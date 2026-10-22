"use strict";

/* ==========================================================
   Tauber Tourist Guide: die ganze Logik der App in einer Datei.

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
  // Exklusivität: aus jeder Gruppe darf höchstens EIN Charakter in einer Troupe sein (IDs aus characters.json).
  // Eine weitere Gruppe = eine weitere Zeile in der Liste.
  exclusive: [
    ["grub", "herbert-growbottom"],
  ],
};

const STORAGE_KEY = "ttg-troupes-v1";     // alle gespeicherten Troupen
// Frühere Versionen mit nur einer Troupe (wird übernommen, falls vorhanden)
const OLD_STORAGE_KEYS = [];
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
  // Längere Meldungen bleiben etwas länger stehen
  toastTimer = setTimeout(() => (box.hidden = true), Math.max(2600, message.length * 55));
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
  // Zweite Fraktion für den Verlauf im Ring; bei nur einer Fraktion dieselbe Farbe
  const second = factionById.get(character.factions[1]) || faction;
  const ring = `--h2:${second.hue}; --fac-s2:${second.sat ?? 55}%`;
  const box = el("div", { class: `portrait ${extraClass}`, style: `${factionStyle(faction)}; ${ring}`, "aria-hidden": "true" });
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

// Die Fraktionssymbole aus dem Regelbuch (Bilder in images/factions/). Ein "icon" in der JSON hat Vorrang.
const FACTION_IMAGES = {
  commonwealth: "images/factions/commonwealth.webp",
  dominion: "images/factions/dominion.webp",
  leshavult: "images/factions/leshavult.webp",
  shades: "images/factions/shades.webp",
};

// Doppelwappen für gemischte Fraktionen: images/factions/<a>-<b>.webp (Reihenfolge wie in FACTION_ORDER)
const FACTION_ORDER = ["commonwealth", "dominion", "leshavult", "shades"];
function dualImage(factions) {
  if (factions.length !== 2) return null;
  const ids = factions.map((f) => f.id).sort((a, b) => FACTION_ORDER.indexOf(a) - FACTION_ORDER.indexOf(b));
  if (ids.some((id) => !FACTION_IMAGES[id])) return null;
  return `images/factions/${ids[0]}-${ids[1]}.webp`;
}

// Ein Symbol für eine oder zwei Fraktionen (bei zwei: das Doppelwappen)
function factionsIcon(factions) {
  const image = dualImage(factions);
  if (!image) return null;
  const box = el("span", { class: "faction-icon dual-icon", "aria-hidden": "true" });
  box.append(el("img", { src: image, alt: "", draggable: "false" }));
  return box;
}

function factionIcon(faction) {
  const box = el("span", { class: "faction-icon", "aria-hidden": "true", "data-fac": faction.id });   // data-fac: Größenausgleich in style.css
  const image = faction.icon || FACTION_IMAGES[faction.id];
  if (image) {
    box.append(el("img", { src: image, alt: "", draggable: "false" }));
  } else if (FACTION_ICONS[faction.id]) {
    // Die Pfade stammen aus der Konstante oben, nicht aus Nutzereingaben
    box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${FACTION_ICONS[faction.id]}</svg>`;
  } else {
    box.textContent = initials(faction.name);   // Ersatz: Anfangsbuchstaben
  }
  return box;
}

// Kleines Fraktionssymbol mit Name als Tooltip (Troupe Builder: Kacheln, Plätze, Fraktionszeile)
function factionBadge(faction) {
  const icon = factionIcon(faction);
  icon.removeAttribute("aria-hidden");
  icon.title = faction.name;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", faction.name);
  return icon;
}

// Baut Suchfeld, Fraktionsauswahl und Keyword-Box in einen Container.
// Jeder Bereich hat seinen eigenen Zustand, deshalb stören sich Kompendium und Editor nicht.
// onChange wird aufgerufen, wenn sich ein Filter ändert. getList liefert die gefilterten Charaktere.
function createFilterPanel(container, onChange) {
  const state = { query: "", factions: new Set(), synergies: new Set(), all: false };   // all: false = ODER, true = UND   // "Synergies" = Keywords und Synergien in einem Filter
  let allowed = null;   // optional: Fraktionen, die noch möglich sind (abgedunkelt, wenn nicht)

  const search = el("input", { type: "search", placeholder: " ", "aria-label": "Search (name, keyword, synergy)", autocomplete: "off" });
  // Eigener Platzhalter, damit die Klammer kleiner sein kann als "Search" (verschwindet, sobald etwas getippt wird)
  const searchHint = el("span", { class: "search-hint", "aria-hidden": "true" }, "Search ", el("small", { text: "(name, keyword, synergy)" }));
  const factionRow = el("div", { class: "faction-row", role: "group", "aria-label": "Factions" });
  // Synergien: zusätzliche Schlagwörter pro Charakter ("synergies" in characters.json), die NICHT auf der Karte stehen
  const synSummary = el("summary", {});
  const synChips = el("div", { class: "chips" });
  // Schalter oben rechts im Synergies-Feld: ODER (mindestens ein gewählter Begriff) oder UND (alle gewählten Begriffe)
  const modeBtn = el("button", { class: "mode-btn", type: "button" },
    el("span", { class: "mode-thumb", "aria-hidden": "true" }),
    el("span", { class: "mode-opt", text: "OR" }),
    el("span", { class: "mode-opt", text: "AND" })
  );
  function renderMode() {
    modeBtn.classList.toggle("is-and", state.all);
    modeBtn.title = state.all ? "Character must match ALL selected synergies and factions. Tap to switch to OR." : "Character needs to match at least ONE selected synergy or faction. Tap to switch to AND.";
    modeBtn.setAttribute("aria-label", modeBtn.title);
    modeBtn.setAttribute("aria-pressed", String(state.all));
  }
  modeBtn.addEventListener("click", () => { state.all = !state.all; renderMode(); onChange(); });
  renderMode();
  const synBox = el("details", { class: "keyword-box synergy-box" }, synSummary, synChips);
  const synWrap = el("div", { class: "synergy-wrap" }, synBox);
  // Suchzeile: Eingabe und ganz rechts in der Ecke der OR/AND-Schalter; die Anzahl steht rechts in der Synergies-Zeile; "Reset filters" darunter nur, wenn etwas gefiltert ist
  const count = el("span", { class: "search-count" });
  const searchWrap = el("div", { class: "search-wrap" }, search, searchHint, modeBtn);
  const reset = el("button", { class: "link", type: "button", text: "Reset filters" });
  const meta = el("div", { class: "filter-meta" }, reset);

  // Suche, Synergien und Fraktionen in einer gemeinsamen Box, getrennt durch Linien (wie die FAQs)
  const box = el("div", { class: "filter-box" }, searchWrap, synWrap, factionRow);
  container.replaceChildren(el("div", { class: "filters" }, box, meta));

  // Keywords und Synergien werden zusammengeführt (jeder Begriff nur einmal)
  const allSynergies = [...new Set(data.characters.flatMap((c) => [...c.keywords, ...(c.synergies || [])]))].sort((a, b) => a.localeCompare(b, "en"));
  synWrap.hidden = allSynergies.length === 0;   // ohne Synergien in den Daten wird der Filter nicht angezeigt

  // Fraktionssymbole: mehrere können gleichzeitig gewählt sein (ODER-Verknüpfung)
  function renderFactions() {
    factionRow.replaceChildren(
      ...data.factions.map((f) =>
        el("button", {
          class: allowed && !allowed.has(f.id) ? "faction-btn blocked" : "faction-btn",
          type: "button",
          style: factionStyle(f),
          title: f.name,
          "aria-label": f.name,   // nur das Wappen ist sichtbar, der Name kommt aus Tooltip und aria-label
          "aria-pressed": String(state.factions.has(f.id)),
          onclick: () => {
            if (state.factions.has(f.id)) state.factions.delete(f.id);
            else state.factions.add(f.id);
            renderFactions();
            onChange();
          },
        },
          factionIcon(f)
        )
      )
    );
  }

  function renderSynergies() {
    synChips.replaceChildren(
      ...allSynergies.map((tag) =>
        el("button", {
          class: "chip",
          type: "button",
          "aria-pressed": String(state.synergies.has(tag)),
          text: tag,
          onclick: () => {
            if (state.synergies.has(tag)) state.synergies.delete(tag);
            else state.synergies.add(tag);
            renderSynergies();
            onChange();
          },
        })
      )
    );
    synSummary.replaceChildren(el("span", { text: "Synergies" }), count);   // Trefferanzahl rechts in der Synergies-Zeile
  }

  // Passt der getippte Text genau auf einen Begriff (auch im Plural), wird dieser Begriff angewählt und die Zeile geleert.
  // Mit Enter (partial = true) reicht auch ein Teil: erst Wortanfang des Begriffs ("summon" -> Summoning), dann Wortanfang
  // eines Wortes im Begriff ("feat" -> Water Feature), dann irgendein Teil. Es zählt die erste Stufe mit genau einem Treffer.
  function matchTag(text, partial = false) {
    const t = text.trim().toLowerCase();
    if (!t) return { tag: null, many: [] };
    const variants = [t, t.replace(/ies$/, "y"), t.replace(/es$/, ""), t.replace(/s$/, "")];
    const exact = allSynergies.find((tag) => variants.includes(tag.toLowerCase()));
    if (exact) return { tag: exact, many: [] };
    if (!partial) return { tag: null, many: [] };
    const levels = [
      (tag) => tag.toLowerCase().startsWith(t),
      (tag) => tag.toLowerCase().split(/[\s-]+/).some((w) => w.startsWith(t)),
      (tag) => tag.toLowerCase().includes(t),
    ];
    for (const test of levels) {
      const found = allSynergies.filter(test);
      if (found.length === 1) return { tag: found[0], many: [] };
      if (found.length > 1) return { tag: null, many: found };
    }
    return { tag: null, many: [] };
  }
  // Kurze Tippvorsicht: erst wenn man einen Moment nicht tippt (oder Enter drückt), wird der Begriff angewählt.
  // So wird aus "rogues" nicht erst "rogue" + "s".
  let tagTimer = null;
  function applyTagMatch(partial = false) {
    clearTimeout(tagTimer);
    const { tag, many } = matchTag(search.value, partial);
    if (!tag) {
      if (many.length) toast(`Several synergies match: ${many.slice(0, 4).join(", ")}${many.length > 4 ? "…" : ""}`);
      return;
    }
    state.synergies.add(tag);
    search.value = "";
    state.query = "";
    renderSynergies();
    onChange();
  }
  search.addEventListener("input", () => {
    state.query = search.value;
    onChange();
    clearTimeout(tagTimer);
    tagTimer = setTimeout(() => applyTagMatch(false), 1000);
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") applyTagMatch(true); });
  reset.addEventListener("click", () => {
    state.query = ""; state.factions.clear(); state.synergies.clear(); state.all = false; renderMode();
    search.value = "";
    renderSynergies();
    renderFactions();
    onChange();
  });

  renderSynergies();
  renderFactions();

  return {
    // Die gefilterten Charaktere
    list() {
      const query = state.query.trim().toLowerCase();
      return data.characters.filter((c) => {
        // Der OR/AND-Schalter gilt auch für die Fraktionen: AND = der Charakter gehört zu allen gewählten Fraktionen
        if (state.factions.size) {
          const picked = [...state.factions];
          if (!(state.all ? picked.every((f) => c.factions.includes(f)) : picked.some((f) => c.factions.includes(f)))) return false;
        }
        // Keywords und Synergien addieren sich: gezeigt wird, wer ein gewähltes Keyword ODER eine gewählte Synergie hat.
        // Innerhalb jeder Gruppe genügt ebenfalls eines davon. Ist nur eine Gruppe gewählt, gilt nur diese.
        // Gezeigt wird, wer mindestens einen der gewählten Begriffe als Keyword oder Synergie hat
        if (state.synergies.size) {
          const tags = new Set([...c.keywords, ...(c.synergies || [])]);
          const picked = [...state.synergies];
          if (!(state.all ? picked.every((k) => tags.has(k)) : picked.some((k) => tags.has(k)))) return false;
        }
        if (query) {
          const text = [
            c.name,
            ...c.keywords,
            ...(c.synergies || []),
            ...c.factions.map((id) => factionById.get(id).name),
          ].join(" ").toLowerCase();
          if (!text.includes(query)) return false;
        }
        return true;
      }).sort((x, y) => Number(this.isPrimary(y)) - Number(this.isPrimary(x)));
    },
    // Ist dieser Begriff im Synergie-Filter gewählt?
    isPicked(tag) {
      return state.synergies.has(tag);
    },
    // Hat der Charakter die gewählten Synergie-Begriffe selbst als Keyword (statt nur als Synergie)?
    isPrimary(c) {
      if (!state.synergies.size) return false;
      const picked = [...state.synergies];
      return state.all ? picked.every((k) => c.keywords.includes(k)) : picked.some((k) => c.keywords.includes(k));
    },
    // Ist gerade eine Suche oder ein Filter aktiv?
    isFiltering() {
      return Boolean(state.query.trim() || state.factions.size || state.synergies.size);
    },
    // Zählzeile aktualisieren
    showCount(shown, total = data.characters.length) {
      count.replaceChildren(`${shown} of ${total}`, el("span", { class: "search-count-word", text: " characters" }));
      meta.hidden = !(state.query || state.factions.size || state.synergies.size);
    },
    // Alle Filter leeren (zum Beispiel beim Öffnen des Editors)
    clear() {
      state.query = ""; state.factions.clear(); state.synergies.clear(); state.all = false; renderMode();
      search.value = "";
        renderSynergies();
      renderFactions();
      synBox.open = false;
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

// Eine oder (bei Troupes aus lauter Zwei-Fraktionen-Modellen) zwei Fraktionen, sonst leer
function troupeFactionList(t) {
  if (!RULES.sameFaction || t.ids.length === 0) return [];
  const left = [...allowedFactions(t)];
  return left.length >= 1 && left.length <= 2 ? left.map((id) => factionById.get(id)) : [];
}

function fitsFactions(t, character) {
  const allowed = allowedFactions(t);
  return character.factions.some((f) => allowed.has(f));
}

// Formate: so viele Modelle hat die Troupe (max) und so viele davon treten im Spiel an (play).
// Math.max/min kommen mit Infinity klar: "unlimited" hat keine Grenze.
const FORMATS = [
  { id: "3",         label: "3 models",       max: 3,        play: 3 },
  { id: "4",         label: "4 models",       max: 4,        play: 4 },
  { id: "5-8",       label: "5 of 8 models",  max: 8,        play: 5 },
  { id: "6-9",       label: "6 of 9 models",  max: 9,        play: 6 },
  { id: "6-10",      label: "6 of 10 models", max: 10,       play: 6 },
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
  for (const group of RULES.exclusive) {
    if (!group.includes(id)) continue;
    const other = t.ids.find((i) => i !== id && group.includes(i));
    if (other) {
      const names = group.map((i) => characterById.get(i)?.name).filter(Boolean).join(" and ");
      return `${character.name} cannot join: ${characterById.get(other).name} is already in the troupe. Only one of ${names} is allowed.`;
    }
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

/* ---------- Import, Export und Backup ---------- */

