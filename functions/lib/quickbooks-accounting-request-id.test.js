/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-accounting-request-id.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves QuickBooks Accounting writes carry Intuit's URI request id so a lost
 *   response can be retried without repeating the provider side effect.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  quickbooks.js; Supabase and HTTP are test doubles.
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Accounting uses `requestid` in the URI. The separate Payments API uses
 *     the `Request-Id` header; these contracts must not be interchanged.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  requests: [],
  responses: [],
  updates: [],
  upserts: [],
  rpcs: [],
  providerTrafficEnabled: true,
  switchRealmDuringRefresh: false,
  connection: {
    access_token: 'test-access',
    refresh_token: 'test-refresh',
    token_expires_at: '2099-01-01T00:00:00.000Z',
    realm_id: 'test-realm',
    environment: 'sandbox',
    updated_at: '2026-08-10T12:00:00.000Z',
    qbo_binding_generation: 4,
  },
}));

vi.mock('./supabase.js', () => ({
  supabase: () => ({
    select: vi.fn(async (table) => table === 'integration_config'
      ? (harness.providerTrafficEnabled ? [{ value: 'true' }] : [])
      : [harness.connection]),
    update: vi.fn(async (table, filter, row) => {
      harness.updates.push({ table, filter, row });
      const currentRealm = encodeURIComponent(String(harness.connection?.realm_id || ''));
      const currentVersion = encodeURIComponent(String(harness.connection?.updated_at || ''));
      if (table !== 'integration_credentials'
        || !filter.includes(`realm_id=eq.${currentRealm}`)
        || !filter.includes(`updated_at=eq.${currentVersion}`)) return [];
      harness.connection = { ...harness.connection, ...row };
      return [harness.connection];
    }),
    upsert: vi.fn(async (_table, row) => {
      harness.upserts.push(row);
      harness.connection = { ...harness.connection, ...row };
      return [harness.connection];
    }),
    rpc: vi.fn(async (name, params) => {
      harness.rpcs.push({ name, params });
      if (name === 'refresh_qbo_connection_cas') {
        if (String(harness.connection?.realm_id) !== String(params.p_expected_realm_id)
          || String(harness.connection?.qbo_binding_generation) !== String(params.p_expected_generation)) {
          return { ok: false, reason: 'connection-changed' };
        }
        const generation = Number(params.p_expected_generation) + 1;
        harness.connection = {
          ...harness.connection,
          access_token: params.p_access_token,
          refresh_token: params.p_refresh_token || harness.connection.refresh_token,
          token_expires_at: params.p_token_expires_at,
          granted_scopes: params.p_granted_scopes || harness.connection.granted_scopes,
          qbo_binding_generation: generation,
        };
        return { ok: true, realm_id: params.p_expected_realm_id, generation };
      }
      if (name === 'replace_qbo_connection') return { ok: true, generation: 5 };
      throw new Error(`unexpected RPC ${name}`);
    }),
  }),
}));

vi.mock('./http.js', () => ({
  fetchWithTimeout: vi.fn(async (url, options) => {
    harness.requests.push({ url, options });
    if (url === 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
      && harness.switchRealmDuringRefresh) {
      harness.connection = {
        ...harness.connection,
        access_token: 'realm-b-access',
        refresh_token: 'realm-b-refresh',
        realm_id: 'realm-B',
        updated_at: '2026-08-10T12:01:00.000Z',
        qbo_binding_generation: 5,
      };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          access_token: 'refreshed-a-access',
          refresh_token: 'refreshed-a-refresh',
          expires_in: 3600,
        }),
        text: async () => '',
      };
    }
    return harness.responses.shift() || {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ Invoice: { Id: 'qbo-1', DocNumber: 'W-1' } }),
      text: async () => '',
    };
  }),
}));

import {
  createEstimate,
  createAllocatedPayment,
  createCustomer,
  createInvoice,
  customerCreateRequestId,
  deleteEstimate,
  deleteInvoice,
  ensureQboCustomer,
  relinkQboCustomer,
  replaceQboConnection,
  sendEstimate,
  getQboInvoice,
  getQboPayment,
  listQboDepositAccounts,
  listQboPaymentMethods,
  updateEstimate,
  withAccountingRequestId,
} from './quickbooks.js';

