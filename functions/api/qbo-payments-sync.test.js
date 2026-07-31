/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the hourly QuickBooks safety-net sweep does both of its jobs: record
 *   recent payments, and mirror recent estimate answers (accepted / declined /
 *   converted). It also proves the two jobs are isolated — a broken estimate
 *   sweep must never stop payments from being recorded.
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
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (data, status) => ({ data, status }),
}));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboRequest: vi.fn(async () => ({ ok: true })) }));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({ insert: vi.fn(async () => null) }),
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
  qboFetch.mockReset();
  syncQboPaymentToUpr.mockClear();
  syncQboEstimateToUpr.mockClear();
  getConnection.mockResolvedValue({ realm_id: '1', refresh_token: 'rt' });
});

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

    expect(syncQboPaymentToUpr).toHaveBeenCalledWith(ENV, expect.anything(), 'P1');
    const sweptIds = syncQboEstimateToUpr.mock.calls.map((c) => c[2]);
    expect(sweptIds).toEqual(['5812', '5823', '5900']);
    expect(res.data.estimates).toEqual({ ok: true, scanned: 3, acted: 3, skipped: 0 });
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
});
