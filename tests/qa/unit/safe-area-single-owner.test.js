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

describe('SAFE-01 — single owner of the top safe-area inset', () => {
  it('uses the top inset exactly twice: the token and .tech-layout', () => {
    const lines = css.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes('safe-area-inset-top'));

    // Fail loudly with the offending lines — a bare count is unhelpful here.
    const rendered = lines.map(([n, line]) => `${n}: ${line.trim()}`).join('\n');
    expect(lines.length, `expected 2 uses, found:\n${rendered}`).toBe(2);

    expect(lines[0][1]).toContain('--safe-top:');       // the token
    expect(lines[1][1]).toContain('padding-top:');      // .tech-layout
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
