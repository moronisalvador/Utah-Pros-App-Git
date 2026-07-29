/**
 * MSG-04 — every custom property referenced in index.css is actually defined.
 *
 * `var(--border)` was used 20 times and defined nowhere. That is not a cosmetic
 * mismatch: an unresolvable var() makes the declaration
 * invalid-at-computed-value-time, so `border-bottom: 1px solid var(--border)`
 * resets to its initial value — border-style `none` — and the separator does
 * not render at all. The reported "blank white" Messages separators were
 * borders that were never drawn.
 *
 * A typo'd token therefore fails SILENTLY, which is exactly the class of defect
 * worth a repo-wide guard rather than a one-line fix.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** Every custom property this stylesheet DEFINES, anywhere. */
function definedTokens(source) {
  const names = new Set();
  for (const m of source.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) names.add(m[1]);
  return names;
}

/** Every custom property this stylesheet REFERENCES, with its line. */
function referencedTokens(source) {
  const refs = [];
  source.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g)) {
      refs.push({ token: m[1], line: i + 1, hasFallback: m[2] === ',' });
    }
  });
  return refs;
}

/**
 * Pre-existing undefined tokens, recorded rather than silently tolerated.
 *
 * Found by this guard when it was written for MSG-04. They are the SAME defect
 * — every declaration using them is invalid-at-computed-value-time and does not
 * render — but choosing replacements is a design decision, not a mechanical
 * one: nothing in the repo says what `--brand-primary` ought to resolve to.
 *
 * `--brand-primary` is the worst of them: it is referenced from JSX inline
 * styles too (src/pages/CustomerPage.jsx), so those colours fall back silently
 * on a live customer surface.
 *
 * This is a RATCHET, matching the repo's eslint-baseline idiom. New undefined
 * tokens fail; these are owed. Shrink the list, never grow it.
 */
const KNOWN_UNDEFINED = new Set([
  '--macro-color',
  '--brand-primary',
  '--brand-primary-light',
  '--brand-primary-hover',
  '--chip-bg',
  '--chip-fg',
  '--crm-danger',
]);

describe('MSG-04 — CSS custom properties resolve', () => {
  it('introduces no NEW undefined token', () => {
    const defined = definedTokens(css);
    const missing = referencedTokens(css)
      .filter((r) => !defined.has(r.token) && !r.hasFallback)
      .filter((r) => !KNOWN_UNDEFINED.has(r.token));

    // Report every offender with its line — a bare count sends the next person
    // hunting, and this is precisely the failure that is invisible in a browser.
    const detail = missing.map((r) => `  ${r.line}: var(${r.token})`).join('\n');
    expect(missing.length, `undefined custom properties:\n${detail}`).toBe(0);
  });

  it('keeps the known-undefined baseline honest', () => {
    // If one of these gets defined, remove it from the list rather than leaving
    // a stale exemption that would hide a future regression of the same name.
    const defined = definedTokens(css);
    const nowDefined = [...KNOWN_UNDEFINED].filter((t) => defined.has(t));
    expect(nowDefined, `now defined — drop from KNOWN_UNDEFINED: ${nowDefined}`).toEqual([]);
  });

  it('specifically no longer references the undefined --border', () => {
    // Pinned by name: this one shipped 20 times and rendered nothing.
    expect(css).not.toMatch(/var\(\s*--border\s*\)/);
    expect(definedTokens(css).has('--border')).toBe(false);
  });

  it('still defines the real border tokens the fix maps onto', () => {
    const defined = definedTokens(css);
    expect(defined.has('--border-color')).toBe(true);
    expect(defined.has('--border-light')).toBe(true);
  });

  it('defines both border tokens for dark theme too', () => {
    // A token defined only in :root would render the separators invisible in
    // dark mode instead — the same silent failure, one theme over.
    const darkBlocks = css.split('[data-theme="dark"]').slice(1).join('\n');
    expect(darkBlocks).toMatch(/--border-color:/);
    expect(darkBlocks).toMatch(/--border-light:/);
  });
});
