"use strict";

/* ==========================================================
   Stoonmone: die ganze Logik der App in einer Datei.

   Aufbau:
   1. Einstellungen und Listenregeln
   2. Zustand (die Daten, die sich ändern)
   3. Hilfsfunktionen
   4. Speichern und Laden
   5. Troupe-Logik (hinzufügen, entfernen, prüfen)
   6. Anzeige (render...-Funktionen bauen die Oberfläche)
   7. Start
   ========================================================== */


/* ---------- 1. Einstellungen und Listenregeln ---------- */

// Alle Listenregeln stehen hier an einer Stelle.
// Passe sie an das Regelbuch an. Die Regel für "Anführer" ist nur ein Beispiel.
const RULES = {
  maxModels: 8,               // so viele Modelle gehören in eine Troupe
  allowDuplicates: false,     // darf derselbe Charakter zweimal vorkommen?
  maxPerKeyword: { "Anführer": 1 },  // höchstens so viele Modelle mit diesem Keyword
};

const STORAGE_KEY = "stoonmone-troupe-v1";


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

// Farbe einer Fraktion. sat = Sättigung in Prozent, 0 ergibt Grau.
   function factionStyle(faction) {
     const sat = faction.sat ?? 55;   // ohne Angabe bleibt es bei 55
     return `--h:${faction.hue}; --fac-s:${sat}%`;
   }

// Das Porträt: ein Bild, falls der Charakter eines hat, sonst ein Kreis mit Initialen.
function portrait(character, extraClass = "") {
  const faction = factionById.get(character.faction);
  const box = el("div", { class: `portrait ${extraClass}`, style: `--h:${faction.hue}`, "aria-hidden": "true" });
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
  for (const [keyword, max] of Object.entries(RULES.maxPerKeyword)) {
    if (!character.keywords.includes(keyword)) continue;
    const count = troupe.ids.filter((i) => characterById.get(i).keywords.includes(keyword)).length;
    if (count >= max) return `Höchstens ${max} Modell mit „${keyword}“ erlaubt.`;
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
    if (filters.faction && c.faction !== filters.faction) return false;
    // Alle gewählten Keywords müssen zutreffen (UND-Verknüpfung)
    for (const keyword of filters.keywords) if (!c.keywords.includes(keyword)) return false;
    if (query) {
      const text = [c.name, ...c.keywords, ...c.abilities.flatMap((a) => [a.name, a.text])].join(" ").toLowerCase();
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
      const faction = factionById.get(c.faction);
      const inTroupe = troupe.ids.includes(c.id);
      return el("article", { class: "card" },
        el("button", { class: "card-main", type: "button", onclick: () => openDetail(c.id), "aria-label": `${c.name}: Details öffnen` },
          portrait(c),
          el("div", { class: "card-text" },
            el("span", { class: "card-name", text: c.name }),
            el("span", { class: "card-faction" }, el("span", { class: "dot", style: `--h:${faction.hue}` }), faction.name),
            el("span", { class: "card-kw", text: c.keywords.join(" · ") })
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
      const faction = factionById.get(c.faction);
      return el("li", { class: "member" },
        el("button", { class: "open", type: "button", onclick: () => openDetail(id), "aria-label": `${c.name}: Details öffnen` },
          portrait(c),
          el("div", { class: "card-text" },
            el("span", { class: "card-name", text: c.name }),
            el("span", { class: "card-faction" }, el("span", { class: "dot", style: `--h:${faction.hue}` }), faction.name)
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
  const faction = factionById.get(c.faction);
  const problem = checkAdd(id);

  const stat = (label, value) => el("div", {}, el("dt", { text: label }), el("dd", { text: String(value) }));

  $("#detail-body").replaceChildren(
    el("div", { class: "detail" },
      el("div", { class: "detail-head" },
        portrait(c, "big"),
        el("div", {},
          el("h2", { text: c.name }),
          el("span", { class: "card-faction" }, el("span", { class: "dot", style: `--h:${faction.hue}` }), faction.name)
        )
      ),
      el("div", { class: "tag-row" }, ...c.keywords.map((k) => el("span", { class: "tag", text: k }))),
      el("dl", { class: "stats" }, stat("Leben", c.stats.leben), stat("Energie", c.stats.energie), stat("Bewegung", c.stats.bewegung)),
      el("ul", { class: "abilities" },
        ...c.abilities.map((a) => el("li", {}, el("h3", { text: a.name }), el("p", { text: a.text })))
      ),
      el("div", { class: "detail-actions" },
        el("button", {
          type: "button",
          text: troupe.ids.includes(id) ? "Schon in der Troupe" : "Zur Troupe hinzufügen",
          disabled: problem ? "" : null,
          onclick: () => { addToTroupe(id); $("#detail").close(); },
        }),
        el("button", { class: "ghost", type: "button", text: "Schließen", onclick: () => $("#detail").close() })
      ),
      problem && !troupe.ids.includes(id) ? el("p", { class: "hint", text: problem }) : null
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

async function boot() {
  wireEvents();

  try {
    const response = await fetch("data/characters.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch {
    $("#cards").replaceChildren(el("p", { class: "empty", text:
      "Die Daten konnten nicht geladen werden. Öffne die App über einen kleinen lokalen Server (zum Beispiel VS Code mit „Live Server“) und nicht per Doppelklick auf die Datei." }));
    return;
  }

  data.factions.forEach((f) => factionById.set(f.id, f));
  data.characters.forEach((c) => characterById.set(c.id, c));

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
