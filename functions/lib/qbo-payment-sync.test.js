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
vi.mock('./quickbooks.js', () => ({ qboFetch: vi.fn(), getConnection: vi.fn() }));

import {
  notifyPaymentReceived,
  syncQboPaymentToUpr,
  adoptInvoiceFromQboEstimate,
  readQboFault,
  isQboNotFound,
  QboRequestError,
  removeQboPaymentFromUpr,
} from './qbo-payment-sync.js';
import { dispatchEvent } from '../api/notify.js';
import { getConnection, qboFetch } from './quickbooks.js';

const ENV = { SUPABASE_URL: 'https://db.test' };

beforeEach(() => {
  dispatchEvent.mockClear();
  qboFetch.mockReset();
  getConnection.mockReset();
});

describe('notifyPaymentReceived (payment.received emit hook)', () => {
  it('emits payment.received with amount, invoice link + payload', async () => {
    await notifyPaymentReceived({
      db: {}, env: ENV, amount: 1234.5, invoiceId: 'inv-1', jobId: 'job-1',
      source: 'Stripe', reference: 'Charge #ch-1', invoiceNumber: 'INV-1001',
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
    // db has no select here, so the enrichment lookups fail closed: context
    // still carries render-safe fallbacks (renderTemplate refuses blanks) and
    // the plain body simply omits the unknown segments.
    expect(evt.body.presentation_context).toEqual({
      invoice_number: 'INV-1001',
      customer_name: 'Customer',
      job_number: '—',
    });
    expect(evt.body.body).not.toContain('from');
    expect(evt.body.body).not.toContain('Job #');
  });

  it('names the customer and job when the lookups resolve', async () => {
    const select = vi.fn(async (table) => {
      if (table === 'contacts') return [{ name: 'Kate Dalton' }];
      if (table === 'jobs') return [{ job_number: '1042' }];
      return [];
    });
    await notifyPaymentReceived({
      db: { select }, env: ENV, amount: 4103.62,
      invoiceId: 'inv-2', jobId: 'job-2', contactId: 'contact-2',
      source: 'QuickBooks', reference: 'QBO Payment #5887', invoiceNumber: 'INV-209',
    });
    const evt = dispatchEvent.mock.calls[0][0];
    expect(evt.body.body).toBe(
      '$4103.62 from Kate Dalton · Job #1042 · Invoice INV-209 · via QuickBooks (QBO Payment #5887).',
    );
    expect(evt.body.presentation_context).toEqual({
      invoice_number: 'INV-209',
      customer_name: 'Kate Dalton',
      job_number: '1042',
    });
    expect(select).toHaveBeenCalledWith('contacts', 'id=eq.contact-2&select=name');
    expect(select).toHaveBeenCalledWith('jobs', 'id=eq.job-2&select=job_number');
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
    async select(table) {
      if (table === 'invoices') {
        return [{
          id: 'inv-1',
          job_id: 'job-1',
          contact_id: 'c-1',
          invoice_number: 'INV-1001',
          qbo_doc_number: 'QB-1001',
        }];
      }
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
    expect(dispatchEvent.mock.calls[0][0].body.presentation_context)
      .toEqual({
        invoice_number: 'QB-1001',
        customer_name: 'Customer',
        job_number: '—',
      });
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

  it('treats a concurrent unique-index winner as already synced without notifying twice', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) return paymentResponse();
      if (path.startsWith('/paymentmethod/')) {
        return { ok: true, json: async () => ({ PaymentMethod: { Name: 'Visa' } }) };
      }
      return { ok: false, status: 404 };
    });
    let paymentReads = 0;
    const db = makeDb({ existingPayment: false });
    db.select = async (table) => {
      if (table === 'invoices') {
        return [{
          id: 'inv-1',
          job_id: 'job-1',
          contact_id: 'c-1',
          invoice_number: 'INV-1001',
          qbo_doc_number: 'QB-1001',
        }];
      }
      if (table === 'payments') {
        paymentReads += 1;
        return paymentReads > 1 ? [{ id: 'pay-race-winner' }] : [];
      }
      return [];
    };
    db.insert = async () => {
      throw new Error('Supabase INSERT payments: 409 duplicate key value violates unique constraint');
    };

    const out = await syncQboPaymentToUpr(ENV, db, 'QB-PAY-1');

    expect(out.results).toEqual([{ qboInvoiceId: 'QB-INV-1', skipped: 'already-synced' }]);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('adoptInvoiceFromQboEstimate — deposit-payment safety', () => {
  it('uses a non-forcing conversion for the payment-driven deposit adoption path', async () => {
    qboFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Invoice: {
        DocNumber: 'QB-EST-1',
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }),
    });
    const rpcs = [];
    const db = {
      async select(table) {
        if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: null }];
        if (table === 'invoices') return [{
          id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1', qbo_invoice_id: null,
          invoice_number: 'INV-1', qbo_doc_number: null,
        }];
        return [];
      },
      async rpc(fn, params) {
        rpcs.push({ fn, params });
        if (fn === 'apply_qbo_estimate_decision') return { ok: true, action: 'approved-and-converted', invoice_id: 'inv-1' };
        return { ok: true, id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1', invoice_number: 'INV-1', qbo_doc_number: 'QB-EST-1', qbo_invoice_id: 'QB-INV-1' };
      },
      async update() { return null; },
    };

    const adopted = await adoptInvoiceFromQboEstimate(ENV, db, 'QB-INV-1');

    expect(adopted.id).toBe('inv-1');
    expect(rpcs).toEqual([
      { fn: 'apply_qbo_estimate_decision', params: { p_estimate_id: 'est-1', p_action: 'convert', p_approved_at: null, p_approved_amount: null } },
      { fn: 'cas_qbo_invoice_link', params: { p_invoice_id: 'inv-1', p_expected_qbo_invoice_id: null, p_new_qbo_invoice_id: 'QB-INV-1', p_qbo_doc_number: 'QB-EST-1' } },
    ]);
  });

  it('refuses to adopt through a non-forcing path when the target invoice has lines', async () => {
    qboFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Invoice: {
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }),
    });
    const rpcs = [];
    const db = {
      async select(table) {
        if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: null }];
        return [];
      },
      async rpc(fn, params) {
        rpcs.push({ fn, params });
        return { ok: true, action: 'approved-needs-manual-convert', invoice_id: 'inv-populated' };
      },
    };

    await expect(adoptInvoiceFromQboEstimate(ENV, db, 'QB-INV-1', false)).resolves.toBeNull();
    expect(rpcs).toEqual([{
      fn: 'apply_qbo_estimate_decision',
      params: { p_estimate_id: 'est-1', p_action: 'convert', p_approved_at: null, p_approved_amount: null },
    }]);
  });

  it('reports a different existing QBO invoice as a blocked adoption without overwriting it', async () => {
    qboFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Invoice: {
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }),
    });
    const updates = [];
    const db = {
      async select(table, query) {
        if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: 'inv-1' }];
        // The sync's first lookup is by the incoming QBO id and must miss so
        // the adoption helper sees the converted UPR invoice by its UUID.
        if (table === 'invoices' && query.startsWith('qbo_invoice_id=')) return [];
        if (table === 'invoices') return [{
          id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1', qbo_invoice_id: 'QB-OTHER',
        }];
        return [];
      },
      async update(...args) { updates.push(args); },
    };

    await expect(adoptInvoiceFromQboEstimate(ENV, db, 'QB-INV-1', false, true))
      .resolves.toEqual({ blocked: 'qbo-invoice-mismatch' });
    expect(updates).toHaveLength(0);
  });

  it('does not let a competing link winner be overwritten after the invoice read', async () => {
    qboFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Invoice: {
        DocNumber: 'QB-EST-1',
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }),
    });
    const updates = [];
    const db = {
      async select(table) {
        if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: 'inv-1' }];
        if (table === 'invoices') return [{
          id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1', qbo_invoice_id: null,
          invoice_number: 'INV-1', qbo_doc_number: null,
        }];
        return [];
      },
      async rpc(fn, params) {
        expect(fn).toBe('cas_qbo_invoice_link');
        expect(params.p_expected_qbo_invoice_id).toBeNull();
        return { ok: false, reason: 'qbo-invoice-mismatch', current_qbo_invoice_id: 'QB-HUMAN-WON' };
      },
      async update(...args) { updates.push(args); },
    };

    await expect(adoptInvoiceFromQboEstimate(ENV, db, 'QB-INV-1', false, true))
      .resolves.toEqual({ blocked: 'qbo-invoice-mismatch' });
    expect(updates).toHaveLength(0);
  });

  it('maps an already-decided conversion response to the durable staff-decision conflict reason', async () => {
    qboFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Invoice: { LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }] } }),
    });
    const db = {
      async select(table) { return table === 'estimates' ? [{ id: 'est-1', converted_invoice_id: null }] : []; },
      async rpc() { return { ok: true, skipped: 'already-decided', status: 'denied' }; },
    };
    await expect(adoptInvoiceFromQboEstimate(ENV, db, 'QB-INV-1', false, true))
      .resolves.toEqual({ blocked: 'staff-decision-conflict' });
  });
});