// Ein eingefügter Code (oder Link) wird erst geprüft und dann als neue Troupe angelegt. Nichts wird überschrieben.

// Aus einem eingefügten Text den Code holen: entweder der Code selbst oder ein Link mit #t=<Code>.
function extractCode(text) {
  text = text.trim();
  const match = text.match(/#t=(\S+)/);
  if (!match) return text;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

// Link, der die Troupe in der App öffnet (die Daten stehen nach dem #, werden also nie an einen Server geschickt).
function shareUrl(t) {
  return `${location.origin}${location.pathname}#t=${encodeURIComponent(encodeTroupe(t))}`;
}

// Baut aus dem Code eine neue Troupe (noch nicht gespeichert). skipped: Einträge, die nicht passen, mit Grund.
// Wirft einen Fehler, wenn der Code nicht lesbar ist.
function buildImport(code) {
  const parsed = decodeTroupe(extractCode(code));
  const created = { id: newId(), name: sanitize({ name: parsed.name, ids: [] }).name, format: validFormat(parsed.format), ids: [] };
  const skipped = [];
  for (const id of Array.isArray(parsed.ids) ? parsed.ids : []) {
    const character = characterById.get(id);
    if (!character) { skipped.push("Unknown model (the code may come from a newer version)."); continue; }
    if (isSummoned(character)) { skipped.push(`${character.name} is summoned and is added automatically.`); continue; }
    const problem = checkAdd(created, id);
    if (problem) skipped.push(problem);
    else created.ids.push(id);
  }
  return { created, skipped };
}

let pendingImport = null;

function showImportStep(step) {
  $("#import-step-code").hidden = step !== "code";
  $("#import-step-preview").hidden = step !== "preview";
}

// Zeigt, was importiert würde, und wartet auf "Add troupe".
function openImportPreview(code) {
  if (troupes.length >= MAX_TROUPES) {
    return toast(`You can save at most ${MAX_TROUPES} troupes. Delete one first.`);
  }
  let result;
  try {
    result = buildImport(code);
  } catch {
    return toast("The code could not be read.");
  }
  const { created, skipped } = result;
  pendingImport = created;

  $("#preview-name").textContent = troupeLabel(created);
  const count = created.ids.length;
  $("#preview-meta").textContent = `Format: ${formatOf(created).label}`;
  $("#preview-list").replaceChildren(...created.ids.map((id) => {
    const c = characterById.get(id);
    return el("li", {}, portrait(c, "mini"),
      el("div", { class: "preview-info" }, el("span", { class: "preview-model", text: c.name }), factionLine(c)));
  }));

  const note = $("#preview-skipped");
  if (skipped.length) {
    const shown = skipped.slice(0, 4);
    note.replaceChildren(
      el("strong", { text: `${skipped.length} entr${skipped.length === 1 ? "y" : "ies"} will be left out:` }),
      el("ul", {}, ...shown.map((s) => el("li", { text: s })),
        skipped.length > shown.length ? el("li", { text: `…and ${skipped.length - shown.length} more.` }) : null)
    );
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  $("#preview-add").disabled = count === 0;

  showImportStep("preview");
  const dialog = $("#import-dialog");
  if (!dialog.open) dialog.showModal();
}

function confirmImport() {
  if (!pendingImport) return;
  if (troupes.length >= MAX_TROUPES) {
    return toast(`You can save at most ${MAX_TROUPES} troupes. Delete one first.`);
  }
  const created = pendingImport;
  pendingImport = null;
  troupes.push(created);
  saveTroupes();
  $("#import-dialog").close();
  if (!current) showView("troupes");
  renderTroupes();   // erst nach dem Wechsel der Ansicht: nur eine sichtbare Ansicht lässt sich vermessen
  toast(`"${troupeLabel(created)}" added.`);
}

// Öffnet die Vorschau, wenn die Seite über einen geteilten Link (…/#t=Code) aufgerufen wurde.
function checkIncomingLink() {
  const hash = location.hash;
  if (!hash.startsWith("#t=")) return;
  history.replaceState(null, "", location.pathname + location.search);
  openImportPreview(hash);
}

// Text in die Zwischenablage kopieren (mit Ausweichlösung für ältere Browser)
async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
    return true;
  } catch {
    const tmp = el("textarea", { readonly: "", style: "position:fixed;left:-9999px;top:0;opacity:0" });
    tmp.value = text;
    document.body.append(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignorieren */ }
    tmp.remove();
    toast(ok ? okMessage : "Copying failed. Please try again.");
    return ok;
  }
}

// Datei speichern. Auf dem Handy über das Teilen-Menü ("In Dateien sichern"), sonst als normaler Download.
async function saveFile(filename, blob) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return false;   // der Nutzer hat abgebrochen
      // sonst weiter mit dem normalen Download
    }
  }
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// Backup: alle Troupen in einer Datei
const BACKUP_TYPE = "ttg-backup";

