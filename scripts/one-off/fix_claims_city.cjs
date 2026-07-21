// node fix_claims_city.cjs
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'src/pages/ClaimsList.jsx');
let src = fs.readFileSync(file, 'utf8');

// Fix: only show city/state if city is non-empty
src = src.replace(
  `                  {(c.loss_city || c.loss_state) && (
                    <span>{c.loss_city}{c.loss_state ? ', ' + c.loss_state : ''}</span>
                  )}`,
  `                  {c.loss_city && (
                    <span>{c.loss_city}{c.loss_state ? ', ' + c.loss_state : ''}</span>
                  )}`
);

fs.writeFileSync(file, src, 'utf8');
console.log('Done.');
