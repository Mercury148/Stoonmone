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

// Sanftes Auf- und Zuklappen für alle <details> der App (Synergien, Einführung, Regeln, FAQs, Summons):
// das ganze <details> gleitet in der Höhe auf bzw. zu, der Inhalt blendet dabei ein bzw. aus.
// Die Bewegung beginnt sofort mit voller Geschwindigkeit und bremst am Ende ab (in beide Richtungen),
// damit zwischen Klick und sichtbarer Bewegung keine Verzögerung spürbar ist.
// Während des Zuklappens trägt das <details> die Klasse "closing" (für den Pfeil), "open" fällt erst am Ende weg.
// Ein Klick mitten in der Animation kehrt sie an der aktuellen Stelle um.
const detailsAnims = new WeakMap();   // <details> -> { box, parts } der laufenden Animation
document.addEventListener("click", (e) => {
  const summary = e.target.closest("summary");
  const box = summary && summary.parentElement;
  if (!box || box.tagName !== "DETAILS" || box.querySelector(":scope > summary") !== summary) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  e.preventDefault();
  const running = detailsAnims.get(box);
  const opening = !box.open || box.classList.contains("closing");
  const parts = [...box.children].filter((c) => c !== summary);
  const fromHeight = box.offsetHeight;   // aktuelle Höhe, auch mitten in einer Animation
  const fromOpacity = running && parts[0] ? getComputedStyle(parts[0]).opacity : (opening ? 0 : 1);
  if (running) { running.box.cancel(); running.parts.forEach((a) => a.cancel()); }
  box.classList.toggle("closing", !opening);
  if (opening) box.open = true;
  // Zielhöhe: offen = volle Höhe, zu = nur die Titelzeile samt Rahmen und Innenabstand
  const cs = getComputedStyle(box);
  const frame = box.offsetHeight - box.clientHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const toHeight = opening ? box.offsetHeight : summary.offsetHeight + frame;
  const duration = Math.round(Math.min(420, 200 + Math.abs(toHeight - fromHeight) * 0.12));   // lange Abschnitte etwas länger
  const timing = { duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  box.style.overflow = "hidden";
  const anim = {
    box: box.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], timing),
    parts: parts.map((p) => p.animate([{ opacity: fromOpacity }, { opacity: opening ? 1 : 0 }], { ...timing, fill: "forwards" })),
  };
  detailsAnims.set(box, anim);
  anim.box.onfinish = () => {
    if (detailsAnims.get(box) !== anim) return;
    detailsAnims.delete(box);
    box.style.overflow = "";
    anim.parts.forEach((a) => a.cancel());
    if (!opening) { box.open = false; box.classList.remove("closing"); }
  };
});

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
  trackGlow(factionRow, ".faction-btn:not(.blocked)", ".faction-btn", 1.3);   // Leuchten bei Mausnähe (bis 1,3 Spaltenbreiten: zwischen zwei Wappen leuchten beide)
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
  // Die Knöpfe werden nur einmal gebaut und danach nur aktualisiert, damit das Leuchten flüssig übergehen kann
  const factionButtons = new Map();
  function renderFactions() {
    if (!factionButtons.size) {
      factionRow.replaceChildren(
        ...data.factions.map((f) => {
          const button = el("button", {
            class: "faction-btn",
            type: "button",
            style: factionStyle(f),
            title: f.name,
            "aria-label": f.name,   // nur das Wappen ist sichtbar, der Name kommt aus Tooltip und aria-label
            onclick: () => {
              if (state.factions.has(f.id)) state.factions.delete(f.id);
              else state.factions.add(f.id);
              renderFactions();
              onChange();
            },
          }, addCrestGlow(factionIcon(f), [f], false));   // Leuchten als vorbereitetes Bild statt CSS-Filter (der wird auf dem Handy über dem Geweih abgeschnitten)
          factionButtons.set(f.id, button);
          return button;
        })
      );
    }
    for (const f of data.factions) {
      const button = factionButtons.get(f.id);
      button.classList.toggle("blocked", Boolean(allowed && !allowed.has(f.id)));
      button.setAttribute("aria-pressed", String(state.factions.has(f.id)));
    }
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
    // Gewählte Synergien klein neben "Synergies" (nur in der breiten Ansicht, siehe style.css); Trefferanzahl rechts
    const picked = [...state.synergies];
    synSummary.replaceChildren(
      ...[
        el("span", { text: "Synergies" }),
        picked.length ? el("span", { class: "syn-picked", text: picked.join(", ") }) : null,
        count,
      ].filter(Boolean)   // ohne Auswahl nichts einfügen (replaceChildren würde sonst "null" als Text zeigen)
    );
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
      meta.classList.toggle("is-off", !(state.query || state.factions.size || state.synergies.size));   // Platz bleibt reserviert (siehe style.css)
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
    if (current.ids.length === formatOf(current).max) showPlayHint();   // Troupe gerade vollständig geworden
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

// Großes, blasses Wappen am rechten Rand der Kachel, halb abgeschnitten wie auf den Charakterkarten.
// Das Bild wird einmal pro Wappen im Browser vorbereitet (Canvas): Leuchten in Fraktionsfarbe nur UM das Wappen herum,
// das Wappen selbst blass in seinen eigenen Farben. So sieht es auf allen Geräten gleich aus (auch auf dem iPhone,
// wo Maske + Filter in CSS nicht zuverlässig funktionieren).
const WATERMARK_PAD = 24 / 188;   // Rand rund ums Wappen, damit das Leuchten nicht abgeschnitten wird
const watermarkCache = new Map();
// opts: crest = Deckkraft des Wappens im Bild (0 = nur das Leuchten), glow = Deckkraft des Leuchtens, blur = Unschärfen (klein, groß)
// pad = Rand ums Wappen (Anteil der Wappengröße); größeres Leuchten braucht mehr Rand, sonst wird es abgeschnitten
function watermarkImage(image, factions, opts = {}) {
  const { crest: crestAlpha = 0.25, glow: glowAlpha = 0.35, blur = [10, 24], pad: padShare = WATERMARK_PAD } = opts;
  const light = getComputedStyle(document.documentElement).getPropertyValue("--fac-l").trim() || "62%";
  const key = `${image}|${light}|${crestAlpha}|${glowAlpha}|${blur}|${padShare}|${factions.map((f) => f.id)}`;
  if (watermarkCache.has(key)) return watermarkCache.get(key);
  const promise = new Promise((resolve) => {
    const src = new Image();
    src.onload = () => {
      const crest = 376;                                   // Wappen in doppelter Auflösung (Original 188 px)
      const pad = Math.round(crest * padShare);
      const size = crest + 2 * pad;
      const canvas = () => { const cv = document.createElement("canvas"); cv.width = size; cv.height = size; return cv; };
      // 1. Leuchten: nur der Schatten des Wappens (das Wappen selbst wird außerhalb gezeichnet und weggeschoben)
      const glow = canvas();
      const g = glow.getContext("2d");
      const [a, b = a] = factions;
      const color = (f) => `hsl(${f.hue} ${f.sat ?? 55}% ${light})`;
      for (const [f, r] of [[a, blur[0]], [a, blur[1]], [b, blur[1]]]) {
        g.shadowColor = color(f);
        g.shadowBlur = r;
        g.shadowOffsetX = size * 4;
        g.drawImage(src, pad - size * 4, pad, crest, crest);
      }
      // 2. Hinter dem Wappen kein Leuchten: die Wappenfläche wieder herausschneiden
      g.shadowColor = "transparent";
      g.globalCompositeOperation = "destination-out";
      g.drawImage(src, pad, pad, crest, crest);
      // 3. Zusammensetzen: Leuchten 35 %, darüber das Wappen 25 %
      const out = canvas();
      const o = out.getContext("2d");
      o.globalAlpha = glowAlpha;
      o.drawImage(glow, 0, 0);
      if (crestAlpha > 0) {
        o.globalAlpha = crestAlpha;
        o.drawImage(src, pad, pad, crest, crest);
      }
      try { resolve(out.toDataURL("image/png")); } catch { resolve(null); }
    };
    src.onerror = () => resolve(null);
    src.src = image;
  });
  watermarkCache.set(key, promise);
  return promise;
}

// Leuchten in Fraktionsfarbe um ein (kräftiges) Wappen, z. B. in der Ecke der Troupe-Kacheln.
// Ein zweites Bild nur mit dem Leuchten liegt hinter dem Wappen; die Wappenfläche ist darin ausgespart.
// withNear: zusätzlich das größere Mausnähe-Leuchten (Troupe-Kacheln); ohne nur das Leuchten selbst (Fraktionsfilter)
function addCrestGlow(icon, factions, withNear = true) {
  const img = icon && icon.querySelector("img");
  if (!img) return icon;
  const files = factions.map((f) => f.id).sort((x, y) => FACTION_ORDER.indexOf(x) - FACTION_ORDER.indexOf(y)).map((id) => factionById.get(id));
  const glow = el("img", { class: "crest-glow", alt: "", draggable: "false" });
  glow.hidden = true;
  icon.prepend(glow);
  watermarkImage(img.getAttribute("src"), files, { crest: 0, glow: 0.9, blur: [14, 32] }).then((url) => { if (url) { glow.src = url; glow.hidden = false; } });
  if (withNear) {
    // Wie bei den Kompendium-Kacheln: zusätzliches, größeres Leuchten, das mit der Mausnähe aufblendet (siehe trackGlow)
    const near = el("img", { class: "crest-glow crest-glow-near", alt: "", draggable: "false" });
    near.hidden = true;
    icon.prepend(near);
    watermarkImage(img.getAttribute("src"), files, { crest: 0, glow: 0.9, blur: [18, 42], pad: 32 / 188 }).then((url) => { if (url) { near.src = url; near.hidden = false; } });
  }
  return icon;
}

function cardWatermark(c) {
  const factions = c.factions.map((id) => factionById.get(id)).filter(Boolean);
  const files = factions.map((f) => f.id).sort((x, y) => FACTION_ORDER.indexOf(x) - FACTION_ORDER.indexOf(y)).map((id) => factionById.get(id));
  const image = factions.length === 2 ? dualImage(factions) : factions[0] && (factions[0].icon || FACTION_IMAGES[factions[0].id]);
  if (!image) return null;
  const img = el("img", { class: "card-watermark", alt: "", draggable: "false", "aria-hidden": "true" });
  // Zweite Ebene nur mit kräftigem Leuchten: blendet auf, je näher die Maus der Wappenmitte kommt (siehe trackCrestGlow)
  const glow = el("img", { class: "card-watermark card-watermark-glow", alt: "", draggable: "false", "aria-hidden": "true" });
  img.hidden = true;
  glow.hidden = true;
  watermarkImage(image, files).then((url) => { if (url) { img.src = url; img.hidden = false; } });
  // Leuchten ca. 30 % größer als bei den Troupe-Wappen (blur 14/32), mit passend größerem Rand (siehe .card-watermark-glow)
  watermarkImage(image, files, { crest: 0, glow: 0.9, blur: [18, 42], pad: 32 / 188 }).then((url) => { if (url) { glow.src = url; glow.hidden = false; } });
  return [img, glow];
}

// Wappen, die heller leuchten, je näher die Maus ist: zählt nur der Abstand zur Mitte, egal wo die Maus ist.
// Ergebnis als --near (0 bis 1) am host-Element; ab range Breiten des gemessenen Elements Abstand 0, in der Mitte 1.
const glowTargets = [];   // { container, measure: Selektor des gemessenen Elements, host: Selektor für --near, range }
let glowLit = new Set(), glowFrame = 0, glowPos = null;

function trackGlow(container, measure, host, range) {
  glowTargets.push({ container, measure, host, range });
}

function updateGlow() {
  glowFrame = 0;
  const next = new Map();
  if (glowPos) {
    // Erst alle Positionen lesen, dann schreiben (sonst rechnet der Browser bei jedem Wappen das Layout neu)
    for (const t of glowTargets) {
      for (const node of t.container.querySelectorAll(t.measure)) {
        const r = node.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;   // ausgeblendet oder nicht im Bild
        const near = 1 - Math.min(1, Math.hypot(glowPos.x - (r.left + r.width / 2), glowPos.y - (r.top + r.height / 2)) / (r.width * t.range));
        if (near > 0) next.set(node.closest(t.host), near * near);
      }
    }
  }
  for (const node of glowLit) if (!next.has(node)) node.style.removeProperty("--near");
  for (const [node, near] of next) node.style.setProperty("--near", near.toFixed(3));
  glowLit = new Set(next.keys());
}

const scheduleGlow = () => { if (!glowFrame) glowFrame = requestAnimationFrame(updateGlow); };
document.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  glowPos = { x: e.clientX, y: e.clientY };
  scheduleGlow();
});
window.addEventListener("scroll", () => { if (glowPos) scheduleGlow(); }, { passive: true });   // beim Scrollen wandern die Wappen unter der Maus
document.documentElement.addEventListener("mouseleave", () => { glowPos = null; scheduleGlow(); });   // Maus verlässt das Fenster

