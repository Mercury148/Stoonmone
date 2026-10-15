"use strict";

/* ==========================================================
   Stoonmone: die ganze Logik der App in einer Datei.

   Aufbau:
   1. Einstellungen und Listenregeln
   2. Zustand (die Daten, die sich ändern)
   3. Hilfsfunktionen
   4. Speichern und Laden
   5. Troupe-Logik (hinzufügen, entfernen, prüfen)
   ---------- allowed-faction helpers
   6. Anzeige (render...-Funktionen bauen die Oberfläche)
   7. Start
   ========================================================== */


/* ---------- 1. Einstellungen und Listenregeln ---------- */

// Alle Listenregeln stehen hier an einer Stelle.
// Passe sie an das Regelbuch an.
const RULES = {
  maxModels: 8,               // so viele Modelle gehören in eine Troupe
  allowDuplicates: false,     // darf derselbe Charakter zweimal vorkommen? // 
};

const STORAGE_KEY = "Stoonmone-troupe-v1";


/* ---------- 2. Zustand ---------- */

let data = { meta: {}, factions: [], characters: [] };
const characterById = new Map();   // schneller Zugriff über die ID
const factionById = new Map();

// Was der Nutzer gerade im Filter eingestellt hat
const filters = { query: "", faction: "", keywords: new Set() };

// Die aktuelle Troupe: ein Name und eine Liste von Charakter-IDs
let troupe = { name: "Meine Troupe", ids: [] };


/* ---------- 3. Hilfsfunktionen ---------- */

const $ = (selector) => document.querySelector(selector);

// Baut ein HTML-Element. Beispiel: el("p", { class: "x", text: "Hallo" })
// Texte werden immer als reiner Text eingesetzt (textContent), nie als HTML.
// Das schützt davor, dass importierte Codes Schadcode einschleusen.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;   // leere Eigenschaften überspringen
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// Kleine Meldung unten auf dem Bildschirm
let toastTimer;
function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 2600);
}

// Farbe einer Fraktion: Farbton (hue) und optional Sättigung (sat, in Prozent).
// sat = 0 ergibt Grau. Ohne Angabe bleibt es bei 55.
function factionStyle(faction) {
  const sat = faction.sat ?? 55;
  return `--h:${faction.hue}; --fac-s:${sat}%`;
}

// Ein Charakter kann in mehreren Fraktionen spielbar sein.
// Für Farben nehmen wir die erste Fraktion in seiner Liste.
function primaryFaction(character) {
  return factionById.get(character.factions[0]);
}

// Die Zeile mit allen Fraktionen eines Charakters: Farbpunkt und Name je Fraktion
function factionLine(character) {
  const parts = character.factions.map((id) => {
    const faction = factionById.get(id);
    return el("span", { class: "faction-tag" },
      el("span", { class: "dot", style: factionStyle(faction) }),
      faction.name
    );
  });
  return el("span", { class: "card-faction" }, ...parts);
}

// Das Porträt: ein Bild, falls der Charakter eines hat, sonst ein Kreis mit Initialen.
function portrait(character, extraClass = "") {
  const faction = primaryFaction(character);
  const box = el("div", { class: `portrait ${extraClass}`, style: factionStyle(faction), "aria-hidden": "true" });
  if (character.image) box.append(el("img", { src: character.image, alt: "", loading: "lazy" }));
  else box.textContent = initials(character.name);
  return box;
}


/* ---------- 4. Speichern und Laden ---------- */

// Alles in try/catch, weil localStorage in manchen Fällen nicht verfügbar ist
// (zum Beispiel im privaten Modus). Dann läuft die App trotzdem weiter.

function saveTroupe() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(troupe)); } catch { /* ignorieren */ }
}

function loadTroupe() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) troupe = sanitize(JSON.parse(raw));
  } catch { /* ignorieren */ }
}

// Gespeicherte oder importierte Daten nie blind glauben: nur bekannte IDs behalten.
function sanitize(saved) {
  const ids = Array.isArray(saved.ids) ? saved.ids.filter((id) => characterById.has(id)) : [];
  const name = typeof saved.name === "string" && saved.name.trim() ? saved.name.slice(0, 40) : "Meine Troupe";
  return { name, ids: ids.slice(0, RULES.maxModels) };
}

