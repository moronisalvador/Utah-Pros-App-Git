/**
 * LIFECYCLE-RESUME — exactly one implementation owns resume/focus refetching.
 *
 * page-lifecycle.md §2: "Use the shared `useResumeRefetch({ onResume, onFocus,
 * pollMs, hiddenEdgeOnly })` hook (F-S2). Do **not** hand-roll
 * `addEventListener('visibilitychange'|'focus')` in a page."
 *
 * The audit that produced that rule counted 8 hand-rolled visibility handlers.
 * Each one re-derived the same three behaviors slightly differently — the
 * hidden→visible edge, the `document.hidden` poll guard (§4: 4 of 7 polls were
 * missing it), and whether the refetch is silent — so a fix to one never
 * reached the others.
 *
 * Two guards here, and the FIRST is the durable one:
 *
 *   1. A repository sweep with a named allowlist. It fails on a NEW hand-rolled
 *      listener in any page or component, not just the ones migrated today.
 *      Without it this file would go stale the moment someone adds a sixth.
 *   2. Per-site assertions that each migrated call site kept its poll interval
 *      and stayed silent — the properties a blind "does it import the hook"
 *      check would miss.
 *
 * Source contract rather than a render test: this lane is DOM-free
 * (vitest.config.js `environment: 'node'`, no jsdom in the repo), and the
 * property that matters — which module owns the listener — is structural.
 * Hook behavior itself (the edge detection, the poll guard) is covered by
 * src/hooks/hooks.test.jsx against the exported pure `subscribeResume`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * A `document.`/`window.`-scoped visibilitychange or focus listener. Scoped to
 * those two targets on purpose: an element-scoped `addEventListener('focus')`
 * on an input is a form concern, not a resume refetch, and must not trip this.
 */
