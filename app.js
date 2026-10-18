"use strict";

/* ==========================================================
   Stoonmone: die ganze Logik der App in einer Datei.

   Aufbau:
   1. Einstellungen und Listenregeln
   2. Zustand (die Daten, die sich ändern)
   3. Hilfsfunktionen
   4. Speichern und Laden
   5. Filter-Bereich (wird im Kompendium und im Editor benutzt)
   6. Troupe-Logik
   7. Anzeige (render...-Funktionen bauen die Oberfläche)
   8. Start

   Die App hat drei Ansichten:
   - Kompendium: nur nachschlagen, nichts hinzufügen
   - Troupen: Übersicht aller gespeicherten Troupen mit "+"
   - Editor: eine Troupe zusammenstellen (kleine Kacheln)
   ========================================================== */


/* ---------- 1. Einstellungen und Listenregeln ---------- */

// Alle Listenregeln stehen hier an einer Stelle.
const RULES = {
  allowDuplicates: false,     // darf derselbe Charakter zweimal in einer Troupe vorkommen?
  maxPerKeyword: {},          // Beispiel: { "Noble": 1 } = höchstens 1 Modell mit diesem Keyword
  sameFaction: true,          // alle Modelle einer Troupe müssen mindestens eine gemeinsame Fraktion haben
};

const STORAGE_KEY = "mondbuch-troupes-v2";     // alle gespeicherten Troupen
// Frühere Versionen mit nur einer Troupe (wird übernommen, falls vorhanden)
const OLD_STORAGE_KEYS = ["Stoonmone-troupe-v1", "mondbuch-troupe-v1"];
const MAX_TROUPES = 30;                        // so viele Troupen lassen sich speichern


/* ---------- 2. Zustand ---------- */

let data = { meta: {}, factions: [], characters: [] };
const characterById = new Map();
const factionById = new Map();

// Alle gespeicherten Troupen. Jede hat eine ID, einen Namen und eine Liste von Charakter-IDs.
let troupes = [];

// Die Troupe, die gerade im Editor offen ist (dasselbe Objekt wie in der Liste), sonst null
let current = null;

// Zwei getrennte Filter-Bereiche: einer im Kompendium, einer im Editor
let compendiumPanel;
let editorPanel;


/* ---------- 3. Hilfsfunktionen ---------- */

const $ = (selector) => document.querySelector(selector);

// Baut ein HTML-Element. Beispiel: el("p", { class: "x", text: "Hallo" })
// Texte werden immer als reiner Text eingesetzt (textContent), nie als HTML.
// Das schützt davor, dass importierte Codes Schadcode einschleusen.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
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

let toastTimer;
function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 2600);
}

// Ein Knopf, der zwei Tipper braucht (erst "Wirklich?", dann die Aktion).
function twoTap(button, armedText, action) {
  const idleText = button.textContent;
  let armed = false;
  let timer;
  const reset = () => {
    armed = false;
    button.textContent = idleText;
    button.classList.remove("danger");
  };
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.textContent = armedText;
      button.classList.add("danger");
      timer = setTimeout(reset, 3000);
      return;
    }
    clearTimeout(timer);
    reset();
    action();
  });
}

// Farbe einer Fraktion: Farbton (hue) und optional Sättigung (sat). sat = 0 ergibt Grau.
function factionStyle(faction) {
  const sat = faction.sat ?? 55;
  return `--h:${faction.hue}; --fac-s:${sat}%`;
}

// Für Farben nehmen wir die erste Fraktion eines Charakters.
function primaryFaction(character) {
  return factionById.get(character.factions[0]);
}

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

// Porträt: Bild, falls vorhanden, sonst Kreis mit Initialen. extraClass: "big", "small" oder "mini".
function portrait(character, extraClass = "") {
  const faction = primaryFaction(character);
  const box = el("div", { class: `portrait ${extraClass}`, style: factionStyle(faction), "aria-hidden": "true" });
  if (character.image) box.append(el("img", { src: character.image, alt: "", loading: "lazy" }));
  else box.textContent = initials(character.name);
  return box;
}

// Beschworene Charaktere haben in der JSON das Feld "summonedBy": eine Liste mit den IDs der Modelle,
// die sie beschwören können. Sie erscheinen nicht zur Auswahl im Troupen-Editor, sondern automatisch
// in einer eigenen Zeile, sobald eines dieser Modelle in der Troupe ist. Sie zählen nicht zu den 8 Modellen.
function isSummoned(character) {
  return Array.isArray(character.summonedBy) && character.summonedBy.length > 0;
}

function summonsFor(t) {
  return data.characters.filter((c) => isSummoned(c) && c.summonedBy.some((id) => t.ids.includes(id)));
}

function troupeLabel(t) {
  return t.name.trim() || "Unnamed";
}


/* ---------- 4. Speichern und Laden ---------- */

// Alles in try/catch, weil localStorage manchmal nicht verfügbar ist (zum Beispiel im privaten Modus).

function newId() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveTroupes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, items: troupes }));
  } catch { /* ignorieren */ }
}

function loadTroupes() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      saved = JSON.parse(raw);
    } else {
      // Die einzelne Troupe aus der ersten Version übernehmen
      for (const key of OLD_STORAGE_KEYS) {
        const old = localStorage.getItem(key);
        if (old) { saved = { items: [JSON.parse(old)] }; break; }
      }
    }
  } catch { /* ignorieren */ }

  const usedIds = new Set();
  const items = Array.isArray(saved?.items) ? saved.items.slice(0, MAX_TROUPES) : [];
  troupes = items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      let id = typeof item.id === "string" && item.id ? item.id : newId();
      while (usedIds.has(id)) id = newId();
      usedIds.add(id);
      return { id, ...sanitize(item) };
    })
    // Eine frühere Version hat immer eine leere Standard-Troupe angelegt. Die lassen wir weg.
    .filter((t, _, all) => t.ids.length > 0 || all.length > 1 || t.name !== "Meine Troupe");
}

// Gespeicherte oder importierte Daten nie blind glauben: nur bekannte IDs behalten.
function sanitize(saved) {
  const ids = Array.isArray(saved.ids) ? saved.ids.filter((id) => characterById.has(id) && !isSummoned(characterById.get(id))) : [];
  const name = typeof saved.name === "string" && saved.name.trim() ? saved.name.slice(0, 40) : "Meine Troupe";
  const format = validFormat(saved.format);
  return { name, format, ids: ids.slice(0, formatById.get(format).max) };
}

// Troupe in einen kurzen Text verwandeln (zum Kopieren) und zurück.
// Jeder Charakter wird dabei durch 4 Zeichen ersetzt (ein fester Kurzwert seiner ID, siehe idCode).
// Aufbau: TTG2.<Format>.<Charaktere>.<Name>, zum Beispiel TTG2.5-8.k3j9a0x2m4p1.Meine%20Troupe
// Alte, längere Codes (Version 1) lassen sich weiterhin laden.
const CODE_PREFIX = "TTG2.";
const idByCode = new Map();   // Kurzwert -> Charakter-ID (wird beim Start gefüllt)