// Troupe in einen kurzen Text verwandeln (zum Kopieren) und zurück.
function encodeTroupe() {
  const json = JSON.stringify({ v: 1, n: troupe.name, ids: troupe.ids });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function decodeTroupe(code) {
  const binary = atob(code.trim());
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (obj.v !== 1) throw new Error("Unbekanntes Format");
  return { name: obj.n, ids: obj.ids };
}


/* ---------- 5. Troupe-Logik ---------- */

// Prüft, ob ein Charakter hinzugefügt werden darf.
// Gibt einen Fehlertext zurück, oder null, wenn alles in Ordnung ist.
function checkAdd(id) {
  const character = characterById.get(id);
  if (troupe.ids.length >= RULES.maxModels) {
    return `Die Troupe ist voll (${RULES.maxModels} Modelle).`;
  }
  if (!RULES.allowDuplicates && troupe.ids.includes(id)) {
    return `${character.name} ist schon in der Troupe.`;  
  }

  return null;
}

function addToTroupe(id) {
  const problem = checkAdd(id);
  if (problem) return toast(problem);
  troupe.ids.push(id);
  saveTroupe();
  renderAll();
  toast(`${characterById.get(id).name} hinzugefügt.`);
}

function removeFromTroupe(index) {
  troupe.ids.splice(index, 1);
  saveTroupe();
  renderAll();
}

function importTroupe(code) {
  let parsed;
  try {
    parsed = decodeTroupe(code);
  } catch {
    return toast("Der Code konnte nicht gelesen werden.");
  }
  // Modelle der Reihe nach einsetzen und dabei die Regeln prüfen
  troupe = { name: sanitize({ name: parsed.name, ids: [] }).name, ids: [] };
  let skipped = 0;
  for (const id of Array.isArray(parsed.ids) ? parsed.ids : []) {
    if (!characterById.has(id) || checkAdd(id)) skipped++;
    else troupe.ids.push(id);
  }
  saveTroupe();
  renderAll();
  toast(skipped ? `Geladen. ${skipped} Eintrag/Einträge passten nicht und wurden übersprungen.` : "Troupe geladen.");
}


/* ---------- Filtern ---------- */

function visibleCharacters() {
  const query = filters.query.trim().toLowerCase();
  return data.characters.filter((c) => {
    // Ein Charakter erscheint in jeder Fraktion, zu der er gehört
    if (filters.faction && !c.factions.includes(filters.faction)) return false;
    // Alle gewählten Keywords müssen zutreffen (UND-Verknüpfung)
    for (const keyword of filters.keywords) if (!c.keywords.includes(keyword)) return false;
    if (query) {
      const text = [
        c.name,
        ...c.keywords,
        ...c.factions.map((id) => factionById.get(id).name),
        ...c.abilities.flatMap((a) => [a.name, a.text]),
      ].join(" ").toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
}


/* ---------- 6. Anzeige ---------- */

function renderAll() {
  renderCards();
  renderTroupe();
  $("#badge").textContent = `${troupe.ids.length}/${RULES.maxModels}`;
}

function renderFilterControls() {
  const select = $("#faction");
  select.replaceChildren(
    el("option", { value: "", text: "Alle Fraktionen" }),
    ...data.factions.map((f) => el("option", { value: f.id, text: f.name }))
  );
  select.value = filters.faction;   // gewählte Fraktion nach dem Neuaufbau wieder anzeigen

  const allKeywords = [...new Set(data.characters.flatMap((c) => c.keywords))].sort((a, b) => a.localeCompare(b, "de"));
  $("#chips").replaceChildren(
    ...allKeywords.map((keyword) =>
      el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(filters.keywords.has(keyword)),
        text: keyword,
        onclick: () => {
          if (filters.keywords.has(keyword)) filters.keywords.delete(keyword);
          else filters.keywords.add(keyword);
          renderFilterControls();
          renderCards();
        },
      })
    )
  );

 // Die Überschrift des Feldes zeigt, welche Keywords gerade gewählt sind

  const picked = [...filters.keywords];
  const summary = $("#keyword-summary");
  summary.textContent = "Keywords";
  if (picked.length) summary.append(el("span", { class: "keyword-selected", text: picked.join(", ") }));
}

function renderCards() {
  const list = visibleCharacters();
  $("#count").textContent = `${list.length} von ${data.characters.length} Charakteren`;
  const active = filters.query || filters.faction || filters.keywords.size;
  $("#reset").hidden = !active;

  if (list.length === 0) {
    $("#cards").replaceChildren(el("p", { class: "empty", text: "Kein Charakter passt zu diesen Filtern." }));
    return;
  }

  $("#cards").replaceChildren(
    ...list.map((c) => {
      const inTroupe = troupe.ids.includes(c.id);
      return el("article", { class: "card" },
        el("button", { class: "card-main", type: "button", onclick: () => openDetail(c.id), "aria-label": `${c.name}: Details öffnen` },
          portrait(c),
          el("div", { class: "card-text" },
            el("span", { class: "card-name", text: c.name }),
            factionLine(c),
            c.keywords.length ? el("span", { class: "card-kw", text: c.keywords.join(" · ") }) : null
          )
        ),
        el("button", {
          class: "card-add",
          type: "button",
          "aria-label": `${c.name} zur Troupe hinzufügen`,
          "aria-disabled": String(inTroupe),
          text: inTroupe ? "In Troupe" : "Hinzufügen",
          onclick: () => addToTroupe(c.id),
        })
      );
    })
  );
}

function renderTroupe() {
  const max = RULES.maxModels;
  const count = troupe.ids.length;

  $("#troupe-name").value = troupe.name;
  $("#slots").replaceChildren(
    ...Array.from({ length: max }, (_, i) => el("span", { class: i < count ? "slot filled" : "slot" }))
  );
  $("#troupe-count").textContent = count === max ? `${count} von ${max} Modellen. Die Troupe ist komplett.` : `${count} von ${max} Modellen`;
  $("#troupe-empty").hidden = count > 0;
  $("#clear").disabled = count === 0;

  $("#members").replaceChildren(
    ...troupe.ids.map((id, index) => {
      const c = characterById.get(id);
      return el("li", { class: "member" },
        el("button", { class: "open", type: "button", onclick: () => openDetail(id), "aria-label": `${c.name}: Details öffnen` },
          portrait(c),
          el("div", { class: "card-text" },
            el("span", { class: "card-name", text: c.name }),
            factionLine(c)
          )
        ),
        el("button", { class: "ghost remove", type: "button", "aria-label": `${c.name} entfernen`, text: "Entfernen", onclick: () => removeFromTroupe(index) })
      );
    })
  );

  $("#export-code").value = count ? encodeTroupe() : "";
}

// Detailansicht in einem <dialog>-Fenster
function openDetail(id) {
  const c = characterById.get(id);
  const problem = checkAdd(id);

  // Die Knöpfe unten sind in beiden Varianten gleich
  const actions = el("div", { class: "detail-actions" },
    el("button", {
      type: "button",
      text: troupe.ids.includes(id) ? "Schon in der Troupe" : "Zur Troupe hinzufügen",
      disabled: problem ? "" : null,
      onclick: () => { addToTroupe(id); $("#detail").close(); },
    }),
    el("button", { class: "ghost", type: "button", text: "Schließen", onclick: () => $("#detail").close() })
  );
  const hint = problem && !troupe.ids.includes(id) ? el("p", { class: "hint", text: problem }) : null;

  // Variante 1: Der Charakter hat ein Kartenbild, dann zeigen wir nur das Bild
  if (c.card) {
    $("#detail-body").replaceChildren(
      el("div", { class: "detail" },
        el("img", { class: "card-image", src: c.card, alt: `Charakterkarte: ${c.name}` }),
        actions,
        hint
      )
    );
    $("#detail").showModal();
    return;
  }

  // Variante 2: kein Bild, dann Text. Werte und Regeln erscheinen nur, wenn sie eingetragen sind.
  const stat = (label, value) => el("div", {}, el("dt", { text: label }), el("dd", { text: String(value) }));
  const hasAbilities = c.abilities.length > 0;

  $("#detail-body").replaceChildren(
    el("div", { class: "detail" },
      el("div", { class: "detail-head" },
        portrait(c, "big"),
        el("div", {},
          el("h2", { text: c.name }),
          factionLine(c)
        )
      ),
      c.keywords.length ? el("div", { class: "tag-row" }, ...c.keywords.map((k) => el("span", { class: "tag", text: k }))) : null,
      c.stats
        ? el("dl", { class: "stats" }, stat("Leben", c.stats.leben), stat("Energie", c.stats.energie), stat("Bewegung", c.stats.bewegung))
        : null,
      hasAbilities
        ? el("ul", { class: "abilities" },
            ...c.abilities.map((a) => el("li", {}, el("h3", { text: a.name }), el("p", { text: a.text }))))
        : el("p", { class: "hint", text: "Werte und Regeltexte sind noch nicht eingetragen." }),
      actions,
      hint
    )
  );
  $("#detail").showModal();
}

function showTab(name) {
  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  }
  $("#view-compendium").hidden = name !== "compendium";
  $("#view-troupe").hidden = name !== "troupe";
  window.scrollTo(0, 0);
}


/* ---------- 7. Start ---------- */

function wireEvents() {
  $("#search").addEventListener("input", (e) => { filters.query = e.target.value; renderCards(); });
  $("#faction").addEventListener("change", (e) => { filters.faction = e.target.value; renderCards(); });
  $("#reset").addEventListener("click", () => {
    filters.query = ""; filters.faction = ""; filters.keywords.clear();
    $("#search").value = ""; $("#faction").value = "";
    renderFilterControls(); renderCards();
  });

  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  }

  $("#troupe-name").addEventListener("input", (e) => {
    troupe.name = e.target.value.slice(0, 40);
    saveTroupe();
    $("#export-code").value = troupe.ids.length ? encodeTroupe() : "";
  });

  // "Troupe leeren" braucht zwei Tipper. Das ersetzt confirm(), das nicht überall funktioniert.
  let clearArmed = false;
  $("#clear").addEventListener("click", (e) => {
    if (!clearArmed) {
      clearArmed = true;
      e.target.textContent = "Wirklich leeren?";
      e.target.classList.add("danger");
      setTimeout(() => { clearArmed = false; e.target.textContent = "Troupe leeren"; e.target.classList.remove("danger"); }, 3000);
      return;
    }
    clearArmed = false;
    e.target.textContent = "Troupe leeren";
    e.target.classList.remove("danger");
    troupe.ids = [];
    saveTroupe();
    renderAll();
  });

  $("#copy").addEventListener("click", async () => {
    const field = $("#export-code");
    if (!field.value) return toast("Noch nichts zu kopieren.");
    try {
      await navigator.clipboard.writeText(field.value);
      toast("Code kopiert.");
    } catch {
      field.select();
      toast("Bitte den markierten Code manuell kopieren.");
    }
  });
  $("#import").addEventListener("click", () => {
    const code = $("#import-code").value;
    if (!code.trim()) return toast("Bitte zuerst einen Code einfügen.");
    importTroupe(code);
    $("#import-code").value = "";
  });

  // Klick auf den abgedunkelten Rand schließt das Detailfenster
  $("#detail").addEventListener("click", (e) => { if (e.target === $("#detail")) $("#detail").close(); });
}

