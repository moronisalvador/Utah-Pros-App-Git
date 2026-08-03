/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-customer-match.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pieces of the QuickBooks customer matcher that decide whether an
 *   existing customer is "the same person": exact email, phone-digit
 *   normalization, the diagnostic display-name conventions, and the detector
 *   for QBO's "customer no longer exists" rejection — the INV-000104 incident
 *   where a contact pointed at a deleted QuickBooks customer.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/quickbooks.js (pure helpers only — no network)
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import {
  normalizePhoneDigits,
  disambiguatedCustomerPayload,
  displayNameVariants,
  isStaleCustomerRef,
  findExistingCustomer,
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

describe('disambiguatedCustomerPayload', () => {
  it('creates a distinct display name instead of adopting a name-only match', () => {
    expect(disambiguatedCustomerPayload(
      { id: 'abcd1234', phone: '(801) 555-0142' },
      { DisplayName: 'Allison Berrett', GivenName: 'Allison' },
    )).toEqual({
      DisplayName: 'Allison Berrett (0142)',
      GivenName: 'Allison',
    });
  });

  it('falls back to the UPR contact identity when no phone is present', () => {
    expect(disambiguatedCustomerPayload(
      { id: 'abcd1234', phone: null },
      { DisplayName: 'Allison Berrett' },
    ).DisplayName).toBe('Allison Berrett (abcd)');
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

describe('findExistingCustomer (tiered matching, injected queries)', () => {
  const contact = { name: 'Emily Bailey', email: 'baileyfam@gmail.com', phone: '(801) 555-0142' };
  const payload = { DisplayName: 'Emily Bailey' };
  const cust = (Id, DisplayName, phone) => ({
    Id, DisplayName, ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
  });

  it('matches a single customer by exact email first', async () => {
    const many = vi.fn(async (env, where) =>
      where.startsWith('PrimaryEmailAddr') ? [cust('121', 'Bailey, Emily')] : []);
    const r = await findExistingCustomer({}, contact, payload, { queryCustomers: many });
    expect(r).toMatchObject({ matchedBy: 'email', customer: { Id: '121' } });
  });

  it('refuses to guess between two email matches', async () => {
    const many = vi.fn(async () => [cust('1', 'A'), cust('2', 'B')]);
    const r = await findExistingCustomer({}, contact, payload, { queryCustomers: many });
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(2);
  });

  it('never links a customer from a name-only suggestion', async () => {
    const many = vi.fn(async () => []);
    const one = vi.fn(async () => cust('121', 'Allison Cachoral'));
    const r = await findExistingCustomer({}, contact, payload, { queryCustomers: many, queryCustomer: one });
    expect(r).toBeNull();
    expect(one).not.toHaveBeenCalled();
  });

  it('matches by family name + phone digits when email misses', async () => {
    const many = vi.fn(async (env, where) => {
      if (where.startsWith('FamilyName')) {
        return [cust('7', 'Em B.', '801.555.0142'), cust('8', 'Other Bailey', '801-555-9999')];
      }
      return [];
    });
    const r = await findExistingCustomer({}, contact, payload, { queryCustomers: many });
    expect(r).toMatchObject({ matchedBy: 'phone', customer: { Id: '7' } });
  });

  it('returns null only when QBO answered "none" for every signal', async () => {
    const many = vi.fn(async () => []);
    const r = await findExistingCustomer({}, contact, payload, { queryCustomers: many });
    expect(r).toBeNull();
  });

  it('FAILS CLOSED: a failed query propagates instead of reading as "no match"', async () => {
    const many = vi.fn(async () => { throw new Error('QBO customer query failed (429)'); });
    await expect(
      findExistingCustomer({}, contact, payload, { queryCustomers: many }),
    ).rejects.toThrow(/query failed/);
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
