/**
 * ════════════════════════════════════════════════
 * FILE: qbo.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the schema-free MCP QBO foundation reads only with an exact open
 *   maintenance gate, conditionally refreshes the existing credential row,
 *   rechecks the credential before provider dispatch, and refuses every write.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: ./qbo.js
 *   Data:      reads  → mocked integration_config and integration_credentials
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The tests use only mock fetch responses and never contact QuickBooks or Supabase.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  qboCreate,
  qboDelete,
  qboQuery,
  qboSend,
  qboSparseUpdate,
} from './qbo.js';

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  QBO_CLIENT_ID: 'client',
  QBO_CLIENT_SECRET: 'secret',
  QBO_ENVIRONMENT: 'sandbox',
};

const response = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});

const connection = (overrides = {}) => ({
  provider: 'quickbooks',
  access_token: 'access-A',
  refresh_token: 'refresh-A',
  token_expires_at: '2099-01-01T00:00:00.000Z',
  realm_id: 'realm-A',
  environment: 'sandbox',
  updated_at: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('schema-free QBO MCP foundation', () => {
  it('requires exact true twice and rechecks the same credential before provider dispatch', async () => {
    let gateReads = 0;
    let credentialReads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/integration_config?')) {
        gateReads += 1;
        return response([{ value: 'true' }]);
      }
      if (target.includes('/integration_credentials?')) {
        credentialReads += 1;
        return response([connection()]);
      }
      if (target.includes('/v3/company/realm-A/query?')) return response({ QueryResponse: { Invoice: [] } });
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice')).resolves.toEqual({ Invoice: [] });
    expect(gateReads).toBe(2);
    expect(credentialReads).toBe(2);
  });

  it.each([undefined, null, false, true, 'TRUE', ' true ', 'false'])('fails closed for non-exact gate value %s', async (value) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/integration_config?')) return response(value === undefined ? [] : [{ value }]);
      throw new Error(`unexpected fetch ${url}`);
    });
    await expect(qboQuery(env, 'SELECT * FROM Invoice')).rejects.toMatchObject({
      code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled', status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a gate close after token acquisition and before provider dispatch', async () => {
    let gateReads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/integration_config?')) {
        gateReads += 1;
        return response([{ value: gateReads === 1 ? 'true' : 'false' }]);
      }
      if (target.includes('/integration_credentials?')) return response([connection()]);
      throw new Error(`unexpected fetch ${target}`);
    });
    await expect(qboQuery(env, 'SELECT * FROM Invoice')).rejects.toMatchObject({
      code: 'qbo_provider_traffic_disabled', status: 503,
    });
  });

  it('blocks a credential switch after token acquisition and before provider dispatch', async () => {
    let reads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/integration_config?')) return response([{ value: 'true' }]);
      if (target.includes('/integration_credentials?')) {
        reads += 1;
        return response([connection(reads === 1 ? {} : { realm_id: 'realm-B', updated_at: '2026-08-12T00:01:00.000Z' })]);
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    await expect(qboQuery(env, 'SELECT * FROM Invoice')).rejects.toMatchObject({
      code: 'qbo-connection-changed', status: 409,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
  });

  it('refreshes through a realm+updated_at conditional PATCH and then reads with the winner', async () => {
    const old = connection({ token_expires_at: '2020-01-01T00:00:00.000Z' });
    const fresh = connection({ access_token: 'access-B', refresh_token: 'refresh-B', updated_at: '2026-08-12T00:02:00.000Z' });
    let credentialReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/integration_config?')) return response([{ value: 'true' }]);
      if (target.includes('/integration_credentials?') && options.method === 'PATCH') {
        expect(target).toContain('realm_id=eq.realm-A');
        expect(target).toContain('updated_at=eq.2026-08-12T00%3A00%3A00.000Z');
        return response([fresh]);
      }
      if (target.includes('/integration_credentials?')) {
        credentialReads += 1;
        return response([credentialReads === 1 ? old : fresh]);
      }
      if (target.includes('/tokens/bearer')) return response({ access_token: 'access-B', refresh_token: 'refresh-B', expires_in: 3600 });
      if (target.includes('/v3/company/realm-A/query?')) return response({ QueryResponse: { Invoice: [] } });
      throw new Error(`unexpected fetch ${target}`);
    });
    await expect(qboQuery(env, 'SELECT * FROM Invoice')).resolves.toEqual({ Invoice: [] });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rpc/refresh_qbo_connection_cas'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/qbo_company_binding'))).toBe(false);
  });

  it('persists a rotated token after maintenance closes, then blocks the Accounting request', async () => {
    const old = connection({ token_expires_at: '2020-01-01T00:00:00.000Z' });
    const fresh = connection({
      access_token: 'access-B',
      refresh_token: 'refresh-B',
      updated_at: '2026-08-12T00:02:00.000Z',
    });
    let gateReads = 0;
    let credentialReads = 0;
    let tokenReturned = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/integration_config?')) {
        gateReads += 1;
        return response([{ value: tokenReturned ? 'false' : 'true' }]);
      }
      if (target.includes('/tokens/bearer')) {
        tokenReturned = true;
        return response({ access_token: 'access-B', refresh_token: 'refresh-B', expires_in: 3600 });
      }
      if (target.includes('/integration_credentials?') && options.method === 'PATCH') {
        expect(tokenReturned).toBe(true);
        expect(target).toContain('realm_id=eq.realm-A');
        expect(target).toContain('updated_at=eq.2026-08-12T00%3A00%3A00.000Z');
        expect(JSON.parse(options.body)).toMatchObject({
          access_token: 'access-B',
          refresh_token: 'refresh-B',
        });
        return response([fresh]);
      }
      if (target.includes('/integration_credentials?')) {
        credentialReads += 1;
        return response([credentialReads === 1 ? old : fresh]);
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice')).rejects.toMatchObject({
      code: 'qbo_provider_traffic_disabled', status: 503,
    });

    expect(gateReads).toBe(3);
    expect(fetchMock.mock.calls.filter(([, options = {}]) => options.method === 'PATCH')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
  });

  it('stops when the conditional refresh PATCH loses without a provider accounting request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/integration_config?')) return response([{ value: 'true' }]);
      if (target.includes('/integration_credentials?') && options.method === 'PATCH') return response([]);
      if (target.includes('/integration_credentials?')) return response([connection({ token_expires_at: '2020-01-01T00:00:00.000Z' })]);
      if (target.includes('/tokens/bearer')) return response({ access_token: 'access-B', refresh_token: 'refresh-B', expires_in: 3600 });
      throw new Error(`unexpected fetch ${target}`);
    });
    await expect(qboQuery(env, 'SELECT * FROM Invoice')).rejects.toMatchObject({ code: 'qbo-connection-changed', status: 409 });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
  });

  it.each([
    ['create', () => qboCreate(env, 'Invoice', {})],
    ['update', () => qboSparseUpdate(env, 'Invoice', '1', {})],
    ['delete', () => qboDelete(env, 'Invoice', '1')],
    ['send', () => qboSend(env, 'Invoice', '1')],
  ])('refuses %s before any database or provider request', async (_name, run) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(run()).rejects.toMatchObject({
      code: 'qbo_mcp_mutation_durable_boundary_required', reason: 'qbo_mcp_mutation_durable_boundary_required', status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
