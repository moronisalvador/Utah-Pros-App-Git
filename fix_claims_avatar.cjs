// node fix_claims_avatar.cjs
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'src/pages/ClaimsList.jsx');
let src = fs.readFileSync(file, 'utf8');

src = src.replace(
  `              {/* Avatar — loss emoji on colored background */}
              <div className="customer-card-avatar" style={{ background: avatarColor(c.claim_number), fontSize: 18 }}>
                {c.loss_type ? (LOSS_EMOJI[c.loss_type] || '📋') : initials(c.insured_name)}
              </div>`,
  `              {/* Avatar — emoji plain, initials get color */}
              <div className="customer-card-avatar" style={{ background: c.loss_type ? 'var(--bg-tertiary)' : avatarColor(c.claim_number), fontSize: c.loss_type ? 20 : 14, color: c.loss_type ? 'unset' : '#fff' }}>
                {c.loss_type ? (LOSS_EMOJI[c.loss_type] || '📋') : initials(c.insured_name)}
              </div>`
);

fs.writeFileSync(file, src, 'utf8');
console.log('Done.');
