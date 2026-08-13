/**
 * ════════════════════════════════════════════════
 * FILE: qbo-provider-traffic.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QuickBooks pause switch stays closed unless its saved value is
 *   exactly right. It blocks new provider requests and credential writes while
 *   closed, while allowing an already-returned rotated refresh token to finish
 *   its exact-version persistence before the next Accounting request is refused.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-provider-traffic.js, quickbooks.js
 *   Data:      reads  → simulated integration_config
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are local doubles only; no QuickBooks or Supabase service is called.
 * ════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  config: [{ value: 'true' }],
  configQueue: [],
  connection: {
    access_token: 'test-access', refresh_token: 'test-refresh',
    token_expires_at: '2099-01-01T00:00:00.000Z', realm_id: 'test-realm', environment: 'sandbox',
  },
  fetches: [],
  supabaseArgs: [],
  rpcs: [],
  updates: [],
  upserts: [],
}));

vi.mock('./supabase.js', () => ({
  supabase: (env, fetchImpl) => {
    harness.supabaseArgs.push({ env, fetchImpl });
    return {
      select: vi.fn(async (table) => table === 'integration_config'
        ? (harness.configQueue.length ? harness.configQueue.shift() : harness.config)
        : [harness.connection]),
      rpc: vi.fn(async (name, params) => { harness.rpcs.push({ name, params }); return { ok: true }; }),
      update: vi.fn(async (...args) => { harness.updates.push(args); return [harness.connection]; }),
      upsert: vi.fn(async (...args) => { harness.upserts.push(args); return [harness.connection]; }),
    };
  },
}));

vi.mock('./http.js', () => ({
  fetchWithTimeout: vi.fn(async (url, options, timeoutMs) => {
    harness.fetches.push({ url, options, timeoutMs });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  }),
}));

import {
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS,
  isQboProviderTrafficDisabled,
  qboProviderTrafficDisabledResponse,
  requireQboProviderTraffic,
} from './qbo-provider-traffic.js';
import {
  exchangeCodeForTokens, paymentsFetch, qboFetch, saveTokens, uploadAttachable,
} from './quickbooks.js';

beforeEach(() => {
  harness.config = [{ value: 'true' }];
  harness.configQueue.length = 0;
  harness.fetches.length = 0;
  harness.supabaseArgs.length = 0;
  harness.rpcs.length = 0;
  harness.updates.length = 0;
  harness.upserts.length = 0;
});

afterEach(() => vi.useRealTimers());

describe('QBO provider traffic maintenance boundary', () => {
  it.each([undefined, null, 'false', 'TRUE', ' true', 'true ', '1', 'yes'])(
    'denies missing or malformed configuration value %j',
    async (value) => {
      harness.config = value === undefined ? [] : [{ value }];
      await expect(requireQboProviderTraffic({})).rejects.toMatchObject({
        code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE, reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE, status: 503,
      });
    },
  );

  it('fails closed for a lookup error and timeout without exposing configuration', async () => {
    await expect(requireQboProviderTraffic({}, { select: async () => { throw new Error('database unavailable'); } }))
      .rejects.toMatchObject({ code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE, status: 503 });

    vi.useFakeTimers();
    const pending = requireQboProviderTraffic({}, { select: () => new Promise(() => {}) });
    const rejected = expect(pending).rejects.toMatchObject({
      code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE, status: 503,
    });
    await vi.advanceTimersByTimeAsync(QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS);
    await rejected;
  });

  it('allows only exact true and returns a safe retryable response helper', async () => {
    await expect(requireQboProviderTraffic({})).resolves.toBeUndefined();
    const transport = harness.supabaseArgs.at(-1).fetchImpl;
    await transport('https://db.test/rest/v1/integration_config', {});
    expect(harness.fetches.at(-1).timeoutMs).toBe(QBO_PROVIDER_TRAFFIC_LOOKUP_TIMEOUT_MS);
    const response = qboProviderTrafficDisabledResponse();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'QuickBooks is temporarily unavailable. Please try again shortly.',
      code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
      reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    });
  });

  it('makes no Intuit request, refresh, or credential persistence while closed', async () => {
    harness.config = [];

    await expect(qboFetch({}, '/companyinfo/test-realm', { method: 'GET' }))
      .rejects.toSatisfy(isQboProviderTrafficDisabled);
    await expect(paymentsFetch({}, '/charges', { method: 'POST' }))
      .rejects.toSatisfy(isQboProviderTrafficDisabled);
    await expect(exchangeCodeForTokens({}, 'code')).rejects.toSatisfy(isQboProviderTrafficDisabled);
    await expect(saveTokens({}, { access_token: 'a', refresh_token: 'r' }))
      .rejects.toSatisfy(isQboProviderTrafficDisabled);

    expect(harness.fetches).toHaveLength(0);
    expect(harness.rpcs).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
    expect(harness.upserts).toHaveLength(0);
  });

  it('prevents both upload refresh and raw multipart traffic while closed', async () => {
    harness.config = [{ value: 'false' }];

    await expect(uploadAttachable({}, {
      entityType: 'invoice', qboEntityId: '1', bytes: new Uint8Array([1]), fileName: 'proof.pdf', contentType: 'application/pdf',
    })).rejects.toSatisfy(isQboProviderTrafficDisabled);

    expect(harness.fetches).toHaveLength(0);
    expect(harness.rpcs).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
    expect(harness.upserts).toHaveLength(0);
  });

  it('preserves provider behavior for the exact open value', async () => {
    await qboFetch({}, '/companyinfo/test-realm', { method: 'GET' });
    expect(harness.fetches).toHaveLength(1);
    expect(harness.fetches[0].url).toContain('/v3/company/test-realm/companyinfo/test-realm');
  });

  it('checks again immediately before an Accounting request and blocks an expired-token refresh before persistence', async () => {
    harness.configQueue.push([{ value: 'true' }], [{ value: 'false' }]);
    await expect(qboFetch({}, '/companyinfo/test-realm', { method: 'GET' }))
      .rejects.toSatisfy(isQboProviderTrafficDisabled);
    expect(harness.fetches).toHaveLength(0);

    harness.connection = { ...harness.connection, token_expires_at: '2000-01-01T00:00:00.000Z' };
    harness.configQueue.push([{ value: 'true' }], []);
    await expect(qboFetch({}, '/companyinfo/test-realm', { method: 'GET' }))
      .rejects.toSatisfy(isQboProviderTrafficDisabled);
    expect(harness.fetches).toHaveLength(0);
    expect(harness.rpcs).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
    expect(harness.upserts).toHaveLength(0);
  });

  it('finishes a successful refresh CAS when traffic closes, then refuses the Accounting request', async () => {
    harness.connection = {
      access_token: 'expired-access', refresh_token: 'test-refresh',
      token_expires_at: '2000-01-01T00:00:00.000Z', realm_id: 'test-realm', environment: 'sandbox',
      updated_at: '2026-08-10T12:00:00.000Z',
    };
    // qboFetch entry, OAuth token exchange, then the final Accounting guard.
    harness.configQueue.push([{ value: 'true' }], [{ value: 'true' }], []);

    await expect(qboFetch({}, '/companyinfo/test-realm', { method: 'GET' }))
      .rejects.toSatisfy(isQboProviderTrafficDisabled);

    expect(harness.fetches).toHaveLength(1);
    expect(harness.fetches[0].url).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
    expect(harness.rpcs).toHaveLength(0);
    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0][0]).toBe('integration_credentials');
    expect(harness.updates[0][1]).toContain('realm_id=eq.test-realm');
    expect(harness.updates[0][1]).toContain('updated_at=eq.2026-08-10T12%3A00%3A00.000Z');
    expect(harness.upserts).toHaveLength(0);
    expect(harness.fetches.some(({ url }) => url.includes('/v3/company/'))).toBe(false);
  });
});