// Fester Kurzwert aus der ID: gleiche ID ergibt immer dieselben 4 Zeichen (Ziffern und Kleinbuchstaben).
function idCode(id) {
  let h = 2166136261;                        // FNV-1a
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1679616).toString(36).padStart(4, "0");   // 36^4 Möglichkeiten
}

function encodeTroupe(t) {
  return `${CODE_PREFIX}${formatOf(t).id}.${t.ids.map(idCode).join("")}.${encodeURIComponent(t.name)}`;
}

function decodeTroupe(code) {
  code = code.trim();
  if (code.startsWith(CODE_PREFIX)) {
    const rest = code.slice(CODE_PREFIX.length);
    const first = rest.indexOf(".");
    const second = rest.indexOf(".", first + 1);
    if (first < 0 || second < 0) throw new Error("Unbekanntes Format");
    const chars = rest.slice(first + 1, second);
    if (chars.length % 4 !== 0) throw new Error("Unbekanntes Format");
    const ids = [];
    for (let i = 0; i < chars.length; i += 4) ids.push(idByCode.get(chars.slice(i, i + 4)) || null);   // null = unbekannt
    return { name: decodeURIComponent(rest.slice(second + 1)), format: rest.slice(0, first), ids };
  }
  // Version 1 (lang): Base64 mit allen IDs im Klartext
  const binary = atob(code);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (obj.v !== 1) throw new Error("Unbekanntes Format");
  return { name: obj.n, format: obj.f, ids: obj.ids };
}


/* ---------- 5. Filter-Bereich ---------- */

// Eigene, einfache Symbole für die Fraktionen (keine offiziellen Logos).
// Ein eigenes Bild geht so: in der JSON bei der Fraktion "icon": "images/dominion.svg" eintragen.
const FACTION_ICONS = {
  commonwealth: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',   // Sonne
  dominion: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',   // Sichelmond
  leshavult: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l8-8"/>',
  shades: '<path d="M6 20V11a6 6 0 0112 0v9l-3-2-3 2-3-2z"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="11" r="1"/>',
};

