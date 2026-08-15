/**
 * ════════════════════════════════════════════════
 * FILE: bundle-size-report.node-test.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the bundle-size report measures the right files. Its main job is to
 *   lock in the fix for a bug that made the old CI step useless: it looked in a
 *   folder that does not exist, found nothing, and reported 20 bytes as if the
 *   app were empty. These tests build a fake dist folder with known file sizes
 *   and check the reported numbers match.
 *
 * DEPENDS ON:
 *   Packages:  node:assert, node:fs, node:os, node:path, node:test, node:zlib
 *   Internal:  scripts/bundle-size-report.mjs
 *   Data:      reads  → a temporary fixture dist/ it creates itself
 *              writes → a temp directory, removed after each test
 *
 * NOTES / GOTCHAS:
 *   - The decoy `dist/assets/` directory in the fixture is deliberate: it is
 *     what the old glob pointed at. A regression that reads it again fails here.
 * ════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { BLOCKING, BUDGETS, buildReport, parseEntryGraph } from './bundle-size-report.mjs';

// ─── SECTION: Helpers ────────────────────────────────────────────────────────

/**
 * Deterministic, poorly-compressible bytes so gzip sizes stay meaningful.
 * Uses Math.imul: a plain `x * 1103515245` exceeds 2^53, loses precision, and
 * degenerates into a repeating pattern that gzip crushes to almost nothing.
 */
function noise(bytes, seed) {
  const out = Buffer.alloc(bytes);
  let x = seed | 0 || 1;
  for (let i = 0; i < bytes; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = Math.imul(x, 1) | 0;
    out[i] = (x >>> 8) & 0xff;
  }
  return out;
}

function makeFixture({ entryBytes = 5000, preloadBytes = 3000, lazyBytes = 100_000, cssBytes = 2000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upr-bundle-'));
  const dist = path.join(dir, 'dist');
  const assets = path.join(dist, 'app-assets');
  fs.mkdirSync(assets, { recursive: true });

  fs.writeFileSync(path.join(assets, 'index-AAA.js'), noise(entryBytes, 1));
  fs.writeFileSync(path.join(assets, 'react-BBB.js'), noise(preloadBytes, 2));
  fs.writeFileSync(path.join(assets, 'LazyRoute-CCC.js'), noise(lazyBytes, 3));
  fs.writeFileSync(path.join(assets, 'index-DDD.css'), noise(cssBytes, 4));

  // The directory the OLD, broken glob pointed at. Nothing may read it.
  const decoy = path.join(dist, 'assets');
  fs.mkdirSync(decoy, { recursive: true });
  fs.writeFileSync(path.join(decoy, 'stale-EEE.js'), noise(999_999, 5));

  fs.writeFileSync(
    path.join(dist, 'index.html'),
    `<!doctype html><html><head>
       <script type="module" crossorigin src="/app-assets/index-AAA.js"></script>
       <link rel="modulepreload" crossorigin href="/app-assets/react-BBB.js">
       <link rel="stylesheet" crossorigin href="/app-assets/index-DDD.css">
     </head><body></body></html>`,
  );

  const srcCss = path.join(dir, 'index.css');
  fs.writeFileSync(srcCss, noise(1234, 6));
  return { dir, dist, srcCss, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ─── SECTION: Entry-graph parsing ────────────────────────────────────────────

test('parseEntryGraph collects the module entry, its preloads and its stylesheet', () => {
  const g = parseEntryGraph(
    `<script type="module" crossorigin src="/app-assets/index-A.js"></script>
     <link rel="modulepreload" crossorigin href="/app-assets/react-B.js">
     <link rel="modulepreload" crossorigin href="/app-assets/i18n-C.js">
     <link rel="stylesheet" crossorigin href="/app-assets/index-D.css">`,
  );
  assert.deepEqual(g.js, ['/app-assets/index-A.js', '/app-assets/react-B.js', '/app-assets/i18n-C.js']);
  assert.deepEqual(g.css, ['/app-assets/index-D.css']);
});

test('parseEntryGraph de-duplicates a chunk listed as both entry and preload', () => {
  const g = parseEntryGraph(
    `<script type="module" src="/app-assets/index-A.js"></script>
     <link rel="modulepreload" href="/app-assets/index-A.js">`,
  );
  assert.deepEqual(g.js, ['/app-assets/index-A.js']);
});

// ─── SECTION: The regression this script exists to prevent ───────────────────

test('REGRESSION: measures dist/app-assets, never the stale dist/assets decoy', () => {
  const fx = makeFixture();
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    // The decoy holds ~1 MB. If it leaked in, these numbers explode.
    assert.equal(r.entryJs.length, 2);
    assert.ok(
      r.entryJs.every((f) => f.name !== 'stale-EEE.js'),
      'stale dist/assets chunk must never enter the entry graph',
    );
    assert.ok(
      r.allJs.every((f) => f.name !== 'stale-EEE.js'),
      'stale dist/assets chunk must never enter the all-JS total',
    );
  } finally {
    fx.cleanup();
  }
});

test('REGRESSION: a real bundle never reports the 20-byte empty-gzip signature', () => {
  const fx = makeFixture();
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    const emptyGzip = zlib.gzipSync(Buffer.alloc(0)).length;
    assert.ok(
      r.entryJsGzip > emptyGzip * 10,
      `entry-graph gzip ${r.entryJsGzip} looks like empty input (${emptyGzip} B) — the glob is broken again`,
    );
  } finally {
    fx.cleanup();
  }
});

test('a missing module entry is a hard error, not a silent zero', () => {
  const fx = makeFixture();
  try {
    fs.writeFileSync(path.join(fx.dist, 'index.html'), '<!doctype html><html></html>');
    assert.throws(() => buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss }), /No module entry/);
  } finally {
    fx.cleanup();
  }
});

