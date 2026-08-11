/**
 * ════════════════════════════════════════════════
 * FILE: qbo-sync-customer.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves customer sync uses one durable QBO create request identity per
 *   contact/create stage and converges when another worker wins the contact link.
 *   It also proves provider and database details stay out of browser responses.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: qbo-sync-customer.js
 *   Data: reads/writes → mocked contacts only
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  contact: null,
  storedCustomerId: null,
  updates: [],
  creates: vi.fn(),
  find: vi.fn(),
  requestId: vi.fn(),
  connection: { refresh_token: 'refresh', realm_id: 'realm-1' },
  boundedFetch: vi.fn(),
  supabaseFetch: null,
  selectFailure: null,
}));

vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(async () => state.connection),
  mapContactToCustomer: vi.fn((contact) => ({ DisplayName: contact.name })),
  findExistingCustomer: (...args) => state.find(...args),
  disambiguatedCustomerPayload: vi.fn((contact, payload) => ({ ...payload, DisplayName: `${payload.DisplayName} (0142)` })),
  createCustomer: (...args) => state.creates(...args),
  customerCreateRequestId: (...args) => state.requestId(...args),
}));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboRequest: vi.fn(async () => ({ ok: true })), QBO_ADMIN_ROLES: ['admin'] }));
vi.mock('../lib/cors.js', () => ({ handleOptions: vi.fn(), jsonResponse: vi.fn((body, status) => ({ body, status })) }));
vi.mock('../lib/http.js', () => ({ fetchWithTimeout: state.boundedFetch }));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: vi.fn() }));
vi.mock('../lib/supabase.js', () => ({ supabase: (_env, fetchImpl) => {
  state.supabaseFetch = fetchImpl;
  return {
  select: vi.fn(async (table, query) => {
    if (table === 'contacts' && state.selectFailure) throw state.selectFailure;
    return table === 'integration_config'
      ? [{ value: 'true' }]
      : query.includes('select=id,qbo_customer_id')
      ? (state.storedCustomerId ? [{ id: state.contact.id, qbo_customer_id: state.storedCustomerId }] : [])
      : [state.contact];
  }),
  update: vi.fn(async (_table, filter, patch) => {
    state.updates.push({ filter, patch });
    if (state.storedCustomerId) return [];
    if (patch.qbo_customer_id) {
      state.storedCustomerId = patch.qbo_customer_id;
      return [{ id: state.contact.id, qbo_customer_id: patch.qbo_customer_id }];
    }
    return [{ id: state.contact.id }];
  }),
  };
} }));

const { onRequestPost } = await import('./qbo-sync-customer.js');

const contactId = '00000000-0000-4000-8000-000000000001';
function request(body = { contact_id: contactId }) {
  return { headers: new Headers(), json: async () => body };
}

beforeEach(() => {
  state.contact = { id: contactId, name: 'Alex Customer', role: 'homeowner', phone: '801-555-0142', qbo_customer_id: null };
  state.supabaseFetch = null;
  state.selectFailure = null;
  state.storedCustomerId = null;
  state.updates.length = 0;
  state.creates.mockReset().mockResolvedValue({ Id: 'qbo-created' });
  state.find.mockReset().mockResolvedValue(null);
  state.requestId.mockReset().mockImplementation(async (_realm, _contact, stage) => `stable-${stage}`);
  state.connection = { refresh_token: 'refresh', realm_id: 'realm-1' };
});

describe('qbo-sync-customer customer-create idempotency', () => {
  it('reuses the primary request identity on concurrent retries and converges to the stored winner', async () => {
    const first = await onRequestPost({ request: request(), env: {} });
    state.creates.mockImplementationOnce(async () => {
      state.storedCustomerId = 'qbo-concurrent-winner';
      return { Id: 'qbo-created' };
    });
    const second = await onRequestPost({ request: request(), env: {} });

    expect(first.body.results[0]).toMatchObject({ action: 'created', qbo_customer_id: 'qbo-created' });
    expect(second.body.results[0]).toMatchObject({ action: 'linked', matched_by: 'concurrent', qbo_customer_id: 'qbo-concurrent-winner' });
    expect(state.creates.mock.calls.map((call) => call[2].requestId)).toEqual(['stable-primary', 'stable-primary']);
    expect(state.creates.mock.calls.every((call) => call[2].expectedRealmId === 'realm-1')).toBe(true);
    expect(state.find.mock.calls.every((call) => call[3].expectedRealmId === 'realm-1')).toBe(true);
    expect(state.updates.every(({ filter }) => filter.includes('qbo_customer_id=is.null'))).toBe(true);
  });

  it('uses a separate durable identity for the duplicate-name disambiguation create', async () => {
    const duplicate = Object.assign(new Error('Duplicate Name Exists Error'), { qboCode: '6240' });
    state.creates.mockRejectedValueOnce(duplicate).mockResolvedValueOnce({ Id: 'qbo-disambiguated' });

    const result = await onRequestPost({ request: request(), env: {} });

    expect(result.body.results[0]).toMatchObject({ action: 'created', qbo_customer_id: 'qbo-disambiguated' });
    expect(state.creates.mock.calls.map((call) => call[2].requestId)).toEqual(['stable-primary', 'stable-disambiguated']);
  });

  it('retries an ambiguous primary create with the same provider request identity', async () => {
    const privateDetail = 'QBO timeout with private customer content';
    state.creates.mockRejectedValueOnce(Object.assign(new Error(privateDetail), { intuitTid: 'tid-customer-502' }))
      .mockResolvedValueOnce({ Id: 'qbo-created' });

    const first = await onRequestPost({ request: request(), env: {} });
    const retry = await onRequestPost({ request: request(), env: {} });

    expect(first.body.results[0]).toMatchObject({
      error: 'QuickBooks customer sync could not be completed. Retry the same request.',
      code: 'qbo_customer_sync_failed',
      intuit_tid: 'tid-customer-502',
      retry_same_request: true,
    });
    expect(JSON.stringify(first.body)).not.toContain(privateDetail);
    const storedFailure = state.updates.find(({ patch }) => patch.qbo_sync_error)?.patch.qbo_sync_error;
    expect(storedFailure).toBe(
      'QuickBooks customer sync could not be completed. Retry the same request. [intuit_tid: tid-customer-502]',
    );
    expect(storedFailure).not.toContain(privateDetail);
    expect(retry.body.results[0]).toMatchObject({ action: 'created', qbo_customer_id: 'qbo-created' });
    expect(state.creates.mock.calls.map((call) => call[2].requestId)).toEqual(['stable-primary', 'stable-primary']);
  });

  it('does not expose an unexpected database or upstream exception from the route catch', async () => {
    const privateDetail = 'Supabase SELECT contacts: private implementation detail';
    state.selectFailure = Object.assign(new Error(privateDetail), { intuitTid: 'tid-customer-route' });

    const result = await onRequestPost({ request: request(), env: {} });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: 'QuickBooks customer sync could not be completed.',
      code: 'qbo_customer_sync_failed',
      intuit_tid: 'tid-customer-route',
    });
    expect(JSON.stringify(result.body)).not.toContain(privateDetail);
  });

  it('does not stamp an error after a late competing attempt has linked the contact', async () => {
    state.storedCustomerId = 'qbo-winner';
    state.creates.mockRejectedValueOnce(new Error('QBO timeout'));

    const result = await onRequestPost({ request: request(), env: {} });

    expect(result.body.results[0]).toEqual({
      id: contactId,
      name: 'Alex Customer',
      action: 'linked',
      matched_by: 'concurrent',
      qbo_customer_id: 'qbo-winner',
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ filter: expect.stringContaining('qbo_customer_id=is.null') });
    expect(state.updates[0].patch).toHaveProperty('qbo_sync_error');
  });

  it('refuses a frozen customer prerequisite after the connected QBO realm changes', async () => {
    state.connection = { ...state.connection, realm_id: 'realm-after-switch' };

    const result = await onRequestPost({
      request: request({ contact_id: contactId, expected_realm_id: 'realm-before-switch' }),
      env: {},
    });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: 'qbo-realm-mismatch', retry_same_request: true });
    expect(state.find).not.toHaveBeenCalled();
    expect(state.creates).not.toHaveBeenCalled();
  });

  it('returns the stable maintenance 503 without stamping qbo_sync_error when the gate closes before create', async () => {
    state.creates.mockRejectedValueOnce(Object.assign(
      new Error('QuickBooks provider traffic is temporarily disabled.'),
      { code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled', status: 503 },
    ));

    const result = await onRequestPost({ request: request(), env: {} });

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled',
    });
    expect(state.updates).toEqual([]);
  });
});
