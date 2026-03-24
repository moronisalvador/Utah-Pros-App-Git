// node patch_division_icons.cjs
// Replaces all local emoji/color maps with imports from DivisionIcons.jsx
const fs = require('fs'), path = require('path');
const BASE = __dirname;

function read(rel)  { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }
function write(rel, src) { fs.writeFileSync(path.join(BASE, rel), src, 'utf8'); console.log(`  ✓  ${rel}`); }

function patch(rel, replacements) {
  let src = read(rel);
  let changed = 0;
  for (const [old, neu] of replacements) {
    if (src.includes(old)) { src = src.replace(old, neu); changed++; }
    else console.log(`  ⚠  NOT FOUND in ${rel}: ${old.slice(0, 60)}`);
  }
  if (changed) write(rel, src);
}

const IMPORT_DIV = `import { DivisionIcon, DIVISION_COLORS, DIVISION_CONFIG } from '@/components/DivisionIcons';`;
const IMPORT_DIV_ONLY = `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`;
const IMPORT_LOSS = `import { LossIcon, LOSS_CONFIG, DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`;

// ── Shared replacements used in multiple files ────────────────────────────────
const OLD_DIV_EMOJI_MAP = `const DIVISION_EMOJI={water:'\\u{1F4A7}',mold:'\\u{1F9A0}',reconstruction:'\\u{1F3D7}\\uFE0F',fire:'\\u{1F525}',contents:'\\u{1F4E6}'};`;
const OLD_DIV_COLORS_MAP = `const DIVISION_COLORS={water:'#2563eb',mold:'#9d174d',reconstruction:'#d97706',fire:'#dc2626',contents:'#059669'};`;

// ────────────────────────────────────────────────────────────────────────────
// 1. JobPage.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/JobPage.jsx', [
  // Add import after useAuth import
  [
    `import SendEsignModal from '@/components/SendEsignModal';`,
    `import SendEsignModal from '@/components/SendEsignModal';\n${IMPORT_DIV}`
  ],
  // Remove local maps
  [OLD_DIV_EMOJI_MAP, ''],
  [OLD_DIV_COLORS_MAP, ''],
  // Replace emoji usage in header
  [
    `const divEmoji=DIVISION_EMOJI[job.division]||'\\u{1F4C1}';`,
    `// divEmoji replaced by DivisionIcon component`
  ],
  // Replace emoji in header JSX
  [
    `<div className="job-page-division-icon">{divEmoji}</div>`,
    `<div className="job-page-division-icon"><DivisionIcon type={job.division} size={28} /></div>`
  ],
  // RelatedJobsSection: replace emoji+color lookups
  [
    `{const dc=DIVISION_COLORS[sj.division]||'#6b7280';const de=DIVISION_EMOJI[sj.division]||'\\u{1F4C1}';`,
    `{const dc=DIVISION_COLORS[sj.division]||'#6b7280';`
  ],
  [
    `<span style={{fontSize:16}}>{de}</span>`,
    `<DivisionIcon type={sj.division} size={18} />`
  ],
]);

// ────────────────────────────────────────────────────────────────────────────
// 2. Collections.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/Collections.jsx', [
  [
    `import PullToRefresh from '@/components/PullToRefresh';`,
    `import PullToRefresh from '@/components/PullToRefresh';\n${IMPORT_DIV_ONLY}`
  ],
  // Remove local maps
  [`const DIV_COLOR = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669' };`, ''],
  [`const DIV_EMOJI = { water: '💧', mold: '🧬', reconstruction: '🏗️', fire: '🔥', contents: '📦' };`, ''],
  // ARRow: replace emoji
  [
    `<span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>{DIV_EMOJI[job.division] || '📁'}</span>`,
    `<DivisionIcon type={job.division} size={20} />`
  ],
  // ARCard: replace emoji
  [
    `<span style={{ fontSize: 22, lineHeight: 1.1, flexShrink: 0 }}>{DIV_EMOJI[job.division] || '📁'}</span>`,
    `<DivisionIcon type={job.division} size={24} />`
  ],
]);

// ────────────────────────────────────────────────────────────────────────────
// 3. ClaimPage.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/ClaimPage.jsx', [
  [
    `import '@/claim-page.css';`,
    `import '@/claim-page.css';\n${IMPORT_LOSS}`
  ],
  // Remove local maps
  [`const DIV_EMOJI  = { water: '💧', mold: '🧬', reconstruction: '🏗️', fire: '🔥', contents: '📦', general: '📁' };`, ''],
  [`const DIV_COLOR  = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669', general: '#6b7280' };`, ''],
  // JobsOverviewSection: replace emoji in avatar
  [
    `<span style={{ fontSize: 20 }}>{DIV_EMOJI[job.division] || '📁'}</span>`,
    `<DivisionIcon type={job.division} size={20} />`
  ],
  // CollectionsTab: replace emoji
  [
    `<span style={{ fontSize: 20 }}>{DIV_EMOJI[job.division] || '📁'}</span>`,
    `<DivisionIcon type={job.division} size={20} />`
  ],
  // DocumentsTab: replace emoji
  [
    `<span style={{ fontSize: 16 }}>{DIV_EMOJI[job.division] || '📁'}</span>`,
    `<DivisionIcon type={job.division} size={16} />`
  ],
  // FinancialTab table: replace emoji
  [
    `<span style={{ fontSize: 16 }}>{DIV_EMOJI[job.division] || '📁'}</span>`,
    `<DivisionIcon type={job.division} size={16} />`
  ],
  // JobsOverviewSection border color
  [
    `const color = DIV_COLOR[job.division] || '#6b7280';`,
    `const color = DIVISION_COLORS[job.division] || '#6b7280';`
  ],
  // DocumentsTab border color
  [
    `const color = DIV_COLOR[job.division] || '#6b7280';`,
    `const color = DIVISION_COLORS[job.division] || '#6b7280';`
  ],
]);

