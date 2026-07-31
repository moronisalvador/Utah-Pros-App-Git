/**
 * ════════════════════════════════════════════════
 * FILE: paymentAllocation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the small payment calculations before a person can submit a receipt.
 *   It proves that totals, retry identity, required check details, and grouped
 *   payment summaries stay predictable as the interface changes.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  paymentAllocation
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - These tests do not contact QuickBooks or write to the database.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { allocationTotal, cents, groupPaymentLedgerRows, nextRequestIdentity, shouldDisarmReviewOnBlur, validateReceipt } from './paymentAllocation';

describe('multi-invoice payment allocation', () => {
  it('adds integer cents without floating-point drift', () => {
    expect(allocationTotal([{ amount_cents: 233645 }, { amount_cents: 410362 }])).toBe(644007);
    expect(cents('6440.07')).toBe(644007);
  });
  it('requires a check reference and deposit account', () => {
    expect(validateReceipt({ contactId: 'c1', paymentDate: '2026-07-29', paymentMethod: 'check', referenceNumber: '', depositAccountId: '', allocations: [{ invoice_id: 'i1', amount_cents: 1 }] })).toBe('A check number is required.');
  });
  it('keeps a retry identity only for unchanged canonical content', () => {
    const makeId = vi.fn(() => 'request-id');
    const payload = { contact_id: 'c1', allocations: [{ invoice_id: 'b', amount_cents: 2 }, { invoice_id: 'a', amount_cents: 1 }] };
    const first = nextRequestIdentity(null, payload, makeId);
    expect(nextRequestIdentity(first, { ...payload, allocations: [...payload.allocations].reverse() }, makeId)).toBe(first);
    expect(nextRequestIdentity(first, { ...payload, payment_date: '2026-07-29' }, makeId)).not.toBe(first);
  });
  it('keeps review armed while focus stays in its card', () => {
    const relatedTarget = {};
    expect(shouldDisarmReviewOnBlur({ contains: (node) => node === relatedTarget }, relatedTarget)).toBe(false);
    expect(shouldDisarmReviewOnBlur({ contains: () => false }, relatedTarget)).toBe(true);
    expect(shouldDisarmReviewOnBlur({ contains: () => false }, null)).toBe(true);
  });
  it('groups one QBO receipt into a receipt summary', () => {
    const rows = groupPaymentLedgerRows([
      { payment_id: '1', qbo_payment_id: '5887', amount: 2.5, claim_id: 'claim-1', claim_number: 'C-1', invoice_number: 'I-1' },
      { payment_id: '2', qbo_payment_id: '5887', amount: 3.5, claim_id: 'claim-2', claim_number: 'C-2', invoice_number: 'I-2' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: 6,
      allocation_count: 2,
      grouped: true,
      cross_claim: true,
      claim_id: null,
      invoice_numbers: ['I-1', 'I-2'],
    });
  });
});