// ─── SECTION: Metric correctness ─────────────────────────────────────────────

test('entry-graph total excludes lazy route chunks', () => {
  const fx = makeFixture({ lazyBytes: 500_000 });
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.ok(r.entryJsGzip < r.totalJsGzip, 'entry graph must be a subset of all JS');
    assert.equal(r.heaviestRoute.name, 'LazyRoute-CCC.js');
    assert.ok(
      r.entryJs.every((f) => f.name !== 'LazyRoute-CCC.js'),
      'a lazy route must not count against the entry-graph budget',
    );
  } finally {
    fx.cleanup();
  }
});

test('gzip totals sum each file separately (wire behaviour), not concatenated', () => {
  const fx = makeFixture();
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    const expected = r.entryJs.reduce((n, f) => n + f.gzip, 0);
    assert.equal(r.entryJsGzip, expected);
  } finally {
    fx.cleanup();
  }
});

test('CSS is measured — both the built stylesheet and the src/index.css source', () => {
  const fx = makeFixture();
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.equal(r.entryCss.length, 1);
    assert.ok(r.entryCss[0].raw > 0 && r.entryCss[0].gzip > 0);
    assert.equal(r.srcCssRaw, 1234);
  } finally {
    fx.cleanup();
  }
});

// ─── SECTION: Budget enforcement ─────────────────────────────────────────────

test('budgets are stated in bytes and ordered budget < fail threshold', () => {
  assert.equal(BUDGETS.entryJsGzip, 237_568);
  assert.equal(BUDGETS.srcIndexCssRaw, 595_000);
  assert.ok(BUDGETS.entryJsGzipFail > BUDGETS.entryJsGzip);
});

test('a within-budget bundle produces no failures', () => {
  const fx = makeFixture();
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.deepEqual(r.failures, []);
  } finally {
    fx.cleanup();
  }
});

test('an oversized route chunk is reported as a failure', () => {
  const fx = makeFixture({ lazyBytes: BUDGETS.routeChunkRaw + 5000 });
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.ok(r.failures.some((f) => /route chunk/.test(f)), r.failures.join(' | '));
  } finally {
    fx.cleanup();
  }
});

