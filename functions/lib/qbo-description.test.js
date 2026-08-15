/**
 * ════════════════════════════════════════════════
 * FILE: qbo-description.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves a long line description is cut into QuickBooks-sized pieces
 *   without losing a single character, and that the continuation row shape
 *   matches what QuickBooks expects for text-only rows.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-description.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Exact reassembly (segments join back to the source) is the contract
 *     that keeps frozen command payloads deterministic across retries.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import {
  QBO_DESCRIPTION_SEGMENT_LIMIT, QBO_LINE_DESCRIPTION_LIMIT, QBO_MAX_LINE_DESCRIPTION,
  qboDescriptionOnlyLine, qboDescriptionSegments,
} from './qbo-description.js';

const reassembled = (segments) => segments.join('');

describe('qboDescriptionSegments', () => {
  it('keeps the segment budget under the provider cap and the ceiling above it', () => {
    expect(QBO_DESCRIPTION_SEGMENT_LIMIT).toBeLessThan(QBO_LINE_DESCRIPTION_LIMIT);
    expect(QBO_MAX_LINE_DESCRIPTION).toBeGreaterThan(QBO_LINE_DESCRIPTION_LIMIT);
  });

  it('returns [] for empty input and a single segment for text within the budget', () => {
    expect(qboDescriptionSegments('')).toEqual([]);
    expect(qboDescriptionSegments(null)).toEqual([]);
    expect(qboDescriptionSegments(undefined)).toEqual([]);
    expect(qboDescriptionSegments('Water mitigation')).toEqual(['Water mitigation']);
    const exact = 'a'.repeat(QBO_DESCRIPTION_SEGMENT_LIMIT);
    expect(qboDescriptionSegments(exact)).toEqual([exact]);
  });

  it('splits a scope-of-work narrative at paragraph boundaries and loses nothing', () => {
    const paragraph = `Scope of Work – Water Damage Mitigation\nCategory 3 Water Loss | Storm/Flood Intrusion\n\n${'All affected drywall will be removed via flood cut. '.repeat(30)}\n`;
    const source = paragraph.repeat(4); // well past one segment
    const segments = qboDescriptionSegments(source);
    expect(segments.length).toBeGreaterThan(1);
    expect(reassembled(segments)).toBe(source);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(QBO_DESCRIPTION_SEGMENT_LIMIT);
      expect(segment.length).toBeGreaterThan(0);
    }
    // Every cut before the tail lands after a newline or space, so each
    // continuation row starts on a word, not mid-word.
    for (const segment of segments.slice(0, -1)) {
      expect(segment).toMatch(/[\n ]$/);
    }
  });

  it('hard-cuts unbroken text (no whitespace anywhere) without dropping characters', () => {
    const source = 'x'.repeat(QBO_DESCRIPTION_SEGMENT_LIMIT * 2 + 7);
    const segments = qboDescriptionSegments(source);
    expect(segments.map((segment) => segment.length)).toEqual([
      QBO_DESCRIPTION_SEGMENT_LIMIT, QBO_DESCRIPTION_SEGMENT_LIMIT, 7,
    ]);
    expect(reassembled(segments)).toBe(source);
  });

  it('ignores a degenerate early boundary instead of emitting tiny segments', () => {
    // The only whitespace sits in the first tenth of the window; a naive cut
    // there would produce hundreds of near-empty segments.
    const source = `note: ${'y'.repeat(QBO_DESCRIPTION_SEGMENT_LIMIT * 2)}`;
    const segments = qboDescriptionSegments(source);
    expect(segments.length).toBe(3);
    expect(segments[0].length).toBe(QBO_DESCRIPTION_SEGMENT_LIMIT);
    expect(reassembled(segments)).toBe(source);
  });

  it('never splits a surrogate pair on a hard cut', () => {
    // The leading 'a' offsets every 2-unit emoji so pairs straddle the raw
    // cut position and the back-off guard has to fire.
    const source = `a${'🙂'.repeat(QBO_DESCRIPTION_SEGMENT_LIMIT)}`;
    const segments = qboDescriptionSegments(source);
    expect(reassembled(segments)).toBe(source);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(QBO_DESCRIPTION_SEGMENT_LIMIT);
      const first = segment.charCodeAt(0);
      const last = segment.charCodeAt(segment.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false); // no leading low surrogate
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false); // no trailing high surrogate
    }
  });

  it('handles a 20,000-character description within the UPR ceiling', () => {
    const source = `${'Garage – flood cut drywall removal per IICRC S500. '.repeat(390)}end`;
    expect(source.length).toBeLessThanOrEqual(QBO_MAX_LINE_DESCRIPTION);
    const segments = qboDescriptionSegments(source);
    expect(reassembled(segments)).toBe(source);
    expect(segments.every((segment) => segment.length <= QBO_DESCRIPTION_SEGMENT_LIMIT)).toBe(true);
  });
});

describe('qboDescriptionOnlyLine', () => {
  it('builds the QuickBooks text-only row shape with no amount field', () => {
    expect(qboDescriptionOnlyLine('continued text')).toEqual({
      DetailType: 'DescriptionOnly', Description: 'continued text', DescriptionLineDetail: {},
    });
    expect(qboDescriptionOnlyLine('x')).not.toHaveProperty('Amount');
  });
});
