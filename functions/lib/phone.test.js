/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/phone.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the worker-side phone helpers normalize typed-in numbers to one
 *   standard stored form and format stored numbers for display — the same
 *   guarantees src/lib/phone.test.js makes for the app side, so server code
 *   (SMS, import dedupe, form capture) can rely on them.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./phone.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone } from './phone.js';

describe('normalizePhone (worker)', () => {
  it('prepends +1 for a 10-digit US number', () => {
    expect(normalizePhone('8014471917')).toBe('+18014471917');
    expect(normalizePhone('(801) 447-1917')).toBe('+18014471917');
  });
  it('keeps an already-normalized 11-digit number', () => {
    expect(normalizePhone('+18014471917')).toBe('+18014471917');
    expect(normalizePhone('18014471917')).toBe('+18014471917');
  });
  it('returns null for too-short input', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('formatPhone (worker)', () => {
  it('formats a US +1 E.164 number as (xxx) xxx-xxxx', () => {
    expect(formatPhone('+18014471917')).toBe('(801) 447-1917');
    expect(formatPhone('8014471917')).toBe('(801) 447-1917');
  });
  it('echoes malformed / non-US input back unchanged, empty for null', () => {
    expect(formatPhone('abc')).toBe('abc');
    expect(formatPhone('')).toBe('');
  });
});
