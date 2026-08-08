/**
 * ════════════════════════════════════════════════
 * FILE: signMarkdown.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The documents clients sign use a tiny bit of markup to make certain phrases
 *   stand out — "not salvageable", "regardless of whether my insurance carrier
 *   approves". The markup is two asterisks on each side of the words. This file
 *   finds those phrases so the page and the saved PDF can both show them in
 *   bold, instead of printing the asterisks as if they were punctuation.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none — dependency-free on purpose, so the signing page and any
 *              other surface can use it without dragging code between bundles.
 *   Data:      reads  → nothing (pure functions over a string)
 *              writes → nothing
 *
 * NOTES / GOTCHAS:
 *   - A SECOND copy lives in functions/api/submit-esign.js. That is not an
 *     oversight: `functions/` is a separate Cloudflare bundle and cannot import
 *     from `src/`. The signed PDF is built there, so if the two disagree the
 *     customer reads one document and signs another — which is exactly the
 *     defect this file was created to fix (found 2026-08-08 on a real stored
 *     PDF that printed "**Category 3 — grossly contaminated**" literally).
 *     tests/qa/unit/esign-bold-run-parity.test.js pins the two together.
 *   - Unbalanced or nested markers deliberately match nothing and survive as
 *     literal text. Swallowing to end-of-line would drop clauses out of a signed
 *     authorization, which is far worse than showing a stray asterisk.
 *   - Newlines are excluded from the match because the PDF side joins wrapped
 *     source lines into one block while the screen splits on '\n' first.
 *     Excluding '\n' is what keeps those two agreeing.
 * ════════════════════════════════════════════════
 */

/** Split a line into {text, bold} runs. */
export function parseBoldRuns(str) {
  if (!str) return [];
  return String(str)
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map(part => (part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? { text: part.slice(2, -2), bold: true }
      : { text: part, bold: false }));
}

/** Headings already render bold on both surfaces, so a marker inside one would
    only print as punctuation. */
export function stripBoldMarkers(str) {
  return parseBoldRuns(str).map(r => r.text).join('');
}