async function exportBackup() {
  if (!troupes.length) return toast("There are no troupes to back up yet.");
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const payload = {
    type: BACKUP_TYPE,
    v: 1,
    exported: now.toISOString(),
    troupes: troupes.map(({ name, format, ids }) => ({ name, format, ids })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  if (await saveFile(`ttg-troupes-${stamp}.json`, blob)) toast("Backup created.");
}

// Backup einlesen: die Troupen werden zu den vorhandenen hinzugefügt. Was schon genau so da ist, wird übersprungen.
async function importBackup(file) {
  if (file.size > 1000000) return toast("This file is too large to be a backup.");
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    return toast("The file could not be read.");
  }
  if (!obj || obj.type !== BACKUP_TYPE || !Array.isArray(obj.troupes)) {
    return toast("This is not a TTG backup file.");
  }
  const keyOf = (t) => `${t.format}|${t.ids.join(",")}|${t.name}`;
  const have = new Set(troupes.map(keyOf));
  let added = 0, same = 0, full = 0, dropped = 0;
  for (const item of obj.troupes) {
    if (!item || typeof item !== "object") continue;
    const clean = sanitize(item);
    dropped += Math.max(0, (Array.isArray(item.ids) ? item.ids.length : 0) - clean.ids.length);
    if (have.has(keyOf(clean))) { same++; continue; }
    if (troupes.length >= MAX_TROUPES) { full++; continue; }
    troupes.push({ id: newId(), ...clean });
    have.add(keyOf(clean));
    added++;
  }
  saveTroupes();
  renderTroupes();
  const parts = [`${added} troupe${added === 1 ? "" : "s"} restored`];
  if (same) parts.push(`${same} already there`);
  if (full) parts.push(`${full} skipped (limit ${MAX_TROUPES})`);
  let message = parts.join(", ") + ".";
  if (dropped) message += ` ${dropped} unknown model${dropped === 1 ? "" : "s"} left out.`;
  toast(message);
}


/* ---------- 7. Anzeige ---------- */

// --- Kompendium: nur Nachschlagen ---
// Fraktionssymbol für die Kompendiums-Kachel (nur in der schmalen Handy-Ansicht sichtbar, siehe style.css)
function cardCrest(c) {
  const icon = c.factions.length === 2
    ? factionsIcon(c.factions.map((id) => factionById.get(id)))
    : factionIcon(factionById.get(c.factions[0]));
  if (icon) {
    icon.classList.add("card-crest");
    icon.dataset.fac = [...c.factions].sort().join("+");   // für die Feinjustierung der Wappen in style.css
  }
  return icon;
}

// Großes, blasses Wappen am rechten Rand der Kachel, halb abgeschnitten wie auf den Charakterkarten (nur breite Ansicht)
function cardWatermark(c) {
  const factions = c.factions.map((id) => factionById.get(id)).filter(Boolean);
  const image = factions.length === 2 ? dualImage(factions) : factions[0] && (factions[0].icon || FACTION_IMAGES[factions[0].id]);
  if (!image) return null;
  return el("img", { class: "card-watermark", src: image, alt: "", draggable: "false", loading: "lazy", "aria-hidden": "true" });
}

// Farben für das Leuchten des Wappens (bei zwei Fraktionen beide Farben); überdeckt auch den weißen Schein der Doppelwappen
function glowStyle(c) {
  const factions = c.factions.map((id) => factionById.get(id)).filter(Boolean);
  if (!factions.length) return null;
  const [a, b = a] = factions;
  return `--h:${a.hue}; --fac-s:${a.sat ?? 55}%; --h2:${b.hue}; --fac-s2:${b.sat ?? 55}%`;
}

function renderCards() {
  // Charaktere mit "compendium": false (die beschworene Kopie eines normalen Charakters) bleiben im Kompendium verborgen
  const list = compendiumPanel.list().filter((c) => c.compendium !== false);
  compendiumPanel.showCount(list.length, data.characters.filter((c) => c.compendium !== false).length);

  if (list.length === 0) {
    $("#cards").replaceChildren(el("p", { class: "empty", text: "No character matches these filters." }));
    return;
  }

  const cardEl = (c) =>
      el("article", { class: "card", style: glowStyle(c) },
        cardWatermark(c),
        el("button",{ class: "card-main", type: "button", onclick: () => openDetail(c.id), "aria-label": `${c.name}: open details` },
          portrait(c),
          cardCrest(c),
          el("div", { class: "card-text" },
            el("span", { class: "card-name", text: c.name }),
            factionLine(c),
            c.keywords.length ? el("span", { class: "card-kw" },
              ...c.keywords.flatMap((k, i) => [
                i ? " · " : null,
                el("span", { class: compendiumPanel.isPicked(k) ? "kw-hit" : null, text: k })
              ])
            ) : null
          )
        )
      );
  // Bei einem Synergie-Filter: erst Modelle mit dem Keyword selbst, dann (neue Zeile) Modelle, die nur eine Synergie damit haben
  const primary = list.filter((c) => compendiumPanel.isPrimary(c));
  const rest = list.filter((c) => !compendiumPanel.isPrimary(c));
  const grouped = primary.length > 0 && rest.length > 0;
  $("#cards").classList.toggle("grouped", grouped);
  if (grouped) {
    $("#cards").replaceChildren(
      el("div", { class: "cards-sub" }, ...primary.map(cardEl)),
      el("div", { class: "cards-sub" }, ...rest.map(cardEl))
    );
  } else {
    $("#cards").replaceChildren(...list.map(cardEl));
  }
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
    const factions = troupeFactionList(t);   // nur wenn die Fraktion feststeht (oder genau zwei in Frage kommen)
    const faction = factions[0];
    const dual = factions.length === 2;
    const dualStyle = dual ? `; --h2:${factions[1].hue}; --fac-s2:${factions[1].sat ?? 55}%` : "";
    return el("div", { class: faction ? `troupe-item has-faction${dual ? " dual" : ""}` : "troupe-item", style: faction ? factionStyle(faction) + dualStyle : null },
      el("button", { class: "troupe-card", type: "button", onclick: () => openEditor(t.id) },
        el("span", { class: "troupe-name", text: troupeLabel(t) }),
        el("span", { class: "troupe-meta", text: troupeMeta(t) }),
        el("span", { class: "mini-row", "data-n": String(t.ids.length) }, ...t.ids.map((id) => portrait(characterById.get(id), "mini")))
      ),
      faction ? el("span", { class: "troupe-corner", title: factions.map((f) => f.name).join(" / ") }, ...(factionsIcon(factions) ? [factionsIcon(factions)] : factions.map((f) => factionIcon(f)))) : null,
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
  $("#editor-slots").classList.toggle("ten", max === 10);   // 6/10: Plätze als 5 x 2 Raster

  // Die acht Plätze: gewählte Charaktere als Portrait (Tipp = Karte ansehen), freie Plätze gestrichelt
  $("#editor-slots").replaceChildren(
    ...Array.from({ length: Number.isFinite(max) ? max : Math.max(8, count + 1) }, (_, i) => {
      const id = current.ids[i];
      if (!id) return el("span", { class: "slot-empty" });
      const c = characterById.get(id);
      return el("div", { class: "slot-portrait" },
        el("button", { class: "slot-open", type: "button", "aria-label": `${c.name}: open details`, onclick: () => openDetail(id) },
          portraitCard(c),
          el("span", { class: "tile-factions" },
            ...c.factions.map((fid) => el("span", { class: "dot", style: factionStyle(factionById.get(fid)), title: factionById.get(fid).name }))
          ),
          el("span", { class: "tile-label" },
            el("span", { class: "tile-name", text: c.name })
          )
        ),
        el("button", { class: "slot-remove", type: "button", "aria-label": `Remove ${c.name} from troupe`, onclick: () => removeMember(id) },
          el("span", { class: "slot-x", "aria-hidden": "true", text: "×" })
        )
      );
    })
  );

  // Fraktionssymbol neben dem Namensfeld (Platz bleibt immer reserviert, damit nichts springt).
  // Eine Fraktion: ihr Wappen. Haben alle Modelle beide Fraktionen, das Doppelwappen. Sonst noch offen.
  const slot = $("#editor-faction");
  const list = troupeFactionList(current);
  const label = list.map((f) => f.name).join(" / ");
  slot.title = list.length ? label : "Faction: not set yet";
  if (list.length === 0) {
    slot.replaceChildren(el("span", { class: "dot open" }));
  } else {
    const icon = list.length === 2 && dualImage(list) ? factionsIcon(list) : factionIcon(list[0]);
    icon.removeAttribute("aria-hidden");
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
    slot.replaceChildren(icon);
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
          el("span", { class: "tile-factions" },
            ...c.factions.map((fid) => el("span", { class: "dot", style: factionStyle(factionById.get(fid)), title: factionById.get(fid).name }))
          ),
          el("span", { class: "tile-label" },
            el("span", { class: "tile-name", text: c.name })
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
      return tileFor(c, selected, () => toggleMember(c.id), blocked ? "blocked" : "");
    })
  );
}

// --- Kartenansicht: die Charakterkarte groß, ein Tipp dreht sie um ---

const HINT_KEY = "ttg-hint-flip-v1";   // gesetzt, wenn der Tipp nie mehr erscheinen soll
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

  // Variante 2: keine Karte, dann Name, Fraktion und Keywords
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
      close
    )
  );
  $("#detail").showModal();
}



