/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment-sync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the payment.received notification hook that the Notification Center
 *   (Session B) added to the QBO payment-sync library. It checks the little
 *   announce-a-payment helper builds the correct event, that it NEVER throws even
 *   when the notifier is broken (a payment must never be lost because an alert
 *   failed), and that a genuinely-new imported payment fires exactly one
 *   notification while a re-delivered / already-synced payment fires none.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo-payment-sync.js (system under test); ../api/notify.js and
 *              ./quickbooks.js are mocked so no network / Supabase is touched.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dispatcher + the QBO fetch so the sync runs offline.
vi.mock('../api/notify.js', () => ({ dispatchEvent: vi.fn(async () => ({ ok: true })) }));
vi.mock('./quickbooks.js', () => ({ qboFetch: vi.fn() }));

import { notifyPaymentReceived, syncQboPaymentToUpr } from './qbo-payment-sync.js';
import { dispatchEvent } from '../api/notify.js';
import { qboFetch } from './quickbooks.js';

const ENV = { SUPABASE_URL: 'https://db.test' };

beforeEach(() => {
  dispatchEvent.mockClear();
  qboFetch.mockReset();
});

describe('notifyPaymentReceived (payment.received emit hook)', () => {
  it('emits payment.received with amount, invoice link + payload', async () => {
    await notifyPaymentReceived({
      db: {}, env: ENV, amount: 1234.5, invoiceId: 'inv-1', jobId: 'job-1',
      source: 'Stripe', reference: 'Invoice 1001',
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const evt = dispatchEvent.mock.calls[0][0];
    expect(evt.typeKey).toBe('payment.received');
    expect(evt.body.link).toBe('/invoices/inv-1');
    expect(evt.body.entity_type).toBe('invoice');
    expect(evt.body.entity_id).toBe('inv-1');
    expect(evt.body.job_id).toBe('job-1');
    expect(evt.body.body).toContain('$1234.50');
    expect(evt.body.body).toContain('Stripe');
    expect(evt.body.payload.amount).toBe(1234.5);
  });

  it('falls back to /collections when there is no invoice id', async () => {
    await notifyPaymentReceived({ db: {}, env: ENV, amount: 10, source: 'Card' });
    expect(dispatchEvent.mock.calls[0][0].body.link).toBe('/collections');
  });

  it('NEVER throws when the dispatcher fails (payment path is protected)', async () => {
    dispatchEvent.mockImplementationOnce(async () => { throw new Error('notify down'); });
    await expect(
      notifyPaymentReceived({ db: {}, env: ENV, amount: 5, invoiceId: 'inv-9', source: 'Card' }),
    ).resolves.toBeUndefined();
  });
});

// A QBO payment with one invoice line applied for $500.
function paymentResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ Payment: { TxnDate: '2026-07-03', PaymentMethodRef: { value: 'pm1' }, Line: [{ Amount: 500, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'QB-INV-1' }] }] } }),
  };
}

function makeDb({ existingPayment = false } = {}) {
  const inserts = [];
  return {
    inserts,
    async select(table, query = '') {
      if (table === 'invoices') return [{ id: 'inv-1', job_id: 'job-1', contact_id: 'c-1' }];
      if (table === 'payments') return existingPayment ? [{ id: 'pay-existing' }] : [];
      return [];
    },
    async insert(table, row) { inserts.push({ table, row }); return [{ id: 'pay-new', ...row }]; },
  };
}

describe('syncQboPaymentToUpr — recorded-only, idempotent notify', () => {
  it('fires payment.received exactly once for a newly-recorded payment', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) return paymentResponse();
      if (path.startsWith('/paymentmethod/')) return { ok: true, json: async () => ({ PaymentMethod: { Name: 'Visa' } }) };
      return { ok: false, status: 404 };
    });
    const db = makeDb({ existingPayment: false });
    const out = await syncQboPaymentToUpr(ENV, db, 'QB-PAY-1');
    expect(out.results.some(r => r.recorded)).toBe(true);
    expect(db.inserts).toHaveLength(1);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].typeKey).toBe('payment.received');
  });

  it('does NOT re-fire for an already-synced (re-delivered) payment', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) return paymentResponse();
      if (path.startsWith('/paymentmethod/')) return { ok: true, json: async () => ({ PaymentMethod: { Name: 'Visa' } }) };
      return { ok: false, status: 404 };
    });
    const db = makeDb({ existingPayment: true });
    const out = await syncQboPaymentToUpr(ENV, db, 'QB-PAY-1');
    expect(out.results.some(r => r.skipped === 'already-synced')).toBe(true);
    expect(db.inserts).toHaveLength(0);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