// Kompendium-Kacheln: bis 2 Wappenbreiten
trackGlow($("#cards"), ".card-watermark-glow:not([hidden])", ".card", 2);
// Troupe-Kacheln: Wappen in der Ecke, bis 10 Wappenbreiten (etwa so weit wie bei den Kompendium-Kacheln)
trackGlow($("#troupe-list"), ".troupe-corner .faction-icon", ".faction-icon", 10);

function renderCards() {
  // Charaktere mit "compendium": false (die beschworene Kopie eines normalen Charakters) bleiben im Kompendium verborgen
  const list = compendiumPanel.list().filter((c) => c.compendium !== false);
  compendiumPanel.showCount(list.length, data.characters.filter((c) => c.compendium !== false).length);

  if (list.length === 0) {
    $("#cards").replaceChildren(el("p", { class: "empty", text: "No character matches these filters." }));
    return;
  }

  const cardEl = (c) =>
      el("article", { class: "card", "data-char": c.id },
        cardWatermark(c),
        el("button",{ class: "card-main", type: "button", onclick: (e) => openDetail(c.id, e.currentTarget), "aria-label": `${c.name}: open details` },
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
      faction ? el("span", { class: "troupe-corner", title: factions.map((f) => f.name).join(" / ") }, ...(factionsIcon(factions) ? [addCrestGlow(factionsIcon(factions), factions)] : factions.map((f) => addCrestGlow(factionIcon(f), [f])))) : null,
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
        el("button", { class: "slot-open", type: "button", "data-char": id, "aria-label": `${c.name}: open details`, onclick: (e) => openDetail(id, e.currentTarget) },
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
        el("button", { class: "slot-open", type: "button", "data-char": c.id, "aria-label": `${c.name} (summoned): open details`, onclick: (e) => openDetail(c.id, e.currentTarget) },
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
  // Jede Seite zeigt einen Lade-Platzhalter in Kartengröße (siehe style.css), bis ihr Bild da ist; dann blendet das Bild ein
  const face = (cls, src, alt) => {
    const box = el("div", { class: cls });
    const done = () => box.classList.add("loaded");
    const img = el("img", { src, alt, onload: done, onerror: done });
    if (img.complete && img.naturalWidth) done();
    box.append(img);
    return box;
  };
  const faces = [face("card-face", c.card, `Character card: ${c.name}`)];
  if (hasBack) faces.push(face("card-face back", c.cardBack, `Back of the card with the signature move: ${c.name}`));
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
      el("div", { class: "card-buttons" },
        el("button", { class: "card-close", type: "button", text: "Close", onclick: () => $("#detail").close() })
      )
    )
  );
  $("#detail").classList.add("card-view");
  if (!$("#detail").open) $("#detail").showModal();
}

// Blättern in der geöffneten Karte: Pfeiltasten links/rechts (Computer), Wischen links/rechts (Handy).
// Die Reihenfolge ist die der Liste, aus der die Karte geöffnet wurde (Kompendium, Troupe, Auswahl, Spielreihe).
// Jedes Element, das eine Karte öffnet, trägt dafür data-char (die ID); die Liste ist der umgebende Bereich.
const DETAIL_LISTS = "#cards, .tiles, #editor-slots, #summons-list, .grow";
let detailNav = { ids: [], index: 0 };

function idsAround(source, id) {
  const scope = source && source.closest(DETAIL_LISTS);
  const ids = scope ? [...new Set([...scope.querySelectorAll("[data-char]")].map((n) => n.dataset.char))] : [];
  return ids.includes(id) ? ids : [id];
}

function stepDetail(dir) {
  const { ids } = detailNav;
  if (ids.length < 2 || !$("#detail").open) return;
  detailNav.index = (detailNav.index + dir + ids.length) % ids.length;   // am Ende geht es vorne weiter
  showDetail(ids[detailNav.index]);
  // Der fokussierte Knopf wurde eben ersetzt: Fokus zurück ins Fenster (auf die Karte), sonst landet er auf der Seite dahinter
  ($("#detail .card-flip") || $("#detail")).focus({ preventScroll: true });
  // Die neue Karte gleitet kurz aus der Richtung herein, aus der geblättert wurde
  if (!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    $("#detail-body").animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }
}

// Auf dem ganzen Dokument lauschen, nicht nur im Fenster: so kommt jeder Tastendruck an, egal wo der Fokus gerade liegt
document.addEventListener("keydown", (e) => {
  if (!$("#detail").open || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowRight") { e.preventDefault(); stepDetail(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); stepDetail(-1); }
});

// Wischen: deutlich waagerecht und schnell genug. Danach wird der Klick unterdrückt, den manche Browser
// nach dem Loslassen noch auslösen (sonst würde die Karte beim Wischen gleichzeitig umgedreht).
{
  let start = null, swallowClick = false;
  const dlg = $("#detail");
  dlg.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, time: Date.now() } : null;
  }, { passive: true });
  dlg.addEventListener("touchend", (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    const quick = Date.now() - start.time < 700;
    start = null;
    if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 400);
      stepDetail(dx < 0 ? 1 : -1);   // nach links wischen = nächster Charakter
    }
  });
  dlg.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); }
  }, true);
}