/* ---------- Gameview: Wunden und Energy im Spiel verfolgen ---------- */

// Im Spiel treten 5 Modelle an (aus den 8 der Troupe). Jedes Modell hat seinen eigenen Energy-Pool.
// Das Feld "health" in der JSON bildet die Lebensleiste der Karte ab, von links nach rechts:
// 1 = blauer Punkt (erzeugt Energy), 0 = leerer Punkt. Wunden werden von rechts gestrichen.
const GAME_KEY = "ttg-game-v1";
function gameSize() { return formatOf(current).play; }   // so viele Modelle treten im Spiel an (Infinity = beliebig viele)
let game = null;          // { troupeId, stage, round, own: [ids], opps: [{ key, name, ids }], models: { "side:id": { wounds, energy } } }
const MAX_OPPONENTS = 4;  // höchstens 5 Spieler: du und bis zu 4 Gegner

// Die Modell-Liste einer Seite: "own" = du, sonst der Schlüssel eines Gegners ("foe", "foe2", …)
function sideIds(side) {
  if (side === "own") return game.own;
  const o = game.opps.find((x) => x.key === side);
  return o ? o.ids : [];
}
function oppLabel(o) {
  const i = game.opps.indexOf(o);
  return o.name.trim() || (game.opps.length > 1 ? `Opponent ${i + 1}` : "Opponent");
}
function nextOppKey() {
  for (let n = 1; ; n++) {
    const key = n === 1 ? "foe" : `foe${n}`;
    if (!game.opps.some((o) => o.key === key)) return key;
  }
}
let foePanel;

function saveGame() {
  try { localStorage.setItem(GAME_KEY, JSON.stringify(game)); } catch { /* ignorieren */ }
}

const MAX_ROUNDS = 5;   // Runde 5 ist "Sudden Death" (Sonnenaufgang)

function loadGame() {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY));
    if (g && typeof g === "object" && Array.isArray(g.own) && (Array.isArray(g.foe) || Array.isArray(g.opps)) && g.models) {
      // Ältere Spielstände hatten genau einen Gegner in "foe"
      if (!Array.isArray(g.opps)) g.opps = [{ key: "foe", name: "", ids: g.foe }];
      delete g.foe;
      g.opps = g.opps
        .filter((o) => o && typeof o.key === "string" && Array.isArray(o.ids))
        .map((o) => ({ key: o.key, name: typeof o.name === "string" ? o.name : "", ids: o.ids }))
        .slice(0, MAX_OPPONENTS);
      if (g.opps.length === 0) g.opps = [{ key: "foe", name: "", ids: [] }];
      g.round = Math.min(MAX_ROUNDS, Math.max(1, Number(g.round) || 1));
      return g;
    }
  } catch { /* ignorieren */ }
  return null;
}

function newGame(troupeId) {
  return { troupeId, stage: "setup", round: 1, own: [], opps: [{ key: "foe", name: "", ids: [] }], models: {} };
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
  const active = sideIds(side);
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
  const list = sideIds(side);
  const i = list.indexOf(c.id);
  if (!twin || i < 0) return;
  const old = gameModel(side, c.id);
  const total = healthOf(twin) ? healthOf(twin).length : 30;
  game.models[`${side}:${twin.id}`] = { wounds: Math.min(old.wounds, total), energy: old.energy, summoned: true };
  game.models[`${side}:${c.id}`] = { wounds: 0, energy: 0 };
  list[i] = twin.id;
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
  for (const o of game.opps) o.ids = o.ids.filter((id) => characterById.has(id)).slice(0, gameSize());
  if (game.own.length === 0 || game.opps.some((o) => o.ids.length === 0)) game.stage = "setup";
  foePanel.clear();
  foeListOpen = false;   // die Charakterliste ist erst einmal ausgeblendet (Suche und Filter bleiben offen)
  foeSummonsOpen = false;
  for (const k of Object.keys(summonMenuOpen)) delete summonMenuOpen[k];
  renderGame();
  showView("game");
  // Frisches Spiel: gleich nach dem Namen des Gegners fragen (überspringbar)
  if (game.stage === "setup" && game.opps.length === 1 && !game.opps[0].name.trim() && game.opps[0].ids.length === 0) openAddOpponent("name");
}

const summonMenuOpen = {};   // Summon-Menü pro Seite aufgeklappt? (standardmäßig nicht)
let foeSummonsOpen = false;   // Liste der möglichen Beschwörungen des Gegners aufgeklappt?
let foeListOpen = true;   // Liste der Gegner-Modelle aufgeklappt?

function toggleGamePick(side, id) {
  const list = sideIds(side);
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else if (list.length >= gameSize()) return toast(`Only ${gameSize()} models play in this format.`);
  else list.push(id);
  // Sind alle Modelle dieses Gegners gewählt, klappt die Liste wieder ein
  if (side !== "own" && Number.isFinite(gameSize()) && list.length >= gameSize()) foeListOpen = false;
  saveGame();
  renderGame();
}

