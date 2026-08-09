/**
 * ════════════════════════════════════════════════
 * FILE: recordPayment.test.js  (Admin Mobile — finding F-1 money-path tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile record-payment path can't corrupt invoice money math:
 *   it writes only the allowed payment columns (never the trigger-owned ones),
 *   refuses a double-tap while a save is running, records the same payment only
 *   once even when the phone never hears back whether the first try worked,
 *   only mirrors to QuickBooks when the invoice is already there, and treats a
 *   failed QuickBooks mirror as a warning — never as a reason to lose the
 *   recorded payment.
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
  amountCents,
  buildPaymentInsert,
  createPaymentRecorder,
  paymentIdempotencyKey,
  paymentMatchesPayload,
  paymentProbeQuery,
} from './recordPayment';

const INV = { id: 'inv-1', contact_id: 'c-1', qbo_invoice_id: 'QBO-77', adjusted_total: null, total: 500, amount_paid: 100 };
const JOB = { id: 'job-1' };
const EMP = { id: 'emp-1' };
const FORM = { amount: '250', date: '2026-07-07', payer_type: 'insurance', method: 'check', reference: 'chk 1001', payer_name: 'State Farm' };

const okJson = (body = {}) => ({ ok: true, json: async () => body });
const failJson = (error) => ({ ok: false, statusText: 'Bad Gateway', json: async () => ({ error }) });
const auth = async () => ({ Authorization: 'Bearer test' });

function makeDb(insertImpl, selectImpl) {
  return {
    insert: vi.fn(insertImpl || (async (_t, data) => [{ id: 'pay-1', ...data }])),
    select: vi.fn(selectImpl || (async () => [])),
  };
}

/** The row PostgREST would hand back for FORM — the probe's happy case. */
const persistedRow = (over = {}) => ({
  id: 'pay-1',
  ...buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form: FORM }),
  ...over,
});

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

describe('idempotency key (AGENTS.md §15 — stable, content-derived, never Date.now())', () => {
  const keyFor = (form) => paymentIdempotencyKey(
    buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form }),
  );

  it('is stable across time — the same payment computed twice is the same key', () => {
    // The whole point: nothing in the key is sampled from the clock. If a
    // Date.now()/uuid ever creeps in, these two diverge and this fails.
    expect(keyFor(FORM)).toBe(keyFor(FORM));
  });

  it('collapses equivalent amount spellings — "250", "250.0", "250.00" are ONE payment', () => {
    const base = keyFor(FORM);
    for (const amount of ['250', '250.0', '250.00', 250]) {
      expect(keyFor({ ...FORM, amount })).toBe(base);
    }
    expect(amountCents('250.00')).toBe(25000);
    expect(amountCents(0.1 + 0.2)).toBe(30); // float noise rounds, never truncates
  });

  it('differs for every field a human can genuinely change', () => {
    const base = keyFor(FORM);
    const variants = {
      amount: { ...FORM, amount: '250.01' },
      date: { ...FORM, date: '2026-07-08' },
      payer_type: { ...FORM, payer_type: 'homeowner' },
      method: { ...FORM, method: 'eft' },
      payer_name: { ...FORM, payer_name: 'Allstate' },
      // Two real cheques for the same amount on the same day differ HERE.
      reference: { ...FORM, reference: 'chk 1002' },
    };
    for (const [field, form] of Object.entries(variants)) {
      expect(keyFor(form), field).not.toBe(base);
    }
    // …and a different invoice is a different payment even if all else matches.
    expect(paymentIdempotencyKey(
      buildPaymentInsert({ invoice: { ...INV, id: 'inv-2' }, job: JOB, employee: EMP, form: FORM }),
    )).not.toBe(base);
  });

  it('is built from the payload, so an omitted date still keys on the date written', () => {
    const payload = buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form: { ...FORM, date: '' } });
    expect(paymentIdempotencyKey(payload)).toContain(payload.payment_date);
    expect(payload.payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('probes on unambiguous columns only, and matches the rest in JS', () => {
    const payload = buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    const q = paymentProbeQuery(payload);
    expect(q).toContain('invoice_id=eq.inv-1');
    expect(q).toContain('amount=eq.250');
    expect(q).toContain('payment_date=eq.2026-07-07');
    expect(q).toContain('payer_type=eq.insurance');
    expect(q).toContain('payment_method=eq.check');
    // Free text stays OUT of the filter — 'chk 1001' has a space, and PostgREST
    // filter quoting is exactly the kind of thing that breaks silently.
    expect(q).not.toContain('reference_number');
    expect(q).not.toContain('payer_name');

    expect(paymentMatchesPayload(persistedRow(), payload)).toBe(true);
    // …but the JS match is what actually enforces the free-text fields.
    expect(paymentMatchesPayload(persistedRow({ reference_number: 'chk 1002' }), payload)).toBe(false);
    expect(paymentMatchesPayload(persistedRow({ payer_name: 'Allstate' }), payload)).toBe(false);
    expect(paymentMatchesPayload(persistedRow({ amount: '250.00' }), payload)).toBe(true);
    expect(paymentMatchesPayload(null, payload)).toBe(false);
  });

  it('a null reference matches a null reference, not any reference', () => {
    const bare = buildPaymentInsert({ invoice: INV, job: JOB, employee: EMP, form: { ...FORM, reference: '', payer_name: '' } });
    expect(bare.reference_number).toBeNull();
    expect(paymentMatchesPayload({ ...bare, reference_number: null, payer_name: null }, bare)).toBe(true);
    expect(paymentMatchesPayload({ ...bare, reference_number: 'chk 1001' }, bare)).toBe(false);
  });
});

