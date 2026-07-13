// node fix_tap_highlight.cjs
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'src/index.css');
let src = fs.readFileSync(file, 'utf8');

// Find the .customer-card rule and add -webkit-tap-highlight-color + outline reset
src = src.replace(
  '.customer-card {',
  '.customer-card {\n  -webkit-tap-highlight-color: transparent;\n  outline: none;'
);

fs.writeFileSync(file, src, 'utf8');
console.log('Done.');
