// Service Worker: speichert die App-Dateien im Gerät, damit die App auch ohne Netz startet.
// Strategie "erst Cache, dann im Hintergrund aktualisieren":
// Die App ist sofort da, und beim nächsten Start ist die neue Version geladen.
//
// WICHTIG: Wenn du Dateien änderst (zum Beispiel characters.json),
// erhöhe die Zahl bei CACHE_NAME, sonst zeigt das Handy noch die alte Version.

const CACHE_NAME = "TTG-v1.2.1";
const DATEIEN = [
  "./",
  "index.html",
  "style.css",
  "legal.html",
  "app.js",
  "data/characters.json",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "images/rules/arcane-deck.webp",
  "images/rules/cover-example.webp",
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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
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