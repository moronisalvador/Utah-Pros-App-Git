// Shared text sanitizer for every pdf-lib-based worker (demo-sheet-pdf.js,
// generate-water-loss-report.js, submit-esign.js — see each file's own
// header for why they're siblings, not shared code, everywhere else).
//
// WHAT THIS DOES: pdf-lib's StandardFonts (Helvetica/Courier/etc.) use
// WinAnsi (CP1252) encoding. drawText()/widthOfTextAtSize() throw a hard
// error the instant they hit a single character the font can't encode —
// an embedded newline (a tech/customer pressing Enter in a text field), an
// emoji, or any script outside Latin-1. One bad character anywhere in a
// document takes down the ENTIRE PDF, not just that field — this is exactly
// how a real production scope-sheet PDF silently failed to attach
// (2026-07-21, root-caused via worker_runs telemetry to a note field
// containing "\n").
//
// pdfSafe() flattens embedded whitespace (readable, not a guess), then
// winAnsiSafe() is the real backstop: it checks every character against
// pdf-lib's own WinAnsi table (not a hand-picked "unsafe ranges" guess,
// which is exactly what missed the newline case in the first place) and
// swaps anything genuinely unencodable for '?' — one glyph degrades
// instead of the whole document failing.
//
// USAGE: call pdfSafe(str) on every string before it reaches
// curPage.drawText() or font.widthOfTextAtSize(). Cheapest to apply once,
// inside each file's own internal drawText(...) helper, rather than at
// every call site — see demo-sheet-pdf.js for the reference wiring.

import { Encodings } from '@pdf-lib/standard-fonts';

export function winAnsiSafe(s) {
  let out = '';
  for (const ch of String(s)) {
    out += Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)) ? ch : '?';
  }
  return out;
}

export function pdfSafe(s) {
  return winAnsiSafe(
    String(s == null ? '' : s)
      // Emoji/pictographs are also WinAnsi-unencodable, so winAnsiSafe() below
      // would already turn them into '?' — stripped instead, cleaner output
      // than a run of question marks where an icon used to be.
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
      // drawText renders one line at a time — an embedded newline/tab/CR
      // throws mid-encode, not a display glitch. Flatten to a single space
      // rather than attempt mid-value wrapping/pagination.
      .replace(/[\t\n\r\v\f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
  );
}

// Recursively applies pdfSafe() to every string in a plain object/array tree
// (a render "model" built from user data) — mirrors demo-sheet-pdf.js's
// original deepPdfSafe so the whole model is sanitized up front, before any
// widthOfTextAtSize/drawText call ever sees it.
export function deepPdfSafe(v) {
  if (typeof v === 'string') return pdfSafe(v);
  if (Array.isArray(v)) return v.map(deepPdfSafe);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepPdfSafe(v[k]);
    return out;
  }
  return v;
}