// Detailansicht in einem <dialog>-Fenster (nur Nachschlagen, ohne Hinzufügen).
// source: das angetippte Element; aus seiner Liste ergibt sich die Reihenfolge zum Blättern.
function openDetail(id, source = null) {
  detailNav = { ids: idsAround(source, id), index: 0 };
  detailNav.index = detailNav.ids.indexOf(id);
  showDetail(id);
}

function showDetail(id) {
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
  if (!$("#detail").open) $("#detail").showModal();
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
  if (game.stage === "setup") startSetupTour();
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
  if (side !== "own") resetFoePickerWhenFull();
  saveGame();
  renderGame();
}

// Sind alle Gegner voll, gibt es nichts mehr zu wählen: Suche und Filter leeren, damit die Liste wirklich verschwindet
// (bei aktiver Suche oder Filter bliebe sie sonst sichtbar)
function resetFoePickerWhenFull() {
  const size = gameSize();
  if (!Number.isFinite(size) || !game.opps.every((o) => o.ids.length >= size)) return;
  foeListOpen = false;
  foePanel.clear();
}

// Rechtsklick (Computer) oder Antippen und Halten (Handy) zeigt die Karte, ein normaler Klick macht etwas anderes (onclick).
// Liefert die Ereignis-Eigenschaften für el(); onDown läuft zusätzlich bei jedem Herunterdrücken.
function cardPress(c, onclick, onDown = null) {
  let timer = null;
  let longPressed = false;
  let startX = 0, startY = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  return {
    onclick: (e) => {
      if (longPressed) { longPressed = false; e.preventDefault(); return; }
      onclick(e);
    },
    oncontextmenu: (e) => { e.preventDefault(); openDetail(c.id, e.currentTarget); },
    onpointerdown: (e) => {
      if (onDown) onDown(e);
      if (e.pointerType === "mouse") return;
      longPressed = false;
      startX = e.clientX; startY = e.clientY;
      const source = e.currentTarget;
      timer = setTimeout(() => { longPressed = true; timer = null; if (navigator.vibrate) navigator.vibrate(15); openDetail(c.id, source); }, 500);
    },
    onpointermove: (e) => { if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); },
    onpointerup: cancel,
    onpointercancel: cancel,
    onpointerleave: cancel,
  };
}

