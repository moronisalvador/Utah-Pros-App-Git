/**
 * ════════════════════════════════════════════════
 * FILE: qbo-receipt.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the exact payment details accepted by the protected receipt server.
 *   It also proves retry markers and QuickBooks method names stay predictable.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-receipt
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - These tests do not call QuickBooks or a database.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import {
  intuitRequestId,
  isReceivePaymentsGateOpen,
  isReceivePaymentsEnabled,
  normalizeQboPaymentMethod,
  receiptFingerprint,
  validateReceiptRequest,
} from './qbo-receipt.js';

const CONTACT = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const INVOICE_A = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const INVOICE_B = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1';

const valid = {
  client_request_id: '7ef4b4ea-637e-47bd-a99c-100632aefb55', contact_id: CONTACT, payment_date: '2026-07-30',
  payer_type: 'homeowner', payment_method: 'check', qbo_payment_method_id: 'pm-check',
  reference_number: '7956', deposit_account_id: '2227',
  allocations: [{ invoice_id: INVOICE_B, amount_cents: 410362 }, { invoice_id: INVOICE_A, amount_cents: 233645 }],
};

describe('qbo receipt input boundary', () => {
  it('sorts the canonical allocation shape and makes a deterministic fingerprint', async () => {
    const normalized = validateReceiptRequest(valid);
    expect(normalized.allocations.map((row) => row.invoice_id)).toEqual([INVOICE_A, INVOICE_B]);
    expect(await receiptFingerprint(normalized)).toBe(await receiptFingerprint(validateReceiptRequest(valid)));
  });
  it.each([
    [{ ...valid, allocations: [{ invoice_id: INVOICE_A, amount_cents: 1 }, { invoice_id: INVOICE_A, amount_cents: 2 }] }],
    [{ ...valid, allocations: [{ invoice_id: INVOICE_A, amount_cents: 1.2 }] }],
    [{ ...valid, reference_number: null }],
    [{ ...valid, payer_type: 'property_manager' }],
    [{ ...valid, payment_date: '2026-02-30' }],
  ])('rejects duplicate, fractional, and missing check references', (input) => {
    expect(() => validateReceiptRequest(input)).toThrow();
  });
  it.each([
    ['Check', 'check'],
    ['ACH bank transfer', 'ach'],
    ['Visa Credit Card', 'credit_card'],
    ['Cash', 'cash'],
    ['Custom counter payment', 'other'],
  ])('maps the QBO method name %s to %s', (name, expected) => {
    expect(normalizeQboPaymentMethod(name)).toBe(expected);
  });
  it('is disabled unless explicitly true and maps a UUID without collision-prone truncation', () => {
    expect(isReceivePaymentsEnabled({})).toBe(false);
    expect(isReceivePaymentsEnabled({ QBO_RECEIVE_PAYMENT_ENABLED: 'true' })).toBe(true);
    const first = intuitRequestId('7ef4b4ea-637e-47bd-a99c-100632aefb55');
    const second = intuitRequestId('8ef4b4ea-637e-47bd-a99c-100632aefb55');
    expect(first).toHaveLength(41);
    expect(first).not.toBe(second);
  });
  it.each([
    ['open', { QBO_RECEIVE_PAYMENT_ENABLED: 'true' }, [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }], true],
    ['worker off', {}, [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }], false],
    ['database off', { QBO_RECEIVE_PAYMENT_ENABLED: 'true' }, [{ key: 'feature:qbo_receive_payment', enabled: false, force_disabled: false }], false],
    ['force disabled', { QBO_RECEIVE_PAYMENT_ENABLED: 'true' }, [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: true }], false],
    ['missing', { QBO_RECEIVE_PAYMENT_ENABLED: 'true' }, [], false],
  ])('requires both rollout gates (%s)', async (_label, env, rows, expected) => {
    const db = { select: async () => rows };
    await expect(isReceivePaymentsGateOpen(env, db)).resolves.toBe(expected);
  });
  it('fails closed when the database gate cannot be read', async () => {
    await expect(isReceivePaymentsGateOpen(
      { QBO_RECEIVE_PAYMENT_ENABLED: 'true' },
      { select: async () => { throw new Error('unavailable'); } },
    )).resolves.toBe(false);
  });
});
