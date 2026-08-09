/**
 * ════════════════════════════════════════════════
 * FILE: esign-wrapped-layout.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the code that lays out the body text of a signed customer document and
 *   reads back the lines it would print. Every case here is a sentence that
 *   actually appeared wrong on a document a customer signed: asterisks left
 *   showing, a space in front of a comma, two words run together with no space.
 *   This checks what the code PRODUCES, not what it says.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/submit-esign.js (layoutWrappedRuns)
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - No pdf-lib. Widths come from an injected stub, `(t) => t.length * 5`, so
 *     wrapping is deterministic and arithmetic-checkable by hand: at
 *     maxWidth 120 a line holds 24 characters including its spaces.
 *   - Three defects reached signed legal documents while this logic was an
 *     unreachable closure inside buildPdf and its only cover was tests that
 *     read the file as text (b57c7365, 1b53ae11, d0d38278). d0d38278 was
 *     introduced BY the fix for 1b53ae11 and was live in production for hours.
 *     That is why the plain→bold and bold→plain transitions are separate,
 *     separately named cases below: 1b53ae11 was verified only in the
 *     direction it repaired.
 *   - The source-contract assertions in esign-bold-run-parity.test.js are kept
 *     and still catch a guard being deleted. They are no longer the only cover.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

import { layoutWrappedRuns } from '../../../functions/api/submit-esign.js';

/* 5pt per character, in either weight. Bold and regular measure the same on
   purpose: a width difference would hide a font-run bug behind a wrap. */
const MEASURE = (text) => text.length * 5;

// Wide enough that nothing wraps unless a case asks it to.
const NO_WRAP = 100_000;

const layout = (str, maxWidth = NO_WRAP) =>
  layoutWrappedRuns(str, { measure: MEASURE, maxWidth, size: 9.5 });

const linesOf = (str, maxWidth = NO_WRAP) => layout(str, maxWidth).map(l => l.text);

const oneLine = (str) => {
  const lines = linesOf(str);
  expect(lines, `${str} should fit on one line`).toHaveLength(1);
  return lines[0];
};

describe('layoutWrappedRuns — the three defects that reached signed documents', () => {
  it('b57c7365: prints no literal asterisk anywhere on the page', () => {
    // A real stored cat3_removal PDF read "**Category 3 — grossly
    // contaminated**" with the markers visible, while the screen the signer had
    // just read showed it bold.
    const lines = linesOf('water is **Category 3** today');

    expect(lines).toEqual(['water is Category 3 today']);
    for (const line of lines) expect(line).not.toContain('*');
  });

  it('1b53ae11: keeps punctuation tight when a bold run ends before it', () => {
    // "disposed of **without delay**, both" printed as "without delay , both":
    // the comma opened the next run, so tokenizing runs independently made it a
    // word of its own and gave it a leading space.
    const line = oneLine('disposed of **without delay**, both');

    expect(line).toBe('disposed of without delay, both');
    expect(line).toContain('without delay, both');
    expect(line).not.toContain('delay ,');
  });

  it('d0d38278: keeps the space around a bold run that the trim would eat', () => {
    // Introduced by the fix above and live in production for hours on every
    // situational authorization: "hasnot been confirmedby any insurance
    // carrier". pdfSafe() trims, so a run's own leading/trailing space is gone
    // before the split can see it.
    const line = oneLine('has **not been confirmed** by');

    expect(line).toBe('has not been confirmed by');
    expect(line).not.toContain('hasnot');
    expect(line).not.toContain('confirmedby');
  });

  it('d0d38278: the same, on the wording it was actually found in', () => {
    const line = oneLine('the work authorized **above** regardless');

    expect(line).toBe('the work authorized above regardless');
    expect(line).not.toContain('aboveregardless');
    expect(line).not.toContain('authorizedabove');
  });
});

/* ─── SECTION: both transition directions, named separately ──────────────────
   The reason d0d38278 slipped a "verified" fix. `**without delay**,` runs
   bold→regular, which the fix repaired and which was the direction it was
   checked in. Only regular→bold loses the space, because pdfSafe() trims the
   trailing space off "has " and the split then yields no empty tail. Neither
   direction is allowed to stand in for the other. */
describe('layoutWrappedRuns — run transitions', () => {
  it('plain → **bold**: the space BEFORE a bold run survives', () => {
    expect(oneLine('has **not** confirmed')).toBe('has not confirmed');
    expect(oneLine('approved by **the carrier**')).toBe('approved by the carrier');
    expect(oneLine('a **b**')).toBe('a b');
  });

  it('**bold** → plain: the space AFTER a bold run survives', () => {
    expect(oneLine('**not** confirmed yet')).toBe('not confirmed yet');
    expect(oneLine('**the carrier** approved it')).toBe('the carrier approved it');
    expect(oneLine('**a** b')).toBe('a b');
  });

  it('a transition with NO source whitespace joins into one word, both ways', () => {
    // The counterpart rule: a run boundary alone never separates words, or the
    // comma in "delay," walks away again.
    expect(oneLine('(**Category 3**)')).toBe('(Category 3)');
    expect(oneLine('a**b**c')).toBe('abc');
    expect(oneLine('**delay**,')).toBe('delay,');
  });

  it('a bold run at the very start of a line', () => {
    expect(oneLine('**All** amounts are due on completion'))
      .toBe('All amounts are due on completion');
    expect(layout('**All** amounts')[0].words[0].pieces).toEqual([
      { text: 'All', bold: true },
    ]);
  });

  it('a bold run at the very end of a line', () => {
    expect(oneLine('Payment is due **in full**')).toBe('Payment is due in full');
    const last = layout('Payment is due **in full**')[0].words.at(-1);
    expect(last.pieces).toEqual([{ text: 'full', bold: true }]);
    expect(last.gapAfter, 'the last word of a line carries no trailing gap').toBe(0);
  });

  it('several spaces in a row still separate exactly one word from the next', () => {
    expect(oneLine('a  **b**')).toBe('a b');
    expect(oneLine('a  b')).toBe('a b');
  });
});