describe('syncQboPaymentToUpr — blocked deposit adoption', () => {
  it('does not choose an arbitrary UPR invoice when combined billing has the same QBO invoice id', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) return paymentResponse();
      if (path.startsWith('/paymentmethod/')) return { ok: true, json: async () => ({ PaymentMethod: { Name: 'Visa' } }) };
      return { ok: false, status: 404 };
    });
    const inserts = [];
    const db = {
      async select(table) {
        if (table === 'invoices') return [
          { id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1' },
          { id: 'inv-2', job_id: 'job-2', contact_id: 'contact-2' },
        ];
        return [];
      },
      async insert(...args) { inserts.push(args); },
    };

    const out = await syncQboPaymentToUpr(ENV, db, 'QB-PAY-1');

    expect(out.results).toEqual([{ qboInvoiceId: 'QB-INV-1', skipped: 'combined-invoice-manual-reconciliation' }]);
    expect(inserts).toHaveLength(0);
  });

  it('does not record a payment when conversion needs manual reconciliation', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) return paymentResponse();
      if (path.startsWith('/paymentmethod/')) return { ok: true, json: async () => ({ PaymentMethod: { Name: 'Visa' } }) };
      if (path.startsWith('/invoice/')) return { ok: true, json: async () => ({ Invoice: {
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }) };
      return { ok: false, status: 404 };
    });
    const inserts = [];
    const rpcs = [];
    const db = {
      async select(table) {
        if (table === 'invoices') return [];
        if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: null }];
        return [];
      },
      async rpc(fn, params) {
        rpcs.push({ fn, params });
        return { ok: true, action: 'approved-needs-manual-convert', invoice_id: 'inv-populated' };
      },
      async insert(...args) { inserts.push(args); },
    };

    const out = await syncQboPaymentToUpr(ENV, db, 'QB-PAY-1');

    expect(rpcs).toEqual([{
      fn: 'apply_qbo_estimate_decision',
      params: { p_estimate_id: 'est-1', p_action: 'convert', p_approved_at: null, p_approved_amount: null },
    }]);
    expect(out.results).toEqual([{ qboInvoiceId: 'QB-INV-1', skipped: 'needs-manual-reconciliation' }]);
    expect(inserts).toHaveLength(0);
  });

  it('does not record a payment when the converted UPR invoice belongs to another QBO invoice', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) return paymentResponse();
      if (path.startsWith('/paymentmethod/')) return { ok: true, json: async () => ({ PaymentMethod: { Name: 'Visa' } }) };
      if (path.startsWith('/invoice/')) return { ok: true, json: async () => ({ Invoice: {
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }) };
      return { ok: false, status: 404 };
    });
    const inserts = [];
    const updates = [];
    const db = {
      async select(table, query) {
        if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: 'inv-1' }];
        if (table === 'invoices' && query.startsWith('qbo_invoice_id=')) return [];
        if (table === 'invoices') return [{
          id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1', qbo_invoice_id: 'QB-OTHER',
        }];
        return [];
      },
      async insert(...args) { inserts.push(args); },
      async update(...args) { updates.push(args); },
    };

    const out = await syncQboPaymentToUpr(ENV, db, 'QB-PAY-1');

    expect(out.results).toEqual([{ qboInvoiceId: 'QB-INV-1', skipped: 'qbo-invoice-mismatch' }]);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('does not adopt a payment when one QBO estimate maps to combined UPR estimates', async () => {
    qboFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Invoice: {
        LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }],
      } }),
    });
    const rpcs = [];
    const db = {
      async select(table) {
        if (table === 'estimates') return [
          { id: 'est-1', converted_invoice_id: null },
          { id: 'est-2', converted_invoice_id: null },
        ];
        return [];
      },
      async rpc(...args) { rpcs.push(args); },
    };

    await expect(adoptInvoiceFromQboEstimate(ENV, db, 'QB-INV-1', false, true))
      .resolves.toEqual({ blocked: 'combined-estimate-manual-reconciliation' });
    expect(rpcs).toHaveLength(0);
  });
});

