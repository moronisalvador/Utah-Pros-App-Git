import { describe, it, expect } from 'vitest';
import { mountainToday, mountainYesterday, isStale } from './date-mt.js';

describe('mountainToday', () => {
  it('keeps a summer evening payment on the Utah business date', () => {
    expect(mountainToday('2026-07-24T05:30:00Z')).toBe('2026-07-23');
  });

  it('handles the winter UTC offset', () => {
    expect(mountainToday('2026-01-15T06:30:00Z')).toBe('2026-01-14');
  });

  it('advances only after Mountain midnight', () => {
    expect(mountainToday('2026-07-24T06:01:00Z')).toBe('2026-07-24');
  });
});

describe('mountainYesterday', () => {
  it('returns the prior MT calendar date for a UTC morning instant (MDT, UTC-6)', () => {
    // 2026-07-01T05:00:00Z is 2026-06-30 23:00 MDT — still June 30 in Denver.
    expect(mountainYesterday('2026-07-01T05:00:00Z')).toBe('2026-06-29');
  });

  it('returns the prior MT calendar date for a UTC late-evening instant', () => {
    // 2026-07-01T23:00:00Z is 2026-07-01 17:00 MDT — July 1 in Denver.
    expect(mountainYesterday('2026-07-01T23:00:00Z')).toBe('2026-06-30');
  });

  it('handles the MST/MDT boundary correctly (winter, UTC-7)', () => {
    // 2026-01-15T04:00:00Z is 2026-01-14 21:00 MST — still Jan 14 in Denver.
    expect(mountainYesterday('2026-01-15T04:00:00Z')).toBe('2026-01-13');
  });
});

describe('isStale', () => {
  it('treats a lead with no prior activity as stale', () => {
    expect(isStale(null, '2026-07-01T12:00:00Z', 3)).toBe(true);
  });

  it('is not stale before the threshold in MT calendar days', () => {
    expect(isStale('2026-06-29T12:00:00Z', '2026-07-01T12:00:00Z', 3)).toBe(false);
  });

  it('is stale once the threshold is reached in MT calendar days', () => {
    expect(isStale('2026-06-28T12:00:00Z', '2026-07-01T12:00:00Z', 3)).toBe(true);
  });

  it('is not fooled by a UTC-day boundary that is not an MT-day boundary', () => {
    // 2026-06-30T23:30:00Z (last) and 2026-07-01T01:00:00Z (now) cross a UTC
    // midnight but are the same MT calendar day (2026-06-30 evening, MDT).
    expect(isStale('2026-06-30T23:30:00Z', '2026-07-01T01:00:00Z', 1)).toBe(false);
  });
});
