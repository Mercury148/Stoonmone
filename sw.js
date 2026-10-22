// Service Worker: speichert die App-Dateien im Gerät, damit die App auch ohne Netz startet.
// Strategie:
// - Code und Daten (html, js, css, json): erst Netz, bei Offline oder nach
//   3 Sekunden ohne Antwort aus dem Cache.
//   Änderungen sind also sofort beim nächsten Öffnen da.
// - Bilder: erst Cache, dann im Hintergrund aktualisieren.
//
// CACHE_NAME nur erhöhen, wenn sich die Liste DATEIEN ändert.

const CACHE_NAME = "TTG-v0.9.1";
const DATEIEN = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "data/characters.json",
  "images/rules/arcane-deck.webp",
    "images/rules/board.webp",
    "images/rules/card-flintlock.webp",
    "images/rules/card-greymair.webp",
    "images/rules/cover-example.webp",
    "images/rules/crest-commonwealth-dominion.webp",
    "images/rules/crest-commonwealth-leshavult.webp",
    "images/rules/crest-commonwealth-shades.webp",
    "images/rules/crest-commonwealth.webp",
    "images/rules/crest-dominion-leshavult.webp",
    "images/rules/crest-dominion-shades.webp",
    "images/rules/crest-dominion.webp",
    "images/rules/crest-leshavult-shades.webp",
    "images/rules/crest-leshavult.webp",
    "images/rules/crest-shades.webp",
    "images/rules/die.webp",
    "images/rules/ex-flipped-card.webp",
    "images/rules/ex-furious-charge.webp",
    "images/rules/ex-ice-veins.webp",
    "images/rules/ex-shoot-musket.webp",
    "images/rules/ex1-cards.webp",
    "images/rules/ex1-health.webp",
    "images/rules/ex1-hoff-hand.webp",
    "images/rules/ex1-reveal.webp",
    "images/rules/ex1-serif-hand.webp",
    "images/rules/ex2-baron-hand.webp",
    "images/rules/ex2-cards.webp",
    "images/rules/ex2-choices.webp",
    "images/rules/ex2-followup.webp",
    "images/rules/ex2-grub-hand.webp",
    "images/rules/ex2-health1.webp",
    "images/rules/ex2-health2.webp",
    "images/rules/ex2-moments.webp",
    "images/rules/ex2-signature.webp",
    "images/rules/ex2-upgrade.webp",
    "images/rules/melee-falling-swing.webp",
    "images/rules/melee-follow-up-table.webp",
    "images/rules/melee-groin-tickler.webp",
    "images/rules/melee-high-guard.webp",
    "images/rules/melee-low-guard.webp",
    "images/rules/melee-rising-attack.webp",
    "images/rules/melee-sweeping-cut.webp",
    "images/rules/melee-thrust.webp",
    "images/rules/reaction-example.webp",
    "images/factions/commonwealth.webp",
    "images/factions/dominion.webp",
    "images/factions/leshavult.webp",
    "images/factions/shades.webp",
    "images/factions/commonwealth-dominion.webp",
    "images/factions/commonwealth-leshavult.webp",
    "images/factions/commonwealth-shades.webp",
    "images/factions/dominion-leshavult.webp",
    "images/factions/dominion-shades.webp",
    "images/factions/leshavult-shades.webp",
    "data/rules.json",
    "data/faq.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(DATEIEN)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Alte Cache-Versionen aufräumen
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(namen.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Code und Daten: erst Netz, bei Offline oder langsamem Netz aus dem Cache.
const NETZ_TIMEOUT_MS = 3000;

function istNetzZuerst(url) {
  return url.origin === location.origin &&
    (/\.(html|js|css|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/"));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (istNetzZuerst(new URL(event.request.url))) {
    const ausNetz = fetch(event.request, { cache: "no-cache" }).then((antwort) => {
      if (antwort.ok) {
        const kopie = antwort.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, kopie));
      }
      return antwort;
    });
    const ausCache = caches.match(event.request);
    // Antwortet das Netz nicht rechtzeitig, die gespeicherte Version nehmen.
    // Das Netz lädt im Hintergrund weiter und aktualisiert den Cache.
    const nachTimeout = new Promise((r) => setTimeout(r, NETZ_TIMEOUT_MS))
      .then(() => ausCache)
      .then((gespeichert) => gespeichert || ausNetz);
    event.respondWith(Promise.race([ausNetz, nachTimeout]).catch(() => ausCache));
    event.waitUntil(ausNetz.catch(() => {}));
    return;
  }

  // Bilder: erst Cache, dann im Hintergrund aktualisieren
  event.respondWith(
    caches.match(event.request).then((gespeichert) => {
      const ausNetz = fetch(event.request)
        .then((antwort) => {
          if (antwort.ok && new URL(event.request.url).origin === location.origin) {
            const kopie = antwort.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, kopie));
          }
          return antwort;
        })
        .catch(() => gespeichert);
      return gespeichert || ausNetz;
    })
  );
});