function tileFor(c, selected, onclick, extraClass = "") {
  const tile = el("button", { class: extraClass ? `tile ${extraClass}` : "tile", type: "button", "data-char": c.id, "aria-pressed": String(selected), "aria-label": c.name,
    ...cardPress(c, onclick),
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

// Lebenspunkte beim letzten Zeichnen und laufende Kästchen-Animationen, je Modell-Eintrag des Spiels (neues Spiel = neue Einträge).
// Wird während einer Animation neu gezeichnet (schnelles Klicken), läuft sie mit negativer Verzögerung an derselben Stelle weiter.
const HBOX_ANIM_MS = 600;
const HBOX_HEAL_MS = 900;   // Heilen dauert etwas länger (grünes Füllen, dann normale Farbe), siehe style.css
const healthAnim = new WeakMap();   // Modell-Eintrag → { remaining, boxes: Map(Index → { kind: "fill" | "drain", start }) }

function hboxAnimations(m, remaining) {
  const now = performance.now();
  let track = healthAnim.get(m);
  if (!track) { track = { remaining, boxes: new Map() }; healthAnim.set(m, track); }
  const before = track.remaining;
  track.remaining = remaining;
  // Kästchen zwischen alter und neuer Grenze: neue Wunden füllen sich rot, geheilte laufen leer
  for (let i = Math.min(before, remaining); i < Math.max(before, remaining); i++) {
    const kind = i >= remaining ? "fill" : "drain";
    const old = track.boxes.get(i);
    // Umkehr mitten in einer Animation: beim aktuellen Füllstand weitermachen statt neu von leer/voll zu beginnen
    // (Wunde ↔ Heilen haben unterschiedliche Dauer: der bereits gelaufene Anteil wird umgerechnet)
    const dur = (k) => (k === "drain" ? HBOX_HEAL_MS : HBOX_ANIM_MS);
    const left = old && old.kind !== kind ? Math.max(0, dur(kind) * (1 - (now - old.start) / dur(old.kind))) : 0;
    track.boxes.set(i, { kind, start: now - left });
  }
  for (const [i, a] of track.boxes) {
    if (now - a.start >= (a.kind === "drain" ? HBOX_HEAL_MS : HBOX_ANIM_MS) || (a.kind === "fill") !== (i >= remaining)) track.boxes.delete(i);
  }
  return (i) => {
    const a = track.boxes.get(i);
    return a ? { kind: a.kind, delay: a.start - now } : null;
  };
}

// Bei jedem Antippen ein etwas anderes Farbmuster für das Aufleuchten, das an das vorige anschließt, so dass beim
// mehrmaligen Tippen eine Art Welle entsteht: eine laufende Phase treibt Winkel, Farbaufteilung und Farbfleck auf
// sanften Kurven weiter, mit etwas Zufall. Zwei Fraktionen: beide Farben wechseln sich ab;
// eine Fraktion: die Fraktionsfarbe überwiegt, dazu ca. 15 % dunkles Grau und ca. 15 % hellere Fraktionsfarbe für Abwechslung.
let flashPhase = Math.random() * 10;
function randomizeFlash(event) {
  const button = event.currentTarget;
  const s = button.style;
  const mono = button.parentElement.dataset.mono === "1";
  flashPhase += 0.55 + Math.random() * 0.25;
  const p = flashPhase;
  const jitter = (n) => (Math.random() - 0.5) * n;
  s.setProperty("--flash-angle", `${Math.round((p * 40 + jitter(16)) % 360)}deg`);
  s.setProperty("--flash-x", `${Math.round(50 + 35 * Math.sin(p * 0.9))}%`);
  s.setProperty("--flash-y", `${Math.round(50 + 35 * Math.cos(p * 0.7))}%`);
  if (mono) {
    s.setProperty("--flash-a", `${Math.round(72 + 8 * Math.sin(p * 1.3))}%`);   // Grau erst ab ca. 65–80 % (etwa 15 % der Fläche)
    s.setProperty("--flash-b", "100%");
    // Zweiter, hellerer Fleck in der Fraktionsfarbe (ca. 15 % der Fläche), auf eigenen Wellenbahnen
    s.setProperty("--flash-hi", "1");
    s.setProperty("--flash-x2", `${Math.round(50 + 32 * Math.sin(p * 1.1 + 2) + jitter(8))}%`);
    s.setProperty("--flash-y2", `${Math.round(50 + 32 * Math.cos(p * 0.8 + 1) + jitter(8))}%`);
  } else {
    s.setProperty("--flash-hi", "0");
    s.setProperty("--flash-a", `${Math.round(15 + 15 * Math.sin(p * 1.3))}%`);
    s.setProperty("--flash-b", `${Math.round(85 + 15 * Math.sin(p * 1.1))}%`);
  }
  // Farbfleck: bei zwei Fraktionen abwechselnd in der einen oder anderen Farbe, bei einer immer in der Fraktionsfarbe
  const second = !mono && Math.sin(p * 0.5) > 0;
  s.setProperty("--flash-bh", second ? "var(--flash-h2)" : "var(--flash-h)");
  s.setProperty("--flash-bs", second ? "var(--flash-s2)" : "var(--flash-s)");
  s.setProperty("--flash-bl", second ? "var(--flash-l2)" : "var(--fac-l)");
  // Gedrückt-Zustand selbst setzen: auf dem Handy greift :active zu spät oder (iPhone) gar nicht
  button.classList.add("pressed");
  const release = () => button.classList.remove("pressed");
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, release, { once: true });
}

// Nach dem Antippen wird die Spielansicht neu gezeichnet und der Knopf ersetzt. Damit das Aufleuchten trotzdem
// sichtbar bleibt (kurzes Tippen auf dem Handy), bekommt der neue Knopf dasselbe Muster und blendet es langsam aus.
let pendingFlash = null;   // { model, half, style } des zuletzt angetippten Knopfes
function rememberFlash(event, model, half) {
  pendingFlash = { model, half, style: event.currentTarget.style.cssText };
}
function takeFlash(model, half) {
  if (!pendingFlash || pendingFlash.model !== model || pendingFlash.half !== half) return null;
  const style = pendingFlash.style;
  pendingFlash = null;
  return style;
}

// Portraits der Gameview werden wiederverwendet statt bei jedem Antippen neu erzeugt.
// Ein neues <img> muss der Browser erst wieder laden und zeichnen, das ließ die Portraits flackern.
const gamePortraits = new Map();
function gamePortrait(side, c) {
  const key = `${side}:${c.id}`;
  let node = gamePortraits.get(key);
  if (!node) {
    node = portraitCard(c);
    const img = node.querySelector("img");
    if (img) img.loading = "eager";
    gamePortraits.set(key, node);
  }
  return node;
}

function gameCell(side, c) {
  const m = gameModel(side, c.id);
  const health = healthOf(c);
  const total = health ? health.length : null;
  const remaining = health ? total - m.wounds : null;
  const maxWounds = total === null ? 30 : total;
  const change = (patch) => { Object.assign(m, patch); saveGame(); renderGamePlay(); pendingFlash = null; };

  // Beschworene Charaktere starten ausgegraut. Erst "Summon" bringt sie mit vollen Lebenspunkten und ohne Energy ins Spiel.
  // Der gerade nicht aktive Zwilling steht ausgegraut in der Beschworenen-Zeile (kein Summon-Knopf)
  if (twinOf(c) && !sideIds(side).includes(c.id)) {
    return el("div", { class: "gcell unsummoned", "data-char": c.id },
      el("div", { class: "gcell-media" },
        el("div", { class: "gcell-portrait", ...cardPress(c, () => {}) }, gamePortrait(side, c)),   // Karte nur per Rechtsklick oder Halten
        el("div", { class: "summon-note", text: "Transformed" })
      ),
      el("div", { class: "gcell-name", text: c.name })
    );
  }

  // Auch ein beschworenes Modell, das auf 0 Lebenspunkte fällt, geht zurück in den Zustand "nicht im Spiel" und kann neu beschworen werden
  if (isSummoned(c) && !twinOf(c) && (!m.summoned || (health && remaining <= 0))) {
    return el("div", { class: "gcell unsummoned", "data-char": c.id },
      // Der Summon-Knopf liegt auf dem Portrait, die Kachel wird dadurch nicht größer
      el("div", { class: "gcell-media" },
        el("div", { class: "gcell-portrait", ...cardPress(c, () => {}) }, gamePortrait(side, c)),   // Karte nur per Rechtsklick oder Halten
        el("button", { class: "summon-btn", type: "button", text: "Summon", onclick: () => change({ summoned: true, wounds: 0, energy: 0 }) })
      ),
      el("div", { class: "gcell-name", text: c.name })
    );
  }

  // Kästchen, die sich gerade geändert haben, füllen sich rot von unten (fill) oder verlieren das Rot nach unten (drain)
  const anim = health ? hboxAnimations(m, remaining) : null;
  const pip = (dot, i) => {
    const a = anim(i);
    return el("span", {
      class: `hbox${dot ? " blue" : ""}${i >= remaining ? " struck" : ""}${a ? " " + a.kind : ""}`,
      style: a ? `--d: ${Math.round(a.delay)}ms` : null,
    });
  };
  // Lebenspunkte in Fünfergruppen, höchstens zwei Gruppen (10 Punkte) pro Zeile; ist die Kachel zu schmal, steht jede Gruppe in einer eigenen Zeile
  const rows = [];
  if (health) {
    for (let r = 0; r < health.length; r += 10) {
      const groups = [];
      for (let i = r; i < Math.min(r + 10, health.length); i += 5) groups.push(el("span", { class: "hgroup" }, ...health.slice(i, i + 5).map((dot, j) => pip(dot, i + j))));
      rows.push(el("span", { class: "hrow" }, ...groups));
    }
  }
  const boxes = health
    ? el("div", { class: "hboxes", role: "img", "aria-label": `${remaining} of ${total} health boxes left` }, ...rows)
    : el("div", { class: "hboxes none", text: `Wounds: ${m.wounds}` });

  // Unsichtbare Knöpfe auf dem Portrait: obere Hälfte heilt (+1), untere Hälfte verwundet (−1); dazwischen ein schmaler Spalt
  const heal = (e) => { rememberFlash(e, m, "up"); change({ wounds: Math.max(0, m.wounds - 1) }); };
  const wound = (e) => { rememberFlash(e, m, "down"); change({ wounds: Math.min(health ? total : maxWounds, m.wounds + 1) }); };
  const hpButton = (half, label, onclick) => {
    const after = takeFlash(m, half);   // gerade angetippt: Aufleuchten im neuen Knopf ausblenden
    return el("button", { class: `hp-btn hp-${half}${after !== null ? " flash-out" : ""}`, type: "button", style: after, "aria-label": label, ...cardPress(c, onclick, randomizeFlash) });
  };
  // Aufleuchten beim Antippen in der Fraktionsfarbe der Troupe dieser Seite (bei zwei Fraktionen beide), sonst der des Modells
  const troupeFactions = troupeFactionList({ ids: sideIds(side) });
  const [f1, f2] = troupeFactions.length ? troupeFactions : [primaryFaction(c) || { hue: 0, sat: 0 }];
  // Eine Fraktion: zweite Farbe ist ein dezentes dunkles Grau
  const flash = f2
    ? `--flash-h:${f1.hue}; --flash-s:${f1.sat ?? 55}%; --flash-h2:${f2.hue}; --flash-s2:${f2.sat ?? 55}%; --flash-l2:var(--fac-l)`
    : `--flash-h:${f1.hue}; --flash-s:${f1.sat ?? 55}%; --flash-h2:230; --flash-s2:8%; --flash-l2:22%`;
  return el("div", { class: `gcell${health && remaining <= 0 ? " dead" : ""}`, "data-char": c.id },
    el("div", { class: "gcell-media", style: flash, "data-mono": f2 ? null : "1" },
      el("div", { class: "gcell-portrait" }, gamePortrait(side, c)),
      // Rechtsklick oder Halten auf dem Portrait öffnet die Karte (wie im Troupe Builder), ohne zu heilen oder zu verwunden
      hpButton("up", `${c.name}: heal 1`, heal),
      hpButton("down", `${c.name}: 1 wound`, wound)
    ),
    // Der Name öffnet keine Karte mehr (sonst öffnet sie sich beim schnellen Tippen auf die Lebenspunkte aus Versehen);
    // die Karte gibt es per Rechtsklick oder Halten auf dem Portrait
    el("div", { class: "gcell-name", text: c.name }),
    // Transform-Knopf (Anya / Striga Anya) zwischen Name und Lebenspunkten. Ist so ein Modell im Spiel, bekommen alle
    // anderen einen unsichtbaren Platzhalter gleicher Größe: alle Kacheln gleich hoch, Lebenspunkte auf gleicher Höhe
    twinOf(c) ? el("button", { class: "transform-btn transform-inline", type: "button", text: "Transform", "aria-label": `Transform ${c.name} into ${twinOf(c).name}`, onclick: () => transformModel(side, c) })
      : gameHasTransform ? el("span", { class: "transform-btn transform-inline transform-spacer", "aria-hidden": "true", text: "Transform" }) : null,
    boxes
  );
}

let gameHasTransform = false;   // ist ein Modell mit Transform-Knopf im Spiel? (wird in renderGamePlay gesetzt)

function renderGamePlay() {
  gameHasTransform = [...game.own, ...game.opps.flatMap((o) => o.ids)].some((id) => {
    const c = characterById.get(id);
    return Boolean(c && twinOf(c));
  });
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
  startGameTour();
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
  resetFoePickerWhenFull();
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
    $("#game-foe-summons-list").replaceChildren(...possible.map((c) => tileFor(c, false, (e) => openDetail(c.id, e.currentTarget))));
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
      if (color === "accent") out.push(el("strong", { class: "accent-text", text: symbol }));   // [[accent:Text]] = fett in Akzentfarbe
      else if (color === "link") {
        // [[link:ziel-id|Text]] = Verweis auf einen Abschnitt mit "id": "ziel-id" (im selben Regelwerk); öffnet ihn und springt hin
        const [target, label] = piece.slice(2, -2).slice(5).split("|");
        out.push(el("a", { class: "rule-link", href: `#${target}`, "data-goto": target }, el("strong", {}, el("em", { text: label || target }))));
      }
      else out.push(el("span", { class: `arc arc-${color}`, text: symbol }));   // farbiges Arcane-Symbol
    }
    else plain(piece);
  }
  return out;
}

