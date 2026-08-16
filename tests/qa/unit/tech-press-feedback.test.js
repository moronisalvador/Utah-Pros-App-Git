/**
 * ════════════════════════════════════════════════
 * FILE: tech-press-feedback.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The field-tech app's buttons all shrink slightly while you hold them down, so a
 *   press feels like it registered. That feedback is written ONCE, for every button in
 *   the tech shell, instead of once per button style — which is the whole point, because
 *   the per-button version is what silently drifted until 72 controls had no press at
 *   all and the owner reported "clicking buttons in the iOS app has no animation".
 *
 *   This file guards the two ways that one shared rule can quietly break:
 *     1. A button style that already shrinks on its own would shrink TWICE (too far).
 *     2. Someone swaps the modern `scale` property for the older `transform: scale()`,
 *        which would shove every centred or rotated button out of position.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/index.css (read as text — this is a source-contract test)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Static source contract, not a rendering test: it proves the CSS says what it
 *     claims, not that a real device paints it. On-device feel stays an owner check.
 *   - Law: .claude/rules/motion-standard.md §3 (press feedback) and §5 (the
 *     prefers-reduced-motion collapse is a HARD gate).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/**
 * Every class that a `transform: scale()` press actually lands ON.
 *
 * Only the compound carrying `:active` counts — an ancestor scope
 * (`.tech-layout .tech-settings-btn:active`) and a `:not()` argument
 * (`.create-menu-fab:active:not(.active)`) are not the pressed element.
 */
function transformScalePressSelectors() {
  const re = /(^|\n)([^{}\n][^{}]*?):active([^{}]*)\{([^}]*)\}/g;
  const found = new Set();
  let m;
  while ((m = re.exec(css))) {
    if (!/transform\s*:\s*[^;]*scale\(/.test(m[4])) continue;
    for (const part of `${m[2]}:active${m[3]}`.split(',')) {
      const compound = part
        .replace(/:not\([^)]*\)/g, '')   // :not() args are exclusions, not targets
        .trim().split(/\s+|>/).pop() ?? '';
      if (!compound.includes(':active')) continue;
      for (const cls of compound.match(/\.[a-zA-Z][\w-]*/g) || []) found.add(cls.slice(1));
    }
  }
  return found;
}

/**
 * Classes that scale via `transform` but can never render inside `.tech-layout`,
 * so they cannot compound with the shared rule. Each needs a reason, not just a name.
 */
const OFFICE_SHELL_ONLY = {
  'create-menu-fab': 'office Layout.jsx create menu — never mounted in the tech shell',
  // DocChecklist is imported only by src/pages/JobPage.jsx (office /jobs/:id).
  'doc-cl-view-btn': 'DocChecklist view toggle — office JobPage only',
  'doc-cl-item': 'DocChecklist row — office JobPage only',
};

describe('tech-shell press feedback — one shared rule', () => {
  it('applies the press to every enabled button in the shell', () => {
    expect(css).toMatch(/\.tech-layout button:active:not\(:disabled\)\s*\{\s*scale:\s*0\.97;\s*\}/);
  });

  // transform: scale() would OVERWRITE the translateX(-50%) that centres
  // .tv2-today-pill / .tv2-msgs-jump / .tv2-hub-lightbox-action and the rotate(45deg)
  // on the open .tv2-fab — every one of them would jump on press. `scale` composes.
  it('uses the independent `scale` property, never `transform: scale()`', () => {
    const shared = css.match(/\.tech-layout button:active:not\(:disabled\)\s*\{[^}]*\}/)?.[0] ?? '';
    expect(shared).toContain('scale:');
    expect(shared).not.toMatch(/transform\s*:/);
  });

  // The compounding guard: 0.97 × 0.92 = 0.89 would be a visibly deeper press on
  // .ui-icon-btn than anywhere else in the app.
  it('opts out every control that already owns a transform-scale press', () => {
    const optOut = css.match(
      /\.tech-layout :is\(([^)]*)\):active:not\(:disabled\)\s*\{\s*scale:\s*1;\s*\}/,
    )?.[1] ?? '';
    const optedOut = new Set((optOut.match(/\.[a-zA-Z][\w-]*/g) || []).map(c => c.slice(1)));

    const unguarded = [...transformScalePressSelectors()]
      .filter(cls => !optedOut.has(cls) && !(cls in OFFICE_SHELL_ONLY));

    expect(
      unguarded,
      `these classes scale on :active via transform and would compound with the shared\n` +
      `tech-shell press. Add each to the .tech-layout :is(...) opt-out list in\n` +
      `src/index.css, or to OFFICE_SHELL_ONLY here with the reason it cannot render\n` +
      `inside .tech-layout:\n  ${unguarded.join('\n  ')}`,
    ).toEqual([]);
  });

  // motion-standard §3: a row spanning the viewport uses the background/opacity swap;
  // scaling it reads as the whole screen flexing.
  it('keeps full-width list rows on the row idiom rather than a scale', () => {
    for (const row of ['tv2-hub-task', 'tv2-hub-tool-row', 'tv2-sheet__row', 'tv2-hub-claimcard', 'am-invline-picker-opt', 'am-estb-result', 'am-estb-picker-opt']) {
      const rule = new RegExp(`\\.tech-layout :is\\([^)]*\\.${row}[^)]*\\):active`);
      expect(css, `${row} must opt out of the press scale`).toMatch(rule);
    }
  });

  it('keeps P4c’s compact document controls scale-responsive despite their local transitions', () => {
    expect(css).toMatch(/\.am-invoice-claim-link:active\s*\{\s*scale:\s*0\.97;/);
    expect(css).toMatch(/:is\(\.am-document-add, \.am-line-tool, \.am-invline-picker-btn\):active:not\(:disabled\)\s*\{\s*scale:\s*0\.97;/);
    expect(css).toMatch(/:is\(\.am-estb-chip, \.am-estb-newcust, \.am-estb-chg, \.am-estb-picker-btn\):active:not\(:disabled\)\s*\{\s*scale:\s*0\.97;/);
    expect(css).toMatch(/\.am-invoice-claim-link:active\s*\{\s*scale:\s*1;/);
    expect(css).toMatch(/\.am-invline-picker-opt, \.am-document-results \.am-data-row--link\s*\{\s*transition:\s*background-color/);
    expect(css).toMatch(/\.am-estb-result, \.am-estb-picker-opt\s*\{\s*transition:\s*background-color/);
  });

  // motion-standard §5 — HARD gate. Missing fallback is a blocker-severity review failure.
  it('collapses the press under prefers-reduced-motion', () => {
    const blocks = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*?\n\}/gs) || [];
    const collapse = blocks.find(b => /\.tech-layout button:active:not\(:disabled\)/.test(b));
    expect(collapse, 'no reduced-motion block collapses the tech-shell press').toBeTruthy();
    expect(collapse).toMatch(/scale:\s*1/);
    expect(collapse).toMatch(/:where\(\.tech-layout\) :where\(button\)\s*\{\s*transition:\s*none/);
  });
});
