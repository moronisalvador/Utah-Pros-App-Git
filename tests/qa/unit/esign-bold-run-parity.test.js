/**
 * ════════════════════════════════════════════════
 * FILE: esign-bold-run-parity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Some words in the documents clients sign are meant to stand out — "not
 *   salvageable", "regardless of whether my insurance carrier approves". The
 *   signing screen and the saved PDF are built by two completely separate
 *   programs, and each has to be told how to find those words. This checks that
 *   both were told the same thing, and that neither will print the raw markup
 *   (the two asterisks) onto a document a customer signs.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  src/pages/SignPage.jsx, functions/api/submit-esign.js,
 *              src/pages/settings/templates/templateData.jsx,
 *              src/lib/customDocSnippets.js
 *   Data:      reads  → application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Why text comparison and not an import: `src/` and `functions/` are
 *     separate bundles (Vite and Cloudflare) and cannot import one another, so
 *     the helper genuinely exists twice. Behaviour is proved once, on the
 *     worker copy, in functions/api/submit-esign.test.js; this file proves the
 *     other copy did not drift from it.
 *   - The defect this exists for was real and shipped: on 2026-08-08 a signed
 *     cat3_removal PDF read "**Category 3 — grossly contaminated**" with the
 *     asterisks visible, while the screen the signer had just read showed it
 *     bold. Static assertions had all passed; only reading a produced PDF
 *     caught it.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBoldRuns   as srcParse,
  stripBoldMarkers as srcStrip,
} from '../../../src/lib/signMarkdown.js';
import {
  parseBoldRuns   as fnParse,
  stripBoldMarkers as fnStrip,
} from '../../../functions/api/submit-esign.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const SIGN_PAGE   = read('src/pages/SignPage.jsx');
const SHARED      = read('src/lib/signMarkdown.js');
const SUBMIT      = read('functions/api/submit-esign.js');
const TEMPLATES   = read('src/pages/settings/templates/templateData.jsx');
const SNIPPETS    = read('src/lib/customDocSnippets.js');

describe('bold-run parsing behaves identically in both bundles', () => {
  /* Real execution of both copies, not a text comparison: the point is that the
     screen and the signed PDF agree, and only running them proves that. */
  const CASES = [
    'plain text with no markup',
    'water is **Category 3** today',
    '**leading** run',
    'trailing **run**',
    'two **bold** runs **here**',
    'a ** dangling marker',
    'nothing **** here',
    'open **here\nand close** there',
    '',
    'THIS WORK **CANNOT** BE UNDONE',
  ];

  it('parseBoldRuns returns the same runs for every case', () => {
    for (const line of CASES) {
      expect(fnParse(line), line).toEqual(srcParse(line));
    }
  });

  it('stripBoldMarkers returns the same text for every case', () => {
    for (const line of CASES) {
      expect(fnStrip(line), line).toBe(srcStrip(line));
    }
  });

  it('both use the newline-excluded expression, so neither bolds across a paragraph', () => {
    for (const [label, src] of [['signMarkdown', SHARED], ['submit-esign', SUBMIT]]) {
      expect(src, label).toContain(String.raw`.split(/(\*\*[^*\n]+\*\*)/g)`);
    }
  });
});