function plainText(text) {
  return String(text).replace(/\[\[link:[^|\]]*\|([^\]]+)\]\]/g, "$1").replace(/\[\[[a-z]+:([^\]]+)\]\]/g, "$1").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
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
      // Breite Bilder rechts (ab 13rem, z. B. der Spieltisch) stehen auf dem Handy mittig statt neben dem Text
      return el("div", { class: ["rule-example", block.side === "right" ? "right" : "", block.side === "right" && Number(block.w) >= 13 ? "wide" : ""].filter(Boolean).join(" ") },
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
  // "Collapse all": schließt alle aufgeklappten Abschnitte. Handy: runder Knopf unten rechts (Daumen),
  // Desktop: unter der Suchzeile, bleibt mit ihr oben stehen. Nur sichtbar, wenn etwas aufgeklappt ist.
  const collapse = el("button", { class: "ghost guide-collapse is-off", type: "button", "aria-label": "Collapse all", title: "Collapse all" });
  collapse.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l5 5 5-5M7 20l5-5 5 5"/></svg><span>Collapse all</span>';
  container.replaceChildren(el("div", { class: "guide-bar" }, search, row, collapse), list, foot);
  // unsichtbar statt ausgeblendet: der Platz bleibt reserviert, nichts springt (siehe style.css)
  const updateCollapse = () => { collapse.classList.toggle("is-off", !list.querySelector("details[open]")); };
  list.addEventListener("toggle", updateCollapse, true);   // toggle steigt nicht auf, deshalb beim Abfangen lauschen
  collapse.addEventListener("click", () => {
    for (const d of list.querySelectorAll("details[open]")) d.open = false;
    if (openBefore) openBefore = new Set();   // während einer Suche: nach dem Leeren der Suche bleibt alles zu
    updateCollapse();
    const top = container.getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY > top) window.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" });
  });

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

  // Verweise im Text ([[link:…]]): Ziel-Abschnitt samt übergeordneten Abschnitten aufklappen, hinscrollen, kurz aufleuchten
  list.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-goto]");
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(`${config.container.slice(1)}-${link.dataset.goto}`);
    if (!target) return;
    for (let d = target; d && list.contains(d); d = d.parentElement.closest("details")) d.open = true;
    const summary = target.querySelector(":scope > summary");
    summary.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
    summary.classList.remove("hit-flash");
    void summary.offsetWidth;
    summary.classList.add("hit-flash");
    setTimeout(() => summary.classList.remove("hit-flash"), 2000);
  });

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
    // Beispiele ("***Example:*** …", "*For example …", "*In the example …") samt den folgenden kursiven Absätzen und Bildern
    // kommen in einen gelben Kasten
    const textOf = (block) => (typeof block.x === "string" ? block.x : "");
    const exampleStart = (block) => (block.t === "p" || block.t === "example") && /^(\*\*\*Example\b|\*(For example|In the example)\b)/.test(textOf(block));
    const exampleMore = (block) => block.t === "figure" || block.t === "gallery" ||
      ((block.t === "p" || block.t === "example") && /^\*(?!\*)[\s\S]*\*$/.test(textOf(block).trim()));   // ganz kursiver Absatz
    let exampleBox = null;
    for (const block of blocks) {
      if (block.t === "group") {
        exampleBox = null;
        const sub = buildGroup(block, chain, level + 1);
        group.children.push(sub);
        parts.push(...sub.words);
        body.append(sub.node);
      } else {
        const node = blockNode(block);
        if (exampleStart(block)) {
          exampleBox = el("div", { class: "rule-example-box" });
          body.append(exampleBox);
        } else if (!(exampleBox && exampleMore(block))) {
          exampleBox = null;
        }
        (exampleBox || body).append(node);
        for (const u of leafUnits(block, node)) {
          const text = searchForm(plainText(u.text));
          units.push({ node: u.node, text, words: new Set(wordsOf(text)), ctxWords, kind: u.kind });
        }
        parts.push(...blockTexts(block));
      }
    }
    // "leaf": Gruppe ohne Untergruppen, z. B. eine einzelne FAQ-Frage (für die Schrift in style.css)
    const leaf = level > 1 && !(def.blocks || []).some((b) => b.t === "group");
    group.node = el("details", { class: level === 1 ? "rule-section" : leaf ? "rule-group leaf" : "rule-group", id: def.id ? `${config.container.slice(1)}-${def.id}` : null }, summary, body);
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

// Seitenwechsel über die untere Leiste: die neue Seite blendet ein und gleitet ein Stück aus der Richtung des Tabs herein
// (Tab weiter rechts: von rechts, sonst von links). Teile mit fest am Rand stehenden Knöpfen (Plus, Import) gleiten nicht mit,
// denn ein Verschieben würde diese Knöpfe kurz mitnehmen; sie blenden nur ein.
const TAB_ORDER = ["compendium", "troupes", "rules", "faqs"];
const FIXED_BUTTONS = ".add-btn, #import-open";
function animateViewChange(from, to) {
  if (!TAB_ORDER.includes(from) || !TAB_ORDER.includes(to) || from === to) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const view = $(`#view-${to}`);
  const dir = TAB_ORDER.indexOf(to) > TAB_ORDER.indexOf(from) ? 1 : -1;
  const timing = { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  view.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  for (const part of view.children) {
    if (part.matches(FIXED_BUTTONS) || part.querySelector(FIXED_BUTTONS)) continue;
    part.animate([{ transform: `translateX(${dir * 18}px)` }, { transform: "none" }], timing);
  }
}

function currentView() {
  const open = [...document.querySelectorAll("[id^='view-']")].find((v) => !v.hidden);
  return open ? open.id.slice(5) : null;
}

function showView(name) {
  const before = currentView();
  if (activeTour) activeTour.viewChanged(name);   // Rundgang wartet nach einer Aktion: auf neuer Seite unterbrechen
  if (name !== "editor") for (const tip of document.querySelectorAll(".play-hint")) tip.remove();   // Tipp zum Play-Knopf gehört nur zum Editor
  $("#start-game").classList.remove("tip-pulse");
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
    markTab(name);
  }
  updateReplayButton(name);
  window.scrollTo(0, 0);
  animateViewChange(before, name);
}

function markTab(name) {
  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  }
  placeTabMarker();
}

// Die gelbe Markierung auf Position und Breite des gewählten Tabs setzen (die Tabs sind je nach Wort verschieden breit)
function placeTabMarker() {
  const nav = document.querySelector(".tabs");
  const tab = nav && nav.querySelector('[aria-selected="true"]');
  if (!tab || !tab.offsetWidth) return;   // Leiste ausgeblendet (Editor, Spiel): beim nächsten Anzeigen
  nav.style.setProperty("--mx", `${tab.offsetLeft}px`);
  nav.style.setProperty("--mw", `${tab.offsetWidth}px`);
  if (!nav.classList.contains("ready")) requestAnimationFrame(() => nav.classList.add("ready"));
}
window.addEventListener("resize", placeTabMarker);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeTabMarker);   // Wortbreiten stehen erst mit der Schrift fest
placeTabMarker();