function tileFor(c, selected, onclick, extraClass = "") {
  // Rechtsklick (Computer) oder Antippen und Halten (Handy) zeigt die Karte, ohne das Modell zu wählen
  let timer = null;
  let longPressed = false;
  let startX = 0, startY = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const tile = el("button", { class: extraClass ? `tile ${extraClass}` : "tile", type: "button", "aria-pressed": String(selected), "aria-label": c.name,
    onclick: (e) => {
      if (longPressed) { longPressed = false; e.preventDefault(); return; }
      onclick(e);
    },
    oncontextmenu: (e) => { e.preventDefault(); openDetail(c.id); },
    onpointerdown: (e) => {
      if (e.pointerType === "mouse") return;
      longPressed = false;
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => { longPressed = true; timer = null; if (navigator.vibrate) navigator.vibrate(15); openDetail(c.id); }, 500);
    },
    onpointermove: (e) => { if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); },
    onpointerup: cancel,
    onpointercancel: cancel,
    onpointerleave: cancel,
  },
    portraitCard(c),
    // Fraktionssymbole oben links in der Ecke (mit dunklem Verlauf), der Name bleibt unten
    el("span", { class: "tile-factions" },
      ...c.factions.map((id) => el("span", { class: "dot", style: factionStyle(factionById.get(id)), title: factionById.get(id).name }))
    ),
    el("span", { class: "tile-label" },
      el("span", { class: "tile-name", text: c.name })
    ),
    selected ? el("span", { class: "tile-check", "aria-hidden": "true", text: "✓" }) : null
  );
  return tile;
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
  if (twinOf(c) && !sideIds(side).includes(c.id)) {
    return el("div", { class: "gcell unsummoned" },
      el("div", { class: "gcell-media" },
        el("button", { class: "gcell-portrait", type: "button", "aria-label": `${c.name}: open card`, onclick: () => openDetail(c.id) }, portraitCard(c)),
        el("div", { class: "summon-note", text: "Transformed" })
      ),
      el("div", { class: "gcell-name", text: c.name })
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
      el("div", { class: "gcell-name", text: c.name })
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
  // Reihenfolge der Beschworenen: aktuell beschworene Modelle zuerst, dann die übrigen in der normalen Reihenfolge,
  // Zwillinge (z. B. Striga Anya, wird nie aktiv beschworen) ganz am Ende
  const orderedSummons = (side) => {
    const rank = (c) => {
      if (twinOf(c)) return 2;
      const m = gameModel(side, c.id);
      const h = healthOf(c);
      return m.summoned && !(h && m.wounds >= h.length) ? 0 : 1;
    };
    return gameSummons(side)
      .map((c, i) => ({ c, i, r: rank(c) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.c);
  };
  // Beschworene: aktuell beschworene Modelle stehen immer sichtbar da. Alle übrigen möglichen Beschwörungen
  // (und der inaktive Zwilling) verstecken sich in einem Menü, das standardmäßig eingeklappt ist.
  const isActiveSummon = (side, c) => {
    if (twinOf(c)) return false;
    const m = gameModel(side, c.id);
    const h = healthOf(c);
    return Boolean(m.summoned) && !(h && m.wounds >= h.length);
  };
  const summonArea = (side, label) => {
    const all = orderedSummons(side);
    const active = all.filter((c) => isActiveSummon(side, c));
    const idle = all.filter((c) => !isActiveSummon(side, c));
    const menu = idle.length
      ? el("details", { class: "summon-menu", open: Boolean(summonMenuOpen[side]), ontoggle: (e) => { summonMenuOpen[side] = e.target.open; } },
          el("summary", { text: `Summons (${idle.length})` }),
          el("div", { class: "grow summons" }, ...idle.map((c) => gameCell(side, c))))
      : null;
    if (!active.length && !menu) return null;
    return el("div", { class: "summon-area" },
      active.length
        ? el("div", {},
            el("h3", { class: "section-label", text: `${label}, summoned` }),
            el("div", { class: "grow summons" }, ...active.map((c) => gameCell(side, c))))
        : null,
      menu
    );
  };
  // Jeder Gegner bekommt einen eigenen Abschnitt mit seinem Namen
  $("#game-foes-play").replaceChildren(
    ...game.opps.map((o) =>
      el("div", { class: "foe-play" },
        el("h3", { class: "section-label", text: oppLabel(o) }),
        el("div", { class: "grow" }, ...o.ids.map((id) => gameCell(o.key, characterById.get(id)))),
        summonArea(o.key, oppLabel(o))
      )
    )
  );
  $("#game-own-row").replaceChildren(...game.own.map((id) => gameCell("own", characterById.get(id))));
  $("#game-own-summon-area").replaceChildren(...[summonArea("own", "You")].filter(Boolean));
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
  for (const side of ["own", ...game.opps.map((o) => o.key)]) {
    for (const c of [...sideIds(side).map((id) => characterById.get(id)), ...gameSummons(side)]) {
      const m = gameModel(side, c.id);
      if (twinOf(c) && !sideIds(side).includes(c.id)) continue;   // inaktiver Zwilling: nicht im Spiel
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
const GAME_COLUMNS = { 3: 3, 4: 4, 5: 5, 6: 3 };

// Ein Modell aus der Gegnerliste: bei einem Gegner direkt (antippen = hinzufügen/entfernen).
// Bei mehreren: kann nur ein Gegner das Modell nehmen, bekommt er es sofort, sonst fragen wir, für wen.
function addToOpponent(o, id) {
  const size = gameSize();
  o.ids.push(id);
  if (Number.isFinite(size) && o.ids.length >= size) foeListOpen = false;
  saveGame();
  renderGame();
}
// Warum ein Gegner das Modell nicht nehmen kann (null = kann es nehmen)
function oppBlocked(o, c) {
  const size = gameSize();
  if (o.ids.includes(c.id)) return "already in";
  if (Number.isFinite(size) && o.ids.length >= size) return "full";
  if (RULES.sameFaction && o.ids.length > 0 && !fitsFactions({ ids: o.ids }, c)) return "other faction";
  return null;
}
function pickFoe(id) {
  if (game.opps.length === 1) return toggleGamePick(game.opps[0].key, id);
  const c = characterById.get(id);
  const size = gameSize();
  const blocked = (o) => oppBlocked(o, c);
  const eligible = game.opps.filter((o) => !blocked(o));
  if (eligible.length === 0) return toast(`${c.name} fits none of the opponents.`);
  if (eligible.length === 1) return addToOpponent(eligible[0], id);
  const dlg = $("#opp-pick-dialog");
  $("#opp-pick-title").textContent = `Add ${c.name} to which opponent?`;
  $("#opp-pick-list").replaceChildren(
    ...game.opps.map((o) => {
      const why = blocked(o);
      return el("button", { type: "button", class: "opp-choice", disabled: Boolean(why),
        onclick: () => { dlg.close(); addToOpponent(o, id); } },
        el("span", { text: oppLabel(o) }),
        el("span", { class: "opp-note", text: why || shownCount(o.ids.length) })
      );
    })
  );
  dlg.showModal();
}
function shownCount(n) {
  const size = gameSize();
  return Number.isFinite(size) ? `${n}/${size}` : String(n);
}

function removeOpponent(key) {
  if (game.opps.length <= 1) return;
  game.opps = game.opps.filter((o) => o.key !== key);
  for (const k of Object.keys(game.models)) if (k.startsWith(`${key}:`)) delete game.models[k];
  saveGame();
  renderGame();
}

// "Add opponent": erst ein Name (Pflicht), dann wird der Gegner angelegt
let oppDialogMode = "add";   // "add" = neuer Gegner, "name" = den ersten Gegner benennen (nach "Play with this troupe")
function openAddOpponent(mode = "add") {
  if (mode === "add" && game.opps.length >= MAX_OPPONENTS) return toast(`At most ${MAX_OPPONENTS + 1} players can take part (you and ${MAX_OPPONENTS} opponents).`);
  oppDialogMode = mode;
  $("#opp-add-title").textContent = mode === "name" ? "Name your opponent" : "Add opponent";
  $("#opp-add-hint").textContent = mode === "name" ? "Who are you playing against? You can change the name later." : "Give the new opponent a name first.";
  $("#opp-add-ok").textContent = mode === "name" ? "OK" : "Add";
  $("#opp-add-cancel").textContent = mode === "name" ? "Skip" : "Cancel";
  const dlg = $("#opp-add-dialog");
  $("#opp-add-name").value = "";
  $("#opp-add-ok").disabled = true;
  dlg.showModal();
  $("#opp-add-name").focus();
}
function confirmAddOpponent() {
  const name = $("#opp-add-name").value.trim();
  if (!name) return;
  if (oppDialogMode === "name") game.opps[0].name = name;
  else {
    if (game.opps.length >= MAX_OPPONENTS) return;
    game.opps.push({ key: nextOppKey(), name, ids: [] });
  }
  saveGame();
  $("#opp-add-dialog").close();
  renderGame();
}

function renderGame() {
  $("#view-game").style.setProperty("--gcols", GAME_COLUMNS[gameSize()] || 5);
  const setup = game.stage === "setup";
  $("#game-setup").hidden = !setup;
  $("#game-play").hidden = setup;
  $("#game-title").textContent = setup ? "Choose models" : "Game";
  $("#game-round").hidden = setup;
  $("#game-add-foe").hidden = !setup;
  if (setup) { delete $("#view-game .editor-bar").dataset.round; delete document.body.dataset.round; }

  if (setup) {
    const size = gameSize();
    const shown = (n) => (Number.isFinite(size) ? `${n}/${size}` : String(n));
    $("#game-own-hint").textContent = Number.isFinite(size) ? `Choose the ${size} models you play this game.` : "Choose the models you play this game.";
    $("#game-own-tiles").replaceChildren(
      ...current.ids.map((id) => characterById.get(id)).map((c) => tileFor(c, game.own.includes(c.id), () => toggleGamePick("own", c.id)))
    );
    $("#game-own-count").textContent = shown(game.own.length);

    // Ein Block pro Gegner: links das Namensfeld, daneben die Anzahl. Gewählte Modelle stehen oben in leeren Plätzen, damit beim Auswählen nichts springt.
    const multi = game.opps.length > 1;
    $("#game-foes").replaceChildren(
      ...game.opps.map((o, n) => {
        const chosen = o.ids.map((id) => characterById.get(id)).map((c) => tileFor(c, true, () => toggleGamePick(o.key, c.id)));
        const slots = Number.isFinite(size) ? Math.max(0, size - chosen.length) : 1;   // voll: kein leerer Platz mehr
        const name = el("input", { class: "foe-name", type: "text", maxlength: "30", autocomplete: "off", placeholder: multi ? `Opponent ${n + 1}` : "Opponent", "aria-label": "Opponent name", value: o.name });
        name.addEventListener("input", () => { o.name = name.value; saveGame(); });
        return el("div", { class: "foe-block" },
          el("div", { class: "foe-head" },
            name,
            el("span", { class: "badge", text: shown(o.ids.length) }),
            multi ? el("button", { class: "ghost foe-remove", type: "button", "aria-label": `Remove ${oppLabel(o)}`, text: "✕", onclick: () => removeOpponent(o.key) }) : null
          ),
          el("div", { class: "tiles" }, ...chosen, ...Array.from({ length: slots }, () => el("div", { class: "tile-empty", "aria-hidden": "true" })))
        );
      })
    );
    const addBtn = $("#game-add-foe");
    addBtn.hidden = false;
    addBtn.classList.toggle("is-full", game.opps.length >= MAX_OPPONENTS);

    // Wie im Troupe-Builder: Fraktionen und Modelle, die nicht zu den schon gewählten Gegner-Modellen passen, werden abgedunkelt bzw. ausgeblendet
    // (nur bei einem Gegner; bei mehreren entscheidet die Abfrage "für wen?")
    const solo = game.opps.length === 1 ? { ids: game.opps[0].ids } : null;
    let allowedSet = null;
    if (RULES.sameFaction) {
      if (solo) allowedSet = solo.ids.length > 0 ? allowedFactions(solo) : null;
      else {
        // Mehrere Gegner: erlaubt ist, was mindestens ein noch nicht voller Gegner nehmen kann
        const open = game.opps.filter((o) => !(Number.isFinite(size) && o.ids.length >= size));
        allowedSet = open.some((o) => o.ids.length === 0) ? null : new Set(open.flatMap((o) => [...allowedFactions({ ids: o.ids })]));
      }
    }
    foePanel.setAllowed(allowedSet);
    const allFoeIds = game.opps.flatMap((o) => o.ids);
    // Ein Gegner: Modelle, die nicht passen, verschwinden. Mehrere: Modelle, die zu keinem Gegner passen, verschwinden.
    const list = foePanel.list().filter((c) => !isSummoned(c) && (solo
      ? allFoeIds.includes(c.id) || fitsFactions(solo, c)
      : game.opps.some((o) => !oppBlocked(o, c))));
    foePanel.showCount(list.length, data.characters.filter((c) => !isSummoned(c)).length);
    $("#game-foe-tiles").replaceChildren(...list.map((c) => tileFor(c, allFoeIds.includes(c.id), () => pickFoe(c.id))));
    // Suche und Filter bleiben immer offen; die Charakterliste selbst nur per Knopf oder sobald gesucht/gefiltert wird
    const listShown = foeListOpen || foePanel.isFiltering();
    $("#game-foe-tiles").hidden = !listShown;
    const toggle = $("#game-foe-toggle");
    toggle.hidden = false;   // immer da, damit das Layout gleich bleibt
    toggle.textContent = foeListOpen ? "Hide list" : "Show all Characters";
    toggle.setAttribute("aria-expanded", String(listShown));
    // Mögliche Beschwörungen der gewählten Gegner-Modelle (nur zum Anschauen, Tippen öffnet die Karte)
    const possible = [...new Map(game.opps.flatMap((o) => gameSummons(o.key)).map((c) => [c.id, c])).values()];
    const sumToggle = $("#game-foe-summons-toggle");
    sumToggle.textContent = foeSummonsOpen ? "Hide summons" : "Show summons";
    sumToggle.setAttribute("aria-expanded", String(foeSummonsOpen));
    $("#game-foe-summons-panel").hidden = !foeSummonsOpen;
    $("#game-foe-summons-none").hidden = possible.length > 0;
    $("#game-foe-summons-hint").hidden = possible.length === 0;
    $("#game-foe-summons-list").replaceChildren(...possible.map((c) => tileFor(c, false, () => openDetail(c.id))));
    $("#game-start").disabled = game.own.length === 0 || game.opps.some((o) => o.ids.length === 0);
  } else {
    renderGamePlay();
  }
}

/* ---------- Regeln und FAQs ---------- */

// Eine Seite mit Suche und aufklappbaren Abschnitten. Der Inhalt steht in einer JSON-Datei
// (data/rules.json für die Regeln, data/faq.json für die FAQs). Aufbau der Datei:
//   { "meta": { "note": "…" }, "sections": [ { "id": "…", "title": "…", "blocks": [ … ] } ] }
// Blöcke: p (Absatz), h (Zwischenüberschrift, l = 2 oder 3), q (Frage über der Antwort), ul (Liste; "ordered": true = nummeriert, "plain": true = ohne Aufzählungszeichen), note (Kasten),
//         figure (Bild), gallery (Bilderreihe mit Beschriftung; items mit x = Beschreibung neben dem Bild), example (Kasten mit Bild und Text, side: "right" = Bild rechts),
//         group (aufklappbarer Unterpunkt: { "t": "group", "title": "…", "blocks": [ … ] }, beliebig tief verschachtelbar),
//         annotated (Bild mit nummerierten Punkten: src, alt, w, pins [[x%, y%], …], items ["Erklärung 1", …], side: "right" = Bild rechts).
// Im Text: *kursiv*, **fett**, ***fett kursiv***, \n = Zeilenumbruch, [[farbe:X]] = farbiges Arcane-Symbol (pink, green, blue).
const GUIDES = {
  rules: { container: "#rules-guide", url: "data/rules.json", placeholder: "Search the rules", empty: "No rules found." },
  faqs:  { container: "#faqs-guide",  url: "data/faq.json",   placeholder: "Search the FAQs",  empty: "The FAQs will follow soon." },
};
const guideInstances = {};

function openGuide(name) {
  const config = GUIDES[name];
  if (!config) return;
  if (!guideInstances[name]) guideInstances[name] = createGuide($(config.container), config);
  guideInstances[name].load();
}

// Text mit Markierungen in DOM-Knoten verwandeln (nie als HTML, daher sicher)
function inlineNodes(text) {
  const out = [];
  const pieces = String(text).split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|\[\[[a-z]+:[^\]]+\]\])/);
  const plain = (s) => s.split("\n").forEach((line, i) => { if (i) out.push(el("br")); if (line) out.push(line); });
  for (const piece of pieces) {
    if (piece.startsWith("***") && piece.endsWith("***") && piece.length > 6) out.push(el("strong", {}, el("em", { text: piece.slice(3, -3) })));
    else if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) out.push(el("strong", { text: piece.slice(2, -2) }));
    else if (piece.startsWith("*") && piece.endsWith("*") && piece.length > 2) out.push(el("em", { text: piece.slice(1, -1) }));
    else if (/^\[\[[a-z]+:[^\]]+\]\]$/.test(piece)) {
      const [color, symbol] = piece.slice(2, -2).split(":");
      out.push(el("span", { class: `arc arc-${color}`, text: symbol }));   // farbiges Arcane-Symbol
    }
    else plain(piece);
  }
  return out;
}

function plainText(text) {
  return String(text).replace(/\[\[[a-z]+:([^\]]+)\]\]/g, "$1").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
}