describe('both renderers actually consume the parser', () => {
  /* The guards below moved out of buildPdf's `drawWrapped` closure and into the
     exported pure `layoutWrappedRuns`, which is where the behavioural cover in
     esign-wrapped-layout.test.js can finally reach them. These assertions are
     unchanged in substance — only the slice follows them. They stay because a
     source contract still catches a guard being deleted with its test, and
     they are no longer the only thing standing between a tokenizer defect and
     a signed customer document.

     Sliced by named declaration rather than a character window — an earlier
     version used `[\s\S]{0,900}` and broke the moment a comment was added
     above the call, which is a test failing on documentation, not behaviour. */
  const layoutBody = () => {
    const start = SUBMIT.indexOf('export function layoutWrappedRuns');
    expect(start, 'layoutWrappedRuns must exist and be exported').toBeGreaterThan(-1);
    const end = SUBMIT.indexOf('\nfunction parseMarkdownSections', start);
    expect(end, 'parseMarkdownSections must follow layoutWrappedRuns').toBeGreaterThan(start);
    return SUBMIT.slice(start, end);
  };

  it('the PDF body layout tokenizes through parseBoldRuns', () => {
    // The regression: the wrapper used to split on ' ' and draw every word in
    // fReg, so `**` reached the page as punctuation.
    expect(layoutBody()).toContain('parseBoldRuns(str)');
    expect(SUBMIT).not.toMatch(/const words = pdfSafe\(str\)\.split\(' '\)/);
  });

  it('a word may span font runs, so punctuation after a bold run stays attached', () => {
    // Second defect from the same PDF read: "**without delay**," printed as
    // "without delay ," because each run was tokenized independently.
    const body = layoutBody();

    // A word accumulates across runs and is only ended by real whitespace.
    expect(body).toContain('if (i > 0) current = null;');
    // …including whitespace at a run's OWN EDGES, which the internal split can
    // no longer see because pdfSafe() trims. Without these two, "has **not
    // confirmed**" renders "hasnot" — the third defect in this same function,
    // and the one the first word-grouping fix traded "delay ," for. Both
    // directions are asserted: a leading edge closes the PREVIOUS word, a
    // trailing edge closes the one this run built.
    expect(body).toContain('if (/^\\s/.test(raw)) current = null;');
    expect(body).toContain('if (/\\s$/.test(raw)) current = null;');
    // The edges must come off the RAW run text; reading them after pdfSafe()
    // would always report "no whitespace" and silently restore the bug.
    expect(body).toMatch(/const raw\s*=\s*String\(run\.text/);
    expect(body).toMatch(/const safe\s*=\s*pdfSafe\(raw\)/);
    // Pieces of one word are measured and drawn as a unit.
    expect(body).toMatch(/const wordWidth = \(word\) =>/);
    expect(body).toMatch(/word\.reduce\(/);
    // The old per-token model is gone.
    expect(body).not.toMatch(/words\.push\(\{ text: word, font: runFont \}\)/);
  });

  it('the pdf-lib renderer draws the pure layout rather than a second copy of it', () => {
    // The extraction is only worth anything if drawWrapped consumes it. A
    // re-inlined tokenizer would drift from the one the tests execute.
    const start = SUBMIT.indexOf('const drawWrapped');
    expect(start, 'drawWrapped must exist').toBeGreaterThan(-1);
    const body = SUBMIT.slice(start, SUBMIT.indexOf('\n  const drawParagraphs', start));

    expect(body).toContain('layoutWrappedRuns(str, {');
    expect(body).toMatch(/measure:\s*\(text, bold\) =>/);
    // The layout itself must not have been copied back in beside the drawing.
    expect(body).not.toContain('parseBoldRuns(str)');
    expect(body).not.toContain('current = null;');
  });

  it('the PDF body renderer can draw a bold run at all', () => {
    // A parser with only one font wired in would strip the markers and quietly
    // flatten the emphasis instead of printing it.
    expect(SUBMIT).toMatch(/boldFont = fBold/);
    expect(SUBMIT).toMatch(/\bbold \? boldFont : font/);
  });

  it('the signing screen renders bold runs as <strong>', () => {
    expect(SIGN_PAGE).toContain("from '@/lib/signMarkdown'");
    expect(SIGN_PAGE).toMatch(/parseBoldRuns\(line\)\.map\([\s\S]{0,120}<strong/);
  });

  it('section headings strip their markers on BOTH surfaces', () => {
    // Headings are already drawn bold on each side, so a marker inside one is
    // pure punctuation. Stripping on only one surface is its own divergence.
    expect(SUBMIT).toContain('drawText(stripBoldMarkers(s.heading)');
    expect(SIGN_PAGE).toContain('{stripBoldMarkers(s.heading)}');
    expect(SIGN_PAGE).toContain('{stripBoldMarkers(line.slice(3))}');
  });
});

describe('no signable wording can print a stray marker', () => {
  /* An odd marker count on a line means at least one is unbalanced, and an
     unbalanced marker prints literally on both surfaces by design. That is the
     right fallback, but it must never be reached by wording we ship. */
  const linesWithMarkers = (src) => src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes('**'))
    // The JSDoc banner and the parser's own comments are not template wording.
    .filter(({ line }) => !/^\s*(\/\*|\*|\/\/)/.test(line));

  it('every template body has balanced bold markers', () => {
    for (const { line, n } of linesWithMarkers(TEMPLATES)) {
      const count = (line.match(/\*\*/g) || []).length;
      expect(count % 2, `templateData.jsx:${n} has an odd number of ** markers`).toBe(0);
    }
  });

  it('every custom-document skeleton has balanced bold markers', () => {
    for (const { line, n } of linesWithMarkers(SNIPPETS)) {
      const count = (line.match(/\*\*/g) || []).length;
      expect(count % 2, `customDocSnippets.js:${n} has an odd number of ** markers`).toBe(0);
    }
  });

  it('no template marker pair is empty or spans a newline', () => {
    // `****` and a pair split across lines both fall through as literal text.
    for (const src of [TEMPLATES, SNIPPETS]) {
      expect(src).not.toContain('****');
      for (const { line } of linesWithMarkers(src)) {
        const opened = (line.match(/\*\*/g) || []).length;
        if (opened >= 2) {
          expect(line).toMatch(/\*\*[^*\n]+\*\*/);
        }
      }
    }
  });
});