function openEditor(id) {
  current = troupes.find((t) => t.id === id);
  if (!current) return;
  editorPanel.clear();
  $("#editor-name").value = current.name;
  renderEditor();
  showView("editor");
  setTimeout(startEditorTour, 400);   // erstes Öffnen: kurzer Rundgang
}

function closeEditor() {
  current = null;
  showView("troupes");
  renderTroupes();
}


/* ---------- 8. Start ---------- */

function wireEvents() {
  // Erst die Markierung umsetzen (sie gleitet sofort los), die neue Seite erst im nächsten Bild aufbauen.
  // Bei schnellen Klicks hintereinander wird nur die Seite des letzten Klicks aufgebaut.
  let pendingTab = null;
  for (const tab of document.querySelectorAll("[role=tab]")) {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      pendingTab = name;
      markTab(name);
      requestAnimationFrame(() => setTimeout(() => {
        if (pendingTab !== name) return;
        pendingTab = null;
        showView(name);
        if (name === "troupes") { renderTroupes(); setTimeout(startTroupesTour, 400); }   // erster Besuch: kurzer Rundgang
        if (name === "compendium") setTimeout(startWelcomeTour, 400);   // unterbrochener Willkommens-Rundgang geht hier weiter
      }, 0));
    });
  }

  $("#replay-tutorials").addEventListener("click", replayTutorials);
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
  setTimeout(startWelcomeTour, 600);   // allererstes Öffnen: kurzer Rundgang durch die Reiter
  window.addEventListener("hashchange", checkIncomingLink);

  // Offline-Funktion einschalten. Wenn das nicht klappt, läuft die App einfach ohne.
  try {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch { /* ignorieren */ }
}

// --- Text, der abgeschnitten würde, automatisch kleiner machen ---
// Betrifft Stellen mit begrenztem Platz (Namen auf den Kacheln, Platzhalter der Suche usw.).
// Die Schrift wird schrittweise verkleinert, bis alles passt, höchstens bis auf 60 % der normalen Größe.
const FIT_SELECTOR = ".tile-name, .search-hint";
function fitText(node) {
  if (!node.isConnected || node.offsetParent === null) return;   // unsichtbar: später, wenn es angezeigt wird
  const key = `${node.clientWidth}|${node.textContent}`;
  if (node.dataset.fit === key) return;                            // schon passend für diese Breite und diesen Text
  node.style.fontSize = "";
  const base = parseFloat(getComputedStyle(node).fontSize);
  const overflowing = () => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
  let size = base;
  while (overflowing() && size > base * 0.6) {
    size *= 0.93;
    node.style.fontSize = `${size}px`;
  }
  node.dataset.fit = key;
}
let fitQueued = false;
function fitAllText() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    document.querySelectorAll(FIT_SELECTOR).forEach(fitText);
  });
}
new MutationObserver(fitAllText).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "open"] });
window.addEventListener("resize", fitAllText);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { document.querySelectorAll(FIT_SELECTOR).forEach((n) => delete n.dataset.fit); fitAllText(); });

