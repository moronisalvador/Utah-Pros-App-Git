/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the hourly QuickBooks safety-net sweep does both of its jobs: record
 *   recent payments, and mirror recent estimate answers (accepted / declined /
 *   converted). It also proves the two jobs are isolated — a broken estimate
 *   sweep must never stop payments from being recorded — and pins the exact
 *   provider query construction (second-precision CDC window, LastUpdatedTime
 *   fallback) plus the honest worker_runs telemetry (scanned, query window,
 *   webhook_missed, and error status when work is dropped).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo-payments-sync.js (system under test); QBO, Supabase and both
 *              sync libraries are mocked — no network.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbWrites = vi.hoisted(() => ({ updates: [], upserts: [], inserts: [] }));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (data, status) => ({ data, status }),
}));
// QBO_ADMIN_ROLES is passed through by this worker: the 2026-08-05 billing widening opened
// the invoicing workers to office/project_manager, and this operational sync deliberately
// stayed admin-only. Mocked here so the pass-through is exercised, not bypassed.
vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboRequest: vi.fn(async () => ({ ok: true })),
  QBO_ADMIN_ROLES: ['admin'],
}));
const db = {
  insert: vi.fn(async (table, row) => {
    dbWrites.inserts.push({ table, row });
    return null;
  }),
  select: vi.fn(async (table) => table === 'integration_config' ? [{ value: 'true' }] : []),
  update: vi.fn(async (table, filter, row) => {
    dbWrites.updates.push({ table, filter, row });
    return null;
  }),
  upsert: vi.fn(async (table, row) => {
    dbWrites.upserts.push({ table, row });
    return null;
  }),
};
vi.mock('../lib/supabase.js', () => ({
  supabase: () => db,
}));
vi.mock('../lib/quickbooks.js', () => ({ qboFetch: vi.fn(), getConnection: vi.fn() }));
vi.mock('../lib/qbo-payment-sync.js', () => ({
  syncQboPaymentToUpr: vi.fn(async () => ({ ok: true, results: [{ recorded: true }] })),
}));
vi.mock('../lib/qbo-estimate-sync.js', () => ({
  syncQboEstimateToUpr: vi.fn(async () => ({ ok: true, result: { action: 'approved-and-converted' } })),
}));

import { onRequestPost } from './qbo-payments-sync.js';
import { authorizeQboRequest } from '../lib/qbo-auth.js';
import { qboFetch, getConnection } from '../lib/quickbooks.js';
import { syncQboPaymentToUpr } from '../lib/qbo-payment-sync.js';
import { syncQboEstimateToUpr } from '../lib/qbo-estimate-sync.js';

const ENV = { SUPABASE_URL: 'https://db.test' };
const CTX = { request: { headers: { get: () => null } }, env: ENV };

function queryResult(payload) {
  return { ok: true, status: 200, json: async () => ({ QueryResponse: payload }) };
}

beforeEach(() => {
  dbWrites.updates.length = 0;
  dbWrites.upserts.length = 0;
  dbWrites.inserts.length = 0;
  qboFetch.mockReset();
  syncQboPaymentToUpr.mockClear();
  syncQboEstimateToUpr.mockClear();
  getConnection.mockResolvedValue({ realm_id: '1', refresh_token: 'rt' });
});

afterEach(() => {
  vi.useRealTimers();
});

function workerRun() {
  return dbWrites.inserts.find((w) => w.table === 'worker_runs') || null;
}

