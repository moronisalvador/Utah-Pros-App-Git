/**
 * MOTION-02 — Reduce Motion is honoured across the app.
 *
 * motion-standard.md §6 makes a missing prefers-reduced-motion fallback a review
 * failure, and requires one on EVERY transition and keyframe. The audit found
 * the coverage piecemeal: hand-written blocks that each had to be remembered,
 * with nothing underneath them and no JS handling at all.
 *
 * Two halves, and both are needed:
 *   CSS — a global floor so an animation nobody remembered still collapses.
 *   JS  — because CSS cannot touch programmatic scrolling. `scrollIntoView({
 *         behavior: 'smooth' })` states its behaviour explicitly and per spec
 *         overrides the CSS scroll-behavior property.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const css = read('src/index.css');

/**
 * The MOTION-02 media block, extracted by brace matching.
 *
 * Fixed-size slices were the first attempt and both overran — the explanatory
 * comment above the block is long enough that a 900-char window never reached
 * the @media line, and the closing-brace search ran on into unrelated rules that
 * legitimately use `animation: none`. Balancing braces is the only way to assert
 * about THIS block and nothing else.
 */
function motionFloorBlock() {
  const marker = css.indexOf('MOTION-02: global Reduce Motion floor');
  if (marker === -1) return null;
  const open = css.indexOf('@media (prefers-reduced-motion: reduce) {', marker);
  if (open === -1) return null;
  let depth = 0;
  let i = css.indexOf('{', open);
  const start = i;
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return null;
}

describe('MOTION-02 — the CSS floor', () => {
  it('has a universal reduced-motion block', () => {
    expect(css).toContain('MOTION-02: global Reduce Motion floor');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\*,\s*\n\s*\*::before,\s*\n\s*\*::after/);
  });

  it('shortens motion instead of removing it, so end states still land', () => {
    // `animation: none` on an animation that supplies the final appearance — a
    // fade-in from opacity 0 — would leave the element permanently invisible.
    // Reduced must not mean broken.
    const block = motionFloorBlock();
    expect(block).not.toBeNull();
    expect(block).toContain('animation-duration: 0.01ms !important;');
    expect(block).toContain('transition-duration: 0.01ms !important;');
    expect(block).not.toContain('animation: none');
  });

  it('kills delays too', () => {
    // A 0.01ms animation behind a 300ms delay is still a 300ms wait.
    expect(css).toContain('animation-delay: 0ms !important;');
    expect(css).toContain('transition-delay: 0ms !important;');
  });

  it('keeps busy indicators moving', () => {
    // These communicate ONLY by moving. A frozen spinner turns "working" into
    // "hung", which is worse than the motion it removes.
    const exception = motionFloorBlock();
    expect(exception).toContain('animation-iteration-count: infinite !important;');
    for (const sel of ['.spinner', '.tv2-skel', '.coll-skel', '.ovw-skel-bar', '.ovw-live-dot']) {
      expect(exception, sel).toContain(sel);
    }
  });

  it('does not touch anyone who has not asked for it', () => {
    // The whole floor lives inside the media query, which is what makes it safe
    // for the frozen PWA surface — and MOTION-02 explicitly asks for the same
    // handling on native and PWA.
    // Extracting by brace match proves the rules really are INSIDE the query;
    // a substring search near the marker would pass even if they had escaped it.
    const block = motionFloorBlock();
    expect(block).not.toBeNull();
    expect(block).toContain('*::after');
    expect(block).toContain('scroll-behavior: auto !important;');
  });
});

describe('MOTION-02 — the JS half', () => {
  const SITES = [
    'src/lib/useNativeKeyboardInset.js',
    'src/pages/tech/v2/messages/ThreadView.jsx',
    'src/pages/tech/v2/schedule/WeekStrip.jsx',
    'src/pages/tech/TechClaimAlbum.jsx',
    'src/pages/tech/TechEditAppointment.jsx',
    'src/pages/Conversations.jsx',
  ];

  it.each(SITES)('%s asks the preference before scrolling', (file) => {
    const src = read(file);
    expect(src).toMatch(/import \{ scrollBehavior \} from '(@\/lib|\.)\/reducedMotion(\.js)?'/);
    expect(src).toContain('scrollBehavior(');
  });

  it.each(SITES)('%s has no hardcoded smooth scroll left', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/behavior: *'smooth'/);
  });

  it('still scrolls under Reduce Motion — only the travel goes', () => {
    // Skipping the scroll would lose the information it exists to convey, which
    // is MOTION-02's "no motion-dependent information loss" clause.
    const lib = read('src/lib/reducedMotion.js');
    expect(lib).toContain("return prefersReducedMotion() ? 'auto' : preferred;");
  });
});

describe('MOTION-02 — site deliberately NOT changed', () => {
  it('records the office/web scroll left alone', () => {
    // Help.jsx is an office/web surface in the frozen PWA UI. If it is ever
    // adopted by a scoped initiative, add it to SITES above.
    expect(read('src/pages/Help.jsx')).toContain("behavior: 'smooth'");
  });
});
