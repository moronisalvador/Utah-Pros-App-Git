/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-customer-match.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pieces of the QuickBooks customer matcher that decide whether an
 *   existing customer is "the same person": phone-digit normalization, the two
 *   display-name conventions ("First Last" and "Last, First"), and the detector
 *   for QBO's "customer no longer exists" rejection — the INV-000104 incident
 *   where a contact pointed at a deleted QuickBooks customer.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/quickbooks.js (pure helpers only — no network)
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePhoneDigits,
  displayNameVariants,
  isStaleCustomerRef,
} from './quickbooks.js';

describe('normalizePhoneDigits', () => {
  it('compares on the last 10 digits regardless of formatting', () => {
    expect(normalizePhoneDigits('(801) 555-0142')).toBe('8015550142');
    expect(normalizePhoneDigits('+1 801-555-0142')).toBe('8015550142');
    expect(normalizePhoneDigits('18015550142')).toBe('8015550142');
  });
  it('passes through short/empty values without inventing a match', () => {
    expect(normalizePhoneDigits('555-0142')).toBe('5550142');
    expect(normalizePhoneDigits('')).toBe('');
    expect(normalizePhoneDigits(null)).toBe('');
  });
});

describe('displayNameVariants', () => {
  it('covers both realm conventions for a two-part name', () => {
    expect(displayNameVariants('Emily Bailey')).toEqual(['Emily Bailey', 'Bailey, Emily']);
  });
  it('keeps middle names attached to the given name', () => {
    expect(displayNameVariants('Mary Jo Kline')).toEqual(['Mary Jo Kline', 'Kline, Mary Jo']);
  });
  it('does not invent a comma variant for single names or pre-comma names', () => {
    expect(displayNameVariants('Cher')).toEqual(['Cher']);
    expect(displayNameVariants('Bailey, Emily')).toEqual(['Bailey, Emily']);
  });
  it('normalizes whitespace and handles empty', () => {
    expect(displayNameVariants('  Emily   Bailey ')).toEqual(['Emily Bailey', 'Bailey, Emily']);
    expect(displayNameVariants('')).toEqual([]);
  });
});

describe('isStaleCustomerRef', () => {
  it('matches the exact QBO rejection from the INV-000104 incident', () => {
    expect(isStaleCustomerRef(new Error(
      'Invalid Reference Id — Invalid Reference Id : Names element id 583 not found',
    ))).toBe(true);
  });
  it('ignores other QBO faults (duplicate doc number, payments, precision)', () => {
    expect(isStaleCustomerRef(new Error('Duplicate Document Number Error'))).toBe(false);
    expect(isStaleCustomerRef(new Error('Amount has more precision than allowed'))).toBe(false);
    expect(isStaleCustomerRef(new Error('Invalid Reference Id : Classes element id 9 not found'))).toBe(false);
    expect(isStaleCustomerRef(null)).toBe(false);
  });
});
