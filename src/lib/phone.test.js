/**
 * ════════════════════════════════════════════════
 * FILE: phone.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the phone helpers: normalizing a typed-in number to a standard
 *   format, and formatting a stored number for display so staff see
 *   "(801) 447-1917" instead of "+18014471917" on the Call Log.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./phone.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone } from './phone.js';

describe('normalizePhone', () => {
  it('prepends +1 for a 10-digit US number', () => {
    expect(normalizePhone('8014471917')).toBe('+18014471917');
    expect(normalizePhone('(801) 447-1917')).toBe('+18014471917');
  });
  it('returns null for too-short input', () => {
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('formats a US +1 E.164 number as (xxx) xxx-xxxx', () => {
    expect(formatPhone('+18014471917')).toBe('(801) 447-1917');
    expect(formatPhone('+13853605077')).toBe('(385) 360-5077');
  });
  it('formats a bare 10-digit US number too', () => {
    expect(formatPhone('8014471917')).toBe('(801) 447-1917');
  });
  it('echoes the input unchanged when it is not a US 10-digit number', () => {
    expect(formatPhone('+448014471917')).toBe('+448014471917'); // non-US
    expect(formatPhone('not a phone')).toBe('not a phone');
    expect(formatPhone('')).toBe('');
  });
  it('returns an empty string for null/undefined', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });
});
