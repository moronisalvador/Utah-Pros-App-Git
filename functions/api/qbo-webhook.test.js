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

const updates = [];
const upserts = [];
const inserts = [];
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    rpc: vi.fn(async () => true), // claim_qbo_event → first delivery
    update: vi.fn(async (table, filter, row) => { updates.push({ table, filter, row }); return null; }),
    upsert: vi.fn(async (table, row) => { upserts.push({ table, row }); return null; }),
    insert: vi.fn(async (table, row) => { inserts.push({ table, row }); return null; }),
  }),
}));

import { onRequestPost } from './qbo-webhook.js';
import { verifyIntuitSignature } from '../lib/intuit.js';
import { syncQboPaymentToUpr, removeQboPaymentFromUpr } from '../lib/qbo-payment-sync.js';
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
  updates.length = 0;
  upserts.length = 0;
  inserts.length = 0;
  syncQboPaymentToUpr.mockClear();
  syncQboPaymentToUpr.mockResolvedValue({ ok: true, results: [] });
  removeQboPaymentFromUpr.mockClear();
  removeQboPaymentFromUpr.mockResolvedValue({ ok: true });
  syncQboEstimateToUpr.mockClear();
  syncQboEstimateToUpr.mockResolvedValue({ ok: true, result: {} });
  getConnection.mockResolvedValue({ realm_id: OUR_REALM });
});

describe('qbo-webhook realm scoping', () => {
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

  it('does not sync when the connection realm cannot be resolved', async () => {
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
