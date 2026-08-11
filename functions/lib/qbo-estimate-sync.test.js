/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-sync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QBO→UPR estimate answer sync behaves safely. A customer accepting
 *   an estimate online must approve + convert the UPR estimate exactly once
 *   (re-deliveries and UPR's own conversion echoes must no-op), must never
 *   append lines onto an invoice that already has them, and must never
 *   overwrite a decision staff already made in UPR (approved/denied/paid).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo-estimate-sync.js (system under test); ./quickbooks.js and
 *              the adoption helper in ./qbo-payment-sync.js are mocked — no
 *              network, no Supabase.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 *   - The fault helpers (readQboFault / isQboNotFound / QboRequestError) are the
 *     REAL ones so the Intuit 400-Fault classification stays covered end-to-end.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./quickbooks.js', () => ({ qboFetch: vi.fn() }));
// notify.js is only reached through qbo-payment-sync's payment path — mock it so
// importing the real fault helpers below never touches email/push modules.
vi.mock('../api/notify.js', () => ({ dispatchEvent: vi.fn(async () => ({ ok: true })) }));
vi.mock('./qbo-payment-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, adoptInvoiceFromQboEstimate: vi.fn(async () => ({ id: 'inv-adopted', job_id: 'job-1' })) };
});

import { syncQboEstimateToUpr, acceptedDateToIso } from './qbo-estimate-sync.js';
import { adoptInvoiceFromQboEstimate } from './qbo-payment-sync.js';
import { qboFetch } from './quickbooks.js';

const ENV = { SUPABASE_URL: 'https://db.test' };

function estimateResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      Estimate: { Id: '5812', TxnStatus: 'Accepted', TotalAmt: 1500, AcceptedDate: '2026-07-21', ...overrides },
    }),
  };
}

function makeDb(estRow, { rpcResult } = {}) {
  const updates = [];
  const rpcs = [];
  return {
    updates,
    rpcs,
    async select(table) {
      if (table === 'estimates') return estRow ? [estRow] : [];
      return [];
    },
    async update(table, filter, patch) { updates.push({ table, filter, patch }); return null; },
    async rpc(fn, params) {
      rpcs.push({ fn, params });
      if (rpcResult !== undefined) return rpcResult;
      if (estRow?.converted_invoice_id) return { ok: true, skipped: 'already-converted', status: estRow.status, invoice_id: estRow.converted_invoice_id };
      if (params.p_action === 'accept' && estRow?.status === 'approved') return { ok: true, skipped: 'already-decided', status: 'approved' };
      if (params.p_action === 'accept' && estRow?.status === 'denied') return { ok: true, skipped: 'already-decided', status: 'denied' };
      if (params.p_action === 'reject' && estRow?.status === 'denied') return { ok: true, skipped: 'already-denied', status: 'denied' };
      if (params.p_action === 'reject') return { ok: true, action: 'denied' };
      if (params.p_action === 'approve_only') return { ok: true, action: 'approved-needs-manual-convert', invoice_id: null };
      return { ok: true, action: 'approved-and-converted', invoice_id: 'inv-new' };
    },
  };
}

const SUBMITTED_EST = {
  id: 'est-1', status: 'submitted', amount: 1500,
  approved_at: null, approved_amount: null, converted_invoice_id: null, estimate_number: 'EST-001008',
};

beforeEach(() => {
  qboFetch.mockReset();
  adoptInvoiceFromQboEstimate.mockClear();
});

describe('acceptedDateToIso', () => {
  it('anchors the date-only AcceptedDate to noon UTC so the day is preserved in any US zone', () => {
    expect(acceptedDateToIso('2026-07-21')).toBe('2026-07-21T12:00:00.000Z');
  });
  it('returns null for missing or malformed dates', () => {
    expect(acceptedDateToIso(null)).toBeNull();
    expect(acceptedDateToIso('yesterday')).toBeNull();
  });
});

describe('frozen company boundary', () => {
  it('passes the captured realm to the provider read and writes no UPR projection on a mismatch', async () => {
    const switched = Object.assign(new Error('QuickBooks connection realm changed'), { code: 'qbo-realm-mismatch' });
    const db = makeDb(SUBMITTED_EST);
    qboFetch.mockRejectedValueOnce(switched);

    await expect(syncQboEstimateToUpr(ENV, db, '5812', { expectedRealmId: 'realm-a' })).rejects.toBe(switched);
    expect(qboFetch).toHaveBeenCalledWith(ENV, expect.any(String), expect.objectContaining({ expectedRealmId: 'realm-a' }));
    expect(db.rpcs).toEqual([]);
    expect(db.updates).toEqual([]);
  });
});

