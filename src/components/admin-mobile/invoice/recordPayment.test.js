/**
 * ════════════════════════════════════════════════
 * FILE: recordPayment.test.js  (Admin Mobile — finding F-1 money-path tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile record-payment path can't corrupt invoice money math:
 *   it writes only the allowed payment columns (never the trigger-owned ones),
 *   refuses a double-tap while a save is running, only mirrors to QuickBooks
 *   when the invoice is already there, and treats a failed QuickBooks mirror
 *   as a warning — never as a reason to lose the recorded payment.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./recordPayment (buildPaymentInsert / createPaymentRecorder)
 *   Data:      reads → none · writes → none (db + fetch are stubbed)
 *
 * NOTES / GOTCHAS:
 *   - These are the named tests bound by finding F-1 in
 *     docs/admin-mobile-roadmap.md (Phase P3) — do not weaken them.
 *   - Plain-node vitest (no jsdom): the module is DOM-free by design.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SAFE_PAYMENT_COLUMNS,
  TRIGGER_OWNED_COLUMNS,
  buildPaymentInsert,
  createPaymentRecorder,
} from './recordPayment';

const INV = { id: 'inv-1', contact_id: 'c-1', qbo_invoice_id: 'QBO-77', adjusted_total: null, total: 500, amount_paid: 100 };
const JOB = { id: 'job-1' };
const EMP = { id: 'emp-1' };
const FORM = { amount: '250', date: '2026-07-07', payer_type: 'insurance', method: 'check', reference: 'chk 1001', payer_name: 'State Farm' };

const okJson = (body = {}) => ({ ok: true, json: async () => body });
const failJson = (error) => ({ ok: false, statusText: 'Bad Gateway', json: async () => ({ error }) });
const auth = async () => ({ Authorization: 'Bearer test' });

function makeDb(insertImpl) {
  return { insert: vi.fn(insertImpl || (async (_t, data) => [{ id: 'pay-1', ...data }])) };
}

describe('record-payment insert payload (F-1 — safe column set)', () => {
  it('writes only the safe column set — exact keys, nothing else', () => {
    const payload = buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(Object.keys(payload).sort()).toEqual([...SAFE_PAYMENT_COLUMNS].sort());
  });

  it('never writes amount_paid / insurance_paid / homeowner_paid / status / paid_at (trigger-owned)', () => {
    const payload = buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    for (const col of TRIGGER_OWNED_COLUMNS) {
      expect(payload).not.toHaveProperty(col);
    }
    // Belt-and-braces: the frozen safe list itself contains no trigger-owned column.
    expect(SAFE_PAYMENT_COLUMNS.filter((c) => TRIGGER_OWNED_COLUMNS.includes(c))).toEqual([]);
  });

  it('the db.insert call itself carries only safe columns', async () => {
    const db = makeDb();
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(db.insert).toHaveBeenCalledTimes(1);
    const [table, data] = db.insert.mock.calls[0];
    expect(table).toBe('payments');
    expect(Object.keys(data).sort()).toEqual([...SAFE_PAYMENT_COLUMNS].sort());
    for (const col of TRIGGER_OWNED_COLUMNS) expect(data).not.toHaveProperty(col);
    expect(data.amount).toBe(250);
    expect(data.recorded_by).toBe('emp-1');
  });
});

describe('double-submit guard', () => {
  it('a second call while one is in flight is refused and inserts nothing', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const db = makeDb(async (_t, data) => { await gate; return [{ id: 'pay-1', ...data }]; });
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });

    const first = record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    const second = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(second).toEqual({ ok: false, reason: 'in_flight' });
    expect(db.insert).toHaveBeenCalledTimes(1); // the double-tap never reached the DB

    release();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });

  it('the latch releases after completion — a later, deliberate payment still works', async () => {
    const db = makeDb();
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    expect((await record({ invoice: INV, job: JOB, employee: EMP, form: FORM })).ok).toBe(true);
    expect((await record({ invoice: INV, job: JOB, employee: EMP, form: FORM })).ok).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing/zero amount before touching the DB', async () => {
    const db = makeDb();
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn() });
    expect(await record({ invoice: INV, job: JOB, employee: EMP, form: { amount: '0' } }))
      .toEqual({ ok: false, reason: 'invalid_amount' });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('QBO mirror precondition (qbo_invoice_id)', () => {
  it('POSTs /api/qbo-payment with the new payment id when qbo_invoice_id exists', async () => {
    const fetchFn = vi.fn(async () => okJson());
    const record = createPaymentRecorder({ db: makeDb(), getAuthHeader: auth, fetchFn });
    const res = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(res).toMatchObject({ ok: true, qboSynced: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/qbo-payment');
    expect(opts.headers.Authorization).toBe('Bearer test');
    expect(JSON.parse(opts.body)).toEqual({ payment_id: 'pay-1' });
  });

  it('does NOT call /api/qbo-payment when the invoice has no qbo_invoice_id', async () => {
    const fetchFn = vi.fn();
    const record = createPaymentRecorder({ db: makeDb(), getAuthHeader: auth, fetchFn });
    const res = await record({ invoice: { ...INV, qbo_invoice_id: null }, job: JOB, employee: EMP, form: FORM });
    expect(res).toMatchObject({ ok: true, qboSynced: false, qboSkipped: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('QBO sync failure is NON-FATAL', () => {
  it('a failed mirror still reports ok:true with the persisted row and the error', async () => {
    const db = makeDb();
    const fetchFn = vi.fn(async () => failJson('QBO is down'));
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn });
    const res = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(res.ok).toBe(true);                 // the UPR payment is recorded
    expect(res.row.id).toBe('pay-1');          // …and we still have the row
    expect(res.qboSynced).toBe(false);
    expect(res.qboError).toBe('QBO is down');  // …with the error surfaced, not swallowed
    expect(db.insert).toHaveBeenCalledTimes(1); // and nothing was rolled back / retried
  });

  it('a thrown fetch (network) is equally non-fatal', async () => {
    const record = createPaymentRecorder({
      db: makeDb(), getAuthHeader: auth, fetchFn: vi.fn(async () => { throw new Error('offline'); }),
    });
    const res = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(res).toMatchObject({ ok: true, qboSynced: false, qboError: 'offline' });
  });

  it('an insert failure (before QBO) is a clean ok:false with no fetch attempted', async () => {
    const fetchFn = vi.fn();
    const record = createPaymentRecorder({
      db: makeDb(async () => { throw new Error('RLS says no'); }), getAuthHeader: auth, fetchFn,
    });
    const res = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(res).toEqual({ ok: false, reason: 'insert_failed', error: 'RLS says no' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
