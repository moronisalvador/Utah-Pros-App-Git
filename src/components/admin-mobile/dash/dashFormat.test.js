/**
 * ════════════════════════════════════════════════
 * FILE: dashFormat.test.js  (Admin Mobile — dashboard shaper math)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the number-crunching behind the mobile dashboard to the same answers the
 *   office Overview produces: dollar formatting, the period date windows, the
 *   up/down change rule, the revenue-by-division split, the accounts-receivable
 *   buckets, and the jobs-sold count for a period. If someone later changes this
 *   math, these tests fail loudly so the mobile numbers can't silently drift from
 *   the desktop.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./dashFormat
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  fmtK, fmtFull, periodBoundsISO, computeDelta,
  shapeMoneySplit, shapeCollections, shapeJobsClosed,
} from './dashFormat';

describe('formatters', () => {
  it('fmtK abbreviates thousands, fmtFull spells them out', () => {
    expect(fmtK(40900)).toBe('$40.9K');
    expect(fmtK(750)).toBe('$750');
    expect(fmtFull(40858)).toBe('$40,858');
    expect(fmtFull(0)).toBe('$0');
  });
});

describe('periodBoundsISO', () => {
  it('MTD starts on the 1st of the current month and ends today', () => {
    const { p_start, p_end } = periodBoundsISO('mtd');
    expect(p_start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p_start <= p_end).toBe(true);
  });
  it('YTD starts on Jan 1', () => {
    expect(periodBoundsISO('ytd').p_start).toMatch(/^\d{4}-01-01$/);
  });
  it('QTD starts on the first day of a quarter month (Jan/Apr/Jul/Oct)', () => {
    expect(periodBoundsISO('qtd').p_start).toMatch(/^\d{4}-(01|04|07|10)-01$/);
  });
});

describe('computeDelta', () => {
  it('is null without a prior-period basis', () => {
    expect(computeDelta(100, 0)).toBeNull();
    expect(computeDelta(100, null)).toBeNull();
  });
  it('rounds the percent and picks the direction', () => {
    expect(computeDelta(120, 100)).toEqual({ dir: 'up', pct: 20 });
    expect(computeDelta(88, 100)).toEqual({ dir: 'down', pct: 12 });
  });
});

describe('shapeMoneySplit', () => {
  it('builds per-division segments, a dropped-zero legend, and a delta', () => {
    const out = shapeMoneySplit({
      total: 100000, prev_total: 80000,
      segments: [{ key: 'mitigation', value: 60000 }, { key: 'reconstruction', value: 40000 }],
    });
    expect(out.totalLabel).toBe('$100,000');
    expect(out.delta).toEqual({ dir: 'up', pct: 25 });
    const miti = out.segments.find((s) => s.key === 'mitigation');
    expect(Math.round(miti.pct)).toBe(60);
    // legend excludes the zero-value divisions (remodeling/mold/contents here)
    expect(out.legend.map((s) => s.key)).toEqual(['mitigation', 'reconstruction']);
  });
  it('degrades safely with no data', () => {
    const out = shapeMoneySplit(null);
    expect(out.total).toBe(0);
    expect(out.legend).toEqual([]);
    expect(out.delta).toBeNull();
  });
});

describe('shapeCollections (A/R buckets)', () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = (offsetDays) => {
    const d = new Date(today); d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  it('splits balances into past-due / due / unsent and computes DSO', () => {
    const out = shapeCollections([
      { balance: 500, sent_at: '2026-01-01', due_date: iso(-5), invoice_date: iso(-40) }, // overdue
      { balance: 300, qbo_invoice_id: 'x', due_date: iso(10), invoice_date: iso(-10) },    // due (future)
      { balance: 200, status: 'draft', invoice_date: iso(-20) },                            // unsent
      { balance: 0, sent_at: '2026-01-01', due_date: iso(-5) },                             // paid → ignored
    ]);
    const by = Object.fromEntries(out.bars.map((b) => [b.key, b.value]));
    expect(by.pastDue).toBe(500);
    expect(by.due).toBe(300);
    expect(by.unsent).toBe(200);
    expect(out.dso).toBeGreaterThan(0);
  });
});

describe('shapeJobsClosed', () => {
  it('counts only sales inside the period window and builds a sparkline', () => {
    const now = new Date('2026-07-15T12:00:00Z').getTime();
    const day = 86400000;
    const rows = [
      { sale_date: new Date(now - 2 * day).toISOString() },  // this month
      { sale_date: new Date(now - 5 * day).toISOString() },  // this month
      { sale_date: '2026-05-01T00:00:00Z' },                 // before MTD
    ];
    const out = shapeJobsClosed(rows, 'mtd', now);
    expect(out.count).toBe(2);
    expect(typeof out.line).toBe('string');
    expect(out.area.endsWith('234,58 0,58')).toBe(true);
  });
});
