/**
 * ════════════════════════════════════════════════
 * FILE: attributionData.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves rangeToDates() turns a range choice into the right start/end
 *   dates before any RPC is called with it — especially the new 'custom'
 *   mode, which reads a picked From/To pair instead of doing day-math. A
 *   wrong bound here would silently query the wrong window on every CRM
 *   dashboard page (Overview, Attribution, Reports).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./attributionData.js (the pure function under test)
 *
 * NOTES / GOTCHAS:
 *   - The day-math branches (7d/30d/90d/12mo/all) are exercised only for shape
 *     (a real Date() call inside would make an exact-date assertion flaky);
 *     'custom' is fully deterministic and asserted exactly.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { rangeToDates } from './attributionData';

describe('rangeToDates', () => {
  it('custom: reads both picked dates verbatim', () => {
    expect(rangeToDates('custom', { start: '2026-06-01', end: '2026-06-30' }))
      .toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });

  it('custom: an empty side stays unbounded (null), not a blank string', () => {
    expect(rangeToDates('custom', { start: '2026-06-01', end: '' }))
      .toEqual({ start: '2026-06-01', end: null });
    expect(rangeToDates('custom', { start: '', end: '2026-06-30' }))
      .toEqual({ start: null, end: '2026-06-30' });
  });

  it('custom: no customRange at all → both sides unbounded (guards a missing arg)', () => {
    expect(rangeToDates('custom')).toEqual({ start: null, end: null });
    expect(rangeToDates('custom', {})).toEqual({ start: null, end: null });
    expect(rangeToDates('custom', undefined)).toEqual({ start: null, end: null });
  });

  it('all: both sides null (no day-math, no customRange dependency)', () => {
    expect(rangeToDates('all')).toEqual({ start: null, end: null });
    // A stray customRange must never leak into a non-custom key.
    expect(rangeToDates('all', { start: '2026-01-01', end: '2026-01-31' }))
      .toEqual({ start: null, end: null });
  });

  it('7d/30d/90d/12mo: both sides are real YYYY-MM-DD strings, end >= start', () => {
    for (const key of ['7d', '30d', '90d', '12mo']) {
      const { start, end } = rangeToDates(key);
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(start).getTime()).toBeLessThanOrEqual(new Date(end).getTime());
    }
  });

  it('an unknown key falls back to unbounded, same as "all"', () => {
    expect(rangeToDates('not-a-real-key')).toEqual({ start: null, end: null });
  });
});