function receiptPayment(patch = {}) {
  return {
    Id: 'QB-PAY-MULTI',
    SyncToken: '2',
    TxnDate: '2026-07-29',
    CustomerRef: { value: 'QB-CUSTOMER-1' },
    CurrencyRef: { value: 'USD' },
    PaymentMethodRef: { value: 'pm-check' },
    DepositToAccountRef: { value: 'bank-1', name: 'Operating' },
    PaymentRefNum: '7956',
    TotalAmt: 300,
    UnappliedAmt: 0,
    Line: [
      { Amount: 100, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'QB-INV-1' }] },
      { Amount: 200, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'QB-INV-2' }] },
    ],
    MetaData: { LastUpdatedTime: '2026-07-29T12:00:00Z' },
    ...patch,
  };
}

function receiptDb({ attempt = null, existingReceipt = null, priorPayment = null } = {}) {
  const rpc = vi.fn(async () => ({ receipt_id: 'receipt-1', status: 'reconciled' }));
  return {
    rpc,
    select: vi.fn(async (table, query) => {
      if (table === 'invoices' && query.includes('QB-INV-1')) {
        return [{ id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1', invoice_number: 'INV-1', qbo_doc_number: 'QBO-1' }];
      }
      if (table === 'invoices' && query.includes('QB-INV-2')) {
        return [{ id: 'inv-2', job_id: 'job-2', contact_id: 'contact-1', invoice_number: 'INV-2', qbo_doc_number: 'QBO-2' }];
      }
      if (table === 'payment_receipts') return existingReceipt ? [existingReceipt] : [];
      if (table === 'payment_receipt_attempts') return attempt ? [attempt] : [];
      if (table === 'payments') return priorPayment ? [priorPayment] : [];
      return [];
    }),
  };
}

function mockReceiptProvider(payment) {
  getConnection.mockResolvedValue({ realm_id: 'realm-1' });
  qboFetch.mockImplementation(async (_env, path) => {
    if (path.startsWith('/payment/')) {
      return { ok: true, status: 200, json: async () => ({ Payment: payment }) };
    }
    if (path.startsWith('/paymentmethod/')) {
      return { ok: true, status: 200, json: async () => ({ PaymentMethod: { Name: 'Check' } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('syncQboPaymentToUpr — durable receipt reconciliation', () => {
  const receiptEnv = { ...ENV, QBO_RECEIVE_PAYMENT_ENABLED: 'true' };

  it('defers a combined UPR invoice mapping without finalizing a partial receipt', async () => {
    mockReceiptProvider(receiptPayment({
      TotalAmt: 100,
      Line: [{ Amount: 100, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'QB-INV-1' }] }],
    }));
    const db = receiptDb({ existingReceipt: { id: 'receipt-1', source: 'qbo' } });
    db.select.mockImplementation(async (table) => {
      if (table === 'invoices') {
        return [
          { id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1' },
          { id: 'inv-2', job_id: 'job-2', contact_id: 'contact-2' },
        ];
      }
      if (table === 'payment_receipts') return [{ id: 'receipt-1', source: 'qbo' }];
      return [];
    });

    await expect(syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI')).resolves.toEqual({
      ok: true,
      results: [{
        qboInvoiceId: 'QB-INV-1',
        skipped: 'combined-invoice-manual-reconciliation',
      }],
    });
    expect(db.rpc).toHaveBeenCalledWith('remove_qbo_payment_receipt', expect.objectContaining({
      p_qbo_realm_id: 'realm-1',
      p_qbo_payment_id: 'QB-PAY-MULTI',
      p_status: 'conflict',
    }));
    expect(db.rpc).not.toHaveBeenCalledWith('reconcile_qbo_payment_receipt', expect.anything());
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('defers blocked estimate adoption without finalizing a receipt', async () => {
    const payment = receiptPayment({
      TotalAmt: 100,
      Line: [{ Amount: 100, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'QB-INV-1' }] }],
    });
    getConnection.mockResolvedValue({ realm_id: 'realm-1' });
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/payment/')) {
        return { ok: true, status: 200, json: async () => ({ Payment: payment }) };
      }
      if (path.startsWith('/paymentmethod/')) {
        return { ok: true, status: 200, json: async () => ({ PaymentMethod: { Name: 'Check' } }) };
      }
      if (path.startsWith('/invoice/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            Invoice: { LinkedTxn: [{ TxnType: 'Estimate', TxnId: 'QB-EST-1' }] },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const db = receiptDb();
    db.select.mockImplementation(async (table) => {
      if (table === 'invoices') return [];
      if (table === 'estimates') return [{ id: 'est-1', converted_invoice_id: null }];
      return [];
    });
    db.rpc.mockImplementation(async (fn) => {
      if (fn === 'apply_qbo_estimate_decision') {
        return { ok: true, action: 'approved-needs-manual-convert', invoice_id: 'inv-populated' };
      }
      return { receipt_id: 'receipt-1', status: 'reconciled' };
    });

    await expect(syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI')).resolves.toEqual({
      ok: true,
      results: [{ qboInvoiceId: 'QB-INV-1', skipped: 'needs-manual-reconciliation' }],
    });
    expect(db.rpc).toHaveBeenCalledWith('apply_qbo_estimate_decision', expect.anything());
    expect(db.rpc).not.toHaveBeenCalledWith('reconcile_qbo_payment_receipt', expect.anything());
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('reconciles and announces a new direct-QBO multi-invoice payment once', async () => {
    mockReceiptProvider(receiptPayment());
    const db = receiptDb();
    const result = await syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI');
    expect(result.results.filter((row) => row.recorded)).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledWith('reconcile_qbo_payment_receipt', expect.objectContaining({
      p_receipt: expect.objectContaining({
        qbo_realm_id: 'realm-1',
        total_cents: 30000,
        applied_cents: 30000,
        unapplied_cents: 0,
        source: 'qbo',
      }),
      p_allocations: [
        expect.objectContaining({ invoice_id: 'inv-1', amount_cents: 10000 }),
        expect.objectContaining({ invoice_id: 'inv-2', amount_cents: 20000 }),
      ],
    }));
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('never re-announces a payment UPR already carries, even with no receipt yet', async () => {
    // The 2026-08-06 04:17 burst: the first working receipt sweep re-projected
    // 14 manually-recorded/backfilled payments (no receipts could exist before
    // the role-check repair) and announced every one to every admin. A prior
    // payments row for the QBO id means the team already knows about the money —
    // the projection upgrade (or a re-reconcile after a customer merge) still
    // runs, but stays silent.
    mockReceiptProvider(receiptPayment());
    const db = receiptDb({ priorPayment: { id: 'pay-existing-1' } });
    const result = await syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI');
    expect(result.results.filter((row) => row.recorded)).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledWith('reconcile_qbo_payment_receipt', expect.anything());
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('links an exact UPR request marker and preserves its selected insurance payer', async () => {
    const clientRequestId = '7ef4b4ea-637e-47bd-a99c-100632aefb55';
    mockReceiptProvider(receiptPayment({ PrivateNote: `UPR receipt ${clientRequestId}` }));
    const db = receiptDb({
      attempt: {
        id: 'attempt-1',
        actor_employee_id: 'employee-1',
        qbo_payment_id: null,
        request_payload: {
          contact_id: 'contact-1',
          payment_date: '2026-07-29',
          payer_type: 'insurance',
          qbo_payment_method_id: 'pm-check',
          deposit_account_id: 'bank-1',
          reference_number: '7956',
          allocations: [
            { invoice_id: 'inv-1', amount_cents: 10000 },
            { invoice_id: 'inv-2', amount_cents: 20000 },
          ],
        },
      },
    });
    await syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI');
    const receipt = db.rpc.mock.calls[0][1];
    expect(receipt.p_receipt).toMatchObject({
      source: 'upr',
      actor_employee_id: 'employee-1',
      attempt_id: 'attempt-1',
    });
    expect(receipt.p_allocations.every((row) => row.payer_type === 'insurance')).toBe(true);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('preserves a linked UPR receipt payer even if its editable QBO note changed', async () => {
    mockReceiptProvider(receiptPayment({ PrivateNote: 'Edited in QuickBooks' }));
    const db = receiptDb({
      existingReceipt: { id: 'receipt-1', source: 'upr' },
      attempt: {
        id: 'attempt-1',
        actor_employee_id: 'employee-1',
        qbo_payment_id: 'QB-PAY-MULTI',
        request_payload: { payer_type: 'insurance' },
      },
    });
    await syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI');
    const receipt = db.rpc.mock.calls[0][1];
    expect(receipt.p_receipt).toMatchObject({
      source: 'upr',
      actor_employee_id: 'employee-1',
      attempt_id: 'attempt-1',
    });
    expect(receipt.p_allocations.every((row) => row.payer_type === 'insurance')).toBe(true);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('still announces a direct QBO receipt whose note only resembles an unknown UPR request', async () => {
    mockReceiptProvider(receiptPayment({
      PrivateNote: 'UPR receipt 7ef4b4ea-637e-47bd-a99c-100632aefb55',
    }));
    const db = receiptDb();
    await syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI');
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('does not announce or project an older provider snapshot rejected by the receipt RPC', async () => {
    mockReceiptProvider(receiptPayment());
    const db = receiptDb({ existingReceipt: { id: 'receipt-1', source: 'qbo' } });
    db.rpc.mockResolvedValue({ receipt_id: 'receipt-1', ignored_stale: true });
    await expect(syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI')).resolves.toEqual({
      ok: true,
      results: [{ qboPaymentId: 'QB-PAY-MULTI', skipped: 'stale-receipt' }],
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('fails closed on unapplied credit instead of recording a partial receipt', async () => {
    mockReceiptProvider(receiptPayment({ TotalAmt: 350, UnappliedAmt: 50 }));
    const db = receiptDb();
    await expect(syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI'))
      .rejects.toThrow(/not fully applied/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('removes stale projections when an existing receipt becomes unsupported', async () => {
    mockReceiptProvider(receiptPayment({ TotalAmt: 350, UnappliedAmt: 50 }));
    const db = receiptDb({ existingReceipt: { id: 'receipt-1', source: 'qbo' } });
    await expect(syncQboPaymentToUpr(receiptEnv, db, 'QB-PAY-MULTI'))
      .rejects.toThrow(/not fully applied/);
    expect(db.rpc).toHaveBeenCalledWith('remove_qbo_payment_receipt', expect.objectContaining({
      p_qbo_realm_id: 'realm-1',
      p_qbo_payment_id: 'QB-PAY-MULTI',
      p_status: 'conflict',
    }));
    expect(db.rpc).not.toHaveBeenCalledWith('reconcile_qbo_payment_receipt', expect.anything());
  });

  it('scopes a terminal removal to the connected realm', async () => {
    const db = {
      rpc: vi.fn(async () => ({})),
      select: vi.fn(async () => []),
      delete: vi.fn(async () => []),
    };
    await removeQboPaymentFromUpr(db, 'QB-PAY-MULTI', {
      receiptEnabled: true,
      realmId: 'realm-1',
      status: 'deleted',
      eventKey: 'event-1',
    });
    expect(db.rpc).toHaveBeenCalledWith('remove_qbo_payment_receipt', {
      p_qbo_realm_id: 'realm-1',
      p_qbo_payment_id: 'QB-PAY-MULTI',
      p_status: 'deleted',
      p_event_key: 'event-1',
    });
    expect(db.select).toHaveBeenCalledWith(
      'payments',
      'qbo_payment_id=eq.QB-PAY-MULTI&source=eq.qbo&select=id',
    );
  });

  it('removes a legacy QBO projection when the receipt tombstone reports no header', async () => {
    const db = {
      rpc: vi.fn(async () => ({ missing: true })),
      select: vi.fn(async () => [{ id: 'legacy-payment-row' }]),
      delete: vi.fn(async () => []),
    };

    await expect(removeQboPaymentFromUpr(db, 'QB-LEGACY', {
      receiptEnabled: true,
      realmId: 'realm-1',
      status: 'deleted',
      eventKey: 'event-legacy',
    })).resolves.toEqual({ ok: true, removed: 1 });

    expect(db.rpc).toHaveBeenCalledWith('remove_qbo_payment_receipt', expect.objectContaining({
      p_qbo_payment_id: 'QB-LEGACY',
      p_status: 'deleted',
    }));
    expect(db.select).toHaveBeenCalledWith(
      'payments',
      'qbo_payment_id=eq.QB-LEGACY&source=eq.qbo&select=id',
    );
    expect(db.delete).toHaveBeenCalledWith('payments', 'id=eq.legacy-payment-row');
  });

  it('finishes legacy cleanup when a tombstone replay follows a failed delete', async () => {
    const db = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ missing: true, tombstone: true })
        .mockResolvedValueOnce({ replayed: true }),
      select: vi.fn(async () => [{ id: 'legacy-payment-row' }]),
      delete: vi.fn()
        .mockRejectedValueOnce(new Error('Supabase DELETE payments: 503 temporarily unavailable'))
        .mockResolvedValueOnce([]),
    };
    const input = {
      receiptEnabled: true,
      realmId: 'realm-1',
      status: 'deleted',
      eventKey: 'event-legacy-retry',
    };

    await expect(removeQboPaymentFromUpr(db, 'QB-LEGACY', input))
      .rejects.toThrow(/503 temporarily unavailable/);
    await expect(removeQboPaymentFromUpr(db, 'QB-LEGACY', input))
      .resolves.toEqual({ ok: true, removed: 'receipt', legacyRemoved: 1 });

    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(2);
  });
});

// ─── SECTION: Intuit Fault classification (2026-07-24) ──────────────
//
// Grounded in Intuit's documented behavior, not inference: entity reads report
// "object not found" as HTTP **400 with Fault code 610**, never 404 — and Intuit's own
// troubleshooting guide notes 610 also fires when a txn "is deleted by one user and
// accessed by another". The pre-existing `res.status === 404` branch is therefore dead
// code for this API, so a genuinely-missing payment used to fall through to a bare
// `throw new Error('QBO get payment 400')`. That is exactly what one live production
// event recorded, with no way to tell why.
describe('Intuit Fault parsing + classification', () => {
  const faultRes = (status, code, message, detail) => ({
    ok: false,
    status,
    json: async () => ({ Fault: { type: 'ValidationFault', Error: [{ code, Message: message, Detail: detail }] } }),
  });

  it('parses code/message/detail out of a Fault body', async () => {
    const fault = await readQboFault(faultRes(400, '610', 'Object Not Found', 'Object Not Found: Something you are trying to use has been made inactive.'));
    expect(fault.status).toBe(400);
    expect(fault.code).toBe('610');
    expect(fault.message).toBe('Object Not Found');
    expect(fault.detail).toContain('made inactive');
  });

  it('survives a non-JSON error body instead of masking it', async () => {
    const fault = await readQboFault({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    expect(fault.status).toBe(502);
    expect(fault.code).toBeNull();
  });

  it('treats 400/610 as not-found, and does NOT treat other 400s as not-found', async () => {
    expect(isQboNotFound(await readQboFault(faultRes(400, '610', 'Object Not Found')))).toBe(true);
    expect(isQboNotFound(await readQboFault(faultRes(400, '6240', 'Duplicate Name Exists')))).toBe(true);
    expect(isQboNotFound(await readQboFault(faultRes(400, '2010', 'Invalid Reference')))).toBe(false);
    expect(isQboNotFound(await readQboFault(faultRes(401, '3200', 'Unauthorized')))).toBe(false);
  });

  it('marks 429 and 5xx retryable, and a 400-family Fault permanent', async () => {
    expect(new QboRequestError('get payment', await readQboFault(faultRes(429, '3001', 'Throttled'))).retryable).toBe(true);
    expect(new QboRequestError('get payment', await readQboFault(faultRes(503, null, null))).retryable).toBe(true);
    expect(new QboRequestError('get payment', await readQboFault(faultRes(400, '2010', 'Invalid Reference'))).retryable).toBe(false);
  });

  it('puts the fault code and message INTO the error text (the whole point)', async () => {
    const err = new QboRequestError('get payment', await readQboFault(faultRes(400, '2010', 'Invalid Reference', 'bad ref')));
    expect(err.message).toContain('400');
    expect(err.message).toContain('code=2010');
    expect(err.message).toContain('Invalid Reference');
    expect(err.faultCode).toBe('2010');
  });

  it('a 610 payment read is a benign skip, not a throw', async () => {
    qboFetch.mockResolvedValueOnce(faultRes(400, '610', 'Object Not Found'));
    const out = await syncQboPaymentToUpr(ENV, { inserts: [] }, '5796');
    expect(out.ok).toBe(true);
    expect(out.results[0].skipped).toBe('payment-not-found');
  });

  it('a non-610 payment read still throws, now with the cause attached', async () => {
    qboFetch.mockResolvedValueOnce(faultRes(400, '2010', 'Invalid Reference'));
    await expect(syncQboPaymentToUpr(ENV, { inserts: [] }, '5796')).rejects.toThrow(/code=2010/);
  });
});