describe('retry after an unknown outcome lands exactly ONE row', () => {
  it('the dropped-response case: attempt fails, row DID land, retry adopts it', async () => {
    // The driveway scenario. The insert reaches Postgres, the response never
    // reaches the phone. Without the probe the retry posts the money twice.
    let attempt = 0;
    const db = makeDb(
      async () => { attempt += 1; throw new Error('Failed to fetch'); },
      async () => [persistedRow()],
    );
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });

    const first = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(first).toMatchObject({ ok: false, reason: 'insert_failed' });

    const second = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(second).toMatchObject({ ok: true, deduped: true, qboSynced: true });
    expect(second.row.id).toBe('pay-1');
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(attempt).toBe(1);              // the retry never inserted again
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('the truly-failed case: attempt fails, nothing landed, retry writes exactly once', async () => {
    let attempt = 0;
    const db = makeDb(
      async (_t, data) => {
        attempt += 1;
        if (attempt === 1) throw new Error('RLS says no');
        return [{ id: 'pay-9', ...data }];
      },
      async () => [],                      // probe: the server has nothing
    );
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });

    expect(await record({ invoice: INV, job: JOB, employee: EMP, form: FORM }))
      .toMatchObject({ ok: false, reason: 'insert_failed' });
    const second = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(second).toMatchObject({ ok: true, qboSynced: true });
    expect(second.deduped).toBeUndefined();
    expect(second.row.id).toBe('pay-9');
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('a retry after SUCCESS is served from memory — the money is never posted twice', async () => {
    const db = makeDb();
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    const first = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    const second = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });

    expect(first).toMatchObject({ ok: true, qboSynced: true });
    expect(second).toMatchObject({ ok: true, deduped: true });
    expect(second.row.id).toBe(first.row.id);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();  // no probe needed — we KNOW it landed
  });

  it('a genuinely different payment still writes, even right after one succeeded', async () => {
    const db = makeDb(async (_t, data) => [{ id: `pay-${data.reference_number}`, ...data }]);
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    const other = await record({ invoice: INV, job: JOB, employee: EMP, form: { ...FORM, reference: 'chk 1002' } });
    expect(other).toMatchObject({ ok: true });
    expect(other.deduped).toBeUndefined();
    expect(db.insert).toHaveBeenCalledTimes(2);   // two cheques, two rows
  });

  it('a probe that cannot answer REFUSES rather than guessing', async () => {
    const db = makeDb(
      async () => { throw new Error('offline'); },
      async () => { throw new Error('offline'); },
    );
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    const second = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(second).toMatchObject({ ok: false, reason: 'probe_failed' });
    expect(db.insert).toHaveBeenCalledTimes(1);   // it did NOT write on an unanswered question
  });

  it('ignores a server row that only partly matches — a near-miss is a different payment', async () => {
    const db = makeDb(
      async (_t, data) => { throw Object.assign(new Error('Failed to fetch'), { data }); },
      async () => [persistedRow({ id: 'pay-old', reference_number: 'chk 0001' })],
    );
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    const second = await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    // The probe found a same-amount/date/method row with a different cheque
    // number, so it is NOT ours: we must try to write again, not adopt it.
    expect(second).toMatchObject({ ok: false, reason: 'insert_failed' });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('an adopted row still re-runs the QuickBooks mirror (which is itself idempotent)', async () => {
    const fetchFn = vi.fn(async () => okJson());
    const db = makeDb(
      async () => { throw new Error('Failed to fetch'); },
      async () => [persistedRow()],
    );
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn });
    await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    await record({ invoice: INV, job: JOB, employee: EMP, form: FORM });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ payment_id: 'pay-1' });
  });

  it('refuses to be built without a select — the guarantee cannot be silently dropped', () => {
    expect(() => createPaymentRecorder({ db: { insert: vi.fn() }, getAuthHeader: auth }))
      .toThrow(/insert and select/);
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
    // A DIFFERENT payment, deliberately: repeating the identical one is now
    // served from the idempotency memory instead (see the retry suite above).
    const db = makeDb(async (_t, data) => [{ id: `pay-${data.reference_number}`, ...data }]);
    const record = createPaymentRecorder({ db, getAuthHeader: auth, fetchFn: vi.fn(async () => okJson()) });
    expect((await record({ invoice: INV, job: JOB, employee: EMP, form: FORM })).ok).toBe(true);
    expect((await record({ invoice: INV, job: JOB, employee: EMP, form: { ...FORM, reference: 'chk 1002' } })).ok).toBe(true);
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
