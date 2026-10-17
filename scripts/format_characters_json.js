const fs = require('fs');
const path = require('path');

// This script reformats data/characters.json so each character object is one line.
// It writes a timestamped backup in data/ before overwriting the file.

const repoRoot = path.resolve(__dirname, '..');
const dataPath = path.join(repoRoot, 'data', 'characters.json');
if (!fs.existsSync(dataPath)) {
  console.error('data/characters.json not found. Run this from scripts/ with the repo root at ..');
  process.exit(1);
}
const raw = fs.readFileSync(dataPath, 'utf8');
const doc = JSON.parse(raw);

const metaJson = JSON.stringify(doc.meta, null, 2);
const factionsJson = JSON.stringify(doc.factions, null, 2);
const charactersLines = doc.characters.map(c => JSON.stringify(c));

const out = `{
  "meta": ${metaJson},
  "factions": ${factionsJson},
  "characters": [\n    ${charactersLines.join(',\n    ')}\n  ]\n}\n`;

const backupName = `characters.json.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
const backupPath = path.join(repoRoot, 'data', backupName);
fs.writeFileSync(backupPath, raw, 'utf8');
fs.writeFileSync(dataPath, out, 'utf8');
console.log('Wrote backup to', backupPath);
console.log('Rewrote', dataPath);
