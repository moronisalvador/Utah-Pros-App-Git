/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.receipts.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the safety-net worker can retry a payment event that the real-time
 *   webhook could not finish. It also keeps terminal changes scoped to the
 *   connected QuickBooks company.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-payments-sync with mocked QBO reconciliation helpers
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - These are queue behavior tests; they make no network or database calls.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/qbo-payment-sync.js', () => ({
  removeQboPaymentFromUpr: vi.fn(),
  syncQboPaymentToUpr: vi.fn(),
}));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(),
  qboFetch: vi.fn(),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(),
}));
const reconcileDb = {
  insert: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
};
vi.mock('../lib/supabase.js', () => ({
  supabase: () => reconcileDb,
}));

import { drainReceiptRetries, scheduled } from './qbo-payments-sync.js';
import { removeQboPaymentFromUpr, syncQboPaymentToUpr } from '../lib/qbo-payment-sync.js';
import { getConnection, qboFetch } from '../lib/quickbooks.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const ENV = { QBO_RECEIVE_PAYMENT_ENABLED: 'true' };

function dbWith(events, staleEvents = []) {
  return {
    select: vi.fn()
      .mockResolvedValueOnce(events)
      .mockResolvedValueOnce(staleEvents),
    rpc: vi.fn(async () => true),
    update: vi.fn(async () => []),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  syncQboPaymentToUpr.mockResolvedValue({ ok: true, results: [] });
  removeQboPaymentFromUpr.mockResolvedValue({ ok: true });
  reconcileDb.rpc.mockResolvedValue(true);
  reconcileDb.insert.mockResolvedValue(null);
  reconcileDb.select.mockImplementation(async (table) => {
    if (table === 'integration_config') return [{ value: 'true' }];
    if (table === 'feature_flags') {
      return [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }];
    }
    return [];
  });
  reconcileDb.update.mockResolvedValue([]);
  getConnection.mockResolvedValue({ realm_id: 'realm-1', refresh_token: 'refresh' });
});