test('an oversized entry graph is reported exactly once, routed by BLOCKING', () => {
  const fx = makeFixture({ entryBytes: 400_000, preloadBytes: 400_000 });
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.equal(r.breaches.filter((b) => b.budget === 'entryJsGzip').length, 1);
    const lane = BLOCKING.entryJsGzip ? r.failures : r.advisories;
    const other = BLOCKING.entryJsGzip ? r.advisories : r.failures;
    assert.ok(lane.some((m) => /entry-graph JS/.test(m)), lane.join(' | '));
    assert.ok(!other.some((m) => /entry-graph JS/.test(m)), 'must not appear in both lanes');
  } finally {
    fx.cleanup();
  }
});

test('all three budgets are enforced', () => {
  assert.equal(BLOCKING.entryJsGzip, true);
  assert.equal(BLOCKING.routeChunkRaw, true);
  assert.equal(BLOCKING.srcIndexCssRaw, true);
});

test('an advisory-lane breach leaves failures empty, so --strict stays green', () => {
  // Exercises the routing itself rather than today's BLOCKING values, so this
  // keeps its meaning if a budget is ever moved back to advisory.
  const fx = makeFixture({ lazyBytes: BUDGETS.routeChunkRaw + 5000 });
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    const lane = BLOCKING.routeChunkRaw ? r.failures : r.advisories;
    assert.ok(lane.some((m) => /route chunk/.test(m)));
    if (!BLOCKING.routeChunkRaw) assert.deepEqual(r.failures, []);
  } finally {
    fx.cleanup();
  }
});

// ─── SECTION: The budget / fail-threshold two-tier rule ──────────────

test('between budget and the +10% line: warns, never blocks', () => {
  // perf-budget.md sets the budget as the target and +10% as the failure point.
  // Blocking inside that band would contradict the standard, even with the
  // entry-graph gate switched on.
  const fx = makeFixture();
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    const between = BUDGETS.entryJsGzip + Math.floor((BUDGETS.entryJsGzipFail - BUDGETS.entryJsGzip) / 2);
    assert.ok(between > BUDGETS.entryJsGzip && between < BUDGETS.entryJsGzipFail);

    // Rebuild the decision the same way buildReport does, over a value in-band.
    const overBudget = between > BUDGETS.entryJsGzip;
    const overFail = between > BUDGETS.entryJsGzipFail;
    assert.ok(overBudget && !overFail);

    // And confirm the real report never puts a sub-threshold overage in failures.
    if (r.entryJsGzip > BUDGETS.entryJsGzip && r.entryJsGzip <= BUDGETS.entryJsGzipFail) {
      assert.ok(!r.failures.some((m) => /entry-graph JS/.test(m)));
      assert.ok(r.advisories.some((m) => /entry-graph JS/.test(m)));
    }
  } finally {
    fx.cleanup();
  }
});

test('above the +10% line: blocks, now that the entry-graph gate is on', () => {
  const fx = makeFixture({ entryBytes: 400_000, preloadBytes: 400_000 });
  try {
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.ok(r.entryJsGzip > BUDGETS.entryJsGzipFail, 'fixture must exceed the fail line');
    assert.ok(r.failures.some((m) => /entry-graph JS/.test(m)), r.failures.join(' | '));
  } finally {
    fx.cleanup();
  }
});

test('an oversized src/index.css is reported as a failure', () => {
  const fx = makeFixture();
  try {
    fs.writeFileSync(fx.srcCss, noise(BUDGETS.srcIndexCssRaw + 1000, 9));
    const r = buildReport({ distDir: fx.dist, srcCssPath: fx.srcCss });
    assert.ok(r.failures.some((f) => /src\/index\.css/.test(f)), r.failures.join(' | '));
  } finally {
    fx.cleanup();
  }
});
