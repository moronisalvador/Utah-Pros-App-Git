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

import { drainProviderBoundaryRetries, onRequestPost } from './qbo-payments-sync.js';
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

function estimateRetryDb(events) {
  return {
    select: vi.fn(async () => events),
    update: vi.fn(async () => null),
    upsert: vi.fn(async () => null),
  };
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

  it.each(['qbo-connection-changed', 'qbo-realm-mismatch', 'qbo-realm-unavailable'])(
    'reports %s from estimate sync as a failed sweep instead of swallowing it',
    async (code) => {
      qboFetch.mockImplementation(async (_env, path) => {
        const q = decodeURIComponent(path);
        if (q.includes('FROM Payment')) return queryResult({ Payment: [] });
        return queryResult({ Estimate: [{ Id: 'E-boundary', TxnStatus: 'Accepted' }] });
      });
      const failure = new Error('QuickBooks connection changed before the provider request');
      failure.code = code;
      syncQboEstimateToUpr.mockRejectedValueOnce(failure);

      const res = await onRequestPost(CTX);

      expect(res.data.estimates).toEqual({ ok: false, error: code });
      expect(workerRun().row).toMatchObject({
        status: 'error',
        error_message: expect.stringContaining('estimate sweep'),
      });
    },
  );

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

describe('qbo-payments-sync durable provider-boundary retry queue', () => {
  it('replays an older-than-seven-days Estimate event and marks it terminally processed', async () => {
    const retryDb = estimateRetryDb([{
      id: 'estimate-retry-old',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'estimate-older-than-window',
      retry_count: 2,
      provider_updated_at: '2020-01-01T00:00:00Z',
    }]);

    await expect(drainProviderBoundaryRetries(ENV, retryDb, 'realm-1')).resolves.toMatchObject({
      processed: 1,
      failed: 0,
    });
    expect(retryDb.select).toHaveBeenCalledWith('qbo_events', expect.stringContaining('entity=in.(Payment,Estimate)&status=eq.retry'));
    expect(syncQboEstimateToUpr).toHaveBeenCalledWith(ENV, retryDb, 'estimate-older-than-window', {
      expectedRealmId: 'realm-1',
    });
    expect(retryDb.update).toHaveBeenCalledWith('qbo_events', 'id=eq.estimate-retry-old', expect.objectContaining({
      status: 'processed',
      retry_count: 3,
      next_retry_at: null,
    }));
  });

  it('terminally ignores an Estimate retry from another QuickBooks realm', async () => {
    const retryDb = estimateRetryDb([{
      id: 'estimate-retry-foreign',
      qbo_realm_id: 'realm-2',
      qbo_entity_id: 'estimate-foreign',
      retry_count: 0,
    }]);

    await expect(drainProviderBoundaryRetries(ENV, retryDb, 'realm-1')).resolves.toMatchObject({
      processed: 0,
      failed: 0,
    });
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(retryDb.update).toHaveBeenCalledWith('qbo_events', 'id=eq.estimate-retry-foreign', expect.objectContaining({
      status: 'ignored',
      error: 'realm_mismatch',
      next_retry_at: null,
    }));
  });

  it.each(['qbo_provider_traffic_disabled', 'qbo-connection-changed', 'qbo-realm-unavailable'])(
    'keeps a mid-drain %s boundary in the durable Estimate queue',
    async (code) => {
      const retryDb = estimateRetryDb([{
        id: `estimate-retry-${code}`,
        qbo_realm_id: 'realm-1',
        qbo_entity_id: 'estimate-boundary',
        retry_count: 9,
      }]);
      const failure = new Error('QuickBooks is temporarily unavailable');
      Object.assign(failure, code === 'qbo_provider_traffic_disabled'
        ? { code, reason: code, status: 503 }
        : { code });
      syncQboEstimateToUpr.mockRejectedValueOnce(failure);

      await expect(drainProviderBoundaryRetries(ENV, retryDb, 'realm-1')).resolves.toMatchObject({
        processed: 0,
        failed: 1,
      });
      expect(retryDb.update).toHaveBeenCalledWith(
        'qbo_events',
        `id=eq.estimate-retry-${code}`,
        expect.objectContaining({ status: 'retry', error: code, next_retry_at: expect.any(String) }),
      );
    },
  );

  it('replays an older Payment boundary in legacy projection mode when receipt rollout is off', async () => {
    const retryDb = estimateRetryDb([{
      id: 'payment-retry-legacy-old',
      entity: 'Payment',
      operation: 'Update',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-older-than-window',
      retry_count: 0,
      provider_updated_at: '2020-01-01T00:00:00Z',
    }]);
    syncQboPaymentToUpr.mockResolvedValueOnce({ ok: true, results: [] });

    await expect(drainProviderBoundaryRetries(ENV, retryDb, 'realm-1', { receiptEnabled: false })).resolves.toMatchObject({
      processed: 1,
      failed: 0,
    });
    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(ENV, retryDb, 'payment-older-than-window', {
      receiptEnabled: false,
      expectedRealmId: 'realm-1',
    });
    expect(retryDb.update).toHaveBeenCalledWith('qbo_events', 'id=eq.payment-retry-legacy-old', expect.objectContaining({
      status: 'processed',
      next_retry_at: null,
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
    expect(workerRun().row.meta.cdc_error).toBe('qbo_cdc_fault_4000');
  });

  it('records a stable classification for a dropped payment, never raw upstream fault text', async () => {
    qboFetch.mockImplementation(async (_env, path) => {
      if (path.startsWith('/cdc?')) {
        return { ok: true, status: 200, json: async () => ({
          CDCResponse: [{ QueryResponse: [{ Payment: [{ Id: 'P-broken' }] }] }],
        }) };
      }
      return queryResult({ Estimate: [] });
    });
    const privateDetail = 'QBO Fault Detail: customer Alice account 12345';
    syncQboPaymentToUpr.mockRejectedValueOnce(Object.assign(new Error(privateDetail), {
      faultCode: '2010', status: 400, intuitTid: 'tid-payment-400', retryable: false,
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await onRequestPost(CTX);

    const run = workerRun();
    expect(run.row.status).toBe('error');
    expect(run.row.error_message).toContain('qbo_fault_2010');
    expect(JSON.stringify(run.row)).not.toContain(privateDetail);
    expect(JSON.stringify(run.row)).not.toContain('Alice');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(privateDetail);
    expect(JSON.stringify(errorSpy.mock.calls)).toContain('qbo_fault_2010 [intuit_tid:tid-payment-400]');
    expect(run.row.records_processed).toBe(0);
    expect(run.row.meta).toMatchObject({ scanned: 1, failed: 1, webhook_missed: 0 });
    expect(res.data).toMatchObject({ ok: true, failed: 1, recorded: 0 });
    errorSpy.mockRestore();
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