// ────────────────────────────────────────────────────────────────────────────
// 4. ClaimsList.jsx — already has LossIcon, just remove local defs + add import
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/ClaimsList.jsx', [
  // Replace full local LossIcon + LOSS_CONFIG block with import
  [
    `import { IconSearch } from '@/components/Icons';`,
    `import { IconSearch } from '@/components/Icons';\nimport { LossIcon, LOSS_CONFIG, DIVISION_COLORS as DIV_COLORS } from '@/components/DivisionIcons';`
  ],
  // Remove local LOSS_CONFIG
  [`const LOSS_CONFIG = {
  water:     { color: '#1d4ed8', bg: '#dbeafe', label: 'Water' },
  fire:      { color: '#b91c1c', bg: '#fee2e2', label: 'Fire' },
  mold:      { color: '#7e22ce', bg: '#f3e8ff', label: 'Mold' },
  storm:     { color: '#a16207', bg: '#fef9c3', label: 'Storm' },
  sewer:     { color: '#065f46', bg: '#d1fae5', label: 'Sewer' },
  vandalism: { color: '#be123c', bg: '#ffe4e6', label: 'Vandalism' },
  other:     { color: '#475569', bg: '#f1f5f9', label: 'Other' },
};`, ''],
  // Remove local LossIcon component (big block — match first line)
  [`function LossIcon({ type, size = 20, color: colorOverride, style, ...rest }) {`, `// LossIcon imported from DivisionIcons\nfunction _LossIconPlaceholder_UNUSED() {`],
]);

// ────────────────────────────────────────────────────────────────────────────
// 5. CustomerPage.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/CustomerPage.jsx', [
  // Add import — find a stable first import line
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
  [`const DIVISION_EMOJI = {`, `const _DIVISION_EMOJI_UNUSED = {`],
  [`const DIVISION_COLORS = {`, `// DIVISION_COLORS imported from DivisionIcons\nconst _DIVISION_COLORS_UNUSED = {`],
]);

// ────────────────────────────────────────────────────────────────────────────
// 6. Customers.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/Customers.jsx', [
  [
    `import { IconSearch } from '@/components/Icons';`,
    `import { IconSearch } from '@/components/Icons';\nimport { DIVISION_COLORS } from '@/components/DivisionIcons';`
  ],
  [`const DIVISION_COLORS = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669' };`, ''],
]);

// ────────────────────────────────────────────────────────────────────────────
// 7. Jobs.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/Jobs.jsx', [
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
  [`const DIVISION_COLORS = {`, `// DIVISION_COLORS imported\nconst _DIVISION_COLORS_UNUSED = {`],
  // Replace inline emojis in division tab buttons
  [`'💧'`, `null /* use DivisionIcon */`],
]);

// ────────────────────────────────────────────────────────────────────────────
// 8. Schedule.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/Schedule.jsx', [
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
  [`const DIV_COLORS = {`, `// DIV_COLORS imported as DIVISION_COLORS\nconst _DIV_COLORS_UNUSED = {`],
  [`const DIV_COLOR = {`, `// DIV_COLOR imported as DIVISION_COLORS\nconst _DIV_COLOR_UNUSED = {`],
]);

// ────────────────────────────────────────────────────────────────────────────
// 9. TimeTracking.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/TimeTracking.jsx', [
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
  [`const DIVISION_COLORS = {`, `// DIVISION_COLORS imported\nconst _DIVISION_COLORS_UNUSED = {`],
]);

// ────────────────────────────────────────────────────────────────────────────
// 10. Production.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/Production.jsx', [
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
]);

// ────────────────────────────────────────────────────────────────────────────
// 11. Conversations.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/pages/Conversations.jsx', [
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
]);

// ────────────────────────────────────────────────────────────────────────────
// 12. AddRelatedJobModal.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/components/AddRelatedJobModal.jsx', [
  [
    `import { useAuth }`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useAuth }`
  ],
]);

// ────────────────────────────────────────────────────────────────────────────
// 13. JobPanel.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/components/JobPanel.jsx', [
  [
    `import { useNavigate`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useNavigate`
  ],
  [`const DIV_COLORS = {`, `// DIV_COLORS imported as DIVISION_COLORS\nconst _DIV_COLORS_UNUSED = {`],
  [`const DIV_COLOR = {`, `// DIV_COLOR imported as DIVISION_COLORS\nconst _DIV_COLOR_UNUSED = {`],
]);

// ────────────────────────────────────────────────────────────────────────────
// 14. SendEsignModal.jsx
// ────────────────────────────────────────────────────────────────────────────
patch('src/components/SendEsignModal.jsx', [
  [
    `import { useAuth }`,
    `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';\nimport { useAuth }`
  ],
]);

console.log('\nDone. Review ⚠ warnings above for any missed patterns.');
console.log('Then: git add -A && git commit -m "Shared DivisionIcons component across all files" && git push origin dev');
