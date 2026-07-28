/**
 * ════════════════════════════════════════════════
 * FILE: bundle-size-report.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Measures how heavy the built app is and compares it against the limits
 *   written down in .claude/rules/perf-budget.md. It reports the boot weight
 *   (the JavaScript a browser must download before the app can start), the
 *   stylesheet weight, and the biggest single page chunk. With --strict it
 *   exits non-zero when something is over budget, so CI can block the merge.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:zlib
 *   Internal:  dist/ (produced by `npm run build`), .claude/rules/perf-budget.md
 *   Data:      reads  → dist/index.html, dist/app-assets/*, src/index.css
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The entry graph is read from dist/index.html (the module script plus its
 *     modulepreload links), NOT from a directory glob. Globbing app-assets/*.js
 *     measures all 185 chunks including every lazy route (~961 KB gzip summed,
 *     ~853 KB concatenated) — a different quantity from the ~232 KB entry-graph
 *     budget, so comparing the two can never mean anything.
 *   - Vite emits to `dist/app-assets/`, not `dist/assets/` (vite.config.js
 *     `assetsDir`). The predecessor of this script globbed `dist/assets/*.js`,
 *     matched nothing, and reported 20 bytes — the gzip header of empty input.
 *   - Gzip totals SUM each file compressed separately, because that is how they
 *     travel over the wire. Concatenating first reports ~9 KB less and flatters.
 *   - All budgets are stated in BYTES. "KB" in prose was ambiguous between 1000
 *     and 1024 and that ambiguity is part of how the CSS budget went stale.
 * ════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const rootDir = path.resolve(import.meta.dirname, '..');

// ─── SECTION: Budgets (source: .claude/rules/perf-budget.md §1) ──────────────
// Stated in bytes deliberately. 232 KB / 175 KB are read as KiB (1024), the
// more generous reading; perf-budget.md should state the JS numbers in bytes
// the way its CSS bullet already does.
export const BUDGETS = Object.freeze({
  entryJsGzip: 232 * 1024, //       237,568 — "Entry-graph JS <= 232 KB gzip"
  entryJsGzipFail: Math.round(232 * 1024 * 1.1), // 261,325 — "CI fails at +10%"
  routeChunkRaw: 175 * 1024, //     179,200 — "Any single route chunk <= 175 KB raw"
  srcIndexCssRaw: 595_000, //       stated in bytes by perf-budget.md, re-baselined 2026-07-27
});

/**
 * Which budgets block a merge under --strict.
 *
 * Owner decision 2026-07-27: gate the two budgets that were passing when the
 * measurement was first fixed, and report entry-graph JS loudly without
 * blocking. The entry graph measured 264,072 B against a 261,325 B fail
 * threshold the moment the glob was corrected — it had drifted over silently,
 * exactly as the index.css budget had. Gating it same-day would have turned CI
 * red on dev for unrelated merges; re-baselining it would have loosened a real
 * budget. So it stays visible and unenforced until it is trimmed back under.
 *
 * FLIP `entryJsGzip` TO TRUE once the entry graph is under budget — that is the
 * whole remaining step, and it is the point of leaving this here.
 */
export const BLOCKING = Object.freeze({
  entryJsGzip: false,
  routeChunkRaw: true,
  srcIndexCssRaw: true,
});

// ─── SECTION: Helpers ────────────────────────────────────────────────────────
const gzipSize = (buf) => zlib.gzipSync(buf).length;
const fmt = (n) => n.toLocaleString('en-US');
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

/**
 * The entry graph is the module script plus every modulepreload Vite emits for
 * it — that is exactly the static import closure a cold boot must fetch.
 */