// Prüft die Daten und meldet Fehler in verständlichen Sätzen.
// Gibt eine Liste von Problemen zurück (leer = alles in Ordnung).
function checkData() {
  const problems = [];
  const seen = new Set();
  for (const c of data.characters) {
    if (seen.has(c.id)) problems.push(`Die ID „${c.id}“ kommt mehrfach vor.`);
    seen.add(c.id);
    for (const fid of c.factions) {
      if (!factionById.has(fid)) problems.push(`${c.name}: unbekannte Fraktion „${fid}“.`);
    }
    if (!Array.isArray(c.keywords) || !Array.isArray(c.abilities)) {
      problems.push(`${c.name}: „keywords“ und „abilities“ müssen Listen sein, notfalls leer [].`);
    }
  }
  return problems;
}

async function boot() {
  wireEvents();

  try {
    const response = await fetch("data/characters.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (err) {
    $("#cards").replaceChildren(el("p", { class: "empty", text:
      `Die Daten konnten nicht geladen werden (${err.message}). Prüfe, ob data/characters.json im Repository liegt und gültig ist.` }));
    return;
  }

  data.factions.forEach((f) => factionById.set(f.id, f));
  // Alte Einträge mit nur einer Fraktion ("faction") funktionieren weiter
  data.characters.forEach((c) => {
    if (!c.factions) c.factions = [c.faction];
    characterById.set(c.id, c);
  });

  // Fehler in der JSON nicht stumm schlucken, sondern anzeigen
  const problems = checkData();
  if (problems.length) {
    $("#cards").replaceChildren(
      el("p", { class: "empty", text: "In data/characters.json stimmt etwas nicht:" }),
      el("ul", {}, ...problems.slice(0, 10).map((p) => el("li", { text: p })))
    );
    return;
  }

  if (data.meta && data.meta.note) {
    $("#data-note").textContent = data.meta.note;
    $("#data-note").hidden = false;
  }

  loadTroupe();
  renderFilterControls();
  renderAll();

  // Offline-Funktion einschalten. Wenn das nicht klappt, läuft die App einfach ohne.
  try {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch { /* ignorieren */ }
}

boot();
