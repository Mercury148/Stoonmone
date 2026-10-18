# Tauber Tourist Guide

Unofficial fan-made companion app for Moonstone. This project is not affiliated
with, endorsed by, or sponsored by Goblin King Games. Moonstone, its characters,
card artwork and rules are the property of Goblin King Games.

## Dateien

| Datei | Wofür |
|---|---|
| `index.html` | Gerüst der Seite (Texte, Felder, Knöpfe) |
| `style.css` | Aussehen, helles und dunkles Design |
| `app.js` | Logik: Filter, Troupe, Speichern, Export und Import |
| `data/characters.json` | Fraktionen und Charaktere |
| `sw.js` | Offline-Funktion |
| `manifest.webmanifest`, `icon-*.png` | Damit die App auf dem Home-Bildschirm wie eine App aussieht |

## Lokal ausprobieren

Ein Doppelklick auf `index.html` reicht nicht, weil der Browser die Datei `characters.json` dann nicht laden darf.
Starte stattdessen einen kleinen Server:

- **VS Code:** Erweiterung „Live Server“ installieren, dann Rechtsklick auf `index.html` und „Open with Live Server“.
- **Terminal:** im Projektordner `python3 -m http.server 8000` ausführen und `http://localhost:8000` öffnen.

## Auf das iPhone bringen

1. Konto auf github.com anlegen, neues Repository erstellen, alle Dateien hochladen.
2. Im Repository unter **Settings > Pages** den Branch `main` und den Ordner `/ (root)` auswählen.
3. Nach ein bis zwei Minuten ist die App unter `https://DEINNAME.github.io/REPOSITORY/` erreichbar.
4. Adresse in **Safari** öffnen, auf **Teilen** tippen, dann **Zum Home-Bildschirm**.
5. Einmal mit Netz öffnen. Danach funktioniert die App auch offline.

## Eigene Daten eintragen

Jeder Charakter in `data/characters.json` sieht so aus:

```json
{
  "id": "eindeutige-id-ohne-leerzeichen",
  "name": "Name",
  "faction": "id-der-fraktion",
  "keywords": ["Keyword1", "Keyword2"],
  "stats": { "leben": 5, "energie": 3, "bewegung": 2 },
  "abilities": [{ "name": "Fähigkeit", "text": "Regeltext" }],
  "image": null
}
```

- Neue Fraktionen kommen oben in die Liste `factions`. Der `hue` (0 bis 360) ist der Farbton der Fraktion.
- Ein Bild trägst du bei `image` als Pfad ein, zum Beispiel `"images/hedda.jpg"`. Ohne Bild erscheinen Initialen.
- Die Werte (Leben, Energie, Bewegung) sind nur Beispiele. Passe sie in `app.js` in der Funktion `openDetail` an die echten Werte an.
- **Nach jeder Änderung** die Zahl bei `CACHE_NAME` in `sw.js` erhöhen (zum Beispiel von `v0.5.2` auf `v0.5.3`), sonst zeigt das Handy die alte Version.

## Listenregeln anpassen

Ganz oben in `app.js` steht `RULES`. Dort legst du fest, wie viele Modelle erlaubt sind, ob Doppelte erlaubt sind und ob ein Keyword begrenzt ist. Die Regel für „Anführer“ ist nur ein Beispiel und muss an das echte Regelbuch angepasst werden.