/**
 * ════════════════════════════════════════════════
 * FILE: qbo-query.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Ensures a QuickBooks maintenance close-race uses the shared retry-safe
 *   response. It also proves provider Fault bodies and thrown upstream details
 *   never appear in the browser response.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: qbo-query.js
 *   Data: none (all dependencies mocked)
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  qboFetch: vi.fn(),
  providerTraffic: [{ value: 'true' }],
}));

vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboRequest: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(async () => ({ refresh_token: 'present', realm_id: 'realm-query' })),
  qboFetch: (...args) => h.qboFetch(...args),
}));
vi.mock('../lib/supabase.js', () => ({ supabase: () => ({
  select: async (table) => table === 'integration_config' ? h.providerTraffic : [],
}) }));

import { onRequestPost } from './qbo-query.js';

beforeEach(() => {
  vi.clearAllMocks();
  h.providerTraffic = [{ value: 'true' }];
});

describe('qbo-query provider maintenance', () => {
  it('returns a stable 503 when the central helper closes before the QBO query fetch', async () => {
    h.qboFetch.mockRejectedValueOnce(Object.assign(
      new Error('QuickBooks provider traffic is temporarily disabled.'),
      { code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled', status: 503 },
    ));
    const request = new Request('https://app.test/api/qbo-query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT * FROM Customer MAXRESULTS 1' }),
    });

    const response = await onRequestPost({ request, env: {} });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled',
    });
  });

  it('does not expose a rejected provider Fault body', async () => {
    const privateDetail = 'private customer and document detail';
    h.qboFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      Fault: { Error: [{ Message: 'Validation Fault', Detail: privateDetail }] },
    }), { status: 400, headers: { 'Content-Type': 'application/json', intuit_tid: 'tid-query-400' } }));
    const request = new Request('https://app.test/api/qbo-query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT * FROM Customer MAXRESULTS 1' }),
    });

    const response = await onRequestPost({ request, env: {} });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'QuickBooks rejected the read-only query.',
      code: 'qbo_query_rejected',
      intuit_tid: 'tid-query-400',
    });
    expect(JSON.stringify(body)).not.toContain(privateDetail);
  });

  it('does not expose a thrown upstream error message', async () => {
    const privateDetail = 'upstream body with private customer content';
    h.qboFetch.mockRejectedValueOnce(Object.assign(new Error(privateDetail), { intuitTid: 'tid-query-502' }));
    const request = new Request('https://app.test/api/qbo-query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT * FROM Customer MAXRESULTS 1' }),
    });

    const response = await onRequestPost({ request, env: {} });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: 'qbo_query_unavailable', intuit_tid: 'tid-query-502' });
    expect(JSON.stringify(body)).not.toContain(privateDetail);
  });

  it('pins the query to the admitted realm and returns a stable mismatch without a provider response', async () => {
    h.qboFetch.mockRejectedValueOnce(Object.assign(
      new Error('private refreshed-token diagnostic'),
      { code: 'qbo-realm-mismatch', intuitTid: 'tid-query-realm' },
    ));
    const request = new Request('https://app.test/api/qbo-query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT * FROM Customer MAXRESULTS 1' }),
    });

    const response = await onRequestPost({ request, env: {} });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: 'qbo_query_unavailable', intuit_tid: 'tid-query-realm' });
    expect(JSON.stringify(body)).not.toContain('private refreshed-token diagnostic');
    expect(h.qboFetch).toHaveBeenCalledWith(
      {}, expect.any(String), expect.objectContaining({ expectedRealmId: 'realm-query' }),
    );
  });
});
