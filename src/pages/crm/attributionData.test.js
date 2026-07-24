/**
 * ════════════════════════════════════════════════
 * FILE: attributionData.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves rangeToDates() turns a range choice into the right start/end
 *   Denver dates before any RPC is called with them, including custom ranges
 *   and daylight-saving boundaries. It also proves the Overview requests the
 *   canonical company-wide-versus-traced sales summary for that same range
 *   and rejects missing or malformed business totals instead of displaying
 *   them as legitimate zeroes.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./attributionData.js (date, RPC and validation helpers)
 *
 * NOTES / GOTCHAS:
 *   - Preset windows are inclusive: "7 days" means the Denver end date plus
 *     the six preceding Denver calendar dates.
 *   - Missing/malformed summary fields must throw so the page renders its
 *     ErrorState; a zero is valid only when the RPC explicitly returned it.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import {
  denverDateStartMs,
  fetchCrmSalesSummary,
  filterLeadsByDenverRange,
  normalizeCrmSalesSummary,
  rangeToDates,
} from './attributionData';

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

  it('preset windows are inclusive and use the Denver date after UTC rollover (MDT)', () => {
    const now = new Date('2026-07-24T05:30:00Z'); // 11:30 PM July 23 in Denver
    expect(rangeToDates('7d', undefined, now))
      .toEqual({ start: '2026-07-17', end: '2026-07-23' });
    expect(rangeToDates('30d', undefined, now))
      .toEqual({ start: '2026-06-24', end: '2026-07-23' });
  });

  it('uses the Denver date across the winter MST boundary too', () => {
    const now = new Date('2026-01-15T06:30:00Z'); // 11:30 PM January 14 in Denver
    expect(rangeToDates('7d', undefined, now))
      .toEqual({ start: '2026-01-08', end: '2026-01-14' });
  });

  it('an unknown key falls back to unbounded, same as "all"', () => {
    expect(rangeToDates('not-a-real-key')).toEqual({ start: null, end: null });
  });
});

describe('Denver reporting-window filtering', () => {
  it('uses MDT midnight boundaries instead of parsing bare dates as UTC', () => {
    expect(denverDateStartMs('2026-07-17'))
      .toBe(Date.parse('2026-07-17T06:00:00Z'));

    const leads = [
      { id: 'before', occurred_at: '2026-07-17T05:59:59Z' },
      { id: 'first', occurred_at: '2026-07-17T06:00:00Z' },
      { id: 'last', occurred_at: '2026-07-24T05:59:59Z' },
      { id: 'after', occurred_at: '2026-07-24T06:00:00Z' },
    ];

    expect(filterLeadsByDenverRange(leads, '2026-07-17', '2026-07-23')
      .map(({ id }) => id)).toEqual(['first', 'last']);
  });

  it('uses MST midnight boundaries and preserves a DST-short calendar day', () => {
    expect(denverDateStartMs('2026-01-08'))
      .toBe(Date.parse('2026-01-08T07:00:00Z'));
    expect(denverDateStartMs('2026-03-08'))
      .toBe(Date.parse('2026-03-08T07:00:00Z'));
    expect(denverDateStartMs('2026-03-09'))
      .toBe(Date.parse('2026-03-09T06:00:00Z'));

    const leads = [
      { id: 'before', occurred_at: '2026-01-08T06:59:59Z' },
      { id: 'first', occurred_at: '2026-01-08T07:00:00Z' },
      { id: 'last', occurred_at: '2026-01-15T06:59:59Z' },
      { id: 'after', occurred_at: '2026-01-15T07:00:00Z' },
      { id: 'invalid', occurred_at: 'not-a-date' },
    ];

    expect(filterLeadsByDenverRange(leads, '2026-01-08', '2026-01-14')
      .map(({ id }) => id)).toEqual(['first', 'last']);
  });
});

describe('CRM sales summary — traced headline plus company-wide context', () => {
  it('calls the canonical RPC with the same date window and normalizes PostgREST numbers', async () => {
    const rpc = vi.fn().mockResolvedValue({
      total_won: '104',
      total_revenue: '628000.25',
      traced_won: '8',
      traced_revenue: '18752.35',
    });

    await expect(fetchCrmSalesSummary({ rpc }, '2026-07-01', '2026-07-22')).resolves.toEqual({
      total_won: 104,
      total_revenue: 628000.25,
      traced_won: 8,
      traced_revenue: 18752.35,
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('get_crm_sales_summary', {
      p_start_date: '2026-07-01',
      p_end_date: '2026-07-22',
    });
  });

  it('keeps an all-time window unbounded while preserving explicit zeroes', async () => {
    const zeroSummary = {
      total_won: 0,
      total_revenue: 0,
      traced_won: 0,
      traced_revenue: 0,
    };
    const rpc = vi.fn().mockResolvedValue(zeroSummary);

    await expect(fetchCrmSalesSummary({ rpc }, null, null)).resolves.toEqual(zeroSummary);
    expect(rpc).toHaveBeenCalledWith('get_crm_sales_summary', {
      p_start_date: null,
      p_end_date: null,
    });
  });

  it('rejects a missing RPC payload instead of displaying a false zero', async () => {
    const rpc = vi.fn().mockResolvedValue(null);

    await expect(fetchCrmSalesSummary({ rpc }, null, null))
      .rejects.toThrow('Invalid CRM sales summary');
  });

  it('rejects malformed fields before they can become NaN in a metric card', () => {
    expect(() => normalizeCrmSalesSummary({
      total_won: 'not-a-number',
      total_revenue: undefined,
      traced_won: Number.NaN,
      traced_revenue: '',
    })).toThrow('Invalid CRM sales summary');
  });

  it.each([
    false,
    true,
    [],
    {},
    '   ',
  ])('rejects coercible non-numeric total_won value: %j', (totalWon) => {
    expect(() => normalizeCrmSalesSummary({
      total_won: totalWon,
      total_revenue: 0,
      traced_won: 0,
      traced_revenue: 0,
    })).toThrow('Invalid CRM sales summary');
  });
});
