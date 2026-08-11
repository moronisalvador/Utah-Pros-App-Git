/**
 * ════════════════════════════════════════════════
 * FILE: qbo.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the owner-only MCP cannot overwrite a newer QuickBooks login and
 *   stops before accounting work when its saved company version is stale or
 *   the global provider-traffic maintenance gate is not exact-true.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo.js
 *   Data:      reads → local response fixtures only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Every database and Intuit response is mocked; no network is contacted.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qboCreate, qboDelete, qboGet, qboQuery, qboReport, qboSend, qboSparseUpdate } from './qbo.js';
import { TOOLS } from './tools.js';

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  QBO_CLIENT_ID: 'client-test',
  QBO_CLIENT_SECRET: 'secret-test',
  QBO_ENVIRONMENT: 'sandbox',
};

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const expiredConnection = (generation = 4) => ({
  provider: 'quickbooks',
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  token_expires_at: '2000-01-01T00:00:00.000Z',
  realm_id: 'realm-A',
  environment: 'sandbox',
  qbo_binding_generation: generation,
});
const providerTrafficConfig = () => jsonResponse([{ value: 'true' }]);
const isProviderTrafficConfig = (target) => target.includes('/integration_config?')
  && target.includes('qbo_provider_traffic_enabled');
const hasProviderSideEffect = (target) => target.includes('intuit.com')
  || target.includes('/integration_credentials?')
  || target.includes('/rpc/refresh_qbo_connection_cas');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('upr-mcp QBO credential generation', () => {
  it('rejects an already-stale generation before any Intuit provider request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) return jsonResponse([expiredConnection(4)]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 5 }]);
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({ code: 'qbo-connection-changed', status: 409 });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('intuit.com'))).toBe(false);
    for (const [, options] of fetchMock.mock.calls) expect(options.signal).toBeTruthy();
  });

  it('does not issue an Accounting request when refresh CAS loses to a reconnect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) return jsonResponse([expiredConnection(4)]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      if (target.includes('/oauth2/v1/tokens/bearer')) {
        return jsonResponse({ access_token: 'stale-new-access', refresh_token: 'stale-new-refresh', expires_in: 3600 });
      }
      if (target.includes('/rpc/refresh_qbo_connection_cas')) {
        return jsonResponse({ ok: false, reason: 'connection-changed' });
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({ code: 'qbo-connection-changed', status: 409 });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/oauth2/v1/tokens/bearer'))).toBe(true);
    for (const [, options] of fetchMock.mock.calls) expect(options.signal).toBeTruthy();
  });

  it('advances the current generation, reloads the winner, and bounds every fetch', async () => {
    let connectionReads = 0;
    let bindingReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) {
        connectionReads += 1;
        return jsonResponse([connectionReads === 1 ? expiredConnection(4) : {
          ...expiredConnection(5),
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          token_expires_at: '2099-01-01T00:00:00.000Z',
        }]);
      }
      if (target.includes('/qbo_company_binding?')) {
        bindingReads += 1;
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: bindingReads === 1 ? 4 : 5 }]);
      }
      if (target.includes('/oauth2/v1/tokens/bearer')) {
        return jsonResponse({
          access_token: 'fresh-access', refresh_token: 'fresh-refresh',
          expires_in: 3600, scope: 'com.intuit.quickbooks.accounting',
        });
      }
      if (target.includes('/rpc/refresh_qbo_connection_cas')) {
        expect(JSON.parse(options.body)).toMatchObject({
          p_expected_environment: 'sandbox',
          p_expected_realm_id: 'realm-A',
          p_expected_generation: 4,
          p_access_token: 'fresh-access',
          p_refresh_token: 'fresh-refresh',
        });
        return jsonResponse({ ok: true, realm_id: 'realm-A', generation: 5 });
      }
      if (target.includes('/v3/company/realm-A/query?')) {
        expect(options.headers.Authorization).toBe('Bearer fresh-access');
        return jsonResponse({ QueryResponse: { Invoice: [] } });
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .resolves.toEqual({ Invoice: [] });

    expect(connectionReads).toBe(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rpc/refresh_qbo_connection_cas'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/realm-A/query?'))).toBe(true);
    for (const [, options] of fetchMock.mock.calls) expect(options.signal).toBeTruthy();
  });

  it('rejects a binding/credential snapshot mismatch before the Accounting fetch', async () => {
    let connectionReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) {
        connectionReads += 1;
        return jsonResponse([{
          ...expiredConnection(),
          realm_id: connectionReads === 1 ? 'realm-A' : 'realm-B',
          token_expires_at: '2099-01-01T00:00:00.000Z',
        }]);
      }
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({ code: 'qbo-connection-changed', status: 409 });

    expect(connectionReads).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
  });

  it('does not place QBO Fault message or detail in the thrown error text', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) return jsonResponse([{
        ...expiredConnection(), token_expires_at: '2099-01-01T00:00:00.000Z',
      }]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      if (target.includes('/v3/company/realm-A/query?')) {
        return new Response(JSON.stringify({ Fault: { Error: [{
          Message: 'raw-provider-message-secret', Detail: 'raw-provider-detail-secret', code: '6190',
        }] } }), { status: 400, headers: { 'Content-Type': 'application/json', intuit_tid: 'tid-safe-123' } });
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    const error = await qboQuery(env, 'SELECT * FROM Invoice').catch((caught) => caught);
    expect(error).toMatchObject({ code: 'qbo_provider_request_failed', intuitTid: 'tid-safe-123' });
    expect(error.message).not.toMatch(/raw-provider-(?:message|detail)-secret/);
  });

  it('fails closed on an expired token while the binding migration is absent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) return jsonResponse([{
        ...expiredConnection(), qbo_binding_generation: null,
      }]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse({ code: 'PGRST205', message: 'qbo_company_binding missing from schema cache' }, 404);
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({ code: 'qbo-connection-changed', status: 409 });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('intuit.com'))).toBe(false);
  });
});

describe('upr-mcp QBO provider traffic gate', () => {
  it('allows only the exact text true and checks again immediately before QBO', async () => {
    let gateReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) {
        gateReads += 1;
        return providerTrafficConfig();
      }
      if (target.includes('/integration_credentials?')) return jsonResponse([{
        ...expiredConnection(), token_expires_at: '2099-01-01T00:00:00.000Z',
      }]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      if (target.includes('/v3/company/realm-A/query?')) return jsonResponse({ QueryResponse: { Invoice: [] } });
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice')).resolves.toEqual({ Invoice: [] });

    expect(gateReads).toBe(2);
    for (const [, options] of fetchMock.mock.calls) expect(options.signal).toBeTruthy();
  });

  it.each([
    ['missing configuration row', () => jsonResponse([])],
    ['null value', () => jsonResponse([{ value: null }])],
    ['boolean false value', () => jsonResponse([{ value: false }])],
    ['text false value', () => jsonResponse([{ value: 'false' }])],
    ['boolean true rather than exact text', () => jsonResponse([{ value: true }])],
    ['case variant', () => jsonResponse([{ value: 'True' }])],
    ['whitespace variant', () => jsonResponse([{ value: ' true ' }])],
    ['malformed configuration row', () => jsonResponse([{}])],
    ['malformed database response', () => jsonResponse({ value: 'true' })],
    ['database error', () => jsonResponse({ message: 'unavailable' }, 500)],
    ['lookup timeout', () => { throw new Error('request timed out'); }],
  ])('fails closed for %s without token, provider, or CAS work', async (_name, configResponse) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return configResponse();
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({
        code: 'qbo_provider_traffic_disabled',
        reason: 'qbo_provider_traffic_disabled',
        status: 503,
      });

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(hasProviderSideEffect(String(fetchMock.mock.calls[0][0]))).toBe(false);
    expect(fetchMock.mock.calls[0][1].signal).toBeTruthy();
  });

  it('blocks a close that races after token acquisition and before the provider fetch', async () => {
    let gateReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) {
        gateReads += 1;
        return jsonResponse([{ value: gateReads === 1 ? 'true' : 'false' }]);
      }
      if (target.includes('/integration_credentials?')) return jsonResponse([{
        ...expiredConnection(), token_expires_at: '2099-01-01T00:00:00.000Z',
      }]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({ code: 'qbo_provider_traffic_disabled', status: 503 });

    expect(gateReads).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('intuit.com'))).toBe(false);
  });

  it('blocks a close after refresh before credential CAS persistence', async () => {
    let gateReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) {
        gateReads += 1;
        return jsonResponse([{ value: gateReads < 3 ? 'true' : 'false' }]);
      }
      if (target.includes('/integration_credentials?')) return jsonResponse([expiredConnection(4)]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      if (target.includes('/oauth2/v1/tokens/bearer')) {
        return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice'))
      .rejects.toMatchObject({ code: 'qbo_provider_traffic_disabled', status: 503 });

    expect(gateReads).toBe(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/oauth2/v1/tokens/bearer'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rpc/refresh_qbo_connection_cas'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/'))).toBe(false);
  });
});

describe('upr-mcp QBO release mutation containment', () => {
  it.each([
    ['create', () => qboCreate(env, 'Invoice', { CustomerRef: { value: '1' } })],
    ['sparse update', () => qboSparseUpdate(env, 'Payment', '2', { PrivateNote: 'test' })],
    ['delete', () => qboDelete(env, 'Payment', '2')],
    ['send', () => qboSend(env, 'Invoice', '3')],
  ])('blocks %s before any configuration, credential, token, CAS, or provider work', async (_name, run) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(run()).rejects.toMatchObject({
      code: 'qbo_mcp_mutation_durable_boundary_required',
      reason: 'qbo_mcp_mutation_durable_boundary_required',
      status: 503,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['invoice delete', 'qbo_delete_invoice', { invoice_id: 'inv-1', confirm: true }],
    ['payment relink', 'qbo_relink_payment', { payment_id: 'pay-1', to_invoice_id: 'inv-1', confirm: true }],
    ['payment delete', 'qbo_delete_payment', { payment_id: 'pay-1', confirm: true }],
  ])('blocks confirmed %s before its inspection read', async (_name, toolName, args) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(TOOLS[toolName].run(env, args)).rejects.toMatchObject({
      code: 'qbo_mcp_mutation_durable_boundary_required',
      reason: 'qbo_mcp_mutation_durable_boundary_required',
      status: 503,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps query, get, and report available when the provider maintenance gate is exact-true', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (isProviderTrafficConfig(target)) return providerTrafficConfig();
      if (target.includes('/integration_credentials?')) return jsonResponse([{
        ...expiredConnection(), token_expires_at: '2099-01-01T00:00:00.000Z',
      }]);
      if (target.includes('/qbo_company_binding?')) {
        return jsonResponse([{ environment: 'sandbox', realm_id: 'realm-A', generation: 4 }]);
      }
      if (target.includes('/v3/company/realm-A/query?')) {
        return jsonResponse({ QueryResponse: { Invoice: [{ Id: 'inv-1', SyncToken: '0' }] } });
      }
      if (target.includes('/v3/company/realm-A/reports/ProfitAndLoss?')) {
        return jsonResponse({ Header: { ReportName: 'ProfitAndLoss' } });
      }
      throw new Error(`unexpected fetch ${target}`);
    });

    await expect(qboQuery(env, 'SELECT * FROM Invoice')).resolves.toEqual({ Invoice: [{ Id: 'inv-1', SyncToken: '0' }] });
    await expect(qboGet(env, 'Invoice', 'inv-1')).resolves.toEqual({ Id: 'inv-1', SyncToken: '0' });
    await expect(qboReport(env, 'ProfitAndLoss')).resolves.toEqual({ Header: { ReportName: 'ProfitAndLoss' } });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/realm-A/query?'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v3/company/realm-A/reports/ProfitAndLoss?'))).toBe(true);
  });
});