// Beim Suchen: Anführungszeichen und Groß-/Kleinschreibung gleichsetzen (die Länge bleibt gleich)
function searchForm(s) {
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

// Wörter eines (schon mit searchForm umgewandelten) Textes; Punkt und Apostroph im Wort bleiben ("8.1", "character's")
const WORD = /[\p{L}\p{N}]+(?:['.][\p{L}\p{N}]+)*/gu;
function wordsOf(form) {
  return form.match(WORD) || [];
}

// Wie viele Tippfehler (falscher, fehlender, zusätzlicher oder vertauschter Buchstabe) trennen den Suchbegriff
// vom ähnlichsten Wortanfang? "movemnt" → "movement" = 1
function prefixDistance(term, word) {
  let before = null;
  let prev = Array.from({ length: word.length + 1 }, (_, j) => j);
  for (let i = 1; i <= term.length; i++) {
    const row = [i];
    for (let j = 1; j <= word.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (term[i - 1] === word[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && term[i - 1] === word[j - 2] && term[i - 2] === word[j - 1]) d = Math.min(d, before[j - 2] + 1);
      row.push(d);
    }
    before = prev;
    prev = row;
  }
  return Math.min(...prev);
}

function blockNode(block) {
  switch (block.t) {
    case "h":
      return el(block.l === 3 ? "h4" : "h3", { class: block.l === 3 ? "rule-h3" : "rule-h2" }, ...inlineNodes(block.x));
    case "ul":
      // ordered: true = nummerierte Liste, plain: true = Liste ohne Aufzählungszeichen (der Text enthält die Nummer selbst, z. B. "8.1.")
      return el(block.ordered ? "ol" : "ul", { class: block.plain ? "plain-list" : null }, ...block.items.map((item) => el("li", {}, ...inlineNodes(item))));
    case "q":
      return el("p", { class: "rule-q" }, ...inlineNodes(block.x));
    case "note":
      return el("div", { class: "rule-note" }, ...inlineNodes(block.x));
    case "figure":
      return el("figure", { class: "rule-fig" },
        el("img", { src: block.src, alt: block.alt || "", loading: "lazy", style: block.w ? `max-width:min(100%, ${Number(block.w) || 22}rem)` : null }),
        block.caption ? el("figcaption", { text: block.caption }) : null);
    case "gallery": {
      // Haben die Bilder eine Beschreibung (x), steht sie neben dem Bild statt nur der Beschriftung darunter
      const described = block.items.some((item) => item.x);
      return el("div", { class: described ? "rule-gallery described" : "rule-gallery", style: `--cols:${Number(block.cols) || 2}`, "data-cols": Number(block.cols) || 2 }, ...block.items.map((item) =>
        el("figure", {}, el("img", { src: item.src, alt: "", loading: "lazy" }),
          described
            ? el("figcaption", {}, el("strong", { text: item.caption }), el("span", {}, ...inlineNodes(item.x || "")))
            : el("figcaption", { text: item.caption }))));
    }
    case "example":
      // side: "right" = Bild rechts neben dem Text (auf schmalen Bildschirmen darunter)
      return el("div", { class: block.side === "right" ? "rule-example right" : "rule-example" },
        el("img", { src: block.src, alt: block.alt || "", loading: "lazy", style: block.w ? `flex-basis:${Number(block.w) || 11}rem;width:${Number(block.w) || 11}rem` : null }),
        el("p", {}, ...inlineNodes(block.x)));
    case "annotated":
      return annotatedNode(block);
    default:
      return el("p", {}, ...inlineNodes(block.x));
  }
}

// Bild mit nummerierten Punkten; darunter die Erklärungen mit denselben Nummern
function annotatedNode(block) {
  const pins = block.pins || [];
  const flash = (node) => {
    node.classList.remove("flash");
    void node.offsetWidth;   // Animation neu starten
    node.classList.add("flash");
    setTimeout(() => node.classList.remove("flash"), 1800);
  };
  const pinNodes = [], itemNodes = [];
  const wrap = el("div", { class: "annot-img" }, el("img", { src: block.src, alt: block.alt || "", loading: "lazy" }));
  pins.forEach((pos, i) => {
    const pin = el("button", { class: "pin", type: "button", style: `left:${Number(pos[0])}%;top:${Number(pos[1])}%`, "aria-label": `Explanation ${i + 1}`, text: String(i + 1) });
    pin.addEventListener("click", () => {
      const item = itemNodes[i];
      if (!item) return;
      item.scrollIntoView({ block: "center", behavior: "smooth" });
      flash(item);
    });
    pinNodes.push(pin);
    wrap.append(pin);
  });
  const list = el("ol", { class: "annot-list" }, ...block.items.map((text, i) => {
    const num = el("button", { class: "def-num", type: "button", "aria-label": `Show point ${i + 1} on the card`, text: String(i + 1) });
    num.addEventListener("click", () => {
      wrap.scrollIntoView({ block: "center", behavior: "smooth" });
      if (pinNodes[i]) flash(pinNodes[i]);
    });
    const item = el("li", {}, num, el("div", { class: "def-text" }, ...inlineNodes(text)));
    itemNodes.push(item);
    return item;
  }));
  return el("div", { class: block.side === "right" ? "annot right" : "annot", style:block.w ? `--annot-w:${Number(block.w) || 22}rem` : null }, wrap, list);
}

// Suchbare Einheiten eines Blocks (für Treffer und Sprung)
function leafUnits(block, node) {
  switch (block.t) {
    case "h":
    case "q": return [{ node, text: block.x, kind: "title" }];
    case "ul": return block.items.map((t, i) => ({ node: node.children[i], text: t, kind: "text" }));
    case "gallery": return block.items.map((it, i) => ({ node: node.children[i], text: `${it.caption || ""} ${it.x || ""}`, kind: "text" }));
    case "annotated": return block.items.map((t, i) => ({ node: node.querySelectorAll("li")[i], text: t, kind: "text" }));
    case "figure": return block.caption ? [{ node, text: block.caption, kind: "text" }] : [];
    case "example": return [{ node, text: `${block.x || ""} ${block.alt || ""}`, kind: "text" }];   // Alt-Text enthält z. B. den Kartennamen
    default: return block.x ? [{ node, text: block.x, kind: "text" }] : [];
  }
}

function blockTexts(block) {
  const parts = [];
  if (block.x) parts.push(block.x);
  if (block.items) parts.push(...block.items.map((i) => (typeof i === "string" ? i : `${i.caption || ""} ${i.x || ""}`)));
  if (block.caption) parts.push(block.caption);
  if (block.t === "example" && block.alt) parts.push(block.alt);
  return parts;
}

function createGuide(container, config) {
  const search = el("input", { type: "search", placeholder: config.placeholder, "aria-label": config.placeholder, autocomplete: "off", enterkeyhint: "search" });
  const status = el("span", { class: "hint guide-status" });
  const next = el("button", { class: "ghost guide-next", type: "button", hidden: "", text: "Next hit ↓" });
  const list = el("div", { class: "guide-list" });
  const foot = el("p", { class: "guide-note", hidden: "" });
  const row = el("div", { class: "guide-row", hidden: "" }, status, next);
  container.replaceChildren(el("div", { class: "guide-bar" }, search, row), list, foot);

  // Statuszeile nur zeigen, wenn es etwas zu melden gibt
  function setStatus(text) {
    status.textContent = text;
    row.hidden = !text && next.hidden;
  }

  let sections = [];       // oberste Abschnitte: { node, words, children }
  let allGroups = [];      // alle aufklappbaren Gruppen (auch verschachtelte)
  let units = [];          // alle suchbaren Absätze und Überschriften
  let vocab = new Set();   // alle Wörter des Textes
  let matchCache = new Map();
  let loadState = "idle";  // idle | loading | done
  let openBefore = null;   // welche Gruppen waren vor der Suche offen?
  let hits = [], hitIndex = -1, jumpTimer = null;

  function clearMarks() {
    for (const m of list.querySelectorAll("mark")) m.replaceWith(document.createTextNode(m.textContent));
    list.normalize();
  }

  // Suchbegriffe aus dem Eingabefeld; einzelne Buchstaben zählen nicht
  function queryTerms() {
    return [...new Set(wordsOf(searchForm(search.value)))].filter((t) => t.length >= 2);
  }

  // Welche Wörter passen zu einem Suchbegriff? Wort → Güte (3 genau, 2 Wortanfang, 1 Wortteil oder Tippfehler).
  // Tippfehler werden nur gesucht, wenn der Begriff sonst nirgends vorkommt, damit z. B. "fire" nicht auch "fine" findet.
  function matchesFor(term) {
    let found = matchCache.get(term);
    if (found) return found;
    found = new Map();
    for (const w of vocab) {
      if (w === term) found.set(w, 3);
      else if (w.startsWith(term)) found.set(w, 2);
      else if (term.length >= 4 && w.includes(term)) found.set(w, 1);
    }
    if (!found.size && term.length >= 4) {
      const allowed = term.length >= 8 ? 2 : 1;
      for (const w of vocab) {
        if (w.length >= term.length - allowed && prefixDistance(term, w) <= allowed) found.set(w, 1);
      }
    }
    matchCache.set(term, found);
    return found;
  }

  // Beste Güte, mit der ein Begriff in einer Wortmenge vorkommt (0 = gar nicht)
  function quality(words, found) {
    let best = 0;
    for (const [w, q] of found) {
      if (q > best && words.has(w)) best = q;
      if (best === 3) break;
    }
    return best;
  }

  // Ganze passende Wörter markieren, nicht einzelne Buchstaben
  function markTerms(root, found) {
    const wanted = new Set(found.flatMap((f) => [...f.keys()]));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.parentElement && n.parentElement.closest(".pin, .def-num")) continue;   // Nummern nicht markieren
      nodes.push(n);
    }
    for (const node of nodes) {
      const text = node.nodeValue;
      let pos = 0, frag = null;
      for (const match of searchForm(text).matchAll(WORD)) {
        if (!wanted.has(match[0])) continue;
        frag = frag || document.createDocumentFragment();
        frag.append(text.slice(pos, match.index), el("mark", { text: text.slice(match.index, match.index + match[0].length) }));
        pos = match.index + match[0].length;
      }
      if (frag) { frag.append(text.slice(pos)); node.replaceWith(frag); }
    }
  }

  // Gruppen ein- oder ausblenden; Treffer werden aufgeklappt
  function visit(group, found) {
    const match = found.every((f) => quality(group.words, f) > 0);
    group.node.hidden = !match;
    if (match && found.length) group.node.open = true;
    for (const child of group.children) visit(child, found);
    return match;
  }

  // Treffer sortieren: ganzer Suchtext im selben Absatz > Überschrift > Teile des Suchtextes; genaue Wörter vor Tippfehlern
  function rankHits(terms, found) {
    const phrase = terms.join(" ");
    const full = [], part = [];
    units.forEach((u, order) => {
      if (u.node.closest("details[hidden]")) return;
      const own = found.map((f) => quality(u.words, f));
      const count = own.filter(Boolean).length;
      if (!count) return;
      const context = found.every((f, i) => own[i] || quality(u.ctxWords, f));
      let score = own.reduce((a, b) => a + b, 0) * 4;
      if (count === terms.length) score += 100; else if (context) score += 50;
      if (u.text.includes(phrase)) score += 40;
      if (u.kind === "title") score += 30;
      if (u.text.startsWith(terms[0])) score += 5;
      (count === terms.length || context ? full : part).push({ u, score, order });
    });
    return (full.length ? full : part).sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.u);
  }

  function updateStatus(terms) {
    if (!terms.length) {
      next.hidden = true;
      setStatus("");
    } else if (!hits.length) {
      next.hidden = true;
      setStatus(`Nothing found for "${search.value.trim()}".`);
    } else {
      next.hidden = hits.length < 2;
      setStatus(hitIndex < 0 ? `${hits.length} hit${hits.length === 1 ? "" : "s"}` : `Hit ${hitIndex + 1} of ${hits.length}`);
    }
  }

  function goTo(index) {
    if (!hits.length) return;
    hitIndex = ((index % hits.length) + hits.length) % hits.length;
    const node = hits[hitIndex].node;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    for (const old of list.querySelectorAll(".hit-flash")) old.classList.remove("hit-flash");
    void node.offsetWidth;
    node.classList.add("hit-flash");
    setTimeout(() => node.classList.remove("hit-flash"), 2000);
    updateStatus(queryTerms());
  }

  function apply() {
    clearTimeout(jumpTimer);
    clearMarks();
    const terms = queryTerms();
    const found = terms.map(matchesFor);
    hits = []; hitIndex = -1;
    if (!terms.length) {
      // Suche leer (oder nur einzelne Buchstaben): alles zeigen, offene Gruppen wie vor der Suche wiederherstellen
      for (const s of sections) visit(s, found);
      if (openBefore) for (const g of allGroups) g.node.open = openBefore.has(g.node);
      openBefore = null;
      updateStatus(terms);
      return;
    }
    if (!openBefore) openBefore = new Set(allGroups.filter((g) => g.node.open).map((g) => g.node));
    for (const s of sections) visit(s, found);
    markTerms(list, found);
    hits = rankHits(terms, found);
    updateStatus(terms);
    if (hits.length) jumpTimer = setTimeout(() => goTo(0), 350);   // kurz warten, falls noch weitergetippt wird
  }

  search.addEventListener("input", apply);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(jumpTimer);
    goTo(hitIndex + 1);
  });
  next.addEventListener("click", () => goTo(hitIndex + 1));

  // Eine Gruppe (Abschnitt oder Unterpunkt) als aufklappbares Menü bauen
  function buildGroup(def, titles, level) {
    const chain = titles.concat(def.title);
    const group = { node: null, children: [], words: null };
    const ctxWords = new Set(wordsOf(searchForm(plainText(chain.join(" ")))));
    const parts = [def.title];
    const summary = el("summary", {}, el("span", { class: "summary-text", text: def.title }));   // eigenes span, damit Markierungen im Titel keine Lücken bekommen
    const body = el("div", { class: "rule-body" });
    const titleText = searchForm(plainText(def.title));
    units.push({ node: summary, text: titleText, words: new Set(wordsOf(titleText)), ctxWords: new Set(wordsOf(searchForm(plainText(titles.join(" "))))), kind: "title" });
    let blocks = def.blocks || [];
    // Nur eine Frage im Thema: kein zweites Aufklappen, die Frage steht direkt über der Antwort
    if (blocks.length === 1 && blocks[0].t === "group") blocks = [{ t: "q", x: blocks[0].title }, ...(blocks[0].blocks || [])];
    for (const block of blocks) {
      if (block.t === "group") {
        const sub = buildGroup(block, chain, level + 1);
        group.children.push(sub);
        parts.push(...sub.words);
        body.append(sub.node);
      } else {
        const node = blockNode(block);
        body.append(node);
        for (const u of leafUnits(block, node)) {
          const text = searchForm(plainText(u.text));
          units.push({ node: u.node, text, words: new Set(wordsOf(text)), ctxWords, kind: u.kind });
        }
        parts.push(...blockTexts(block));
      }
    }
    group.node = el("details", { class: level === 1 ? "rule-section" : "rule-group", id: def.id ? `${config.container.slice(1)}-${def.id}` : null }, summary, body);
    group.words = new Set(wordsOf(searchForm(plainText(parts.join(" ")))));
    allGroups.push(group);
    return group;
  }

  function render(guideData) {
    const defs = Array.isArray(guideData && guideData.sections) ? guideData.sections : [];
    units = []; allGroups = [];
    sections = defs.map((def) => buildGroup(def, [], 1));
    vocab = new Set(sections.flatMap((s) => [...s.words]));
    matchCache = new Map();
    list.replaceChildren(...sections.map((s) => s.node));
    const note = guideData && guideData.meta && guideData.meta.note;
    foot.textContent = note || "";
    foot.hidden = !note || !sections.length;
    if (!sections.length) list.replaceChildren(el("p", { class: "empty", text: config.empty }));
    search.hidden = !sections.length;
    apply();
  }

  async function load() {
    if (loadState !== "idle") return;
    loadState = "loading";
    setStatus("Loading…");
    try {
      const response = await fetch(config.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
      loadState = "done";
    } catch (err) {
      loadState = "idle";   // beim nächsten Öffnen oder per Knopf nochmal versuchen
      setStatus("");
      const retry = el("button", { class: "ghost", type: "button", text: "Try again" });
      retry.addEventListener("click", () => {
        list.replaceChildren();
        load();
      });
      list.replaceChildren(el("div", { class: "empty guide-error", role: "alert" },
        el("p", { text: `This page could not be loaded (${err.message}). Please check your connection and try again.` }),
        retry));
      retry.focus();
    }
  }

  return { load };
}