describe('qbo-payments-sync estimate sweep', () => {
  it('sweeps only estimates carrying a customer answer (Accepted/Rejected/Converted)', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [{ Id: 'P1' }] });
      if (q.includes('FROM Estimate')) {
        return queryResult({
          Estimate: [
            { Id: '5812', TxnStatus: 'Accepted' },
            { Id: '5884', TxnStatus: 'Pending' },     // no answer — must be filtered out
            { Id: '5823', TxnStatus: 'Converted' },
            { Id: '5900', TxnStatus: 'Rejected' },
          ],
        });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await onRequestPost(CTX);

    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(
      ENV,
      expect.anything(),
      'P1',
      { receiptEnabled: false, expectedRealmId: '1' },
    );
    const sweptIds = syncQboEstimateToUpr.mock.calls.map((c) => c[2]);
    expect(sweptIds).toEqual(['5812', '5823', '5900']);
    expect(res.data.estimates).toEqual({
      ok: true, scanned: 3, acted: 3, skipped: 0,
      reconciliation_count: 0, reconciliation_reasons: [],
    });
    expect(res.data.recorded).toBe(1);
  });

  it('keeps recording payments even when the estimate sweep fails', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [{ Id: 'P1' }] });
      return { ok: false, status: 503, json: async () => ({}) };
    });

    const res = await onRequestPost(CTX);

    expect(res.data.ok).toBe(true);
    expect(res.data.recorded).toBe(1);
    expect(res.data.estimates.ok).toBe(false);
  });

  it('a rejected authorization short-circuits before any QBO read or sync (negative auth)', async () => {
    authorizeQboRequest.mockResolvedValueOnce({ ok: false, status: 403, error: 'forbidden' });

    const res = await onRequestPost(CTX);

    expect(res.status).toBe(403);
    expect(qboFetch).not.toHaveBeenCalled();
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
  });

  it('one failing estimate does not stop the rest of the sweep', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [] });
      return queryResult({ Estimate: [{ Id: 'E1', TxnStatus: 'Accepted' }, { Id: 'E2', TxnStatus: 'Accepted' }] });
    });
    syncQboEstimateToUpr.mockRejectedValueOnce(new Error('QBO get estimate 503'));

    const res = await onRequestPost(CTX);

    expect(syncQboEstimateToUpr).toHaveBeenCalledTimes(2);
    expect(res.data.estimates.scanned).toBe(2);
    expect(res.data.estimates.acted).toBe(1);
  });

  it('persists and reports a combined estimate reconciliation boundary', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [] });
      return queryResult({ Estimate: [{ Id: 'E-combined', TxnStatus: 'Accepted' }] });
    });
    syncQboEstimateToUpr.mockResolvedValueOnce({ ok: true, result: {
      skipped: 'combined-estimate-manual-reconciliation',
    } });

    const res = await onRequestPost(CTX);

    expect(res.data.estimates).toMatchObject({
      reconciliation_count: 1,
      reconciliation_reasons: ['combined-estimate'],
    });
  });

  it('the hourly sweep closes the same synthetic item after a later unambiguous result', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [] });
      return queryResult({ Estimate: [{ Id: 'E-lifecycle', TxnStatus: 'Accepted' }] });
    });
    syncQboEstimateToUpr
      .mockResolvedValueOnce({ ok: true, result: { manual_reconciliation: 'staff-decision-conflict' } })
      .mockResolvedValueOnce({ ok: true, result: { action: 'approved-and-converted' } });

    await onRequestPost(CTX);
    await onRequestPost(CTX);

    expect(dbWrites.upserts).toContainEqual(expect.objectContaining({
      table: 'qbo_events',
      row: expect.objectContaining({
        id: 'reconcile:Estimate:E-lifecycle',
        status: 'needs_reconciliation',
      }),
    }));
    expect(dbWrites.updates).toContainEqual(expect.objectContaining({
      table: 'qbo_events',
      filter: 'id=eq.reconcile:Estimate:E-lifecycle',
      row: expect.objectContaining({ status: 'processed', error: null }),
    }));
  });
});

