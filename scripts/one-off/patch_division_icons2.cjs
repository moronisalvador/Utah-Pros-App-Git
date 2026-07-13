// node patch_division_icons2.cjs
// Fixes the files that failed in the first pass
const fs = require('fs'), path = require('path');
const BASE = __dirname;
function read(rel)  { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }
function write(rel, src) { fs.writeFileSync(path.join(BASE, rel), src, 'utf8'); console.log(`  ✓  ${rel}`); }
function patch(rel, replacements) {
  let src = read(rel), changed = 0;
  for (const [old, neu] of replacements) {
    if (src.includes(old)) { src = src.replace(old, neu); changed++; }
    else console.log(`  ⚠  NOT FOUND in ${rel}: ${old.slice(0,70)}`);
  }
  if (changed) write(rel, src);
}

const DI = `import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`;

// ── CustomerPage.jsx ─────────────────────────────────────────────────────────
patch('src/pages/CustomerPage.jsx', [
  [
    `import { useState, useEffect } from 'react';`,
    `import { useState, useEffect } from 'react';\n${DI}`
  ],
  [
    `const DIVISION_EMOJI = {`,
    `// DIVISION_EMOJI removed — use DivisionIcon from DivisionIcons\nconst _DIVISION_EMOJI_UNUSED = {`
  ],
  // CustomerPage uses DIVISION_COLORS as a simple string map — replace it
  [
    `const DIVISION_COLORS = {`,
    `// DIVISION_COLORS imported from DivisionIcons\nconst _DIVISION_COLORS_UNUSED = {`
  ],
]);

// ── Schedule.jsx — DIV_COLORS comes from scheduleUtils (different shape, keep it)
// Just add DivisionIcon import for any emoji usage
patch('src/pages/Schedule.jsx', [
  [
    `import { useState, useEffect, useCallback, useMemo, useRef } from 'react';`,
    `import { useState, useEffect, useCallback, useMemo, useRef } from 'react';\nimport { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`
  ],
]);

// ── Conversations.jsx ────────────────────────────────────────────────────────
patch('src/pages/Conversations.jsx', [
  [
    `import { useState, useEffect, useRef, useCallback, useMemo } from 'react';`,
    `import { useState, useEffect, useRef, useCallback, useMemo } from 'react';\nimport { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`
  ],
]);

// ── AddRelatedJobModal.jsx ───────────────────────────────────────────────────
patch('src/components/AddRelatedJobModal.jsx', [
  [
    `import { useState } from 'react';`,
    `import { useState } from 'react';\nimport { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`
  ],
]);

// ── JobPanel.jsx — scheduleUtils DIV_COLORS is a different shape (keeps bg/text/label)
// Add DivisionIcon import separately
patch('src/components/JobPanel.jsx', [
  [
    `import { useState, useEffect, useCallback, useMemo } from 'react';`,
    `import { useState, useEffect, useCallback, useMemo } from 'react';\nimport { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`
  ],
]);

// ── SendEsignModal.jsx ───────────────────────────────────────────────────────
patch('src/components/SendEsignModal.jsx', [
  [
    `import { useState, useEffect } from 'react';`,
    `import { useState, useEffect } from 'react';\nimport { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';`
  ],
]);

// ── ClaimsList.jsx — previous avatar patch changed the LossIcon/LOSS_CONFIG block
// The import was added in the first pass, just verify it's there
{
  const src = read('src/pages/ClaimsList.jsx');
  if (src.includes(`from '@/components/DivisionIcons'`)) {
    console.log('  ✓  src/pages/ClaimsList.jsx (DivisionIcons import already present)');
  } else {
    patch('src/pages/ClaimsList.jsx', [
      [
        `import { IconSearch } from '@/components/Icons';`,
        `import { IconSearch } from '@/components/Icons';\nimport { LossIcon, LOSS_CONFIG, DIVISION_COLORS as DIV_COLORS } from '@/components/DivisionIcons';`
      ],
    ]);
  }
}

console.log('\nDone. Commit and push:');
console.log('git add -A && git commit -m "Shared DivisionIcons — all files wired" && git push origin dev');
