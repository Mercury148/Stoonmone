// Service Worker: speichert die App-Dateien im Gerät, damit die App auch ohne Netz startet.
// Strategie "erst Cache, dann im Hintergrund aktualisieren":
// Die App ist sofort da, und beim nächsten Start ist die neue Version geladen.
//
// WICHTIG: Wenn du Dateien änderst (zum Beispiel characters.json),
// erhöhe die Zahl bei CACHE_NAME, sonst zeigt das Handy noch die alte Version.

const CACHE_NAME = "stoonmone-v0.5.11"; // Version der App, bei Änderungen erhöhen
const DATEIEN = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "data/characters.json",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
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