/* ---------- Ansichten wechseln ---------- */

let lastTab = "compendium";

function showView(name) {
  $("#view-compendium").hidden = name !== "compendium";
  $("#view-troupes").hidden = name !== "troupes";
  $("#view-editor").hidden = name !== "editor";
  $("#view-game").hidden = name !== "game";
  $("#view-rules").hidden = name !== "rules";
  $("#view-faqs").hidden = name !== "faqs";
  if (name === "rules" || name === "faqs") openGuide(name);
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
  $("#game-add-foe").addEventListener("click", () => openAddOpponent("add"));
  const addName = $("#opp-add-name");
  addName.addEventListener("input", () => { $("#opp-add-ok").disabled = !addName.value.trim(); });
  addName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmAddOpponent(); } });
  $("#opp-add-ok").addEventListener("click", confirmAddOpponent);
  $("#opp-add-cancel").addEventListener("click", () => $("#opp-add-dialog").close());
  $("#opp-pick-cancel").addEventListener("click", () => $("#opp-pick-dialog").close());
  for (const id of ["#opp-add-dialog", "#opp-pick-dialog"]) {
    const d = $(id);
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  }
  $("#game-start").addEventListener("click", startGame);
  $("#game-next-round").addEventListener("click", nextRound);
  twoTap($("#game-reset"), "Really reset?", resetGame);

  $("#editor-name").addEventListener("input", (e) => {
    current.name = e.target.value.slice(0, 40);
    saveTroupes();
  });

  // Export: ein kleines Fenster mit Teilen, Link kopieren und Code kopieren
  const exportDialog = $("#export-dialog");
  $("#copy").addEventListener("click", () => {
    if (!current || !current.ids.length) return toast("Add some models to the troupe first.");
    const n = current.ids.length;
    $("#export-summary").textContent = `${troupeLabel(current)} · ${n} model${n === 1 ? "" : "s"}`;
    $("#export-share").hidden = typeof navigator.share !== "function";
    exportDialog.showModal();
  });
  $("#export-close").addEventListener("click", () => exportDialog.close());
  exportDialog.addEventListener("click", (e) => { if (e.target === exportDialog) exportDialog.close(); });
  $("#export-share").addEventListener("click", async () => {
    if (!current) return;
    try {
      await navigator.share({
        title: troupeLabel(current),
        text: `${troupeLabel(current)}: my troupe in the Tauber Tourist Guide`,
        url: shareUrl(current),
      });
      exportDialog.close();
    } catch (err) {
      if (!err || err.name !== "AbortError") toast("Sharing did not work. Try copying the link instead.");
    }
  });
  $("#export-link").addEventListener("click", async () => {
    if (!current) return;
    if (await copyText(shareUrl(current), "Link copied to clipboard.")) exportDialog.close();
  });
  $("#export-code").addEventListener("click", async () => {
    if (!current) return;
    if (await copyText(encodeTroupe(current), "Troupe code successfully copied to clipboard.")) exportDialog.close();
  });

  // Import: Knopf in der Übersicht öffnet ein kleines Fenster zum Einfügen, danach folgt die Vorschau
  const importDialog = $("#import-dialog");
  $("#import-open").addEventListener("click", () => {
    $("#import-code").value = "";
    pendingImport = null;
    showImportStep("code");
    importDialog.showModal();
  });
  $("#import-cancel").addEventListener("click", () => importDialog.close());
  importDialog.addEventListener("click", (e) => { if (e.target === importDialog) importDialog.close(); });
  importDialog.addEventListener("close", () => { pendingImport = null; $("#import-code").value = ""; });
  // Enter im Eingabefeld geht zur Vorschau (Shift+Enter wäre ein Zeilenumbruch)
  $("#import-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("#import").click();
    }
  });
  $("#import").addEventListener("click", () => {
    const code = $("#import-code").value;
    if (!code.trim()) return toast("Please paste a code or link first.");
    openImportPreview(code);
  });
  $("#preview-back").addEventListener("click", () => { pendingImport = null; showImportStep("code"); });
  $("#preview-add").addEventListener("click", confirmImport);

  // Backup aller Troupen
  $("#backup-export").addEventListener("click", exportBackup);
  $("#backup-import").addEventListener("click", () => $("#backup-file").click());
  $("#backup-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";   // damit dieselbe Datei später nochmal gewählt werden kann
    if (file) importBackup(file);
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
    if (!Array.isArray(c.keywords)) {
      problems.push(`${c.name}: "keywords" must be a list, empty [] if necessary.`);
    }
    if (c.synergies !== undefined && !(Array.isArray(c.synergies) && c.synergies.every((t) => typeof t === "string"))) {
      problems.push(`${c.name}: "synergies" must be a list of texts, for example ["Animal"].`);
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
  const codeProblems = [];
  data.characters.forEach((c) => {
    if (!c.factions) c.factions = [c.faction];
    characterById.set(c.id, c);
    const short = idCode(c.id);
    if (idByCode.has(short)) codeProblems.push(`The troupe code cannot tell "${c.id}" and "${idByCode.get(short)}" apart. Rename one of the ids slightly.`);
    else idByCode.set(short, c.id);
  });

  const problems = [...codeProblems, ...checkData()];
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

  // Geteilter Link (…/#t=Code): Vorschau zum Importieren öffnen
  checkIncomingLink();
  window.addEventListener("hashchange", checkIncomingLink);

  // Offline-Funktion einschalten. Wenn das nicht klappt, läuft die App einfach ohne.
  try {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch { /* ignorieren */ }
}

// Bilder (auch die Charakterkarten) lassen sich nicht herausziehen
document.addEventListener("dragstart", (e) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); });

boot();