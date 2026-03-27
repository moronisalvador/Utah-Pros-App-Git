// node fix_claims_display.cjs
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'src/pages/ClaimsList.jsx');
let src = fs.readFileSync(file, 'utf8');

// Fix 1: fmt$ — show $0 for zero values (so Outstanding shows $0, not —)
src = src.replace(
  "const fmt$ = (v) => { if (!v || Number(v) === 0) return '—'; const n = Number(v); if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'k'; return '$' + Math.round(n); };",
  "const fmt$ = (v, showZero = false) => { const n = Number(v); if (isNaN(n) || (!n && !showZero)) return '—'; if (n === 0) return '$0'; if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'k'; return '$' + Math.round(n); };"
);

// Fix 2: subtitle — use fmt$(stats.outstanding, true) so $0 shows instead of —
src = src.replace(
  '<p className="page-subtitle">{stats.total} claims · {stats.open} active · {fmt$(stats.outstanding)} outstanding</p>',
  '<p className="page-subtitle">{stats.total} claims · {stats.open} active · {fmt$(stats.outstanding, true)} outstanding</p>'
);

// Fix 3: KPI Outstanding value — also use showZero
src = src.replace(
  "{ label: 'Outstanding',   value: fmt$(stats.outstanding),",
  "{ label: 'Outstanding',   value: fmt$(stats.outstanding, true),"
);

// Fix 4: footer outstanding — use showZero
src = src.replace(
  'Outstanding: <strong style={{ color: filtered.reduce((s,c) => s + Number(c.total_balance||0), 0) > 0 ? \'#dc2626\' : \'inherit\' }}>{fmt$(filtered.reduce((s,c) => s + Number(c.total_balance||0), 0))}</strong>',
  'Outstanding: <strong style={{ color: filtered.reduce((s,c) => s + Number(c.total_balance||0), 0) > 0 ? \'#dc2626\' : \'#059669\' }}>{fmt$(filtered.reduce((s,c) => s + Number(c.total_balance||0), 0), true)}</strong>'
);

fs.writeFileSync(file, src, 'utf8');
console.log('Done.');
