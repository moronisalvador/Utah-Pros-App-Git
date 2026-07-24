/**
 * ════════════════════════════════════════════════
 * FILE: qbo-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QuickBooks payment webhook does the right thing when something goes wrong.
 *   Three behaviours matter: it must never look up a payment belonging to a DIFFERENT
 *   QuickBooks company, it must remember the difference between "try this again later" and
 *   "this will never work", and it must always tell Intuit "received" so Intuit does not
 *   switch our endpoint off.
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
vi.mock('../lib/quickbooks.js', () => ({ getConnection: vi.fn() }));

const updates = [];
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    rpc: vi.fn(async () => true), // claim_qbo_event → first delivery
    update: vi.fn(async (table, filter, row) => { updates.push({ table, filter, row }); return null; }),
  }),
}));

import { onRequestPost } from './qbo-webhook.js';
import { syncQboPaymentToUpr } from '../lib/qbo-payment-sync.js';
import { getConnection } from '../lib/quickbooks.js';

const OUR_REALM = '9341453160223706';
const ENV = { QBO_WEBHOOK_VERIFIER_TOKEN: 'tok', SUPABASE_URL: 'https://db.test' };

function eventPost(realmId, { id = '5796', operation = 'Create' } = {}) {
  const body = JSON.stringify({
    eventNotifications: [{
      realmId,
      dataChangeEvent: { entities: [{ name: 'Payment', id, operation, lastUpdated: '2026-07-24T19:49:37-07:00' }] },
    }],
  });
  return { request: { text: async () => body, headers: { get: () => 'sig' } }, env: ENV };
}

beforeEach(() => {
  updates.length = 0;
  syncQboPaymentToUpr.mockClear();
  syncQboPaymentToUpr.mockResolvedValue({ ok: true, results: [] });
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

  it('does not block processing when the realm cannot be resolved', async () => {
    // Fail open on an unreadable connection rather than dropping real payment events.
    getConnection.mockRejectedValueOnce(new Error('no connection'));
    await onRequestPost(eventPost(OUR_REALM));
    expect(syncQboPaymentToUpr).toHaveBeenCalledTimes(1);
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