// Wischen zwischen den Seiten (Handy): nach links = nächster Reiter (Compendium → Troupes → Rules → FAQs), nach rechts = vorheriger.
// Nur auf diesen vier Seiten und ohne geöffnetes Fenster; nicht in Eingabefeldern und nicht in Bereichen, die selbst seitlich scrollen.
// Zügig und mindestens 60 px weit; die Richtung legt die Deadzone weiter unten fest.
{
  let start = null;
  const scrollsSideways = (node) => {
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  document.addEventListener("touchstart", (e) => {
    start = null;
    if (e.touches.length !== 1 || document.querySelector("dialog[open], .tour-layer:not(.tour-waiting)")) return;   // nicht während eines Fensters oder Rundgangs
    if (!TAB_ORDER.includes(currentView())) return;
    const t = e.touches[0];
    if (t.clientX < 16 || t.clientX > window.innerWidth - 16) return;   // Bildschirmrand: dort liegt die Zurück-Geste des Systems
    if (e.target.closest("input, textarea, select") || scrollsSideways(e.target)) return;
    start = { x: t.clientX, y: t.clientY, time: Date.now(), axis: null };
  }, { passive: true });
  // Deadzone mit Richtungs-Sperre: Nach den ersten 12 px Bewegung steht fest, ob gewischt (waagerecht) oder gescrollt (senkrecht) wird.
  // Waagerecht: die Seite scrollt nicht mehr nach oben/unten. Senkrecht: es wird nur gescrollt, ein Seitenwechsel ist ausgeschlossen.
  document.addEventListener("touchmove", (e) => {
    if (!start || e.touches.length !== 1) { start = null; return; }
    if (window.visualViewport && window.visualViewport.scale > 1.01) { start = null; return; }   // gezoomt: Wischen verschiebt nur
    const t = e.touches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (!start.axis) {
      if (Math.hypot(dx, dy) < 12) return;   // noch in der Deadzone
      start.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
    }
    if (start.axis === "x" && e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", (e) => {
    if (!start || start.axis !== "x") { start = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const quick = Date.now() - start.time < 700;
    start = null;
    if (!quick || Math.abs(dx) < 60) return;
    const next = TAB_ORDER[TAB_ORDER.indexOf(currentView()) + (dx < 0 ? 1 : -1)];
    if (next) document.querySelector(`[role=tab][data-tab="${next}"]`).click();
  }, { passive: true });
}

/* ---------- Tipps: Play-Knopf nach fertiger Troupe, Rundgang durch die Gameview ---------- */
// Jeder Tipp erscheint höchstens einmal pro App-Start und nie mehr, sobald "Don't show this again" angehakt wurde.
const tipsShown = new Set();
function tipOff(key) { try { return localStorage.getItem(key) === "1"; } catch { return false; } }
function setTipOff(key) { try { localStorage.setItem(key, "1"); } catch { /* ignorieren */ } }
const PLAY_HINT_KEY = "ttg-hint-play-v1";
const TOUR_KEY = "ttg-hint-game-tour-v1";
// alle Tipps und Rundgänge (für "Skip all"); die Konstanten weiter unten werden erst beim Klick gelesen
const ALL_TIP_KEYS = ["ttg-hint-flip-v1", "ttg-hint-play-v1", "ttg-hint-game-tour-v1", "ttg-hint-welcome-v1", "ttg-hint-troupes-tour-v1", "ttg-hint-editor-tour-v1", "ttg-hint-setup-tour-v1"];
const isPhoneLayout = () => window.matchMedia && window.matchMedia("(max-width: 719.98px)").matches;

// Handy: Sprechblase über dem runden Play-Knopf, sobald die Troupe zum ersten Mal vollständig ist
function showPlayHint() {
  if (!isPhoneLayout() || tipOff(PLAY_HINT_KEY) || tipsShown.has(PLAY_HINT_KEY)) return;
  const button = $("#start-game");
  if (!button || !button.getClientRects().length) return;   // Knopf nicht sichtbar (offsetParent hilft hier nicht: er ist position: fixed)
  tipsShown.add(PLAY_HINT_KEY);
  const check = el("input", { type: "checkbox", id: "play-hint-off" });
  const close = () => { if (check.checked) setTipOff(PLAY_HINT_KEY); bubble.remove(); button.classList.remove("tip-pulse"); };
  const bubble = el("div", { class: "play-hint", role: "note" },
    el("p", {}, "Your troupe is complete! Tap the ", el("strong", { text: "play button" }), " to start a game with it."),
    el("label", { class: "hint-check", for: "play-hint-off" }, check, "Don't show this again"),
    el("button", { type: "button", text: "Got it", onclick: close })
  );
  document.body.append(bubble);
  button.classList.add("tip-pulse");
  button.addEventListener("click", close, { once: true });   // wer gleich auf Play tippt, braucht den Tipp nicht mehr
}

// "Replay tutorials" (oben rechts): nur die Rundgänge und Tipps der gerade offenen Seite wieder einschalten
// (auch nach "Skip all" oder "Don't show this again") und den Rundgang der Seite gleich neu starten.
// Seiten ohne eigenes Tutorial (Rules, FAQs) zeigen den Knopf nicht (siehe updateReplayButton).
function pageTutorials(view) {
  if (view === "compendium") return { keys: [WELCOME_KEY, HINT_KEY], start: startWelcomeTour };   // Rundgang und Umdreh-Tipp der Karten
  if (view === "troupes") return { keys: [TROUPES_TOUR_KEY], start: startTroupesTour };
  return null;
}
function updateReplayButton(view) {
  $("#replay-tutorials").hidden = !pageTutorials(view);
}
function replayTutorials() {
  if (activeTour) return;   // läuft gerade ein Rundgang, nichts durcheinanderbringen
  const page = pageTutorials(currentView());
  if (!page) return;
  for (const k of page.keys) {
    try { localStorage.removeItem(k); localStorage.removeItem(`${k}-at`); } catch { /* ignorieren */ }
    tipsShown.delete(k);
  }
  if (page.keys.includes(HINT_KEY)) hintShownThisSession = false;
  page.start();
}

// Willkommens-Rundgang beim allerersten Öffnen: was die Reiter unten machen
const WELCOME_KEY = "ttg-hint-welcome-v1";
function startWelcomeTour() {
  if (currentView() !== "compendium" || document.querySelector("dialog[open]")) return;
  runTour(WELCOME_KEY, [
    // Wer die Einführung aufklappt, kann in Ruhe lesen: weiter geht es erst, wenn sie wieder zugeklappt ist
    { target: () => $(".intro-box > summary"), until: () => !$(".intro-box").open,
      text: () => ["Your first time visiting Tauber? ", el("strong", { text: "Start here" }), " for a quick overview."] },
    { target: () => $("#compendium-filters .filter-box"),
      text: () => ["Here you can explore the citizens of Tauber: search by name, keyword or synergy, or filter by faction."] },
    { target: () => $("#tab-compendium"),
      text: () => [el("strong", { text: "Compendium:" }), " here you'll find every character. Filter them by faction, keyword or synergy, and open a character to see the card and its signature move."] },
    { target: () => $("#tab-troupes"),
      text: () => [el("strong", { text: "Troupes:" }), " build your troupes here and take them into a game."] },
    { target: () => [$("#tab-rules"), $("#tab-faqs")],
      text: () => [el("strong", { text: "Rules and FAQs:" }), " everything you need to play a game of Moonstone, with a search."] },
  ], { once: true });
}

// Troupes-Übersicht beim ersten Besuch: erstellen, importieren, sichern
const TROUPES_TOUR_KEY = "ttg-hint-troupes-tour-v1";
function startTroupesTour() {
  if (currentView() !== "troupes" || document.querySelector("dialog[open]")) return;
  runTour(TROUPES_TOUR_KEY, [
    { target: () => [$("#new-troupe"), $("#import-open")],
      text: () => [el("strong", { text: "New troupe" }), " creates a troupe. ", el("strong", { text: "Import" }), " adds a troupe someone shared with you."] },
    { target: () => [$("#backup-export"), $("#backup-import")],
      text: () => [el("strong", { text: "Back up all troupes" }), " saves them to a file, ", el("strong", { text: "Restore from file" }), " loads them back, e.g. on a new device."] },
  ], { once: true });
}

// Troupe Builder beim ersten Öffnen: Format, Modelle hinzufügen, teilen
const EDITOR_TOUR_KEY = "ttg-hint-editor-tour-v1";
function startEditorTour() {
  if (currentView() !== "editor" || document.querySelector("dialog[open]")) return;
  runTour(EDITOR_TOUR_KEY, [
    { target: () => $("#editor-format"), idle: 4000,   // längere Pause: in Ruhe die Formate ansehen
      text: () => ["Choose the ", el("strong", { text: "format" }), " here: how many models your troupe has and how many of them play in a game."] },
    // Beispiel-Kachel: Agatha (ohne Summons, die sonst gleich mit in die Troupe kommen); passt sie nicht, die erste Kachel
    { target: () => [...document.querySelectorAll('#editor-tiles .tile[data-char="agatha-tavernfrau"]')].find((t) => t.getClientRects().length) || $("#editor-tiles .tile"),
      text: () => ["Tap a model to ", el("strong", { text: "add" }), " it, tap it again to remove it. Press and hold (or right-click) to see its card."] },
    { target: () => $("#copy"),
      text: () => [el("strong", { text: "Export" }), " shares your troupe as a link or code."] },
  ], { once: true });
}

// Rundgang über der Gameview nach dem Spielstart
function startGameTour() {
  runTour(TOUR_KEY, [
    { target: () => $("#game-own-row .gcell-media"),
      text: () => ["Tap the ", el("strong", { text: "upper half" }), " of a portrait to heal 1 wound, the ", el("strong", { text: "lower half" }), " to deal 1 wound. Press and hold (or right-click) a portrait to see the character card."] },
    { target: () => $("#game-next-round"),
      text: () => ["Tap ", el("strong", { text: "Next round" }), " when everyone has activated. Leftover energy is discarded and each model gets new energy. The current round is shown at the top."] },
    { target: () => $("#game-reset"),
      text: () => ["Tap ", el("strong", { text: "Reset game" }), " twice to end this game and choose models for a new one."] },
  ]);
}

// Kurzer Rundgang beim Aufstellen: gegnerische Modelle und weitere Gegner hinzufügen.
// Ist gerade die Abfrage nach dem Gegnernamen offen, startet er erst, wenn sie geschlossen ist.
const SETUP_TOUR_KEY = "ttg-hint-setup-tour-v1";
function startSetupTour() {
  if (tipOff(SETUP_TOUR_KEY) || tipsShown.has(SETUP_TOUR_KEY)) return;
  const dlg = $("#opp-add-dialog");
  if (dlg.open) { dlg.addEventListener("close", () => setTimeout(startSetupTour, 250), { once: true }); return; }
  if (!game || game.stage !== "setup" || currentView() !== "game") return;
  runTour(SETUP_TOUR_KEY, [
    { target: () => $("#game-foe-filters .filter-box"),
      text: () => ["Here you can filter the models by faction or keyword."] },
    { target: () => $("#game-foe-toggle"),
      text: () => ["Tap ", el("strong", { text: "Show all Characters" }), " to see every model, then tap a model to add it to your opponent. Tap a chosen model again to remove it."] },
    { target: () => $("#game-add-foe"),
      text: () => ["More players? ", el("strong", { text: "Add opponent" }), " adds up to 4 opponents. If a model fits several of them, you'll be asked who gets it."] },
  ]);
}

const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// Rundgang: der erklärte Bereich wird hervorgehoben, daneben eine Infobox mit Pfeil,
// unten Schritt x/y und "Next tip"; im letzten Schritt "Don't show this again".
// target darf auch eine Liste von Elementen liefern: dann wird der Bereich um alle zusammen hervorgehoben.
// once: true = der Rundgang erscheint nur ein einziges Mal (ohne "Don't show this again").
//
// Führt man die erklärte Aktion selbst aus (z. B. Tippen auf ein Portrait), blendet der Rundgang aus und lässt einen
// erst einmal schauen. Nach einer kurzen Ruhepause geht es mit dem nächsten Schritt weiter. Hat die Aktion auf eine
// andere Seite geführt, wird der Rundgang an dieser Stelle gespeichert und beim nächsten Mal auf seiner Seite fortgesetzt;
// auf der neuen Seite läuft derweil deren eigener Rundgang (falls man dort noch nicht war).
let activeTour = null;   // { key, viewChanged(name) } des gerade laufenden Rundgangs
const TOUR_IDLE_MS = 1600;   // so lange nach der letzten Berührung warten, bevor der nächste Schritt erscheint

function runTour(key, allSteps, { once = false } = {}) {
  if (tipOff(key) || tipsShown.has(key) || activeTour) return;
  const targetsOf = (st) => [].concat(st.target() || []).filter((t) => t && t.getClientRects().length);
  const rectOf = (st) => {
    const rs = targetsOf(st).map((t) => t.getBoundingClientRect());
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const steps = allSteps;
  const atKey = `${key}-at`;   // gespeicherter Schritt eines unterbrochenen Rundgangs
  let saved = 0;
  try { saved = Math.max(0, Number(localStorage.getItem(atKey)) || 0); } catch { /* ignorieren */ }
  let index = saved;
  while (index < steps.length && !targetsOf(steps[index]).length) index += 1;
  if (index >= steps.length) return;
  tipsShown.add(key);
  const startView = currentView();

  const spot = el("div", { class: "tour-spot", style: "transition: none" });
  const box = el("div", { class: "tour-box", role: "dialog", "aria-live": "polite" });
  const count = el("span", { class: "tour-count" });
  const check = el("input", { type: "checkbox", id: "tour-off" });
  const checkLabel = el("label", { class: "hint-check", for: "tour-off" }, check, "Don't show this again");
  const nextBtn = el("button", { type: "button", class: "tour-next" });
  // "Skip all": dieser und alle anderen Rundgänge und Tipps erscheinen nie mehr
  const skipBtn = el("button", { type: "button", class: "tour-skip", text: "Skip all", onclick: () => {
    for (const k of ALL_TIP_KEYS) { setTipOff(k); try { localStorage.removeItem(`${k}-at`); } catch { /* ignorieren */ } }
    end();
  } });
  // Mit Maus (Desktop): Schrittzahl und "Next tip" direkt in der Sprechblase; auf dem Handy als Leiste am Bildschirmrand
  const inBox = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  // Reihenfolge: Haken links, Schrittzahl und Knopf rechts (mit dem rechten Daumen gut erreichbar)
  const bar = el("div", { class: inBox ? "tour-bar in-box" : "tour-bar" }, checkLabel, count, nextBtn);
  // Unsichtbare Fläche mit Loch: blockiert Klicks auf den abgedunkelten Rest, der hervorgehobene Bereich bleibt bedienbar
  const shade = el("div", { class: "tour-shade" });
  const layer = el("div", { class: "tour-layer" }, shade, spot, box, inBox ? null : bar);
  let waiting = false, idleTimer = null;

  const place = () => {
    if (waiting || !targetsOf(steps[index]).length) return;
    const r = rectOf(steps[index]);
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const [l, t, rr, bb] = [r.left - pad, r.top - pad, r.right + pad, r.bottom + pad].map((v) => `${Math.round(v)}px`);
    shade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${rr} ${t}, ${rr} ${bb}, ${l} ${bb}, ${l} ${t})`;
    // Infobox unter dem Bereich, wenn dort Platz ist, sonst darüber; der Pfeil zeigt auf die Mitte des Bereichs
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(320, vw - 32);
    const left = Math.min(Math.max(16, r.left + r.width / 2 - width / 2), vw - 16 - width);
    box.style.width = `${width}px`;
    box.style.left = `${left}px`;
    box.style.setProperty("--arrow-x", `${Math.min(Math.max(18, r.left + r.width / 2 - left), width - 18)}px`);
    const barInBox = box.contains(bar);
    const floor = barInBox ? vh : bar.getBoundingClientRect().top;
    const ceiling = 0;
    const below = r.bottom + pad + 14 + box.offsetHeight < floor - 8;
    box.classList.toggle("above", !below);
    box.style.top = below ? `${r.bottom + pad + 14}px` : `${Math.max(ceiling + 8, r.top - pad - 14 - box.offsetHeight)}px`;
  };
  const show = () => {
    const step = steps[index];
    const last = !steps.slice(index + 1).some((st) => targetsOf(st).length);
    // Handy: Leiste unten am Rand. Liegt der Bereich selbst ganz unten (z. B. die Reiter), kommt die Leiste in die
    // Sprechblase direkt darüber, statt an den oberen Rand (dort wäre sie mit dem Daumen schlecht zu erreichen)
    const r0 = targetsOf(step)[0].getBoundingClientRect();
    const barIntoBox = inBox || r0.bottom > window.innerHeight - 110;
    bar.classList.toggle("in-box", barIntoBox);
    // "Skip all" steht immer in der Sprechblase: in der Leiste links, wenn die Leiste in der Blase ist, sonst in einer eigenen Zeile
    if (barIntoBox) bar.prepend(skipBtn);
    box.replaceChildren(...[el("p", {}, ...step.text()), barIntoBox ? bar : el("div", { class: "tour-skip-row" }, skipBtn)].filter(Boolean));   // ohne Leiste kein "null" einfügen
    if (!barIntoBox && bar.parentElement !== layer) layer.append(bar);
    count.textContent = `${index + 1}/${steps.length}`;
    nextBtn.textContent = last ? "Got it" : "Next tip";
    checkLabel.hidden = !last || once;
    targetsOf(step)[0].scrollIntoView({ block: "center", behavior: "auto" });
    requestAnimationFrame(() => {
      place();
      requestAnimationFrame(() => { spot.style.transition = ""; });   // erst ab dem zweiten Schritt gleitet die Markierung
      // Ganz dezenter Übergang: die Sprechblase blendet leicht verschoben ein, die Markierung gleitet (siehe .tour-spot in style.css)
      if (!reduceMotion()) {
        const from = box.classList.contains("above") ? "4px" : "-4px";
        box.animate([{ opacity: 0, transform: `translateY(${from})` }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
      }
    });
  };
  const cleanup = () => {
    clearTimeout(idleTimer);
    activeTour = null;
    document.documentElement.classList.remove("touring");
    window.removeEventListener("resize", place);
    document.removeEventListener("click", onAction, true);
    document.removeEventListener("pointerdown", onTouch, true);
    document.removeEventListener("change", onTouch, true);
  };
  // Fertig (Got it, letzter Schritt erledigt): Fortschritt löschen, ggf. nie mehr zeigen
  const end = () => {
    if (check.checked || once) setTipOff(key);
    try { localStorage.removeItem(atKey); } catch { /* ignorieren */ }
    cleanup();
    // sanft ausblenden; während dessen nimmt die Ebene keine Klicks mehr an
    layer.style.pointerEvents = "none";
    for (const part of layer.children) part.style.pointerEvents = "none";
    if (!reduceMotion() && !waiting) layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" }).finished.then(() => layer.remove(), () => layer.remove());
    else layer.remove();
  };
  // Unterbrochen (die Aktion führte auf eine andere Seite): Stelle merken, später auf dieser Seite weitermachen
  const pause = (resumeAt) => {
    try { localStorage.setItem(atKey, String(resumeAt)); } catch { /* ignorieren */ }
    tipsShown.delete(key);
    cleanup();
    layer.remove();
  };
  // Nächster Schritt, dessen Bereich gerade zu sehen ist; sonst Ende
  const nextVisible = () => {
    let next = index + 1;
    while (next < steps.length && !targetsOf(steps[next]).length) next += 1;
    return next;
  };
  const advance = () => {
    const next = nextVisible();
    if (next >= steps.length) return end();
    index = next;
    show();
  };
  nextBtn.addEventListener("click", advance);

  // Nach der Aktion: Ebene ausblenden und erst einmal schauen lassen
  const hideForNow = () => {
    waiting = true;
    layer.classList.add("tour-waiting");
    document.documentElement.classList.remove("touring");
    armIdle();
  };
  // Wartezeit: pro Schritt einstellbar (idle), sonst TOUR_IDLE_MS
  const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(resume, steps[index].idle || TOUR_IDLE_MS); };
  const onTouch = () => { if (waiting) armIdle(); };   // solange weiter getippt wird, warten
  const resume = () => {
    if (!waiting) return;
    if (document.querySelector("dialog[open]")) return armIdle();   // erst, wenn ein geöffnetes Fenster wieder zu ist
    if (steps[index].until && !steps[index].until()) return armIdle();   // z. B. erst weiter, wenn die Einführung wieder zugeklappt ist
    if (currentView() !== startView) return pause(index + 1);
    const next = nextVisible();
    if (next >= steps.length) return end();
    waiting = false;
    layer.classList.remove("tour-waiting");
    document.documentElement.classList.add("touring");
    index = next;
    show();
  };
  // Wer die erklärte Aktion gleich ausführt, kommt damit weiter (wie mit "Next tip"/"Got it")
  const onAction = (e) => {
    if (waiting || !layer.isConnected || layer.contains(e.target)) return;
    if (!targetsOf(steps[index]).some((t) => t.contains(e.target))) return;
    if (nextVisible() >= steps.length && !steps.slice(index + 1).length) { setTimeout(end, 0); return; }   // letzter Schritt: fertig
    hideForNow();
  };
  activeTour = { key, viewChanged: (name) => { if (waiting && name !== startView) pause(index + 1); } };
  document.addEventListener("click", onAction, true);
  document.addEventListener("pointerdown", onTouch, true);
  document.addEventListener("change", onTouch, true);   // z. B. ein anderes Format gewählt: Pause beginnt von vorn
  document.body.append(layer);
  if (!reduceMotion()) layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });   // Rundgang blendet sanft ein
  document.documentElement.classList.add("touring");
  window.addEventListener("resize", place);
  show();
}

// Bilder (auch die Charakterkarten) lassen sich nicht herausziehen
document.addEventListener("dragstart", (e) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); });

boot();