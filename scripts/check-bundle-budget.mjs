#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/check-bundle-budget.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Blocking replacement for the old non-blocking "Bundle size report" CI step,
//   which read dist/assets/ (a directory Vite does not emit to) and therefore
//   measured 20 bytes of nothing for weeks. This one reads the real output
//   (dist/app-assets/), measures gzip weight, and FAILS the build when a
//   committed ceiling in scripts/bundle-budget.json is exceeded.
//
//   Four ceilings:
//     - totalJsGzipMax:      all JS chunks concatenated, gzipped
//     - entryChunkGzipMax:   the index-*.js entry chunk alone, gzipped
//     - indexCssRawBytesMax: src/index.css raw bytes (perf-budget.md ceiling)
//     - builtCssGzipMax:     all built CSS concatenated, gzipped
//
// USAGE:
//   npm run build && node scripts/check-bundle-budget.mjs
//
// DEPENDS ON:
//   Internal: dist/app-assets/**, src/index.css, scripts/bundle-budget.json
//   Data:     reads → build output + budget file. Writes nothing.
//
// NOTES / GOTCHAS:
//   - Raising a ceiling is allowed but must be its own visible commit with a
//     reason. Lowering one (ratcheting down) needs no ceremony.
//   - Prints the top-8 chunks so a regression is attributable at a glance.
// ════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ASSETS = path.join(ROOT, 'dist', 'app-assets');
const budget = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'bundle-budget.json'), 'utf8'));

let assetFiles;
try {
  assetFiles = readdirSync(ASSETS);
} catch {
  console.error(`FAIL  ${ASSETS} does not exist — run \`npm run build\` first. `
    + 'If Vite\'s output directory ever changes, update this script in the same commit; '
    + 'a budget pointed at an empty directory is how the last guard went dark.');
  process.exit(1);
}

const js = assetFiles.filter((f) => f.endsWith('.js'));
const css = assetFiles.filter((f) => f.endsWith('.css'));
if (js.length === 0) {
  console.error('FAIL  no JS chunks found in dist/app-assets — the glob or the build is broken.');
  process.exit(1);
}

const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const read = (f) => readFileSync(path.join(ASSETS, f));

const perChunk = js
  .map((f) => ({ file: f, gzip: gz(read(f)), raw: statSync(path.join(ASSETS, f)).size }))
  .sort((a, b) => b.gzip - a.gzip);

const totalJsGzip = gz(Buffer.concat(js.map(read)));
const entry = perChunk.find((c) => /^index-/.test(c.file));
const builtCssGzip = css.length ? gz(Buffer.concat(css.map(read))) : 0;
const indexCssRaw = statSync(path.join(ROOT, 'src', 'index.css')).size;

const checks = [
  ['totalJsGzip', totalJsGzip, budget.totalJsGzipMax],
  ['entryChunkGzip', entry ? entry.gzip : Infinity, budget.entryChunkGzipMax],
  ['indexCssRawBytes', indexCssRaw, budget.indexCssRawBytesMax],
  ['builtCssGzip', builtCssGzip, budget.builtCssGzipMax],
];

console.log('Top chunks (gzip):');
for (const c of perChunk.slice(0, 8)) console.log(`  ${String(c.gzip).padStart(8)}  ${c.file}`);
console.log('');

let failed = false;
for (const [name, actual, max] of checks) {
  const ok = actual <= max;
  const pct = ((actual / max) * 100).toFixed(1);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual} / ${max} bytes (${pct}% of ceiling)`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('\nBundle budget exceeded. Either shrink the change (route-lazy the dep, move CSS '
    + 'into the split plan) or raise the ceiling in scripts/bundle-budget.json as its own visible '
    + 'commit with a stated reason.');
  process.exit(1);
}