beforeEach(() => {
  harness.requests.length = 0;
  harness.responses.length = 0;
  harness.updates.length = 0;
  harness.upserts.length = 0;
  harness.rpcs.length = 0;
  harness.providerTrafficEnabled = true;
  harness.switchRealmDuringRefresh = false;
  harness.connection = {
    access_token: 'test-access',
    refresh_token: 'test-refresh',
    token_expires_at: '2099-01-01T00:00:00.000Z',
    realm_id: 'test-realm',
    environment: 'sandbox',
    updated_at: '2026-08-10T12:00:00.000Z',
    qbo_binding_generation: 4,
  };
});

describe('QuickBooks Accounting request-id contract', () => {
  it('puts the stable key in the Accounting URI and never leaks it as a fetch option', async () => {
    const requestId = `upr-i-c-${'a'.repeat(40)}`;

    await createInvoice({}, { CustomerRef: { value: '1' }, Line: [] }, { requestId });

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0].url).toBe(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/test-realm/invoice?minorversion=70&requestid=${requestId}`,
    );
    expect(harness.requests[0].options.requestId).toBeUndefined();
  });

  it('derives a stable, separated customer request ID and forwards it to QBO', async () => {
    const primary = await customerCreateRequestId('realm-1', 'contact-1', 'primary');
    const duplicate = await customerCreateRequestId('realm-1', 'contact-1', 'disambiguated');

    expect(primary).toMatch(/^upr-c-[a-f0-9]{44}$/);
    expect(primary).toHaveLength(50);
    expect(await customerCreateRequestId('realm-1', 'contact-1', 'primary')).toBe(primary);
    expect(duplicate).not.toBe(primary);
    expect(await customerCreateRequestId('realm-2', 'contact-1', 'primary')).not.toBe(primary);
    expect(await customerCreateRequestId('realm-1', 'contact-2', 'primary')).not.toBe(primary);

    await createCustomer({}, { DisplayName: 'Test Customer' }, { requestId: primary });

    expect(harness.requests.at(-1).url).toBe(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/test-realm/customer?minorversion=70&requestid=${primary}`,
    );
    expect(harness.requests.at(-1).options.requestId).toBeUndefined();
  });

  it('forwards the frozen estimate request id on create, update, send, and delete writes', async () => {
    const requestId = `upr-e-s-${'b'.repeat(40)}`;
    const response = (payload) => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => payload, text: async () => '',
    });

    harness.responses.push(response({ Estimate: { Id: 'est-1' } }));
    await createEstimate({}, { CustomerRef: { value: 'customer-1' }, Line: [] }, { requestId });
    expect(harness.requests.at(-1).url).toContain(`/estimate?minorversion=70&requestid=${requestId}`);

    harness.responses.push(
      response({ QueryResponse: { Estimate: [{ Id: 'est-1', SyncToken: '2' }] } }),
      response({ Estimate: { Id: 'est-1', SyncToken: '3' } }),
    );
    await updateEstimate({}, 'est-1', { Line: [] }, { requestId });
    expect(harness.requests.at(-2).url).not.toContain('requestid=');
    expect(harness.requests.at(-1).url).toContain(`/estimate?minorversion=70&requestid=${requestId}`);

    harness.responses.push(response({ Estimate: { Id: 'est-1', EmailStatus: 'EmailSent' } }));
    await sendEstimate({}, 'est-1', 'customer@example.test', { requestId });
    expect(harness.requests.at(-1).url).toContain(`send?minorversion=70&sendTo=customer%40example.test&requestid=${requestId}`);

    harness.responses.push(
      response({ QueryResponse: { Estimate: [{ Id: 'est-1', SyncToken: '3' }] } }),
      response({}),
    );
    await deleteEstimate({}, 'est-1', { requestId });
    expect(harness.requests.at(-2).url).not.toContain('requestid=');
    expect(harness.requests.at(-1).url).toContain(`/estimate?operation=delete&minorversion=70&requestid=${requestId}`);
    for (const entry of harness.requests) expect(entry.options.requestId).toBeUndefined();
  });

  it('refuses an expired-token provider request before refresh when credentials switched realms', async () => {
    harness.connection = {
      ...harness.connection,
      token_expires_at: '2000-01-01T00:00:00.000Z',
      realm_id: 'realm-after-switch',
    };

    await expect(createEstimate(
      {},
      { CustomerRef: { value: 'customer-1' }, Line: [] },
      { requestId: 'upr-e-realm-race', expectedRealmId: 'realm-before-switch' },
    )).rejects.toMatchObject({ status: 409, code: 'qbo-realm-mismatch' });

    expect(harness.requests).toHaveLength(0);
  });

  it('refuses invoice and receipt provider helpers before any HTTP when the frozen realm changed', async () => {
    harness.connection = { ...harness.connection, realm_id: 'realm-after-switch' };
    const expectedRealmId = 'realm-before-switch';
    const calls = [
      () => createInvoice({}, { CustomerRef: { value: 'customer-1' }, Line: [] }, { expectedRealmId }),
      () => getQboInvoice({}, 'invoice-1', { expectedRealmId }),
      () => getQboPayment({}, 'payment-1', { expectedRealmId }),
      () => listQboPaymentMethods({}, { expectedRealmId }),
      () => listQboDepositAccounts({}, { expectedRealmId }),
      () => createAllocatedPayment({}, { customerId: 'customer-1', allocations: [{ qboInvoiceId: 'invoice-1', amountCents: 100 }], expectedRealmId }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 409, code: 'qbo-realm-mismatch' });
    expect(harness.requests).toHaveLength(0);
  });

  it('does not overwrite a reconnect that wins while an old-realm token refresh is pending', async () => {
    harness.connection = {
      ...harness.connection,
      token_expires_at: '2000-01-01T00:00:00.000Z',
      realm_id: 'realm-A',
    };
    harness.switchRealmDuringRefresh = true;

    await expect(createEstimate(
      {},
      { CustomerRef: { value: 'customer-1' }, Line: [] },
      { requestId: 'upr-e-refresh-race', expectedRealmId: 'realm-A' },
    )).rejects.toMatchObject({ status: 409, code: 'qbo-connection-changed' });

    expect(harness.connection).toMatchObject({
      realm_id: 'realm-B',
      refresh_token: 'realm-b-refresh',
      qbo_binding_generation: 5,
    });
    expect(harness.rpcs).toHaveLength(1);
    expect(harness.rpcs[0]).toMatchObject({
      name: 'refresh_qbo_connection_cas',
      params: {
        p_expected_realm_id: 'realm-A',
        p_expected_generation: 4,
      },
    });
    expect(harness.updates).toHaveLength(0);
    expect(harness.upserts).toHaveLength(0);
    expect(harness.requests.filter(({ url }) => url.includes('/v3/company/'))).toHaveLength(0);
  });

  it('persists a same-realm token refresh with the credential-version CAS', async () => {
    harness.connection = {
      ...harness.connection,
      token_expires_at: '2000-01-01T00:00:00.000Z',
      realm_id: 'realm-A',
    };
    harness.responses.push(
      {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({
          access_token: 'refreshed-access', refresh_token: 'refreshed-token', expires_in: 3600,
        }),
        text: async () => '',
      },
      {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ Estimate: { Id: 'est-1' } }),
        text: async () => '',
      },
    );

    await expect(createEstimate(
      {},
      { CustomerRef: { value: 'customer-1' }, Line: [] },
      { requestId: 'upr-e-refresh-success', expectedRealmId: 'realm-A' },
    )).resolves.toMatchObject({ Id: 'est-1' });

    expect(harness.rpcs).toHaveLength(1);
    expect(harness.rpcs[0]).toMatchObject({
      name: 'refresh_qbo_connection_cas',
      params: {
        p_expected_environment: 'sandbox',
        p_expected_realm_id: 'realm-A',
        p_expected_generation: 4,
        p_access_token: 'refreshed-access',
        p_refresh_token: 'refreshed-token',
      },
    });
    expect(harness.updates).toHaveLength(0);
    expect(harness.connection).toMatchObject({
      realm_id: 'realm-A',
      refresh_token: 'refreshed-token',
      qbo_binding_generation: 5,
    });
    expect(harness.requests.filter(({ url }) => url.includes('/v3/company/realm-A/estimate'))).toHaveLength(1);
  });

  it('sends first-connect tokens only through the atomic binding replacement RPC', async () => {
    const result = await replaceQboConnection(
      {},
      {
        access_token: 'callback-access',
        refresh_token: 'callback-refresh',
        expires_in: 3600,
        scope: 'com.intuit.quickbooks.accounting',
      },
      {
        environment: 'sandbox',
        realmId: 'realm-A',
        connectedBy: 'employee-1',
        connectedAt: '2026-08-10T12:30:00.000Z',
      },
    );

    expect(result).toEqual({ ok: true, generation: 5 });
    expect(harness.rpcs).toHaveLength(1);
    expect(harness.rpcs[0]).toMatchObject({
      name: 'replace_qbo_connection',
      params: {
        p_environment: 'sandbox',
        p_realm_id: 'realm-A',
        p_access_token: 'callback-access',
        p_refresh_token: 'callback-refresh',
        p_granted_scopes: 'com.intuit.quickbooks.accounting',
        p_connected_by: 'employee-1',
        p_connected_at: '2026-08-10T12:30:00.000Z',
      },
    });
    expect(harness.upserts).toHaveLength(0);
    expect(harness.updates).toHaveLength(0);
  });

  it('carries the frozen realm into the customer prerequisite request', async () => {
    const ok = await ensureQboCustomer(
      new Request('https://app.test/api/qbo-estimate'),
      { QBO_WEBHOOK_SECRET: 'test-secret' },
      'contact-1',
      { expectedRealmId: 'realm-frozen' },
    );

    expect(ok).toBe(true);
    expect(JSON.parse(harness.requests[0].options.body)).toEqual({
      contact_id: 'contact-1',
      expected_realm_id: 'realm-frozen',
    });
  });

  it('uses the customer request identity and preserves a concurrent relink winner', async () => {
    harness.responses.push({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ Customer: { Id: 'qbo-created' } }),
      text: async () => '',
    });
    const db = {
      select: vi.fn(async (_table, query) => query.includes('select=id,qbo_customer_id')
        ? [{ id: 'contact-1', qbo_customer_id: 'qbo-concurrent-winner' }]
        : [{ id: 'contact-1', name: 'Alex Customer', qbo_customer_id: 'qbo-stale' }]),
      update: vi.fn(async () => []),
    };

    await expect(relinkQboCustomer({}, db, 'contact-1')).resolves.toEqual({
      id: 'qbo-concurrent-winner',
      matchedBy: 'concurrent',
    });

    const requestId = await customerCreateRequestId('test-realm', 'contact-1', 'primary');
    expect(harness.requests.at(-1).url).toContain(`requestid=${requestId}`);
    expect(db.update).toHaveBeenCalledWith(
      'contacts',
      'id=eq.contact-1&qbo_customer_id=eq.qbo-stale',
      expect.objectContaining({ qbo_customer_id: 'qbo-created', qbo_sync_error: null }),
    );
  });

  it('replaces the stale stored customer only when that exact mapping still wins the CAS', async () => {
    harness.responses.push({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ Customer: { Id: 'qbo-relinked' } }),
      text: async () => '',
    });
    const db = {
      select: vi.fn(async () => [{ id: 'contact-1', name: 'Alex Customer', qbo_customer_id: 'qbo-stale' }]),
      update: vi.fn(async () => [{ id: 'contact-1', qbo_customer_id: 'qbo-relinked' }]),
    };

    await expect(relinkQboCustomer({}, db, 'contact-1')).resolves.toEqual({
      id: 'qbo-relinked',
      matchedBy: 'created',
    });
    expect(db.update).toHaveBeenCalledWith(
      'contacts',
      'id=eq.contact-1&qbo_customer_id=eq.qbo-stale',
      expect.objectContaining({ qbo_customer_id: 'qbo-relinked', qbo_sync_error: null }),
    );
  });

  it('rejects unsafe or oversized keys and appends safely to paths with or without a query', () => {
    expect(withAccountingRequestId('/invoice', 'upr-safe_1')).toBe('/invoice?requestid=upr-safe_1');
    expect(withAccountingRequestId('/invoice?operation=delete', 'upr-safe_2'))
      .toBe('/invoice?operation=delete&requestid=upr-safe_2');
    expect(() => withAccountingRequestId('/invoice', 'x'.repeat(51))).toThrow(/1-50 safe/);
    expect(() => withAccountingRequestId('/invoice', 'contains space')).toThrow(/1-50 safe/);
  });

  it('does not treat an unauthorized delete preflight as an already-missing invoice', async () => {
    harness.responses.push({
      ok: false,
      status: 401,
      headers: { get: () => 'tid-401' },
      json: async () => ({ Fault: { Error: [{ code: '3200' }] } }),
      text: async () => 'unauthorized',
    });
    await expect(deleteInvoice({}, 'qbo-1', { missingIsSuccess: true }))
      .rejects.toThrow('QBO invoice query before delete failed (401)');
    expect(harness.requests).toHaveLength(1);
  });

  it('classifies estimate delete preflight/write failures and only accepts proven missing state', async () => {
    harness.responses.push({
      ok: false, status: 401, headers: { get: () => 'estimate-query-tid' },
      json: async () => ({ Fault: {} }), text: async () => 'unauthorized',
    });
    await expect(deleteEstimate({}, 'est-1', { missingIsSuccess: true }))
      .rejects.toMatchObject({ status: 401, intuitTid: 'estimate-query-tid' });

    harness.responses.push({
      ok: true, status: 200, headers: { get: () => 'estimate-missing-tid' },
      json: async () => ({ QueryResponse: {} }), text: async () => '',
    });
    await expect(deleteEstimate({}, 'est-1', { missingIsSuccess: true }))
      .resolves.toEqual({ deleted: false, missing: true });

    harness.responses.push(
      {
        ok: true, status: 200, headers: { get: () => 'estimate-found-tid' },
        json: async () => ({ QueryResponse: { Estimate: [{ Id: 'est-1', SyncToken: '3' }] } }), text: async () => '',
      },
      {
        ok: false, status: 400, headers: { get: () => 'estimate-delete-tid' },
        json: async () => ({ Fault: {} }), text: async () => 'invalid delete',
      },
    );
    await expect(deleteEstimate({}, 'est-1', { requestId: 'upr-e-delete', missingIsSuccess: true }))
      .rejects.toMatchObject({ status: 400, intuitTid: 'estimate-delete-tid' });
    expect(harness.requests.at(-1).url).toContain('requestid=upr-e-delete');
  });

  it('does not treat a 5xx non-JSON delete preflight as an already-missing invoice', async () => {
    harness.responses.push({
      ok: false,
      status: 503,
      headers: { get: () => 'tid-503' },
      json: async () => { throw new SyntaxError('Unexpected token <'); },
      text: async () => '<html>temporarily unavailable</html>',
    });
    await expect(deleteInvoice({}, 'qbo-1', { missingIsSuccess: true }))
      .rejects.toThrow('QBO invoice query before delete failed (503)');
    expect(harness.requests).toHaveLength(1);
  });

  it('allows already-missing cleanup only after a successful parsed query confirms no invoice', async () => {
    harness.responses.push({
      ok: true,
      status: 200,
      headers: { get: () => 'tid-no-match' },
      json: async () => ({ QueryResponse: {} }),
      text: async () => '',
    });

    await expect(deleteInvoice({}, 'qbo-1', { missingIsSuccess: true }))
      .resolves.toEqual({ deleted: false, missing: true });
    expect(harness.requests).toHaveLength(1);
  });
});
