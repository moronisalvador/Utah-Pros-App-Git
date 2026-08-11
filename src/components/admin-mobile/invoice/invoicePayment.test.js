/**
 * ════════════════════════════════════════════════
 * FILE: invoicePayment.test.js  (single-invoice receipt flow contract)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pushed invoice payment flow creates exactly one allocation,
 *   keeps amounts in cents, refuses overpayments, and chooses the deposit
 *   account using the same current → remembered → first-bank chain as the
 *   established Receive Payment screen.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./invoicePayment
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import {
  buildInvoicePaymentPayload,
  clearPendingInvoicePaymentIdentity,
  chooseDepositAccountId,
  findInvoiceOption,
  persistPendingInvoicePaymentIdentity,
  readPendingInvoicePaymentIdentity,
  validateInvoicePayment,
} from './invoicePayment';
import { canonicalPayload, nextRequestIdentity } from '@/components/collections/paymentAllocation';

const invoice = { id: 'inv-1', balance_cents: 12_345, invoice_number: 'INV-100' };
const method = { id: 'method-1', name: 'Check', type: 'check' };

describe('single-invoice payment payload', () => {
  it('creates one allocation for the route invoice and preserves exact cents', () => {
    const payload = buildInvoicePaymentPayload({
      contactId: 'contact-1',
      invoice,
      amount: '123.45',
      paymentDate: '2026-08-09',
      payerType: 'homeowner',
      method,
      referenceNumber: '1042',
      depositAccountId: 'bank-1',
    });

    expect(payload).toEqual({
      contact_id: 'contact-1',
      payment_date: '2026-08-09',
      payer_type: 'homeowner',
      payment_method: 'check',
      qbo_payment_method_id: 'method-1',
      reference_number: '1042',
      deposit_account_id: 'bank-1',
      allocations: [{ invoice_id: 'inv-1', amount_cents: 12_345 }],
    });
    expect(validateInvoicePayment(payload, invoice)).toBeNull();
  });

  it('refuses a missing check number and an amount above the live open balance', () => {
    const missingReference = buildInvoicePaymentPayload({
      contactId: 'contact-1', invoice, amount: '12.00', paymentDate: '2026-08-09',
      payerType: 'insurance', method, referenceNumber: '', depositAccountId: 'bank-1',
    });
    expect(validateInvoicePayment(missingReference, invoice)).toBe('A check number is required.');

    const overBalance = buildInvoicePaymentPayload({
      contactId: 'contact-1', invoice, amount: '123.46', paymentDate: '2026-08-09',
      payerType: 'insurance', method: { id: 'cash-1', name: 'Cash', type: 'cash' },
      referenceNumber: '', depositAccountId: 'bank-1',
    });
    expect(validateInvoicePayment(overBalance, invoice)).toBe('The payment is greater than this invoice’s current open balance.');
  });
});

describe('invoice receipt options', () => {
  const accounts = [
    { id: 'other-1', account_type: 'Other Current Asset' },
    { id: 'bank-1', account_type: 'Bank' },
    { id: 'bank-2', account_type: 'Bank' },
  ];

  it('filters the over-fetched customer response to the route invoice', () => {
    expect(findInvoiceOption({ invoices: [{ id: 'inv-2' }, invoice] }, 'inv-1')).toBe(invoice);
    expect(findInvoiceOption({ invoices: [invoice] }, 'missing')).toBeNull();
  });

  it('prefers a still-valid current account, then remembered, then first bank', () => {
    expect(chooseDepositAccountId(accounts, 'bank-2', 'bank-1')).toBe('bank-2');
    expect(chooseDepositAccountId(accounts, 'missing', 'bank-1')).toBe('bank-1');
    expect(chooseDepositAccountId(accounts, '', 'missing')).toBe('bank-1');
    expect(chooseDepositAccountId([{ id: 'asset-1', account_type: 'Other' }], '', '')).toBe('asset-1');
    expect(chooseDepositAccountId([], '', '')).toBe('');
  });
});

describe('durable native retry identity', () => {
  const memoryStorage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
  };

  it('reuses the same request after a reload and isolates actor, invoice, and payload', async () => {
    const storage = memoryStorage();
    const payload = buildInvoicePaymentPayload({
      contactId: 'contact-1', invoice, amount: '123.45', paymentDate: '2026-08-09',
      payerType: 'homeowner', method, referenceNumber: '1042', depositAccountId: 'bank-1',
    });
    const first = nextRequestIdentity(null, payload, () => 'request-before-response-loss');
    await persistPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-1', invoiceId: invoice.id, payload, identity: first,
    });

    // A native process eviction loses React state. Re-reading storage must feed
    // nextRequestIdentity the original id instead of minting a second QBO attempt.
    const restored = await readPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-1', invoiceId: invoice.id, payload,
    });
    expect(restored).toEqual({ canonical: canonicalPayload(payload), id: 'request-before-response-loss' });
    expect(nextRequestIdentity(restored, payload, () => 'duplicate-request').id)
      .toBe('request-before-response-loss');

    expect(await readPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-2', invoiceId: invoice.id, payload,
    })).toBeNull();
    expect(await readPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-1', invoiceId: 'inv-2', payload,
    })).toBeNull();
    expect(await readPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-1', invoiceId: invoice.id,
      payload: { ...payload, reference_number: 'DIFFERENT' },
    })).toBeNull();

    await clearPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-1', invoiceId: invoice.id, payload,
      requestId: first.id,
    });
    expect(await readPendingInvoicePaymentIdentity({
      storage, actorId: 'employee-1', invoiceId: invoice.id, payload,
    })).toBeNull();
  });
});