describe('syncQboEstimateToUpr — Accepted', () => {
  it('approves + converts a submitted estimate through the locked decision RPC', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.action).toBe('approved-and-converted');
    expect(out.result.invoice_id).toBe('inv-new');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toEqual([{ fn: 'apply_qbo_estimate_decision', params: {
      p_estimate_id: 'est-1', p_action: 'accept',
      p_approved_at: '2026-07-21T12:00:00.000Z', p_approved_amount: 1500,
    } }]);
  });

  it('approves WITHOUT copying lines when the target invoice already has some (needs_confirm)', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const db = makeDb({ ...SUBMITTED_EST }, { rpcResult: { ok: true, action: 'approved-needs-manual-convert', invoice_id: 'inv-existing' } });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.action).toBe('approved-needs-manual-convert');
    expect(out.result.invoice_id).toBe('inv-existing');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(1);
  });

  it('no-ops on a re-delivered acceptance (already approved)', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const db = makeDb({ ...SUBMITTED_EST, status: 'approved', approved_at: '2026-07-21T18:00:00Z' });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.skipped).toBe('already-decided');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(1);
  });

  it('no-ops when the estimate is already converted', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const db = makeDb({ ...SUBMITTED_EST, converted_invoice_id: 'inv-9' });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');
    expect(out.result.skipped).toBe('already-converted');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(1);
  });

  it('never overwrites a staff denial with a customer acceptance', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const db = makeDb({ ...SUBMITTED_EST, status: 'denied' });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');
    expect(out.result.skipped).toBe('already-decided');
    expect(out.result.status).toBe('denied');
    expect(out.result.manual_reconciliation).toBe('staff-decision-conflict');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(1);
  });
});

describe('syncQboEstimateToUpr — Rejected', () => {
  it('marks a submitted estimate denied with the QBO decline reason', async () => {
    qboFetch.mockResolvedValue(estimateResponse({ TxnStatus: 'Rejected' }));
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.action).toBe('denied');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toEqual([{ fn: 'apply_qbo_estimate_decision', params: {
      p_estimate_id: 'est-1', p_action: 'reject', p_approved_at: null, p_approved_amount: null,
    } }]);
  });

  it('never regresses an approved/converted estimate to denied', async () => {
    qboFetch.mockResolvedValue(estimateResponse({ TxnStatus: 'Rejected' }));
    const db = makeDb({ ...SUBMITTED_EST, status: 'approved', converted_invoice_id: 'inv-9' });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');
    expect(out.result.skipped).toBe('already-converted');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(1);
  });
});

