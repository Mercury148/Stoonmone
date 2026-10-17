const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dataPath = path.join(repoRoot, 'data', 'characters.json');
const backupPath = path.join(
  repoRoot,
  'data',
  `characters.json.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`
);

if (!fs.existsSync(dataPath)) {
  throw new Error(`Missing file: ${dataPath}`);
}

const original = fs.readFileSync(dataPath, 'utf8');
fs.writeFileSync(backupPath, original, 'utf8');

const data = JSON.parse(original);

const metaJson = JSON.stringify(data.meta, null, 2);
const factionsJson = JSON.stringify(data.factions, null, 2);
const charactersJson = data.characters
  .map((character) => JSON.stringify(character))
  .join(',\n    ');

const formatted = `{
  "meta": ${metaJson},
  "factions": ${factionsJson},
  "characters": [
    ${charactersJson}
  ]
}\n`;

fs.writeFileSync(dataPath, formatted, 'utf8');
console.log(`Created backup: ${backupPath}`);
console.log(`Reformatted: ${dataPath}`);