function factionIcon(faction) {
  const box = el("span", { class: "faction-icon", "aria-hidden": "true" });
  if (faction.icon) {
    box.append(el("img", { src: faction.icon, alt: "" }));
  } else if (FACTION_ICONS[faction.id]) {
    // Die Pfade stammen aus der Konstante oben, nicht aus Nutzereingaben
    box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${FACTION_ICONS[faction.id]}</svg>`;
  } else {
    box.textContent = initials(faction.name);   // Ersatz: Anfangsbuchstaben
  }
  return box;
}

// Baut Suchfeld, Fraktionsauswahl und Keyword-Box in einen Container.
// Jeder Bereich hat seinen eigenen Zustand, deshalb stören sich Kompendium und Editor nicht.
// onChange wird aufgerufen, wenn sich ein Filter ändert. getList liefert die gefilterten Charaktere.
function createFilterPanel(container, onChange) {
  const state = { query: "", factions: new Set(), keywords: new Set() };
  let allowed = null;   // optional: Fraktionen, die noch möglich sind (abgedunkelt, wenn nicht)

  const search = el("input", { type: "search", placeholder: "Search (name, keyword, ability)", "aria-label": "Search", autocomplete: "off" });
  const factionRow = el("div", { class: "faction-row", role: "group", "aria-label": "Factions" });
  const summary = el("summary", {});
  const chips = el("div", { class: "chips" });
  const box = el("details", { class: "keyword-box" }, summary, chips);
  const count = el("span", {});
  const reset = el("button", { class: "link", type: "button", text: "Reset filters" });
  const meta = el("div", { class: "filter-meta" }, count, reset);

  container.replaceChildren(el("div", { class: "filters" }, search, box, factionRow, meta));

  const allKeywords = [...new Set(data.characters.flatMap((c) => c.keywords))].sort((a, b) => a.localeCompare(b, "en"));

  // Fraktionssymbole: mehrere können gleichzeitig gewählt sein (ODER-Verknüpfung)
  function renderFactions() {
    factionRow.replaceChildren(
      ...data.factions.map((f) =>
        el("button", {
          class: allowed && !allowed.has(f.id) ? "faction-btn blocked" : "faction-btn",
          type: "button",
          style: factionStyle(f),
          title: f.name,
          "aria-pressed": String(state.factions.has(f.id)),
          onclick: () => {
            if (state.factions.has(f.id)) state.factions.delete(f.id);
            else state.factions.add(f.id);
            renderFactions();
            onChange();
          },
        },
          factionIcon(f),
          el("span", { class: "faction-name", text: f.name })
        )
      )
    );
  }

  function renderKeywords() {
    chips.replaceChildren(
      ...allKeywords.map((keyword) =>
        el("button", {
          class: "chip",
          type: "button",
          "aria-pressed": String(state.keywords.has(keyword)),
          text: keyword,
          onclick: () => {
            if (state.keywords.has(keyword)) state.keywords.delete(keyword);
            else state.keywords.add(keyword);
            renderKeywords();
            onChange();
          },
        })
      )
    );
    summary.textContent = "Keywords";
    if (state.keywords.size) summary.append(el("span", { class: "keyword-selected", text: [...state.keywords].join(", ") }));
  }

  search.addEventListener("input", () => { state.query = search.value; onChange(); });
  reset.addEventListener("click", () => {
    state.query = ""; state.factions.clear(); state.keywords.clear();
    search.value = "";
    renderKeywords();
    renderFactions();
    onChange();
  });

  renderKeywords();
  renderFactions();

  return {
    // Die gefilterten Charaktere
    list() {
      const query = state.query.trim().toLowerCase();
      return data.characters.filter((c) => {
        if (state.factions.size && !c.factions.some((f) => state.factions.has(f))) return false;
        // Mehrere Keywords: es genügt eines davon (Human, Noble = Human oder Noble oder beides)
        if (state.keywords.size && !c.keywords.some((k) => state.keywords.has(k))) return false;
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
    },
    // Zählzeile aktualisieren
    showCount(shown, total = data.characters.length) {
      count.textContent = `${shown} of ${total} characters`;
      reset.hidden = !(state.query || state.factions.size || state.keywords.size);
    },
    // Alle Filter leeren (zum Beispiel beim Öffnen des Editors)
    clear() {
      state.query = ""; state.factions.clear(); state.keywords.clear();
      search.value = "";
      renderKeywords();
      renderFactions();
      box.open = false;
    },
    // Fraktionen, die nicht mehr möglich sind, werden abgedunkelt (null = alle möglich)
    setAllowed(set) {
      allowed = set;
      renderFactions();
    },
  };
}


/* ---------- 6. Troupe-Logik ---------- */

// Welche Fraktionen sind für Troupe t noch möglich?
// Leere Troupe: alle. Sonst die Fraktionen, die ALLE bisherigen Modelle gemeinsam haben.
function allowedFactions(t) {
  const all = new Set(data.factions.map((f) => f.id));
  if (!RULES.sameFaction || t.ids.length === 0) return all;
  for (const id of t.ids) {
    const own = characterById.get(id).factions;
    for (const f of [...all]) if (!own.includes(f)) all.delete(f);
  }
  return all;
}

// Die Fraktion einer Troupe: nur wenn genau eine übrig bleibt, sonst null (noch offen)
function troupeFaction(t) {
  if (!RULES.sameFaction || t.ids.length === 0) return null;
  const left = [...allowedFactions(t)];
  return left.length === 1 ? factionById.get(left[0]) : null;
}

function fitsFactions(t, character) {
  const allowed = allowedFactions(t);
  return character.factions.some((f) => allowed.has(f));
}

// Formate: so viele Modelle hat die Troupe (max) und so viele davon treten im Spiel an (play).
// Math.max/min kommen mit Infinity klar: "unlimited" hat keine Grenze.
const FORMATS = [
  { id: "4",         label: "4 models",       max: 4,        play: 4 },
  { id: "5-8",       label: "5 of 8 models",  max: 8,        play: 5 },
  { id: "6-9",       label: "6 of 9 models",  max: 9,        play: 6 },
  { id: "unlimited", label: "Unlimited",      max: Infinity, play: Infinity },
];
const DEFAULT_FORMAT = "5-8";
const formatById = new Map(FORMATS.map((f) => [f.id, f]));
function formatOf(t) { return formatById.get(t.format) || formatById.get(DEFAULT_FORMAT); }
function validFormat(id) { return formatById.has(id) ? id : DEFAULT_FORMAT; }

// Prüft, ob ein Charakter zur Troupe t hinzugefügt werden darf.
// Gibt einen Fehlertext zurück, oder null, wenn alles in Ordnung ist.
function checkAdd(t, id) {
  const character = characterById.get(id);
  if (t.ids.length >= formatOf(t).max) {
    return `The troupe is full (${formatOf(t).max} models).`;
  }
  if (!RULES.allowDuplicates && t.ids.includes(id)) {
    return `${character.name} is already in the troupe.`;
  }
  if (!fitsFactions(t, character)) {
    const names = [...allowedFactions(t)].map((f) => factionById.get(f).name).join(", ");
    return `${character.name} does not fit this troupe. Still possible: ${names}.`;
  }
  for (const [keyword, max] of Object.entries(RULES.maxPerKeyword)) {
    if (!character.keywords.includes(keyword)) continue;
    const count = t.ids.filter((i) => characterById.get(i).keywords.includes(keyword)).length;
    if (count >= max) return `At most ${max} model with "${keyword}" allowed.`;
  }
  return null;
}

// Tippen auf eine Kachel: ist der Charakter schon dabei, wird er entfernt, sonst hinzugefügt.
function toggleMember(id) {
  const index = current.ids.indexOf(id);
  if (index >= 0) {
    current.ids.splice(index, 1);
  } else {
    const problem = checkAdd(current, id);
    if (problem) return toast(problem);
    current.ids.push(id);
  }
  saveTroupes();
  renderEditor();
}

// Charakter über sein Platz-Symbol oben aus der Troupe nehmen
function removeMember(id) {
  const index = current.ids.indexOf(id);
  if (index < 0) return;
  current.ids.splice(index, 1);
  saveTroupes();
  renderEditor();
}

function nextTroupeName() {
  const names = new Set(troupes.map((t) => t.name));
  let n = troupes.length + 1;
  while (names.has(`Troupe ${n}`)) n++;
  return `Troupe ${n}`;
}

function createTroupe() {
  if (troupes.length >= MAX_TROUPES) return toast(`You can save at most ${MAX_TROUPES} troupes.`);
  const created = { id: newId(), name: nextTroupeName(), format: DEFAULT_FORMAT, ids: [] };
  troupes.push(created);
  saveTroupes();
  openEditor(created.id);
}

function deleteTroupe(t) {
  const name = troupeLabel(t);
  troupes = troupes.filter((x) => x !== t);
  saveTroupes();
  renderTroupes();
  toast(`"${name}" deleted.`);
}

// X-Knopf auf der Kachel: erster Tipp fragt nach ("Delete?"), zweiter löscht
function deleteButton(t) {
  let armed = false;
  let timer;
  const button = el("button", { class: "troupe-delete", type: "button", "aria-label": `Delete ${troupeLabel(t)}` },
    el("span", { class: "slot-x", "aria-hidden": "true", text: "×" }));
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.classList.add("armed");
      button.replaceChildren(el("span", { class: "del-text", text: "Delete?" }));
      timer = setTimeout(() => {
        armed = false;
        button.classList.remove("armed");
        button.replaceChildren(el("span", { class: "slot-x", "aria-hidden": "true", text: "×" }));
      }, 3000);
      return;
    }
    clearTimeout(timer);
    deleteTroupe(t);
  });
  return button;
}

// Ein eingefügter Code wird als neue Troupe angelegt und überschreibt nichts.
function importTroupe(code) {
  if (troupes.length >= MAX_TROUPES) {
    return toast(`You can save at most ${MAX_TROUPES} troupes. Delete one first.`);
  }
  let parsed;
  try {
    parsed = decodeTroupe(code);
  } catch {
    return toast("The code could not be read.");
  }
  const created = { id: newId(), name: sanitize({ name: parsed.name, ids: [] }).name, format: validFormat(parsed.format), ids: [] };
  let skipped = 0;
  for (const id of Array.isArray(parsed.ids) ? parsed.ids : []) {
    if (!characterById.has(id) || isSummoned(characterById.get(id)) || checkAdd(created, id)) skipped++;
    else created.ids.push(id);
  }
  troupes.push(created);
  saveTroupes();
  renderTroupes();
  toast(skipped
    ? `"${troupeLabel(created)}" loaded. ${skipped} entr${skipped === 1 ? "y" : "ies"} did not fit and ${skipped === 1 ? "was" : "were"} skipped.`
    : `"${troupeLabel(created)}" loaded.`);
}


/* ---------- 7. Anzeige ---------- */

// --- Kompendium: nur Nachschlagen ---
function renderCards() {
  // Charaktere mit "compendium": false (die beschworene Kopie eines normalen Charakters) bleiben im Kompendium verborgen
  const list = compendiumPanel.list().filter((c) => c.compendium !== false);
  compendiumPanel.showCount(list.length, data.characters.filter((c) => c.compendium !== false).length);

  if (list.length === 0) {
    $("#cards").replaceChildren(el("p", { class: "empty", text: "No character matches these filters." }));
    return;
  }

  $("#cards").replaceChildren(
    ...list.map((c) =>
      el("article", { class: "card" },
        el("button", { class: "card-main", type: "button", onclick: () => openDetail(c.id), "aria-label": `${c.name}: open details` },
          portrait(c),
          el("div", { class: "card-text" },
            el("span", { class: "card-name", text: c.name }),
            factionLine(c),
            c.keywords.length ? el("span", { class: "card-kw", text: c.keywords.join(" · ") }) : null
          )
        )
      )
    )
  );
}

// --- Troupen-Übersicht ---
function troupeMeta(t) {
  const max = formatOf(t).max;
  if (!Number.isFinite(max)) return `${t.ids.length} models, unlimited`;
  return t.ids.length === max ? `${t.ids.length} of ${max} models, complete` : `${t.ids.length} of ${max} models`;
}
// Neu-Knopf: Solange die Karte "New troupe" im sichtbaren Bereich Platz hat, steht sie als Karte
// an der Stelle, an der die nächste Troupe erscheinen würde. Sonst gibt es den runden Knopf unten rechts.
function renderTroupes() {
  $("#troupes-empty").hidden = troupes.length > 0;
  const add = $("#new-troupe");
  add.disabled = troupes.length >= MAX_TROUPES;
  $("#new-wrap").classList.toggle("full", add.disabled);

  const cards = troupes.map((t) => {
    const faction = troupeFaction(t);   // nur wenn die Fraktion feststeht
    return el("div", { class: faction ? "troupe-item has-faction" : "troupe-item", style: faction ? factionStyle(faction) : null },
      el("button", { class: "troupe-card", type: "button", onclick: () => openEditor(t.id) },
        el("span", { class: "troupe-name", text: troupeLabel(t) }),
        el("span", { class: "troupe-meta", text: troupeMeta(t) }),
        el("span", { class: "mini-row", "data-n": String(t.ids.length) }, ...t.ids.map((id) => portrait(characterById.get(id), "mini")))
      ),
      faction ? el("span", { class: "troupe-corner", title: faction.name }, factionIcon(faction)) : null,
      deleteButton(t)
    );
  });
  // Erst als Karte einsetzen und messen, ob sie über der unteren Leiste noch zu sehen ist
  const wrap = $("#new-wrap"), imp = $("#import-open");
  wrap.classList.add("as-card");
  wrap.append(imp);
  $("#troupe-list").replaceChildren(...cards, wrap);
  if ($("#view-troupes").hidden) return;   // unsichtbar: nicht messbar, wird beim Öffnen der Ansicht neu geprüft
  const tabs = document.querySelector(".tabs");
  const limit = tabs ? tabs.getBoundingClientRect().top : window.innerHeight;
  if (wrap.getBoundingClientRect().bottom + window.scrollY > limit) {
    // Kein Platz: zwei runde Knöpfe unten rechts, Import (grün) über dem Plus
    wrap.classList.remove("as-card");
    $("#view-troupes").append(wrap);
  }
}
window.addEventListener("resize", () => renderTroupes());

// --- Editor ---

// Portraitfläche im Hochformat: das Bild des Charakters, sonst eine Silhouette in der Fraktionsfarbe.
// Die Pfade stammen aus dieser Konstante, nicht aus Nutzereingaben.
const SILHOUETTE = '<svg viewBox="0 0 100 125" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><circle cx="50" cy="48" r="22"/><path d="M8 125c0-32 18-46 42-46s42 14 42 46z"/></svg>';

function portraitCard(character) {
  const box = el("span", { class: "pcard", style: factionStyle(primaryFaction(character)), "aria-hidden": "true" });
  if (character.image) box.append(el("img", { src: character.image, alt: "", loading: "lazy" }));
  else box.innerHTML = SILHOUETTE;
  return box;
}

function renderEditor() {
  const max = formatOf(current).max;
  const count = current.ids.length;

  $("#editor-count").textContent = Number.isFinite(max) ? `${count}/${max}` : `${count}/∞`;
  $("#editor-format").value = formatOf(current).id;
  $("#editor-slots").dataset.format = formatOf(current).id;   // das Raster passt sich dem Format an (siehe style.css)
  $("#editor-slots").classList.toggle("nine", max === 9);   // 6/9: Plätze als 3 x 3 Raster

  // Die acht Plätze: gewählte Charaktere als Portrait (Tipp = Karte ansehen), freie Plätze gestrichelt
  $("#editor-slots").replaceChildren(
    ...Array.from({ length: Number.isFinite(max) ? max : Math.max(8, count + 1) }, (_, i) => {
      const id = current.ids[i];
      if (!id) return el("span", { class: "slot-empty" });
      const c = characterById.get(id);
      return el("div", { class: "slot-portrait" },
        el("button", { class: "slot-open", type: "button", "aria-label": `${c.name}: open details`, onclick: () => openDetail(id) },
          portraitCard(c),
          el("span", { class: "tile-label" },
            el("span", { class: "tile-name", text: c.name }),
            el("span", { class: "tile-factions" },
              ...c.factions.map((fid) => el("span", { class: "dot", style: factionStyle(factionById.get(fid)), title: factionById.get(fid).name }))
            )
          )
        ),
        el("button", { class: "slot-remove", type: "button", "aria-label": `Remove ${c.name} from troupe`, onclick: () => removeMember(id) },
          el("span", { class: "slot-x", "aria-hidden": "true", text: "×" })
        )
      );
    })
  );

  // Hinweiszeile: leer = Anleitung. Bleibt genau eine Fraktion übrig, ist das die Fraktion der Troupe.
  const rule = $("#editor-rule");
  const left = [...allowedFactions(current)];
  if (count === 0) {
    rule.textContent = "Tap characters below to add them.";
    rule.hidden = false;
  } else if (RULES.sameFaction && left.length === 1) {
    const faction = factionById.get(left[0]);
    rule.replaceChildren(
      el("span", { class: "rule-faction" },
        el("span", { class: "dot", style: factionStyle(faction) }),
        `Faction: ${faction.name}`
      )
    );
    rule.hidden = false;
  } else {
    rule.hidden = true;   // noch mehrere Fraktionen möglich: nichts anzeigen
  }
  renderSummons();
  editorPanel.setAllowed(RULES.sameFaction && count > 0 ? allowedFactions(current) : null);
  renderTiles();
}

// Die Zeile mit den beschworenen Charakteren: automatisch, nicht entfernbar, ohne Limit
function renderSummons() {
  const list = summonsFor(current);
  $("#editor-summons").hidden = list.length === 0;
  $("#summons-list").replaceChildren(
    ...list.map((c) =>
      el("div", { class: "slot-portrait summoned" },
        el("button", { class: "slot-open", type: "button", "aria-label": `${c.name} (summoned): open details`, onclick: () => openDetail(c.id) },
          portraitCard(c),
          el("span", { class: "tile-label" },
            el("span", { class: "tile-name", text: c.name }),
            el("span", { class: "tile-factions" },
              ...c.factions.map((fid) => el("span", { class: "dot", style: factionStyle(factionById.get(fid)), title: factionById.get(fid).name }))
            )
          )
        )
      )
    )
  );
}

// Nur die Kacheln neu zeichnen (beim Filtern bleibt so das Suchfeld unberührt)
function renderTiles() {
  // Charaktere, die nicht zu den Fraktionen der Troupe passen, werden ausgeblendet
  // Beschworene Charaktere stehen nicht zur Auswahl, sie erscheinen automatisch in ihrer eigenen Zeile
  const fitting = editorPanel.list().filter((c) => !isSummoned(c) && (current.ids.includes(c.id) || fitsFactions(current, c)));
  editorPanel.showCount(fitting.length, data.characters.filter((c) => !isSummoned(c)).length);

  const list = fitting;   // feste Reihenfolge, nichts springt beim Auswählen

  if (list.length === 0) {
    $("#editor-tiles").replaceChildren(el("p", { class: "empty", text: "No character matches these filters." }));
    return;
  }

  $("#editor-tiles").replaceChildren(
    ...list.map((c) => {
      const selected = current.ids.includes(c.id);
      const blocked = !selected && checkAdd(current, c.id) !== null;
      return el("button", {
        class: blocked ? "tile blocked" : "tile",
        type: "button",
        "aria-pressed": String(selected),
        "aria-label": c.name,
        onclick: () => toggleMember(c.id),
      },
        portraitCard(c),
        el("span", { class: "tile-label" },
          el("span", { class: "tile-name", text: c.name }),
          el("span", { class: "tile-factions" },
            ...c.factions.map((id) => el("span", { class: "dot", style: factionStyle(factionById.get(id)), title: factionById.get(id).name }))
          )
        ),
        selected ? el("span", { class: "tile-check", "aria-hidden": "true", text: "✓" }) : null
      );
    })
  );
}

// --- Kartenansicht: die Charakterkarte groß, ein Tipp dreht sie um ---

const HINT_KEY = "stoonmone-hint-flip-v1";   // gesetzt, wenn der Tipp nie mehr erscheinen soll
let hintShownThisSession = false;            // der Tipp erscheint höchstens einmal pro App-Start

function hintDisabled() {
  try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; }
}
function disableHint() {
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* ignorieren */ }
}

// Kleiner Tipp auf der Karte mit "Nicht mehr anzeigen"
function buildFlipHint() {
  hintShownThisSession = true;
  const check = el("input", { type: "checkbox", id: "hint-off" });
  const box = el("div", { class: "card-hint", role: "note" },
    el("p", { text: "Tap the card to flip it and see the signature move." }),
    el("label", { class: "hint-check", for: "hint-off" }, check, "Don't show this again"),
    el("button", { type: "button", text: "Got it", onclick: () => {
      if (check.checked) disableHint();
      box.remove();
    } })
  );
  return box;
}

function openCardView(c) {
  const hasBack = Boolean(c.cardBack);
  let hint = hasBack && !hintDisabled() && !hintShownThisSession ? buildFlipHint() : null;

  const side = el("div", { class: "card-side", text: hasBack ? "Front" : "" });
  const faces = [
    el("div", { class: "card-face" }, el("img", { src: c.card, alt: `Character card: ${c.name}` })),
  ];
  if (hasBack) {
    faces.push(el("div", { class: "card-face back" }, el("img", { src: c.cardBack, alt: `Back of the card with the signature move: ${c.name}` })));
  }
  const inner = el("div", { class: "card-inner" }, ...faces);

  let card;
  if (hasBack) {
    card = el("button", { class: "card-flip", type: "button", "aria-label": "Flip card", "aria-pressed": "false" }, inner);
    card.addEventListener("click", () => {
      const flipped = card.classList.toggle("flipped");
      card.setAttribute("aria-pressed", String(flipped));
      side.textContent = flipped ? "Back" : "Front";
      // Wer umdreht, hat es verstanden: der Tipp erscheint nicht mehr
      if (hint) { hint.remove(); hint = null; }
      disableHint();
    });
  } else {
    card = el("div", { class: "card-flip" }, inner);
  }

  $("#detail-body").replaceChildren(
    el("div", { class: "detail card-wrap" },
      side,
      el("div", { class: "card-stage" }, card, hint),
      el("button", { class: "card-close", type: "button", text: "Close", onclick: () => $("#detail").close() })
    )
  );
  $("#detail").classList.add("card-view");
  $("#detail").showModal();
}

// Detailansicht in einem <dialog>-Fenster (nur Nachschlagen, ohne Hinzufügen)
function openDetail(id) {
  const c = characterById.get(id);
  const close = el("div", { class: "detail-actions" },
    el("button", { class: "ghost", type: "button", text: "Close", onclick: () => $("#detail").close() })
  );

  // Variante 1: Der Charakter hat ein Kartenbild, dann zeigen wir die Karte (mit Rückseite zum Umdrehen)
  if (c.card) return openCardView(c);
  $("#detail").classList.remove("card-view");

  // Variante 2: kein Bild, dann Text. Werte und Regeln erscheinen nur, wenn sie eingetragen sind.
  const stat = (label, value) => el("div", {}, el("dt", { text: label }), el("dd", { text: String(value) }));

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
        ? el("dl", { class: "stats" }, stat("Health", c.stats.leben), stat("Energy", c.stats.energie), stat("Movement", c.stats.bewegung))
        : null,
      c.abilities.length
        ? el("ul", { class: "abilities" },
            ...c.abilities.map((a) => el("li", {}, el("h3", { text: a.name }), el("p", { text: a.text }))))
        : el("p", { class: "hint", text: "Stats and rules text have not been entered yet." }),
      close
    )
  );
  $("#detail").showModal();
}



/* ---------- Gameview: Wunden und Energy im Spiel verfolgen ---------- */

// Im Spiel treten 5 Modelle an (aus den 8 der Troupe). Jedes Modell hat seinen eigenen Energy-Pool.
// Das Feld "health" in der JSON bildet die Lebensleiste der Karte ab, von links nach rechts:
// 1 = blauer Punkt (erzeugt Energy), 0 = leerer Punkt. Wunden werden von rechts gestrichen.
const GAME_KEY = "stoonmone-game-v1";
function gameSize() { return formatOf(current).play; }   // so viele Modelle treten im Spiel an (Infinity = beliebig viele)
let game = null;          // { troupeId, stage, round, own: [ids], foe: [ids], models: { "side:id": { wounds, energy } } }
let foePanel;

function saveGame() {
  try { localStorage.setItem(GAME_KEY, JSON.stringify(game)); } catch { /* ignorieren */ }
}

const MAX_ROUNDS = 5;   // Runde 5 ist "Sudden Death" (Sonnenaufgang)

function loadGame() {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY));
    if (g && typeof g === "object" && Array.isArray(g.own) && Array.isArray(g.foe) && g.models) {
      g.round = Math.min(MAX_ROUNDS, Math.max(1, Number(g.round) || 1));
      return g;
    }
  } catch { /* ignorieren */ }
  return null;
}

function newGame(troupeId) {
  return { troupeId, stage: "setup", round: 1, own: [], foe: [], models: {} };
}

function gameModel(side, id) {
  const key = `${side}:${id}`;
  if (!game.models[key]) game.models[key] = { wounds: 0, energy: 0 };
  return game.models[key];
}

// Die Lebensleiste eines Charakters (oder null, wenn in der JSON noch keine steht)
function healthOf(c) {
  return Array.isArray(c.health) && c.health.length ? c.health : null;
}

// Wie viel Energy erzeugt das Modell zu Beginn der Runde, bei den aktuellen Wunden?
function energyGenerated(c, wounds) {
  const health = healthOf(c);
  if (!health) return null;
  return health.slice(0, Math.max(0, health.length - wounds)).reduce((sum, dot) => sum + (dot ? 1 : 0), 0);
}

// Verwandlung: "transformsInto" steht bei EINEM der beiden Charaktere, die sich ineinander verwandeln.
// twinOf liefert den jeweils anderen (egal, bei welchem von beiden das Feld steht).
function twinOf(c) {
  // "transformsInto" darf ein Text ("striga-anya") oder eine Liste (["striga-anya"]) sein
  const targets = (o) => [].concat(o.transformsInto || []);
  const direct = targets(c).map((id) => characterById.get(id)).find(Boolean);
  if (direct) return direct;
  return data.characters.find((o) => targets(o).includes(c.id)) || null;
}

// Die zweite Zeile: Beschworene, deren Beschwörer im Spiel ist, und der gerade nicht aktive Zwilling
function gameSummons(side) {
  const active = game[side];
  return data.characters.filter((c) => {
    if (active.includes(c.id)) return false;
    const twin = twinOf(c);
    if (twin && active.includes(twin.id)) return true;
    return isSummoned(c) && c.summonedBy.some((id) => active.includes(id));
  });
}

// Verwandeln: Der Zwilling nimmt den Platz ein, Lebenspunkte und Energy bleiben erhalten
function transformModel(side, c) {
  const twin = twinOf(c);
  const i = game[side].indexOf(c.id);
  if (!twin || i < 0) return;
  const old = gameModel(side, c.id);
  const total = healthOf(twin) ? healthOf(twin).length : 30;
  game.models[`${side}:${twin.id}`] = { wounds: Math.min(old.wounds, total), energy: old.energy, summoned: true };
  game.models[`${side}:${c.id}`] = { wounds: 0, energy: 0 };
  game[side][i] = twin.id;
  saveGame();
  renderGamePlay();
}

function openGame() {
  const saved = loadGame();
  game = saved && saved.troupeId === current.id ? saved : newGame(current.id);
  // Modelle, die nicht mehr in der Troupe sind oder nicht mehr existieren, fliegen raus
  game.own = game.own.filter((id) => {
    const c = characterById.get(id);
    if (!c) return false;
    const twin = twinOf(c);   // ein verwandeltes Modell darf an seinem Platz bleiben
    return current.ids.includes(id) || (twin && current.ids.includes(twin.id));
  }).slice(0, gameSize());
  game.foe = game.foe.filter((id) => characterById.has(id)).slice(0, gameSize());
  if (game.own.length === 0 || game.foe.length === 0) game.stage = "setup";
  foePanel.clear();
  foeListOpen = !(Number.isFinite(gameSize()) && game.foe.length >= gameSize());
  foeSummonsOpen = false;
  renderGame();
  showView("game");
}

let foeSummonsOpen = false;   // Liste der möglichen Beschwörungen des Gegners aufgeklappt?
let foeListOpen = true;   // Liste der Gegner-Modelle aufgeklappt?

function toggleGamePick(side, id) {
  const list = game[side];
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else if (list.length >= gameSize()) return toast(`Only ${gameSize()} models play in this format.`);
  else list.push(id);
  // Sind alle Gegner-Modelle gewählt, klappt die Liste ein. Wird eines wieder entfernt, klappt sie auf.
  if (side === "foe" && Number.isFinite(gameSize())) foeListOpen = list.length < gameSize();
  saveGame();
  renderGame();
}

function tileFor(c, selected, onclick) {
  return el("button", { class: "tile", type: "button", "aria-pressed": String(selected), "aria-label": c.name, onclick },
    portraitCard(c),
    el("span", { class: "tile-label" },
      el("span", { class: "tile-name", text: c.name }),
      el("span", { class: "tile-factions" },
        ...c.factions.map((id) => el("span", { class: "dot", style: factionStyle(factionById.get(id)), title: factionById.get(id).name }))
      )
    ),
    selected ? el("span", { class: "tile-check", "aria-hidden": "true", text: "✓" }) : null
  );
}

// Eine kleine Zeile mit - Wert +
function stepper(label, value, onMinus, onPlus) {
  return el("div", { class: "gstep" },
    el("span", { class: "gstep-label", text: label }),
    el("div", { class: "gstep-row" },
      el("button", { class: "ghost", type: "button", "aria-label": `${label}: less`, text: "−", onclick: onMinus }),
      el("span", { class: "gstep-value", text: String(value) }),
      el("button", { class: "ghost", type: "button", "aria-label": `${label}: more`, text: "+", onclick: onPlus })
    )
  );
}

function gameCell(side, c) {
  const m = gameModel(side, c.id);
  const health = healthOf(c);
  const total = health ? health.length : null;
  const remaining = health ? total - m.wounds : null;
  const generated = energyGenerated(c, m.wounds);
  const maxWounds = total === null ? 30 : total;
  const change = (patch) => { Object.assign(m, patch); saveGame(); renderGamePlay(); };

  // Beschworene Charaktere starten ausgegraut. Erst "Summon" bringt sie mit vollen Lebenspunkten und ohne Energy ins Spiel.
  // Der gerade nicht aktive Zwilling steht ausgegraut in der Beschworenen-Zeile (kein Summon-Knopf)
  if (twinOf(c) && !game[side].includes(c.id)) {
    return el("div", { class: "gcell unsummoned" },
      el("div", { class: "gcell-media" },
        el("button", { class: "gcell-portrait", type: "button", "aria-label": `${c.name}: open card`, onclick: () => openDetail(c.id) }, portraitCard(c)),
        el("div", { class: "summon-note", text: "Transformed" })
      ),
      el("div", { class: "gcell-name", text: c.name }),
      el("div", { class: "hboxes none", text: "not in play" })
    );
  }

  // Auch ein beschworenes Modell, das auf 0 Lebenspunkte fällt, geht zurück in den Zustand "nicht im Spiel" und kann neu beschworen werden
  if (isSummoned(c) && !twinOf(c) && (!m.summoned || (health && remaining <= 0))) {
    return el("div", { class: "gcell unsummoned" },
      // Der Summon-Knopf liegt auf dem Portrait, die Kachel wird dadurch nicht größer
      el("div", { class: "gcell-media" },
        el("button", { class: "gcell-portrait", type: "button", "aria-label": `${c.name}: open card`, onclick: () => openDetail(c.id) }, portraitCard(c)),
        el("button", { class: "summon-btn", type: "button", text: "Summon", onclick: () => change({ summoned: true, wounds: 0, energy: 0 }) })
      ),
      el("div", { class: "gcell-name", text: c.name }),
      el("div", { class: "hboxes none", text: "not in play" })
    );
  }

  const boxes = health
    ? el("div", { class: "hboxes", role: "img", "aria-label": `${remaining} of ${total} health boxes left` },
        ...health.map((dot, i) => el("span", { class: `hbox${dot ? " blue" : ""}${i >= remaining ? " struck" : ""}` })))
    : el("div", { class: "hboxes none", text: "no health data" });

  return el("div", { class: `gcell${health && remaining <= 0 ? " dead" : ""}` },
    // Der Transform-Knopf sitzt auf dem Portrait, damit die Kachel gleich groß bleibt wie die anderen
    el("div", { class: "gcell-media" },
      el("button", { class: "gcell-portrait", type: "button", "aria-label": `${c.name}: open card`, onclick: () => openDetail(c.id) }, portraitCard(c)),
      twinOf(c) ? el("button", { class: "transform-btn", type: "button", text: "Transform", "aria-label": `Transform ${c.name} into ${twinOf(c).name}`, onclick: () => transformModel(side, c) }) : null
    ),
    el("div", { class: "gcell-name", text: c.name }),
    boxes,
    health
      // HP = verbleibende Lebenspunkte: "−" streicht ein Kästchen von rechts (eine Wunde), "+" gibt eines zurück
      ? stepper(`HP ${remaining}/${total}`, remaining,
          () => change({ wounds: Math.min(total, m.wounds + 1) }),
          () => change({ wounds: Math.max(0, m.wounds - 1) }))
      : stepper("Wounds", m.wounds,
          () => change({ wounds: Math.max(0, m.wounds - 1) }),
          () => change({ wounds: Math.min(maxWounds, m.wounds + 1) })),
    stepper(generated === null ? "Energy" : `Energy (+${generated})`, m.energy,
      () => change({ energy: Math.max(0, m.energy - 1) }),
      () => change({ energy: m.energy + 1 }))
  );
}

function renderGamePlay() {
  const fill = (side, rowId, summonId, summonWrap) => {
    $(rowId).replaceChildren(...game[side].map((id) => gameCell(side, characterById.get(id))));
    // Reihenfolge: aktuell beschworene Modelle zuerst, dann die übrigen in der normalen Reihenfolge,
    // Zwillinge (z. B. Striga Anya, wird nie aktiv beschworen) ganz am Ende
    const rank = (c) => {
      if (twinOf(c)) return 2;
      const m = gameModel(side, c.id);
      const h = healthOf(c);
      return m.summoned && !(h && m.wounds >= h.length) ? 0 : 1;
    };
    const summons = gameSummons(side)
      .map((c, i) => ({ c, i, r: rank(c) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.c);
    $(summonWrap).hidden = summons.length === 0;
    $(summonId).replaceChildren(...summons.map((c) => gameCell(side, c)));
  };
  fill("foe", "#game-foe-row", "#game-foe-summons", "#game-foe-summon-wrap");
  fill("own", "#game-own-row", "#game-own-summons", "#game-own-summon-wrap");
  const last = game.round >= MAX_ROUNDS;
  $("#game-round").textContent = last ? "Sudden Death" : `Round ${game.round}`;
  // Die Kopfzeile wird von Runde zu Runde röter: die Nacht geht zu Ende, in Runde 5 geht die Sonne auf
  $("#view-game .editor-bar").dataset.round = String(game.round);
  document.body.dataset.round = String(game.round);
  const next = $("#game-next-round");
  next.disabled = last;
  next.textContent = last ? "Last round" : "Next round";
}

// Jedes Modell bekommt die Energy, die es laut Lebensleiste erzeugt. Übrige Energy verfällt dabei.
function generateEnergy() {
  for (const side of ["own", "foe"]) {
    for (const c of [...game[side].map((id) => characterById.get(id)), ...gameSummons(side)]) {
      const m = gameModel(side, c.id);
      if (twinOf(c) && !game[side].includes(c.id)) continue;   // inaktiver Zwilling: nicht im Spiel
      if (isSummoned(c) && !twinOf(c) && (!m.summoned || (healthOf(c) && m.wounds >= healthOf(c).length))) continue;   // nicht im Spiel
      m.energy = energyGenerated(c, m.wounds) || 0;
    }
  }
}

// Spielstart: Runde 1 beginnt schon mit der erzeugten Energy
function startGame() {
  generateEnergy();
  game.round = 1;
  game.stage = "play";
  saveGame();
  renderGame();
  window.scrollTo(0, 0);
}

// Neue Runde: übrige Energy verfällt, danach erzeugt jedes Modell Energy gemäß seiner verbleibenden Lebenspunkte
function nextRound() {
  if (game.round >= MAX_ROUNDS) return;
  generateEnergy();
  game.round += 1;
  saveGame();
  renderGamePlay();
  toast(game.round >= MAX_ROUNDS
    ? "Sudden Death: the sun rises. Old energy expired, new energy generated."
    : `Round ${game.round}: old energy expired, new energy generated.`);
}

function resetGame() {
  game = newGame(current.id);
  saveGame();
  renderGame();
}

// Spalten der Spielansicht: 4 Modelle in 4 Spalten, 5 in 5, 6 als 3x2, sonst 5 nebeneinander
const GAME_COLUMNS = { 4: 4, 5: 5, 6: 3 };

function renderGame() {
  $("#view-game").style.setProperty("--gcols", GAME_COLUMNS[gameSize()] || 5);
  const setup = game.stage === "setup";
  $("#game-setup").hidden = !setup;
  $("#game-play").hidden = setup;
  $("#game-title").textContent = setup ? "Choose models" : "Game";
  $("#game-round").hidden = setup;
  if (setup) { delete $("#view-game .editor-bar").dataset.round; delete document.body.dataset.round; }

  if (setup) {
    const size = gameSize();
    const shown = (n) => (Number.isFinite(size) ? `${n}/${size}` : String(n));
    $("#game-own-count").textContent = shown(game.own.length);
    $("#game-foe-count").textContent = shown(game.foe.length);
    $("#game-own-hint").textContent = Number.isFinite(size) ? `Choose the ${size} models you play this game.` : "Choose the models you play this game.";
    $("#game-own-tiles").replaceChildren(
      ...current.ids.map((id) => characterById.get(id)).map((c) => tileFor(c, game.own.includes(c.id), () => toggleGamePick("own", c.id)))
    );
    // Gewählte Gegner-Modelle stehen oben in leeren Plätzen, damit beim Auswählen nichts springt
    const chosen = game.foe.map((id) => characterById.get(id)).map((c) => tileFor(c, true, () => toggleGamePick("foe", c.id)));
    const slots = Number.isFinite(size) ? Math.max(0, size - chosen.length) : 1;   // voll: kein leerer Platz mehr
    $("#game-foe-chosen").replaceChildren(...chosen, ...Array.from({ length: slots }, () => el("div", { class: "tile-empty", "aria-hidden": "true" })));
    const list = foePanel.list().filter((c) => !isSummoned(c));
    foePanel.showCount(list.length, data.characters.filter((c) => !isSummoned(c)).length);
    $("#game-foe-tiles").replaceChildren(...list.map((c) => tileFor(c, game.foe.includes(c.id), () => toggleGamePick("foe", c.id))));
    // Alle Gegner-Modelle gewählt: Liste einklappen, per Knopf wieder aufklappbar
    const foeFull = Number.isFinite(size) && game.foe.length >= size;
    const collapsed = !foeListOpen;
    $("#game-foe-picker").hidden = collapsed;
    const toggle = $("#game-foe-toggle");
    toggle.hidden = false;   // immer da, damit das Layout gleich bleibt
    toggle.textContent = !collapsed ? "Hide list" : foeFull ? "Change opponent models" : "Show list";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    // Mögliche Beschwörungen der gewählten Gegner-Modelle (nur zum Anschauen, Tippen öffnet die Karte)
    const possible = gameSummons("foe");
    const sumToggle = $("#game-foe-summons-toggle");
    sumToggle.textContent = foeSummonsOpen ? "Hide summons" : "Show summons";
    sumToggle.setAttribute("aria-expanded", String(foeSummonsOpen));
    $("#game-foe-summons-panel").hidden = !foeSummonsOpen;
    $("#game-foe-summons-none").hidden = possible.length > 0;
    $("#game-foe-summons-hint").hidden = possible.length === 0;
    $("#game-foe-summons-list").replaceChildren(...possible.map((c) => tileFor(c, false, () => openDetail(c.id))));
    $("#game-start").disabled = game.own.length === 0 || game.foe.length === 0;
  } else {
    renderGamePlay();
  }
}

/* ---------- Ansichten wechseln ---------- */

let lastTab = "compendium";

function showView(name) {
  $("#view-compendium").hidden = name !== "compendium";
  $("#view-troupes").hidden = name !== "troupes";
  $("#view-editor").hidden = name !== "editor";
  $("#view-game").hidden = name !== "game";
  document.body.classList.toggle("editing", name === "editor" || name === "game");
  // Spielansicht: immer dunkel (Nacht), mit eigenem Hintergrund
  document.body.classList.toggle("in-game", name === "game");
  if (name === "game") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  if (name !== "game") delete document.body.dataset.round;
  if (name !== "editor" && name !== "game") {
    lastTab = name;
    for (const tab of document.querySelectorAll("[role=tab]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    }
  }
  window.scrollTo(0, 0);
}

function openEditor(id) {
  current = troupes.find((t) => t.id === id);
  if (!current) return;
  editorPanel.clear();
  $("#editor-name").value = current.name;
  renderEditor();
  showView("editor");
}

function closeEditor() {
  current = null;
  showView("troupes");
  renderTroupes();
}


/* ---------- 8. Start ---------- */

function wireEvents() {
  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.addEventListener("click", () => {
      showView(tab.dataset.tab);
      if (tab.dataset.tab === "troupes") renderTroupes();
    });
  }

  $("#new-troupe").addEventListener("click", createTroupe);
  $("#editor-back").addEventListener("click", closeEditor);

  // Format der Troupe: wie viele Modelle sie hat und wie viele davon spielen
  $("#editor-format").replaceChildren(...FORMATS.map((f) => el("option", { value: f.id, text: f.label })));
  $("#editor-format").addEventListener("change", (e) => {
    const next = formatById.get(e.target.value);
    if (current.ids.length > next.max) {
      toast(`This format allows only ${next.max} models. Remove some first.`);
      e.target.value = formatOf(current).id;
      return;
    }
    current.format = next.id;
    saveTroupes();
    renderEditor();
  });

  $("#start-game").addEventListener("click", () => {
    if (current.ids.length === 0) return toast("Add some models to the troupe first.");
    openGame();
  });
  $("#game-back").addEventListener("click", () => { renderEditor(); showView("editor"); });
  $("#game-foe-summons-toggle").addEventListener("click", () => { foeSummonsOpen = !foeSummonsOpen; renderGame(); });
  $("#game-foe-toggle").addEventListener("click", () => { foeListOpen = !foeListOpen; renderGame(); });
  $("#game-start").addEventListener("click", startGame);
  $("#game-next-round").addEventListener("click", nextRound);
  twoTap($("#game-reset"), "Really reset?", resetGame);

  $("#editor-name").addEventListener("input", (e) => {
    current.name = e.target.value.slice(0, 40);
    saveTroupes();
  });

  // Export: Code direkt in die Zwischenablage
  $("#copy").addEventListener("click", async () => {
    if (!current || !current.ids.length) return toast("Add some models to the troupe first.");
    const code = encodeTroupe(current);
    try {
      await navigator.clipboard.writeText(code);
      toast("Troupe code successfully copied to clipboard.");
    } catch {
      // Ältere Browser: über ein unsichtbares Textfeld kopieren
      const tmp = el("textarea", { readonly: "", style: "position:fixed;left:-9999px;top:0;opacity:0" });
      tmp.value = code;
      document.body.append(tmp);
      tmp.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* ignorieren */ }
      tmp.remove();
      toast(ok ? "Troupe code successfully copied to clipboard." : "Copying failed. Please try again.");
    }
  });

  // Import: Knopf in der Übersicht öffnet ein kleines Fenster zum Einfügen
  $("#import-open").addEventListener("click", () => {
    $("#import-code").value = "";
    $("#import-dialog").showModal();
  });
  $("#import-cancel").addEventListener("click", () => $("#import-dialog").close());
  $("#import-dialog").addEventListener("click", (e) => { if (e.target === $("#import-dialog")) $("#import-dialog").close(); });
  // Enter im Eingabefeld startet den Import (Shift+Enter wäre ein Zeilenumbruch)
  $("#import-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("#import").click();
    }
  });
  $("#import").addEventListener("click", () => {
    const code = $("#import-code").value;
    if (!code.trim()) return toast("Please paste a code first.");
    $("#import-dialog").close();
    importTroupe(code);
    $("#import-code").value = "";
  });

  // Klick auf den abgedunkelten Rand schließt das Detailfenster
  $("#detail").addEventListener("click", (e) => {
    if (e.target === $("#detail") || e.target.classList.contains("card-wrap")) $("#detail").close();
  });
}

// Prüft die Daten und meldet Fehler in verständlichen Sätzen.
function checkData() {
  const problems = [];
  const seen = new Set();
  for (const c of data.characters) {
    if (seen.has(c.id)) problems.push(`The ID "${c.id}" appears more than once.`);
    seen.add(c.id);
    for (const fid of c.factions) {
      if (!factionById.has(fid)) problems.push(`${c.name}: unknown faction "${fid}".`);
    }
    if (c.health !== undefined && !(Array.isArray(c.health) && c.health.every((d) => d === 0 || d === 1))) {
      problems.push(`${c.name}: "health" muss eine Liste aus 0 und 1 sein, zum Beispiel [1,0,1,0,0,1,0,0].`);
    }
    for (const sid of c.summonedBy || []) {
      if (!characterById.has(sid)) problems.push(`${c.name}: "summonedBy" nennt die unbekannte ID "${sid}".`);
    }
    if (!Array.isArray(c.keywords) || !Array.isArray(c.abilities)) {
      problems.push(`${c.name}: "keywords" and "abilities" must be lists, empty [] if necessary.`);
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
      `The data could not be loaded (${err.message}). Check that data/characters.json is in the repository and valid.` }));
    return;
  }

  data.factions.forEach((f) => factionById.set(f.id, f));
  // Alte Einträge mit nur einer Fraktion ("faction") funktionieren weiter
  data.characters.forEach((c) => {
    if (!c.factions) c.factions = [c.faction];
    characterById.set(c.id, c);
    const short = idCode(c.id);
    if (idByCode.has(short)) problems.push(`The troupe code cannot tell "${c.id}" and "${idByCode.get(short)}" apart. Rename one of the ids slightly.`);
    else idByCode.set(short, c.id);
  });

  const problems = checkData();
  if (problems.length) {
    $("#cards").replaceChildren(
      el("p", { class: "empty", text: "Something is wrong in data/characters.json:" }),
      el("ul", {}, ...problems.slice(0, 10).map((p) => el("li", { text: p })))
    );
    return;
  }

  if (data.meta && data.meta.note) {
    $("#data-note").textContent = data.meta.note;
    $("#data-note").hidden = false;
  }

  loadTroupes();
  compendiumPanel = createFilterPanel($("#compendium-filters"), renderCards);
  editorPanel = createFilterPanel($("#editor-filters"), renderTiles);
  foePanel = createFilterPanel($("#game-foe-filters"), renderGame);
  renderCards();
  renderTroupes();

  // Offline-Funktion einschalten. Wenn das nicht klappt, läuft die App einfach ohne.
  try {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch { /* ignorieren */ }
}

boot();