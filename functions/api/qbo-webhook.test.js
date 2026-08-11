/**
 * ════════════════════════════════════════════════
 * FILE: qbo-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QuickBooks webhook does the right thing when something goes wrong.
 *   Three behaviours matter: it must never look up a record belonging to a DIFFERENT
 *   QuickBooks company, it must remember the difference between "try this again later" and
 *   "this will never work", and it must always tell Intuit "received" so Intuit does not
 *   switch our endpoint off. Estimate events (customer accepted/declined) must route to
 *   the estimate sync and obey the exact same rules.
 *
 * WHERE IT LIVES:
 *   Tests: functions/api/qbo-webhook.js
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  everything the worker imports is mocked — no network, no Supabase, no QBO.
 *
 * NOTES / GOTCHAS:
 *   - This file is NEW (2026-07-24). The worker previously had no tests at all, which is
 *     how a silent cross-company read could reach production unnoticed.
 *   - `qbo_events.status` has NO CHECK constraint (verified live), so 'ignored' and 'retry'
 *     are accepted without a migration. If a CHECK is ever added, it must include them.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (data, status) => ({ data, status }),
}));
vi.mock('../lib/intuit.js', () => ({
  verifyIntuitSignature: vi.fn(async () => true),
  sha256hex: vi.fn(async (s) => `hash(${s})`),
}));
vi.mock('../lib/qbo-payment-sync.js', () => ({
  syncQboPaymentToUpr: vi.fn(async () => ({ ok: true, results: [] })),
  removeQboPaymentFromUpr: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../lib/qbo-estimate-sync.js', () => ({
  syncQboEstimateToUpr: vi.fn(async () => ({ ok: true, result: {} })),
}));
vi.mock('../lib/quickbooks.js', () => ({ getConnection: vi.fn() }));

const rpcCalls = [];
const updates = [];
const upserts = [];
const inserts = [];
let featureFlagEnabled = true;
let providerTrafficEnabled = true;
let maintenanceInsertError = null;
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    rpc: vi.fn(async (name, params) => { rpcCalls.push({ name, params }); return true; }),
    select: vi.fn(async (table) => {
      if (table === 'integration_config') return providerTrafficEnabled
        ? [{ value: 'true' }]
        : [];
      return table === 'feature_flags' && featureFlagEnabled
        ? [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }]
        : [];
    }),
    update: vi.fn(async (table, filter, row) => { updates.push({ table, filter, row }); return null; }),
    upsert: vi.fn(async (table, row) => { upserts.push({ table, row }); return null; }),
    insert: vi.fn(async (table, row) => {
      if (maintenanceInsertError) throw maintenanceInsertError;
      inserts.push({ table, row });
      return null;
    }),
  }),
}));

import { onRequestPost } from './qbo-webhook.js';
import { verifyIntuitSignature } from '../lib/intuit.js';
import { removeQboPaymentFromUpr, syncQboPaymentToUpr } from '../lib/qbo-payment-sync.js';
import { syncQboEstimateToUpr } from '../lib/qbo-estimate-sync.js';
import { getConnection } from '../lib/quickbooks.js';

const OUR_REALM = '9341453160223706';
const ENV = { QBO_WEBHOOK_VERIFIER_TOKEN: 'tok', SUPABASE_URL: 'https://db.test' };

function eventPost(realmId, { id = '5796', operation = 'Create', name = 'Payment' } = {}) {
  const body = JSON.stringify({
    eventNotifications: [{
      realmId,
      dataChangeEvent: { entities: [{ name, id, operation, lastUpdated: '2026-07-24T19:49:37-07:00' }] },
    }],
  });
  return { request: { text: async () => body, headers: { get: () => 'sig' } }, env: ENV };
}

beforeEach(() => {
  rpcCalls.length = 0;
  updates.length = 0;
  upserts.length = 0;
  inserts.length = 0;
  featureFlagEnabled = true;
  providerTrafficEnabled = true;
  maintenanceInsertError = null;
  syncQboPaymentToUpr.mockClear();
  syncQboPaymentToUpr.mockResolvedValue({ ok: true, results: [] });
  removeQboPaymentFromUpr.mockClear();
  removeQboPaymentFromUpr.mockResolvedValue({ ok: true });
  syncQboEstimateToUpr.mockClear();
  syncQboEstimateToUpr.mockResolvedValue({ ok: true, result: {} });
  getConnection.mockResolvedValue({ realm_id: OUR_REALM });
});

describe('qbo-webhook realm scoping', () => {
  it('acknowledges a signed maintenance delivery after atomically persisting retry metadata, without connection or projection work', async () => {
    providerTrafficEnabled = false;
    const res = await onRequestPost(eventPost(OUR_REALM));
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(inserts).toEqual([expect.objectContaining({ table: 'qbo_events', row: expect.objectContaining({
      entity: 'Payment', operation: 'Create', status: 'retry',
      error: 'qbo_provider_traffic_disabled', qbo_realm_id: OUR_REALM,
      qbo_entity_id: '5796', next_retry_at: expect.any(String),
    }) })]);
    expect(updates).toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
  });

  it('leaves a duplicate maintenance event untouched and still acknowledges Intuit', async () => {
    providerTrafficEnabled = false;
    maintenanceInsertError = new Error('Supabase INSERT qbo_events: 409 duplicate key value violates unique constraint');

    const res = await onRequestPost(eventPost(OUR_REALM, { name: 'Estimate', id: '5812', operation: 'Update' }));

    expect(res.status).toBe(200);
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
  });

  it('acknowledges an unavailable maintenance ledger without provider work', async () => {
    providerTrafficEnabled = false;
    maintenanceInsertError = new Error('Supabase INSERT qbo_events: 503 unavailable');

    const res = await onRequestPost(eventPost(OUR_REALM));

    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([]);
    expect(updates).toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
  });
  it('refuses a cross-realm event WITHOUT reading the payment', async () => {
    const res = await onRequestPost(eventPost('99999999999999'));

    // The whole bug: every QBO read is scoped to our stored realm, so reading another
    // company's payment id silently queries the wrong company and Intuit answers 400.
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].row.status).toBe('ignored');
    expect(updates[0].row.error).toMatch(/realm_mismatch/);
    expect(updates[0].row.processed_at).toBeTruthy(); // terminal, not left dangling
    expect(res.status).toBe(200); // still ack — Intuit disables endpoints that keep failing
  });

  it('processes an event from our own realm normally', async () => {
    await onRequestPost(eventPost(OUR_REALM));
    expect(syncQboPaymentToUpr).toHaveBeenCalledTimes(1);
    expect(updates[0].row.status).toBe('processed');
  });

  it('passes the verified realm into receipt-aware terminal reconciliation', async () => {
    const context = eventPost(OUR_REALM, { operation: 'Delete' });
    context.env = { ...ENV, QBO_RECEIVE_PAYMENT_ENABLED: 'true' };
    await onRequestPost(context);
    // env is pinned too: the removal path dispatches payment.voided, which needs
    // env to reach the same push/email channels the payment.received it retracts
    // went out on. Without this the forwarding could silently regress.
    expect(removeQboPaymentFromUpr).toHaveBeenCalledWith(expect.anything(), '5796', expect.objectContaining({
      receiptEnabled: true,
      status: 'deleted',
      realmId: OUR_REALM,
      env: context.env,
    }));
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
  });

  it('atomically claims receipt metadata without a separate metadata update', async () => {
    const context = eventPost(OUR_REALM);
    context.env = { ...ENV, QBO_RECEIVE_PAYMENT_ENABLED: 'true' };

    await onRequestPost(context);

    expect(rpcCalls).toEqual([{
      name: 'claim_qbo_receipt_event',
      params: {
        p_id: `hash(${OUR_REALM}:Payment:5796:Create:2026-07-24T19:49:37-07:00)`,
        p_entity: 'Payment',
        p_operation: 'Create',
        p_realm_id: OUR_REALM,
        p_entity_id: '5796',
        p_provider_updated_at: '2026-07-24T19:49:37-07:00',
      },
    }]);
    expect(updates).toEqual([expect.objectContaining({ row: expect.objectContaining({ status: 'processed' }) })]);
    expect(updates[0].row).not.toHaveProperty('qbo_realm_id');
    expect(updates[0].row).not.toHaveProperty('qbo_entity_id');
    expect(updates[0].row).not.toHaveProperty('provider_updated_at');
  });

  it('falls back to the legacy payment path while the database gate is disabled', async () => {
    featureFlagEnabled = false;
    const context = eventPost(OUR_REALM);
    context.env = { ...ENV, QBO_RECEIVE_PAYMENT_ENABLED: 'true' };

    await onRequestPost(context);

    expect(rpcCalls).toEqual([{
      name: 'claim_qbo_event',
      params: expect.objectContaining({ p_entity: 'Payment', p_operation: 'Create' }),
    }]);
    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '5796',
      { receiptEnabled: false, expectedRealmId: OUR_REALM },
    );
  });

  it('keeps Estimate claims on the established event contract while receipt mode is enabled', async () => {
    const context = eventPost(OUR_REALM, { id: '5812', operation: 'Update', name: 'Estimate' });
    context.env = { ...ENV, QBO_RECEIVE_PAYMENT_ENABLED: 'true' };

    await onRequestPost(context);

    expect(rpcCalls).toEqual([{
      name: 'claim_qbo_event',
      params: expect.objectContaining({ p_entity: 'Estimate', p_operation: 'Update' }),
    }]);
    expect(syncQboEstimateToUpr).toHaveBeenCalledWith(expect.anything(), expect.anything(), '5812', { expectedRealmId: OUR_REALM });
  });

  it('does not block processing when the realm cannot be resolved', async () => {
    // Fail open on an unreadable connection rather than dropping real payment events.
    getConnection.mockRejectedValueOnce(new Error('no connection'));
    await onRequestPost(eventPost(OUR_REALM));
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(removeQboPaymentFromUpr).not.toHaveBeenCalled();
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].row.status).toBe('retry');
    expect(updates[0].row.error).toMatch(/realm_unavailable/);
  });

  it('does not sync an event with a blank realm', async () => {
    const res = await onRequestPost(eventPost('   '));

    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(removeQboPaymentFromUpr).not.toHaveBeenCalled();
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].row.status).toBe('ignored');
    expect(updates[0].row.error).toMatch(/realm_missing/);
    expect(updates[0].row.processed_at).toBeTruthy();
    expect(res.status).toBe(200);
  });
});

describe('qbo-webhook estimate events', () => {
  it('routes an Estimate Update to the estimate sync, not the payment sync', async () => {
    await onRequestPost(eventPost(OUR_REALM, { id: '5812', operation: 'Update', name: 'Estimate' }));
    expect(syncQboEstimateToUpr).toHaveBeenCalledTimes(1);
    expect(syncQboEstimateToUpr.mock.calls[0][2]).toBe('5812');
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(updates[0].row.status).toBe('processed');
  });

  it('marks an Estimate Delete ignored without syncing (UPR owns estimate deletion)', async () => {
    await onRequestPost(eventPost(OUR_REALM, { id: '5812', operation: 'Delete', name: 'Estimate' }));
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(updates[0].row.status).toBe('ignored');
    expect(updates[0].row.error).toMatch(/not mirrored/);
    expect(updates[0].row.processed_at).toBeTruthy();
  });

  it('refuses a cross-realm estimate event WITHOUT reading it', async () => {
    await onRequestPost(eventPost('99999999999999', { id: '5812', operation: 'Update', name: 'Estimate' }));
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(updates[0].row.status).toBe('ignored');
    expect(updates[0].row.error).toMatch(/realm_mismatch/);
  });

  it('still skips entities that are neither Payment nor Estimate', async () => {
    const res = await onRequestPost(eventPost(OUR_REALM, { id: '42', operation: 'Update', name: 'Customer' }));
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0); // skipped before claiming — no qbo_events row at all
    expect(res.status).toBe(200);
  });

  it('classifies an estimate sync failure with the same retry/error split as payments', async () => {
    const err = new Error('QBO get estimate 503');
    err.retryable = true;
    syncQboEstimateToUpr.mockRejectedValueOnce(err);

    const res = await onRequestPost(eventPost(OUR_REALM, { id: '5812', operation: 'Update', name: 'Estimate' }));
    expect(updates[0].row.status).toBe('retry');
    expect(res.status).toBe(200);
  });

  it('keeps a legacy Estimate claim recoverable when maintenance closes mid-run', async () => {
    const err = new Error('QuickBooks is temporarily unavailable');
    Object.assign(err, {
      code: 'qbo_provider_traffic_disabled',
      reason: 'qbo_provider_traffic_disabled',
      status: 503,
    });
    syncQboEstimateToUpr.mockRejectedValueOnce(err);

    const res = await onRequestPost(eventPost(OUR_REALM, { id: '5812', operation: 'Update', name: 'Estimate' }));

    expect(res.status).toBe(200);
    expect(updates.at(-1).row).toMatchObject({
      status: 'retry',
      error: 'qbo_provider_traffic_disabled',
      qbo_realm_id: OUR_REALM,
      qbo_entity_id: '5812',
      provider_updated_at: '2026-07-24T19:49:37-07:00',
      next_retry_at: expect.any(String),
    });
  });

  it('finishes the claimed provider event and delegates a staff-decision conflict to one canonical item', async () => {
    syncQboEstimateToUpr.mockResolvedValueOnce({ ok: true, result: {
      skipped: 'already-decided', status: 'denied', manual_reconciliation: 'staff-decision-conflict',
    } });

    await onRequestPost(eventPost(OUR_REALM, { id: '5812', operation: 'Update', name: 'Estimate' }));

    expect(updates.at(-1).row).toMatchObject({ status: 'processed' });
    expect(updates.at(-1).row.processed_at).toBeTruthy();
    expect(updates.at(-1).row.error).toContain('reconciliation_delegated: reconcile:Estimate:5812');
    expect(updates.at(-1).row.error).toContain('Estimate=5812:staff-decision-conflict');
    expect(upserts).toEqual([expect.objectContaining({ table: 'qbo_events', row: expect.objectContaining({
      id: 'reconcile:Estimate:5812', status: 'needs_reconciliation',
    }) })]);
    expect(inserts).toEqual([expect.objectContaining({ table: 'worker_runs', row: expect.objectContaining({
      worker_name: 'qbo-webhook', status: 'error', meta: expect.objectContaining({ reconciliation_count: 1 }),
    }) })]);
  });

  it('rejects an invalid Intuit signature before any estimate work (negative auth)', async () => {
    verifyIntuitSignature.mockResolvedValueOnce(false);

    const res = await onRequestPost(eventPost(OUR_REALM, { id: '5812', operation: 'Update', name: 'Estimate' }));

    expect(res.status).toBe(401);
    expect(syncQboEstimateToUpr).not.toHaveBeenCalled();
    expect(syncQboPaymentToUpr).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0); // nothing claimed, nothing written
  });
});

describe('qbo-webhook failure classification', () => {
  it('records a retryable provider failure as retry, not error', async () => {
    const err = new Error('QBO get payment 503');
    err.retryable = true;
    syncQboPaymentToUpr.mockRejectedValueOnce(err);

    const res = await onRequestPost(eventPost(OUR_REALM));
    expect(updates[0].row.status).toBe('retry');
    expect(res.status).toBe(200);
  });

  it('records a permanent provider refusal as error, with the fault text kept', async () => {
    const err = new Error('QBO get payment 400 code=2010 Invalid Reference');
    err.retryable = false;
    syncQboPaymentToUpr.mockRejectedValueOnce(err);

    await onRequestPost(eventPost(OUR_REALM));
    expect(updates[0].row.status).toBe('error');
    expect(updates[0].row.error).toContain('code=2010');
  });
});
