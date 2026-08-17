/**
 * ════════════════════════════════════════════════
 * FILE: picker-tap-targets.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the date picker and the Scope Sheet's plus/minus stepper are
 *   big enough to hit with a gloved finger, and that their buttons are real
 *   buttons a screen reader can name. Reads the source files as text — no
 *   browser needed.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/components/DatePicker.jsx, src/index.css,
 *              src/components/demo-sheet/DemoSheetRenderer.jsx (reads only)
 *   Data:      reads → none; writes → none
 *
 * NOTES / GOTCHAS:
 *   - PICK-05: tech-mobile-ux.md sets primary field actions >= 48px, a
 *     documented dense secondary control at 44px, and bans hit areas under
 *     24px regardless of visual size. The pickers were below all of it:
 *     36px trigger, 34px non-semantic click-divs, 28px month nav, 42px small
 *     Stepper. The persona the numbers exist for: a 64-year-old technician
 *     in a flooded basement, wearing work gloves, one-handed.
 *   - DemoSheetRenderer's stepper change landed on dev independently; the
 *     assertions here pin it against regression.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const picker = read('src/components/DatePicker.jsx');
const css = read('src/index.css');
const renderer = read('src/components/demo-sheet/DemoSheetRenderer.jsx');

describe('PICK-05 — DatePicker tap targets', () => {
  it('gives the trigger the 48px primary floor', () => {
    expect(picker).toMatch(/minHeight: 48/);
    expect(picker).not.toMatch(/minHeight: 36/);
  });

  it('lets a host form override trigger sizing without weakening the shared default', () => {
    expect(picker).toContain('triggerStyle,');
    expect(picker).toMatch(/minHeight: 48[\s\S]*\.\.\.triggerStyle[\s\S]*\(open \?/);
  });

  it('makes the trigger a labelled keyboard button that SPEAKS its value', () => {
    // PR #666 review P1: a default 'Choose date' aria-label overrode the
    // rendered date as the accessible name for every caller, making sibling
    // date fields indistinguishable and the selected value unspoken. The
    // contract now: no default name (fall back to the button's own text); an
    // explicit ariaLabel composes the displayed value in; ariaLabelledBy
    // composes the visible label id with the value span's id.
    expect(picker).toMatch(/ariaLabel,\n/); // prop declared with NO default
    expect(picker).not.toContain("ariaLabel = 'Choose date'");
    expect(picker).toMatch(/aria-label=\{ariaLabelledBy \|\| !ariaLabel[\s\S]*?\$\{ariaLabel\}, \$\{value \? displayDate\(value\) : placeholder\}/);
    expect(picker).toMatch(/aria-labelledby=\{ariaLabelledBy \? `\$\{ariaLabelledBy\} \$\{valueId\}` : undefined\}/);
    expect(picker).toContain('<span id={valueId}>{value ? displayDate(value) : placeholder}</span>');
    expect(picker).toContain('aria-haspopup="dialog"');
    expect(picker).toContain('aria-expanded={open}');
    expect(picker).toContain("role=\"dialog\" aria-label={`${ariaLabel || 'Choose date'} calendar`}");
  });

  it("Today commits the caller's authoritative business day, not the device day", () => {
    // PR #666 review P1: goToday formatted device-local new Date(), so an
    // Eastern-time user after 10 PM Denver would record a QuickBooks TxnDate
    // on the wrong business day. Money surfaces pass todayDate (America/
    // Denver via todayInCompanyTimeZone); the dot and aria-current follow it.
    expect(picker).toMatch(/const goToday = \(\) => \{\s*const now = authoritativeToday\(\);/);
    expect(picker).toContain('const today = authoritativeToday();');
    const receiveForm = read('src/components/collections/ReceivePaymentForm.jsx');
    expect(receiveForm).toContain('todayDate={todayInCompanyTimeZone()}');
  });

  it('gives the trigger tokenized press feedback with a reduced-motion fallback', () => {
    expect(picker).toContain('className="upr-date-picker-trigger"');
    expect(css).toMatch(/\.upr-date-picker-trigger \{[\s\S]*?touch-action: manipulation;[\s\S]*?-webkit-tap-highlight-color: transparent;[\s\S]*?transition:[\s\S]*?var\(--motion-duration-fast\)[\s\S]*?var\(--motion-ease-standard\)/);
    expect(css).toContain('.upr-date-picker-trigger:active:not(:disabled) { scale: 0.97; }');
    // The reduce block covers the trigger AND the calendar's inner buttons
    // (month nav, day cells, footer) as one grouped selector.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.upr-date-picker-trigger, \.upr-date-picker-press \{ transition: none; \}[\s\S]*?\.upr-date-picker-press:active:not\(:disabled\) \{ scale: 1; \}/);
    // And the inner buttons have press feedback in the first place.
    expect(css).toMatch(/\.upr-date-picker-press \{[\s\S]*?touch-action: manipulation;[\s\S]*?transition: scale var\(--motion-duration-fast\) var\(--motion-ease-standard\)/);
    expect(picker.match(/className="upr-date-picker-press"/g)?.length).toBeGreaterThanOrEqual(5);
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

  it('returns focus to the trigger on every deliberate exit (WCAG 2.4.3)', () => {
    // Same defect class restoreContextMenuFocus fixed in Conversations.jsx
    // (#661): closing an overlay from the keyboard must not strand focus on
    // <body>. Escape, day select, Today, and Clear all restore; outside-click
    // deliberately does not (the user is moving focus on purpose).
    expect(picker).toContain('ref={triggerRef}');
    expect(picker).toMatch(/const closeAndRestore = \(\) => \{[\s\S]*?triggerRef\.current\?\.focus\?\.\(\);/);
    expect((picker.match(/closeAndRestore\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(picker).toMatch(/e\.key === 'Escape'\) closeAndRestore\(\)/);
    // The landing is visible: the trigger carries a focus-visible ring.
    expect(css).toMatch(/\.upr-date-picker-trigger:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/);
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
