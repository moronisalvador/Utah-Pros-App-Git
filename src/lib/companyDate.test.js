/**
 * PICK-02 (half two) — company-time calendar dates.
 *
 * `new Date().toISOString().split('T')[0]` slices the UTC date, and Mountain
 * Time is 6-7 hours behind UTC, so from ~6 p.m. local onward it returns
 * TOMORROW. That is why a technician creating an appointment in the evening got
 * tomorrow's date on it.
 *
 * The evening case is the whole point, so it is asserted against the broken
 * expression directly rather than against a hardcoded string.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  COMPANY_TIME_ZONE,
  companyDateOf,
  todayInCompanyTimeZone,
} from './companyDate.js';

const utcSliced = (d) => new Date(d).toISOString().split('T')[0];

afterEach(() => { vi.useRealTimers(); });

function at(iso) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('companyDate', () => {
  it('uses the company timezone of record', () => {
    expect(COMPANY_TIME_ZONE).toBe('America/Denver');
  });

  it('returns yesterday-in-UTC terms during a Mountain evening', () => {
    // 02:30 UTC on the 27th === 20:30 MDT on the 26th.
    const instant = '2026-07-27T02:30:00Z';
    at(instant);
    expect(todayInCompanyTimeZone()).toBe('2026-07-26');
    // The exact defect: the old expression disagrees, by one day.
    expect(utcSliced(instant)).toBe('2026-07-27');
    expect(todayInCompanyTimeZone()).not.toBe(utcSliced(instant));
  });

  it('agrees with the UTC slice during Mountain working hours', () => {
    // 18:00 UTC === noon MDT — same calendar day either way. The fix must not
    // shift dates for the majority case.
    const instant = '2026-07-27T18:00:00Z';
    at(instant);
    expect(todayInCompanyTimeZone()).toBe('2026-07-27');
    expect(todayInCompanyTimeZone()).toBe(utcSliced(instant));
  });

  it('rolls at Mountain midnight, not UTC midnight', () => {
    at('2026-07-27T05:59:00Z');        // 23:59 MDT on the 26th
    expect(todayInCompanyTimeZone()).toBe('2026-07-26');
    at('2026-07-27T06:01:00Z');        // 00:01 MDT on the 27th
    expect(todayInCompanyTimeZone()).toBe('2026-07-27');
  });

  it('handles the spring-forward boundary', () => {
    // 2026-03-08 02:00 MST -> 03:00 MDT. 08:00 UTC is 01:00 MST, still the 8th.
    at('2026-03-08T08:00:00Z');
    expect(todayInCompanyTimeZone()).toBe('2026-03-08');
    at('2026-03-08T05:00:00Z');        // 22:00 MST on the 7th
    expect(todayInCompanyTimeZone()).toBe('2026-03-07');
  });

  it('handles the fall-back boundary', () => {
    // 2026-11-01 02:00 MDT -> 01:00 MST. 07:00 UTC is 01:00 MDT, still the 1st.
    at('2026-11-01T07:00:00Z');
    expect(todayInCompanyTimeZone()).toBe('2026-11-01');
    at('2026-11-01T05:00:00Z');        // 23:00 MDT on Oct 31
    expect(todayInCompanyTimeZone()).toBe('2026-10-31');
  });

  it('handles a leap day', () => {
    at('2028-02-29T18:00:00Z');
    expect(todayInCompanyTimeZone()).toBe('2028-02-29');
  });

  it('zero-pads single-digit months and days', () => {
    at('2026-01-05T18:00:00Z');
    expect(todayInCompanyTimeZone()).toBe('2026-01-05');
    expect(todayInCompanyTimeZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('converts an arbitrary instant, not just now', () => {
    expect(companyDateOf(new Date('2026-07-27T02:30:00Z'))).toBe('2026-07-26');
    expect(companyDateOf('2026-07-27T02:30:00Z')).toBe('2026-07-26');
  });

  it('returns empty for an unusable date rather than a wrong one', () => {
    expect(companyDateOf(new Date('nonsense'))).toBe('');
    expect(companyDateOf('not a date')).toBe('');
  });
});
