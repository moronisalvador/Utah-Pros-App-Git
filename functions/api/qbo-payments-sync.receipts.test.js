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
  reconcileDb.select.mockImplementation(async (table) => table === 'feature_flags'
    ? [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }]
    : []);
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
    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(ENV, db, 'payment-1', { receiptEnabled: true });
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
    expect(removeQboPaymentFromUpr).toHaveBeenCalledWith(db, 'payment-2', {
      receiptEnabled: true,
      status: 'deleted',
      eventKey: 'event-delete',
      realmId: 'realm-1',
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
    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(ENV, db, 'payment-stale', { receiptEnabled: true });
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

  it('stays inert while the receive-payment worker switch is off', async () => {
    const db = dbWith([{ id: 'event-1' }]);
    await expect(drainReceiptRetries({}, db, 'realm-1')).resolves.toEqual({
      processed: 0,
      failed: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