/* ─── SECTION: wrapping ──────────────────────────────────────────────────────
   With MEASURE at 5pt/char, maxWidth 120 holds 24 characters including spaces,
   so every expectation below is checkable by counting. */
describe('layoutWrappedRuns — wrapping', () => {
  it('breaks a sentence into lines at word boundaries', () => {
    const lines = linesOf(
      'I authorize the removal of all affected materials without delay',
      120,
    );

    expect(lines).toEqual([
      'I authorize the removal',
      'of all affected',
      'materials without delay',
    ]);
    for (const line of lines) {
      expect(MEASURE(line), line).toBeLessThanOrEqual(120);
    }
  });

  it('a word long enough to force a wrap mid-sentence starts its own line', () => {
    // 110 holds 22 characters. "sign the" is 8; adding " acknowledgement" would
    // make 24, so the long word moves down and takes "now" with it.
    const lines = linesOf('sign the acknowledgement now', 110);

    expect(lines).toEqual(['sign the', 'acknowledgement now']);
    // The long word did not get chopped or dropped.
    expect(lines.join(' ')).toBe('sign the acknowledgement now');
    for (const line of lines) expect(MEASURE(line), line).toBeLessThanOrEqual(110);
  });

  it('a single word wider than the line is emitted whole rather than lost', () => {
    // No hyphenation exists here; overflowing is the current behaviour and a
    // dropped word on a signed document would be far worse than an overflow.
    expect(linesOf('supercalifragilistic', 20)).toEqual(['supercalifragilistic']);
  });

  it('a word split across font runs is never broken by a wrap', () => {
    // "delay," is ONE word whose comma is regular and whose text is bold. A
    // wrap must not fall between them.
    const lines = linesOf('disposed of the water **without delay**, entirely', 120);

    for (const line of lines) {
      expect(line).not.toMatch(/^,/);
      expect(line).not.toMatch(/\s,/);
    }
    expect(lines.join(' ')).toBe('disposed of the water without delay, entirely');
  });

  it('wrapping loses no words and inserts no double spaces', () => {
    const source = 'I acknowledge that **Category 3** water is grossly '
      + 'contaminated and that the affected materials are **not salvageable**, '
      + 'and I authorize their removal.';

    for (const maxWidth of [60, 120, 240, 480]) {
      const lines = linesOf(source, maxWidth);
      expect(lines.join(' '), `maxWidth ${maxWidth}`)
        .toBe(source.replace(/\*\*/g, ''));
      for (const line of lines) {
        expect(line, `maxWidth ${maxWidth}`).not.toContain('  ');
        expect(line, `maxWidth ${maxWidth}`).not.toContain('*');
      }
    }
  });
});

/* ─── SECTION: what the caller needs in order to draw it ─────────────────── */
describe('layoutWrappedRuns — the drawable shape', () => {
  it('marks each piece with the weight it must be drawn in', () => {
    const [line] = layout('water is **Category 3** today');

    expect(line.words.map(w => w.pieces)).toEqual([
      [{ text: 'water',    bold: false }],
      [{ text: 'is',       bold: false }],
      [{ text: 'Category', bold: true  }],
      [{ text: '3',        bold: true  }],
      [{ text: 'today',    bold: false }],
    ]);
  });

  it('splits a mixed-weight word into pieces with no gap between them', () => {
    const [line] = layout('**delay**, both');
    const [mixed] = line.words;

    // One word, two weights — this is what keeps the comma against "delay".
    expect(mixed.pieces).toEqual([
      { text: 'delay', bold: true  },
      { text: ',',     bold: false },
    ]);
    expect(mixed.gapAfter, 'a gap follows a word, never a piece').toBe(MEASURE(' '));
  });

  it('measures the inter-word gap in the weight of the preceding word', () => {
    // Pinning the rule, not the number: the drawn line drifts from the measured
    // one if the gap takes a different font, and a bold run overruns the margin.
    const widths = [];
    layoutWrappedRuns('**bold** then plain', {
      measure: (text, bold) => { if (text === ' ') widths.push(bold); return text.length * 5; },
      maxWidth: NO_WRAP,
      size: 9.5,
    });

    expect(widths[0], 'the gap after a bold word is measured bold').toBe(true);
    expect(widths).toContain(false);
  });

  it('forwards the requested size to the injected measurer', () => {
    const seen = [];
    layoutWrappedRuns('one two', {
      measure: (text, bold, size) => { seen.push(size); return text.length * 5; },
      maxWidth: NO_WRAP,
      size: 9.5,
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([9.5]));
  });
});

describe('layoutWrappedRuns — empty and degenerate input', () => {
  it('returns no lines for nothing to draw', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(layout(empty), String(empty)).toEqual([]);
    }
  });

  it('leaves an unbalanced or empty marker pair as literal text', () => {
    // Matching the signing screen exactly. Swallowing to end-of-line would drop
    // clauses out of an authorization; printing the markers is the safer half
    // of a fallback that shipped wording must never reach anyway.
    expect(oneLine('a ** dangling marker')).toBe('a ** dangling marker');
    expect(oneLine('nothing **** here')).toBe('nothing **** here');
  });

  it('flattens an embedded newline instead of throwing, like every other field', () => {
    // pdfSafe() collapses it; pdf-lib's drawText would hard-error on it and
    // take down the whole document, not just this paragraph.
    expect(oneLine('signed\nand delivered')).toBe('signed and delivered');
  });
});
