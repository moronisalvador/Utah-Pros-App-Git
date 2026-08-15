/**
 * ════════════════════════════════════════════════
 * FILE: qbo-description.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   QuickBooks only accepts 4,000 characters of description on one document
 *   line, but a real scope of work (the long write-up on an estimate or
 *   invoice line) is often longer. This file cuts a long description into
 *   pieces that each fit, so the priced line carries the first piece and the
 *   rest flows onto text-only continuation rows underneath it. The customer
 *   still reads the whole write-up; QuickBooks never sees an oversized field.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - Segments concatenate back to the source text exactly — nothing is
 *     trimmed or dropped, so the frozen command payload stays deterministic
 *     and an exact retry rebuilds byte-identical segments.
 *   - The per-segment budget (3,800) deliberately sits under the documented
 *     4,000-character cap as margin in case the provider counts bytes rather
 *     than UTF-16 units on multi-byte text (en dashes, accents, emoji).
 *   - DescriptionOnly is the line type QuickBooks itself creates for a
 *     description-only row; it carries no Amount, so document totals are
 *     untouched by however many continuation rows the text needs.
 * ════════════════════════════════════════════════
 */

// Provider-documented cap on one Line.Description (QuickBooks Online API).
export const QBO_LINE_DESCRIPTION_LIMIT = 4000;
// Our per-segment budget — under the cap on purpose (see NOTES).
export const QBO_DESCRIPTION_SEGMENT_LIMIT = 3800;
// UPR's ceiling for one line item's whole description (~5 provider rows).
// Anything longer is almost certainly a paste mistake, and an unbounded
// description would bloat the frozen command payload the retry path stores.
export const QBO_MAX_LINE_DESCRIPTION = 20000;

// A boundary found in the first tenth of the window would produce a
// needlessly tiny segment (and many more of them) — hard-cut instead.
const BOUNDARY_FLOOR = Math.floor(QBO_DESCRIPTION_SEGMENT_LIMIT / 10);

/**
 * Split text into segments of at most QBO_DESCRIPTION_SEGMENT_LIMIT UTF-16
 * units. Cuts prefer the last newline in the window, then the last space, so
 * continuation rows start on natural boundaries; the boundary character stays
 * with the earlier segment and the pieces concatenate exactly to the source.
 * Returns [] for empty input.
 */
export function qboDescriptionSegments(text) {
  const source = String(text ?? '');
  if (!source) return [];
  if (source.length <= QBO_DESCRIPTION_SEGMENT_LIMIT) return [source];
  const segments = [];
  let rest = source;
  while (rest.length > QBO_DESCRIPTION_SEGMENT_LIMIT) {
    const window = rest.slice(0, QBO_DESCRIPTION_SEGMENT_LIMIT);
    const newline = window.lastIndexOf('\n');
    const space = window.lastIndexOf(' ');
    let cut = newline > BOUNDARY_FLOOR ? newline + 1
      : space > BOUNDARY_FLOOR ? space + 1
        : QBO_DESCRIPTION_SEGMENT_LIMIT;
    // Never split a surrogate pair on a hard cut — back off one unit so an
    // emoji or other astral character stays whole in one segment.
    const edge = rest.charCodeAt(cut - 1);
    if (edge >= 0xd800 && edge <= 0xdbff) cut -= 1;
    segments.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) segments.push(rest);
  return segments;
}

/** The QuickBooks text-only continuation row for one overflow segment. */
export function qboDescriptionOnlyLine(segment) {
  return { DetailType: 'DescriptionOnly', Description: segment, DescriptionLineDetail: {} };
}
