/**
 * SAFE-01 — exactly one element owns the top safe-area inset.
 *
 * The Messages pane re-applied `env(safe-area-inset-top)` three more times
 * inside a `.tech-layout` that had already applied it, so every Messages header
 * was pushed down by the Dynamic Island twice. One of those rules spent the
 * inset on the BOTTOM padding as well as the top.
 *
 * `.tv2-msgs-pane` is a plain in-flow flex child (no position:fixed, no inset:0)
 * rendered inside `<div className="tech-layout">`, which is what makes the inner
 * uses duplicates rather than compensation — verified before the change.
 *
 * The whole regression contract is a grep, so it is expressed as one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

describe('SAFE-01 — one inset owner per shell', () => {
  // Amended by SAFE-02. The rule was never "one owner globally" — it is one
  // owner PER SHELL. `.tech-layout` owns the authenticated shell;
  // `.public-native-shell` owns the public one (login, signing, set-password,
  // legal), which sits outside `.tech-layout` and previously consumed no inset
  // at all. They never nest, so no surface is padded twice.
  it('uses the top inset exactly three times: the token and the two shells', () => {
    const lines = css.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes('safe-area-inset-top'));

    // Fail loudly with the offending lines — a bare count is unhelpful here.
    const rendered = lines.map(([n, line]) => `${n}: ${line.trim()}`).join('\n');
    expect(lines.length, `expected 3 uses, found:\n${rendered}`).toBe(3);

    expect(lines[0][1]).toContain('--safe-top:');       // the token
    expect(lines[1][1]).toContain('padding-top:');      // .tech-layout
    expect(lines[2][1]).toContain('padding-top:');      // .public-native-shell
  });

  it('scopes the public shell to native only, so the PWA is untouched', () => {
    const at = css.indexOf(':root[data-native="true"] .public-native-shell {');
    expect(at, 'public shell rule must be native-scoped').toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block).toContain('safe-area-inset-top');
    // An unscoped `.public-native-shell { padding-top: env(...) }` would be a
    // no-op on the web today but would silently start applying if the PWA ever
    // ran in a display mode that reports a non-zero inset.
    expect(css).not.toMatch(/\n\.public-native-shell \{/);
  });

  it('never nests the two shells', () => {
    // The public routes are registered outside TechRoutes; if that ever changed,
    // a public page would sit inside .tech-layout and be padded twice.
    const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
    const nativeRoutes = app.slice(
      app.indexOf('function NativeRoutes()'),
      app.indexOf('function WebRoutes()'),
    );
    const shellAt = nativeRoutes.indexOf('<PublicNativeShell');
    const techAt = nativeRoutes.indexOf('{TechRoutes()}');
    expect(shellAt).toBeGreaterThan(-1);
    expect(techAt).toBeGreaterThan(shellAt);   // public routes come first, unnested
  });

  it('keeps .tech-layout as that owner', () => {
    const layout = css.slice(css.indexOf('.tech-layout {'));
    const block = layout.slice(0, layout.indexOf('}'));
    expect(block).toContain('padding-top: env(safe-area-inset-top, 0px);');
  });

  it('leaves the Messages pane an ordinary in-flow child', () => {
    // If this pane ever became position:fixed it would legitimately need its
    // own inset, and the rule above would have to change with it.
    const pane = css.slice(css.indexOf('.tv2-msgs-pane {'));
    const block = pane.slice(0, pane.indexOf('}'));
    expect(block).not.toContain('position: fixed');
    expect(block).not.toContain('position: absolute');
    expect(block).toContain('flex: 1');
  });

  it('does not reintroduce the inset in the Messages headers', () => {
    for (const selector of [
      '.tv2-msgs-list__header',
      '.tv2-msgs-thread__bar',
      '.tv2-msgs-new__search',
    ]) {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} not found`).toBeGreaterThan(-1);
      const block = css.slice(at, css.indexOf('}', at));
      expect(block, selector).not.toContain('safe-area-inset-top');
    }
  });
});