describe('QBO receipt retry queue', () => {
  it('retries a due payment event and marks it processed', async () => {
    const db = dbWith([{
      id: 'event-1',
      operation: 'Update',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-1',
      retry_count: 1,
    }]);
    await expect(drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true })).resolves.toEqual({
      processed: 1,
      failed: 0,
    });
    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(ENV, db, 'payment-1', {
      receiptEnabled: true,
      expectedRealmId: 'realm-1',
    });
    expect(db.update).toHaveBeenCalledWith('qbo_events', 'id=eq.event-1', expect.objectContaining({
      status: 'processed',
      retry_count: 2,
      next_retry_at: null,
    }));
  });

  it('retries a delete through the realm-scoped receipt tombstone path', async () => {
    const db = dbWith([{
      id: 'event-delete',
      operation: 'Delete',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-2',
      retry_count: 0,
    }]);
    await drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true });
    // env is forwarded so the removal path can dispatch payment.voided on the
    // same push/email channels the payment.received it retracts went out on.
    expect(removeQboPaymentFromUpr).toHaveBeenCalledWith(db, 'payment-2', {
      receiptEnabled: true,
      status: 'deleted',
      eventKey: 'event-delete',
      realmId: 'realm-1',
      env: ENV,
    });
  });

  it('never processes an event from a different QuickBooks company', async () => {
    const db = dbWith([{
      id: 'event-foreign',
      operation: 'Update',
      qbo_realm_id: 'realm-2',
      qbo_entity_id: 'payment-3',
      retry_count: 0,
    }]);
    await drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true });
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(removeQboPaymentFromUpr).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledWith('qbo_events', 'id=eq.event-foreign', expect.objectContaining({
      status: 'ignored',
      error: 'realm_mismatch',
    }));
  });

  it('keeps a transient database 5xx in the durable retry queue', async () => {
    const db = dbWith([{
      id: 'event-db-5xx',
      operation: 'Update',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-4',
      retry_count: 1,
    }]);
    syncQboPaymentToUpr.mockRejectedValueOnce(
      new Error('Supabase RPC reconcile_qbo_payment_receipt: 503 temporarily unavailable'),
    );
    await expect(drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true })).resolves.toEqual({
      processed: 0,
      failed: 1,
    });
    expect(db.update).toHaveBeenCalledWith(
      'qbo_events',
      'id=eq.event-db-5xx',
      expect.objectContaining({
        status: 'retry',
        retry_count: 2,
        next_retry_at: expect.any(String),
      }),
    );
  });

  it('keeps a connection-change boundary retryable and stores its stable code', async () => {
    const db = dbWith([{
      id: 'event-connection-changed',
      operation: 'Update',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-connection-changed',
      retry_count: 0,
    }]);
    const failure = new Error('QuickBooks connection changed while its token refreshed');
    failure.code = 'qbo-connection-changed';
    syncQboPaymentToUpr.mockRejectedValueOnce(failure);

    await expect(drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true })).resolves.toEqual({
      processed: 0,
      failed: 1,
    });
    expect(db.update).toHaveBeenCalledWith('qbo_events', 'id=eq.event-connection-changed', expect.objectContaining({
      status: 'retry',
      error: 'qbo-connection-changed',
      next_retry_at: expect.any(String),
    }));
  });

  it('recovers a stale receipt-mode processing claim, but leaves fresh work alone', async () => {
    const db = dbWith([], [{
      id: 'event-stale-processing',
      operation: 'Update',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-stale',
      retry_count: 0,
    }]);

    await expect(drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true })).resolves.toEqual({
      processed: 1,
      failed: 0,
    });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.select.mock.calls[1][1]).toContain('status=eq.processing');
    expect(db.select.mock.calls[1][1]).toContain('qbo_entity_id=not.is.null');
    expect(db.select.mock.calls[1][1]).toContain('created_at=lte.');
    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(ENV, db, 'payment-stale', {
      receiptEnabled: true,
      expectedRealmId: 'realm-1',
    });
  });

  it('does not select or process a future retry', async () => {
    const db = dbWith([]);

    await expect(drainReceiptRetries(ENV, db, 'realm-1', { receiptEnabled: true })).resolves.toEqual({
      processed: 0,
      failed: 0,
    });
    expect(db.select.mock.calls[0][1]).toContain('status=eq.retry');
    expect(db.select.mock.calls[0][1]).toContain('next_retry_at.lte.');
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(removeQboPaymentFromUpr).not.toHaveBeenCalled();
  });

  it('keeps the receipt queue inert when only the worker switch is enabled', async () => {
    const db = dbWith([{ id: 'event-1' }]);
    await expect(drainReceiptRetries(ENV, db, 'realm-1')).resolves.toEqual({
      processed: 0,
      failed: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('atomically claims CDC retry metadata before recording its failure outcome', async () => {
    qboFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        CDCResponse: [{ QueryResponse: [{ Payment: [{
          Id: 'payment-cdc',
          MetaData: { LastUpdatedTime: '2026-07-31T01:02:03Z' },
        }] }] }],
      }),
    });
    const failure = new Error('QBO temporarily unavailable');
    failure.retryable = true;
    syncQboPaymentToUpr.mockRejectedValueOnce(failure);

    await scheduled({}, ENV, {});

    expect(reconcileDb.rpc).toHaveBeenCalledWith('claim_qbo_receipt_event', {
      p_id: 'cdc-retry:realm-1:payment-cdc:2026-07-31T01:02:03Z',
      p_entity: 'Payment',
      p_operation: 'CDC',
      p_realm_id: 'realm-1',
      p_entity_id: 'payment-cdc',
      p_provider_updated_at: '2026-07-31T01:02:03Z',
    });
    expect(reconcileDb.update).toHaveBeenCalledWith(
      'qbo_events',
      'id=eq.cdc-retry%3Arealm-1%3Apayment-cdc%3A2026-07-31T01%3A02%3A03Z',
      expect.not.objectContaining({
        qbo_realm_id: expect.anything(),
        qbo_entity_id: expect.anything(),
        provider_updated_at: expect.anything(),
      }),
    );
  });

  it('persists a CDC connection boundary as a retry with its stable code', async () => {
    qboFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        CDCResponse: [{ QueryResponse: [{ Payment: [{
          Id: 'payment-cdc-connection',
          MetaData: { LastUpdatedTime: '2026-07-31T01:02:04Z' },
        }] }] }],
      }),
    });
    const failure = new Error('QuickBooks connection changed while its token refreshed');
    failure.code = 'qbo-connection-changed';
    syncQboPaymentToUpr.mockRejectedValueOnce(failure);

    await scheduled({}, ENV, {});

    expect(reconcileDb.update).toHaveBeenCalledWith(
      'qbo_events',
      'id=eq.cdc-retry%3Arealm-1%3Apayment-cdc-connection%3A2026-07-31T01%3A02%3A04Z',
      expect.objectContaining({
        status: 'retry',
        error: 'qbo-connection-changed',
        next_retry_at: expect.any(String),
      }),
    );
  });

  it('atomically preserves a legacy-mode maintenance race beyond the seven-day CDC window', async () => {
    qboFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        CDCResponse: [{ QueryResponse: [{ Payment: [{
          Id: 'payment-cdc-legacy-boundary',
          MetaData: { LastUpdatedTime: '2020-01-01T00:00:00Z' },
        }] }] }],
      }),
    });
    const failure = new Error('QuickBooks maintenance boundary');
    Object.assign(failure, {
      code: 'qbo_provider_traffic_disabled',
      reason: 'qbo_provider_traffic_disabled',
      status: 503,
    });
    syncQboPaymentToUpr.mockRejectedValueOnce(failure);

    await scheduled({}, {}, {});

    expect(reconcileDb.rpc).not.toHaveBeenCalledWith('claim_qbo_receipt_event', expect.anything());
    expect(reconcileDb.insert).toHaveBeenCalledWith('qbo_events', expect.objectContaining({
      id: 'cdc-retry:realm-1:payment-cdc-legacy-boundary:2020-01-01T00:00:00Z',
      entity: 'Payment',
      operation: 'CDC',
      status: 'retry',
      error: 'qbo_provider_traffic_disabled',
      qbo_realm_id: 'realm-1',
      qbo_entity_id: 'payment-cdc-legacy-boundary',
      provider_updated_at: '2020-01-01T00:00:00Z',
      next_retry_at: expect.any(String),
    }));
  });

  it('a failed receipt-mode CDC payment leaves an error run carrying scanned/webhook_missed telemetry', async () => {
    qboFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        CDCResponse: [{ QueryResponse: [{ Payment: [{ Id: 'payment-cdc' }] }] }],
      }),
    });
    syncQboPaymentToUpr.mockRejectedValueOnce(
      new Error('Supabase RPC reconcile_qbo_payment_receipt: 403 NOT_AUTHORIZED'),
    );

    await scheduled({}, ENV, {});

    expect(recordWorkerRun).toHaveBeenCalledWith(reconcileDb, expect.objectContaining({
      workerName: 'qbo-payments-sync',
      status: 'error',
      recordsProcessed: 0,
      errorMessage: expect.stringContaining('qbo_failure'),
      meta: expect.objectContaining({
        scanned: 1,
        source: 'cdc',
        webhook_missed: 0,
        failed: 1,
        query_window: expect.objectContaining({ days: 7 }),
      }),
    }));
    expect(JSON.stringify(recordWorkerRun.mock.calls)).not.toContain('NOT_AUTHORIZED');
  });

  // The reported symptom, at the worker level. CDC re-reports a VOIDED payment as an
  // ordinary update (a void is not a delete — the entity still exists), so it reaches
  // syncQboPaymentToUpr rather than the `status === 'deleted'` removal branch. When the
  // library rejected it, the poller recorded 'error' every hour until the payment aged
  // out of the 7-day window (live: payment 6059, 2026-08-07 16:17:00Z). A void is a
  // clean skip, so the run must be green and carry no failure telemetry.
  it('a voided CDC payment leaves a completed run, not a permanently red poller', async () => {
    // Both provider calls are stubbed: an unmocked estimate sweep throws and would
    // turn the run red for a reason that has nothing to do with the void.
    qboFetch.mockImplementation(async (_env, path) => (path.startsWith('/cdc')
      ? { ok: true, json: async () => ({ CDCResponse: [{ QueryResponse: [{ Payment: [{ Id: '6059' }] }] }] }) }
      : { ok: true, json: async () => ({ QueryResponse: {} }) }));
    syncQboPaymentToUpr.mockResolvedValueOnce({
      ok: true,
      results: [{ qboPaymentId: '6059', skipped: 'voided' }],
    });

    await scheduled({}, ENV, {});

    expect(recordWorkerRun).toHaveBeenCalledWith(reconcileDb, expect.objectContaining({
      workerName: 'qbo-payments-sync',
      status: 'completed',
      errorMessage: null,
      meta: expect.objectContaining({ scanned: 1, failed: 0, webhook_missed: 0 }),
    }));
    // A void needs no human decision, so it must not open a reconciliation item.
    expect(recordWorkerRun.mock.calls[0][1].meta.reconciliation_count).toBe(0);
  });

  it('stays inert while the receive-payment worker switch is off', async () => {
    const db = dbWith([{ id: 'event-1' }]);
    await expect(drainReceiptRetries({}, db, 'realm-1')).resolves.toEqual({
      processed: 0,
      failed: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
