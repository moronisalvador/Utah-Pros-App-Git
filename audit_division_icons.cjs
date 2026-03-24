// node audit_division_icons.cjs
// Finds every file that uses DIVISION_EMOJI, DIV_EMOJI, division colors, or loss type icons
const fs = require('fs'), path = require('path');

const dirs = [
  'src/pages',
  'src/components',
];

const patterns = [
  'DIVISION_EMOJI',
  'DIV_EMOJI',
  'DIVISION_COLORS',
  'DIV_COLORS',
  'DIV_COLOR',
  'LOSS_EMOJI',
  'LOSS_CONFIG',
  'division.*emoji',
  '💧','🧬','🏗️','🔥','📦',
];

for (const dir of dirs) {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full)) {
    if (!file.endsWith('.jsx') && !file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(full, file), 'utf8');
    const hits = patterns.filter(p => src.includes(p));
    if (hits.length) console.log(`${dir}/${file}:`, hits.join(', '));
  }
}