describe('qbo-payments-sync query construction + telemetry', () => {
  const FROZEN_NOW = '2026-08-05T12:00:00.000Z';
  // 7 days back, in Intuit's documented second-precision dateTime — no milliseconds.
  const WINDOW_START = '2026-07-29T12:00:00Z';

  function freezeClock() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));
  }

  it('sends CDC changedSince as a second-precision UTC timestamp for a frozen clock', async () => {
    freezeClock();
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/cdc?')) {
        return { ok: true, status: 200, json: async () => ({
          CDCResponse: [{ QueryResponse: [{ Payment: [{ Id: 'P-cdc' }] }] }],
        }) };
      }
      return queryResult({ Estimate: [] });
    });

    const res = await onRequestPost(CTX);

    expect(qboFetch.mock.calls[0][1]).toBe(
      `/cdc?entities=Payment&changedSince=${encodeURIComponent(WINDOW_START)}&minorversion=70`,
    );
    expect(res.data).toMatchObject({ ok: true, source: 'cdc', scanned: 1, recorded: 1 });
  });

  it('falls back to a MetaData.LastUpdatedTime window (never TxnDate) when CDC fails, and stores scanned + the window in worker_runs meta', async () => {
    freezeClock();
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/cdc?')) return { ok: false, status: 403, json: async () => ({}) };
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [{ Id: 'P1' }, { Id: 'P2' }] });
      return queryResult({ Estimate: [] });
    });
    syncQboPaymentToUpr
      .mockResolvedValueOnce({ ok: true, results: [{ recorded: true }] })
      .mockResolvedValueOnce({ ok: true, results: [{ skipped: 'already-synced' }] });

    const res = await onRequestPost(CTX);

    expect(qboFetch.mock.calls[1][1]).toBe(
      `/query?query=${encodeURIComponent(
        `SELECT * FROM Payment WHERE MetaData.LastUpdatedTime >= '${WINDOW_START}' MAXRESULTS 500`,
      )}&minorversion=70`,
    );
    const run = workerRun();
    expect(run.row.status).toBe('completed');
    expect(run.row.records_processed).toBe(1);
    expect(run.row.meta).toMatchObject({
      scanned: 2,
      source: 'query-fallback',
      cdc_error: 'HTTP 403',
      query_window: { changed_since: WINDOW_START, days: 7 },
      webhook_missed: 1,
      failed: 0,
    });
    expect(res.data).toMatchObject({
      scanned: 2, recorded: 1, skipped: 1, webhook_missed: 1, source: 'query-fallback',
    });
  });

  it('treats a Fault riding on an HTTP-200 CDC body as CDC failure (fail closed), not as zero changes', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/cdc?')) {
        return { ok: true, status: 200, json: async () => ({
          CDCResponse: [{ Fault: {
            Error: [{ Message: 'metadata date format is invalid', code: '4000' }],
            type: 'ValidationFault',
          } }],
        }) };
      }
      const q = decodeURIComponent(path);
      if (q.includes('FROM Payment')) return queryResult({ Payment: [{ Id: 'P1' }] });
      return queryResult({ Estimate: [] });
    });

    const res = await onRequestPost(CTX);

    expect(res.data).toMatchObject({ recorded: 1, source: 'query-fallback' });
    expect(workerRun().row.meta.cdc_error).toBe('fault 4000 — metadata date format is invalid');
  });

  it('a run that drops a payment mid-sweep records status error with the real failure, never completed', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/cdc?')) {
        return { ok: true, status: 200, json: async () => ({
          CDCResponse: [{ QueryResponse: [{ Payment: [{ Id: 'P-broken' }] }] }],
        }) };
      }
      return queryResult({ Estimate: [] });
    });
    syncQboPaymentToUpr.mockRejectedValueOnce(
      new Error('Supabase RPC reconcile_qbo_payment_receipt: 403 NOT_AUTHORIZED'),
    );

    const res = await onRequestPost(CTX);

    const run = workerRun();
    expect(run.row.status).toBe('error');
    expect(run.row.error_message).toContain('NOT_AUTHORIZED');
    expect(run.row.records_processed).toBe(0);
    expect(run.row.meta).toMatchObject({ scanned: 1, failed: 1, webhook_missed: 0 });
    expect(res.data).toMatchObject({ ok: true, failed: 1, recorded: 0 });
  });

  it('records an error run — not silence — when CDC and the fallback query both fail', async () => {
    qboFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));

    const res = await onRequestPost(CTX);

    expect(res.data.ok).toBe(false);
    expect(res.data.error).toBe('QBO query 500 (cdc: HTTP 500)');
    const run = workerRun();
    expect(run.row.status).toBe('error');
    expect(run.row.error_message).toBe('QBO query 500 (cdc: HTTP 500)');
    expect(run.row.meta).toMatchObject({ scanned: 0, source: 'query-fallback', cdc_error: 'HTTP 500' });
  });
});