const RAW_LISTENER = /(?:document|window)\.addEventListener\(\s*['"](?:visibilitychange|focus)['"]/;

/**
 * The sanctioned primitives. Each is allowed to hold a raw listener BECAUSE it
 * is the single implementation of its concern — the thing the rule points other
 * files at. Adding a line here is a deliberate decision to create a second
 * owner of resume behavior, which is what §2 exists to prevent.
 *
 * `src/hooks/useResumeRefetch.js` deliberately needs no entry: it attaches to
 * INJECTED `doc`/`win` params rather than the globals, which is both why the
 * sweep never matches it and why its `subscribeResume` is unit-testable without
 * a DOM. That indirection is asserted below so the exemption stays earned.
 */
const SANCTIONED = new Map([
  ['src/components/overview/hooks/usePolledRpc.js',
    'the hidden-guard behavior model page-lifecycle.md §2 and §4 cite by name'],
  ['src/components/RouteRestorer.jsx',
    'the one scroll/route-restoration primitive (§5: "pages do not hand-roll it")'],
  ['src/lib/nativeKeyboardLayout.js',
    'native keyboard layout metrics — not a data refetch, so §2 does not apply'],
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('LIFECYCLE-RESUME — no page or component hand-rolls a resume listener', () => {
  it('leaves visibilitychange/focus to the sanctioned primitives only', () => {
    const offenders = walk('src')
      .filter((file) => RAW_LISTENER.test(read(file)))
      .filter((file) => !SANCTIONED.has(file));

    expect(
      offenders,
      'page-lifecycle.md §2 bans hand-rolled visibilitychange/focus in a page or '
      + 'component. Use useResumeRefetch({ onResume, onFocus, pollMs }). If this file '
      + 'is genuinely a new shared primitive, add it to SANCTIONED with a reason.',
    ).toEqual([]);
  });

  it('keeps the allowlist honest — every sanctioned file still exists and still holds a listener', () => {
    // An allowlist entry that no longer applies is how a ban quietly loosens:
    // the name stays, the file changes, and the exemption covers something new.
    for (const [file, reason] of SANCTIONED) {
      expect(RAW_LISTENER.test(read(file)), `${file} no longer holds a raw listener — drop its allowlist entry (${reason})`).toBe(true);
    }
  });

  it('walks a real tree (guards against the sweep silently matching nothing)', () => {
    const files = walk('src');
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain('src/hooks/useResumeRefetch.js');
    // Prove the regex has teeth against a known-positive file.
    expect(RAW_LISTENER.test(read('src/components/RouteRestorer.jsx'))).toBe(true);
  });

  it('keeps the hook itself on injected targets, not the globals', () => {
    // This is why the hook needs no allowlist entry. If it ever reached for
    // `document`/`window` directly it would both trip the sweep and lose the
    // DOM-free testability of subscribeResume.
    const hook = read('src/hooks/useResumeRefetch.js');
    expect(hook).toMatch(/doc\.addEventListener\(\s*'visibilitychange'/);
    expect(hook).toMatch(/win\.addEventListener\(\s*'focus'/);
    expect(RAW_LISTENER.test(hook)).toBe(false);
  });
});

/**
 * The five sites migrated 2026-07-30. `pollMs` records the interval each one
 * previously hand-rolled with `setInterval` — the hook owns the
 * `document.hidden` guard those raw polls needed (§4).
 */
const SITES = [
  { file: 'src/pages/crm/CrmCallLog.jsx', pollMs: 15000 },
  { file: 'src/pages/tech/admin/AdminLeadCenter.jsx', pollMs: 20000 },
  { file: 'src/pages/JobPage.jsx', pollMs: null },
  { file: 'src/pages/tech/v2/dash/AttentionStrip.jsx', pollMs: null },
  { file: 'src/pages/tech/TechJobDocuments.jsx', pollMs: null },
];

describe('LIFECYCLE-RESUME — the migrated sites route through the hook', () => {
  for (const { file, pollMs } of SITES) {
    describe(file, () => {
      const source = read(file);

      it('imports and calls useResumeRefetch', () => {
        expect(source).toMatch(/import\s+(?:\{\s*useResumeRefetch\s*\}|useResumeRefetch)\s+from\s+['"]@\/hooks\/useResumeRefetch(?:\.js)?['"]/);
        expect(source).toMatch(/useResumeRefetch\(\{/);
      });

      it('holds no raw visibilitychange/focus listener', () => {
        expect(RAW_LISTENER.test(source)).toBe(false);
      });

      if (pollMs) {
        it(`keeps its ${pollMs}ms poll, through the hook's hidden-guard`, () => {
          expect(source).toMatch(new RegExp(`pollMs:\\s*${pollMs}`));
          // The raw interval is what lacked the document.hidden guard.
          expect(source).not.toMatch(/setInterval\(/);
        });
      }
    });
  }

  it('keeps the two poll pages silent on resume (§1: no gate on a refetch)', () => {
    // These pages already had a { silent } param; the migration must not have
    // swapped the resume path onto the gating call.
    for (const file of ['src/pages/crm/CrmCallLog.jsx', 'src/pages/tech/admin/AdminLeadCenter.jsx']) {
      const source = read(file);
      const call = source.slice(source.indexOf('useResumeRefetch({'));
      expect(call, `${file} resume refetch must stay silent`).toContain('silent');
      expect(source).toMatch(/load\(\{\s*silent:\s*true\s*\}\)/);
    }
  });

  it('keeps AttentionStrip torn down while the strip is inactive', () => {
    // The pre-migration effect bailed on `if (!active) return undefined`, so the
    // listener never existed on an inactive tab. `enabled` is how the hook
    // expresses that; losing it would start geolocating on a hidden dashboard.
    const source = read('src/pages/tech/v2/dash/AttentionStrip.jsx');
    const call = source.slice(source.indexOf('useResumeRefetch({'));
    expect(call.slice(0, 200)).toMatch(/enabled:\s*active/);
  });

  it('guards JobPage FilesTab against a stale response landing on a newer job', () => {
    // §2 requires a request guard. The pre-migration handler had none: two bare
    // db.select().then(set...) calls, so a slow response for the previous job
    // could overwrite the current one's files.
    const source = read('src/pages/JobPage.jsx');
    const filesTab = source.slice(
      source.indexOf('function FilesTab('),
      source.indexOf('function FilesTab(') + 3000,
    );
    expect(filesTab).toMatch(/useResumeRefetch\(\{\s*onResume/);
    // A generation ref compared before every setState is the in-repo pattern
    // (NotificationsSection.jsx refreshGenerationRef).
    expect(filesTab).toMatch(/resumeGenRef/);
    const guarded = filesTab.match(/if\s*\(\s*gen\s*===\s*resumeGenRef\.current\s*\)/g) || [];
    expect(guarded.length, 'both selects in the resume refetch must be generation-guarded').toBe(2);
  });
});
