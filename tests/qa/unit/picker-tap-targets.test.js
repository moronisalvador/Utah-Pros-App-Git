/**
 * PICK-05 — pickers meet the gloved-hands floor.
 *
 * tech-mobile-ux.md: primary field actions >= 48px, a documented dense
 * secondary control may be 44px, and hit areas under 24px are banned outright
 * regardless of visual size. The pickers were below all of it: the DatePicker
 * trigger 36px, day cells 34px non-semantic click-divs, month nav 28px, and the
 * Scope Sheet's small Stepper 42px.
 *
 * The persona these numbers exist for is in the rule: a 64-year-old technician
 * in a flooded basement, wearing work gloves, one-handed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const picker = read('src/components/DatePicker.jsx');
const renderer = read('src/components/demo-sheet/DemoSheetRenderer.jsx');

describe('PICK-05 — DatePicker tap targets', () => {
  it('gives the trigger the 48px primary floor', () => {
    expect(picker).toMatch(/minHeight: 48/);
    expect(picker).not.toMatch(/minHeight: 36/);
  });

  it('gives each day a 44px hit area', () => {
    expect(picker).toMatch(/width: 44, height: 44/);
  });

  it('keeps the 34px circle as a visual only, so the calendar looks unchanged', () => {
    // The point is a bigger TARGET, not a bigger calendar — separating the two
    // is what makes this safe to ship without a redesign.
    expect(picker).toMatch(/position: 'absolute', width: 34, height: 34/);
    expect(picker).toContain('aria-hidden="true"');
  });

  it('gives month nav the 44px secondary floor', () => {
    const at = picker.indexOf('navBtn: {');
    const block = picker.slice(at, picker.indexOf('}', at));
    expect(block).toMatch(/width: 44, height: 44/);
    expect(block).not.toMatch(/width: 28/);
  });

  it('makes days real buttons, not click-divs', () => {
    // A div with onClick is unreachable by keyboard and invisible to
    // assistive tech; it also cannot be disabled properly.
    expect(picker).toMatch(/<button\s+key=\{di\}/);
    expect(picker).toMatch(/disabled=\{isDisabled\}/);
  });

  it('labels every day and both nav buttons', () => {
    expect(picker).toContain('aria-label={dayAriaLabel(thisDate, locale)}');
    expect(picker).toMatch(/aria-label=\{monthNavLabel\(viewDate, -1, locale\)\}/);
    expect(picker).toMatch(/aria-label=\{monthNavLabel\(viewDate, 1, locale\)\}/);
    // Bare "14" tells a screen-reader user nothing about month or year.
    expect(picker).toMatch(/weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'/);
  });

  it('widened the popup so seven 44px columns actually fit', () => {
    // 7 x 44 = 308, plus 8px padding a side. At the old 280 the columns were
    // ~38px and the targets would have overlapped or been clipped.
    expect(picker).toMatch(/width: 328/);
    expect(picker).not.toMatch(/width: 280, background/);
  });
});

describe('PICK-05 — Scope Sheet stepper', () => {
  it('raises the small variant to the 44px floor', () => {
    expect(renderer).toMatch(/const sz = small \? 44 : 50;/);
  });

  it('labels the bare glyph buttons', () => {
    expect(renderer).toContain("aria-label={unit ? `Decrease ${unit}` : 'Decrease'}");
    expect(renderer).toContain("aria-label={unit ? `Increase ${unit}` : 'Increase'}");
    expect(renderer).toMatch(/<span aria-hidden="true">−<\/span>/);
    expect(renderer).toMatch(/<span aria-hidden="true">\+<\/span>/);
  });
});