describe('syncQboEstimateToUpr — Converted', () => {
  it('no-ops on the echo of a UPR-side conversion', async () => {
    qboFetch.mockResolvedValue(estimateResponse({ TxnStatus: 'Converted' }));
    const db = makeDb({ ...SUBMITTED_EST, status: 'approved', converted_invoice_id: 'inv-9' });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.skipped).toBe('already-converted');
    expect(adoptInvoiceFromQboEstimate).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it('adopts an ordinary QBO-side conversion only through the non-forcing helper path', async () => {
    qboFetch.mockResolvedValue(estimateResponse({
      TxnStatus: 'Converted',
      LinkedTxn: [{ TxnType: 'Invoice', TxnId: '901' }],
    }));
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(adoptInvoiceFromQboEstimate).toHaveBeenCalledWith(ENV, db, '901', false, true, { expectedRealmId: undefined });
    expect(out.result.action).toBe('adopted-qbo-conversion');
    expect(out.result.invoice_id).toBe('inv-adopted');
  });

  it('never overturns a staff denial with a QBO-side conversion', async () => {
    qboFetch.mockResolvedValue(estimateResponse({
      TxnStatus: 'Converted',
      LinkedTxn: [{ TxnType: 'Invoice', TxnId: '901' }],
    }));
    const db = makeDb({ ...SUBMITTED_EST, status: 'denied' });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.skipped).toBe('already-decided');
    expect(out.result.status).toBe('denied');
    expect(adoptInvoiceFromQboEstimate).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
  });

  it('still adopts for an approved-awaiting-manual-convert estimate (deliberate pass-through)', async () => {
    qboFetch.mockResolvedValue(estimateResponse({
      TxnStatus: 'Converted',
      LinkedTxn: [{ TxnType: 'Invoice', TxnId: '901' }],
    }));
    const db = makeDb({ ...SUBMITTED_EST, status: 'approved', approved_at: '2026-07-21T12:00:00Z', approved_amount: 1500 });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(adoptInvoiceFromQboEstimate).toHaveBeenCalledWith(ENV, db, '901', false, true, { expectedRealmId: undefined });
    expect(out.result.action).toBe('adopted-qbo-conversion');
  });

  it('falls back to approve-only when the linked invoice cannot be adopted', async () => {
    adoptInvoiceFromQboEstimate.mockResolvedValueOnce(null);
    qboFetch.mockResolvedValue(estimateResponse({
      TxnStatus: 'Converted',
      LinkedTxn: [{ TxnType: 'Invoice', TxnId: '901' }],
    }));
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.action).toBe('approved-needs-manual-convert');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toEqual([{ fn: 'apply_qbo_estimate_decision', params: {
      p_estimate_id: 'est-1', p_action: 'approve_only',
      p_approved_at: '2026-07-21T12:00:00.000Z', p_approved_amount: 1500,
    } }]);
  });

  it('cannot append estimate lines to a populated invoice after a Converted event', async () => {
    // The real helper returns null for convert_estimate_to_invoice(needs_confirm)
    // when this ordinary status path passes p_force:false. The sync therefore
    // records approval only and leaves the existing invoice for manual review.
    adoptInvoiceFromQboEstimate.mockResolvedValueOnce(null);
    qboFetch.mockResolvedValue(estimateResponse({
      TxnStatus: 'Converted',
      LinkedTxn: [{ TxnType: 'Invoice', TxnId: '901' }],
    }));
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(adoptInvoiceFromQboEstimate).toHaveBeenCalledWith(ENV, db, '901', false, true, { expectedRealmId: undefined });
    expect(out.result).toMatchObject({ ok: true, action: 'approved-needs-manual-convert', invoice_id: null });
    expect(db.rpcs).toHaveLength(1);
    expect(db.updates).toHaveLength(0);
  });
});

describe('syncQboEstimateToUpr — boundaries', () => {
  it('skips estimates UPR does not track (no qbo_estimate_id match)', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const db = makeDb(null);

    const out = await syncQboEstimateToUpr(ENV, db, '5812');
    expect(out.result.skipped).toBe('not-tracked');
    expect(db.updates).toHaveLength(0);
  });

  it('does not choose an arbitrary UPR estimate for a combined QBO estimate id', async () => {
    qboFetch.mockResolvedValue(estimateResponse());
    const updates = [];
    const rpcs = [];
    const db = {
      updates,
      rpcs,
      async select() {
        return [
          { ...SUBMITTED_EST, id: 'est-1' },
          { ...SUBMITTED_EST, id: 'est-2' },
        ];
      },
      async update(...args) { updates.push(args); },
      async rpc(...args) { rpcs.push(args); },
    };

    const out = await syncQboEstimateToUpr(ENV, db, '5812');

    expect(out.result.skipped).toBe('combined-estimate-manual-reconciliation');
    expect(db.updates).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
    expect(adoptInvoiceFromQboEstimate).not.toHaveBeenCalled();
  });

  it('ignores statuses that carry no customer answer (Pending)', async () => {
    qboFetch.mockResolvedValue(estimateResponse({ TxnStatus: 'Pending' }));
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');
    expect(out.result.skipped).toBe('status-not-synced');
    expect(db.updates).toHaveLength(0);
  });

  it('treats an Intuit 400 "object not found" Fault as benign-terminal', async () => {
    qboFetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ Fault: { type: 'ValidationFault', Error: [{ code: '610', Message: 'Object Not Found' }] } }),
    });
    const db = makeDb({ ...SUBMITTED_EST });

    const out = await syncQboEstimateToUpr(ENV, db, '5812');
    expect(out.result.skipped).toBe('estimate-not-found');
  });

  it('throws a retryable error on a QBO 5xx so the webhook marks it retry', async () => {
    qboFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const db = makeDb({ ...SUBMITTED_EST });

    await expect(syncQboEstimateToUpr(ENV, db, '5812')).rejects.toMatchObject({ retryable: true });
  });
});