export function parseEntryGraph(html) {
  const entry = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const preload = [...html.matchAll(/rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  // Preserve order, drop duplicates.
  return { js: [...new Set([...entry, ...preload])], css: [...new Set(css)] };
}

const measure = (files, distDir) =>
  files
    .map((href) => {
      const file = path.join(distDir, href.replace(/^\//, ''));
      const buf = fs.readFileSync(file);
      return { name: path.basename(file), raw: buf.length, gzip: gzipSize(buf) };
    })
    .sort((a, b) => b.gzip - a.gzip);

// ─── SECTION: Report ─────────────────────────────────────────────────────────
export function buildReport({ distDir, srcCssPath }) {
  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const graph = parseEntryGraph(html);
  if (graph.js.length === 0) {
    throw new Error('No module entry found in dist/index.html — did `npm run build` run?');
  }

  const entryJs = measure(graph.js, distDir);
  const entryCss = measure(graph.css, distDir);
  const entryJsGzip = entryJs.reduce((n, f) => n + f.gzip, 0);

  const assetsDir = path.join(distDir, 'app-assets');
  const allJs = fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const buf = fs.readFileSync(path.join(assetsDir, f));
      return { name: f, raw: buf.length, gzip: gzipSize(buf) };
    });
  const totalJsGzip = allJs.reduce((n, f) => n + f.gzip, 0);

  const entryNames = new Set(entryJs.map((f) => f.name));
  const heaviestRoute = allJs
    .filter((f) => !entryNames.has(f.name))
    .sort((a, b) => b.raw - a.raw)[0] ?? null;

  const srcCssRaw = fs.statSync(srcCssPath).size;

  // A breach is recorded once, then routed to blocking or advisory by BLOCKING.
  const breaches = [];
  if (entryJsGzip > BUDGETS.entryJsGzipFail) {
    breaches.push({
      budget: 'entryJsGzip',
      message: `entry-graph JS gzip ${fmt(entryJsGzip)} B exceeds the fail threshold ${fmt(BUDGETS.entryJsGzipFail)} B (+10% of ${fmt(BUDGETS.entryJsGzip)} B)`,
    });
  } else if (entryJsGzip > BUDGETS.entryJsGzip) {
    breaches.push({
      budget: 'entryJsGzip',
      message: `entry-graph JS gzip ${fmt(entryJsGzip)} B is over budget ${fmt(BUDGETS.entryJsGzip)} B but under the +10% fail threshold`,
    });
  }
  if (heaviestRoute && heaviestRoute.raw > BUDGETS.routeChunkRaw) {
    breaches.push({
      budget: 'routeChunkRaw',
      message: `route chunk ${heaviestRoute.name} raw ${fmt(heaviestRoute.raw)} B exceeds ${fmt(BUDGETS.routeChunkRaw)} B`,
    });
  }
  if (srcCssRaw > BUDGETS.srcIndexCssRaw) {
    breaches.push({
      budget: 'srcIndexCssRaw',
      message: `src/index.css raw ${fmt(srcCssRaw)} B exceeds ${fmt(BUDGETS.srcIndexCssRaw)} B`,
    });
  }

  const failures = breaches.filter((b) => BLOCKING[b.budget]).map((b) => b.message);
  const advisories = breaches.filter((b) => !BLOCKING[b.budget]).map((b) => b.message);

  return {
    entryJs, entryCss, entryJsGzip, totalJsGzip, allJs, heaviestRoute, srcCssRaw,
    breaches, failures, advisories,
  };
}

function render(r) {
  const lines = [];
  lines.push('── Bundle size vs perf-budget.md ──────────────────────────────');
  lines.push('');
  lines.push(`Entry-graph JS   ${fmt(r.entryJsGzip).padStart(9)} B gzip  (${kib(r.entryJsGzip)})  across ${r.entryJs.length} chunks`);
  lines.push(`  budget         ${fmt(BUDGETS.entryJsGzip).padStart(9)} B        fail at ${fmt(BUDGETS.entryJsGzipFail)} B (+10%)  [${BLOCKING.entryJsGzip ? 'BLOCKING' : 'advisory'}]`);
  lines.push('');
  lines.push('  Top 5 entry chunks by gzip:');
  for (const f of r.entryJs.slice(0, 5)) {
    lines.push(`    ${fmt(f.gzip).padStart(8)} B  ${f.name}`);
  }
  lines.push('');
  for (const c of r.entryCss) {
    lines.push(`Stylesheet       ${fmt(c.gzip).padStart(9)} B gzip  (${fmt(c.raw)} B raw)  ${c.name}`);
  }
  lines.push(`src/index.css    ${fmt(r.srcCssRaw).padStart(9)} B raw   budget ${fmt(BUDGETS.srcIndexCssRaw)} B  (ratchet target 409,600 B)`);
  lines.push('');
  if (r.heaviestRoute) {
    lines.push(`Heaviest route   ${fmt(r.heaviestRoute.raw).padStart(9)} B raw   budget ${fmt(BUDGETS.routeChunkRaw)} B  ${r.heaviestRoute.name}`);
  }
  lines.push(`All JS chunks    ${fmt(r.totalJsGzip).padStart(9)} B gzip  (${r.allJs.length} files — context only, NOT the entry-graph budget)`);
  lines.push('');
  for (const a of r.advisories) lines.push(`OVER (advisory, not blocking)  ${a}`);
  for (const f of r.failures) lines.push(`OVER (blocking)                ${f}`);
  if (!r.advisories.length && !r.failures.length) lines.push('All measured budgets are within limits.');
  return lines.join('\n');
}

// ─── SECTION: CLI ────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const strict = process.argv.includes('--strict');
  const report = buildReport({
    distDir: path.join(rootDir, 'dist'),
    srcCssPath: path.join(rootDir, 'src', 'index.css'),
  });
  console.log(render(report));
  if (report.advisories.length > 0) {
    console.log('');
    console.log(
      'Advisory breach above is deliberately NOT blocking (see BLOCKING in this script). ' +
        'It still needs fixing — see .claude/rules/perf-budget.md §1.',
    );
  }
  if (report.failures.length > 0) {
    console.log('');
    console.log(
      strict
        ? 'FAIL: blocking budget exceeded (--strict). See .claude/rules/perf-budget.md §1.'
        : 'Blocking budget exceeded, but --strict was not passed, so this run does not fail.',
    );
    if (strict) process.exit(1);
  }
}
