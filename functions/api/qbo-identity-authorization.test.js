/**
 * ════════════════════════════════════════════════
 * FILE: qbo-identity-authorization.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the identity boundary for the remaining QuickBooks workers. Trusted server tasks keep
 *   their existing capability, browser actions require an active internal administrator, and
 *   denied requests stop before business data, telemetry, OAuth state, or provider helpers.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-sync-customer.js, qbo-payments-sync.js, quickbooks-connect.js,
 *              qbo-charge.js, qbo-attach.js
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  createCharge,
  createCustomer,
  createPayment,
  deleteAttachable,
  disambiguatedCustomerPayload,
  findExistingCustomer,
  getConnection,
  mapContactToCustomer,
  qboFetch,
  uploadAttachable,
} from '../lib/quickbooks.js';
import {
  notifyPaymentReceived,
  removeQboPaymentFromUpr,
  syncQboPaymentToUpr,
} from '../lib/qbo-payment-sync.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { onRequestPost as syncCustomer } from './qbo-sync-customer.js';
import {
  onRequestGet as syncPaymentsGet,
  onRequestPost as syncPaymentsPost,
  scheduled as syncPaymentsScheduled,
} from './qbo-payments-sync.js';
import { onRequestGet as connectQuickBooks } from './quickbooks-connect.js';
import { onRequestPost as chargeCard } from './qbo-charge.js';
import { onRequestPost as attachFile } from './qbo-attach.js';

vi.mock('../lib/quickbooks.js', () => ({
  buildAuthorizeUrl: vi.fn(),
  createCharge: vi.fn(),
  createCustomer: vi.fn(),
  customerCreateRequestId: vi.fn(),
  createPayment: vi.fn(),
  deleteAttachable: vi.fn(),
  disambiguatedCustomerPayload: vi.fn(),
  findExistingCustomer: vi.fn(),
  getConnection: vi.fn(),
  mapContactToCustomer: vi.fn(),
  qboFetch: vi.fn(),
  uploadAttachable: vi.fn(),
}));

vi.mock('../lib/qbo-payment-sync.js', () => ({
  notifyPaymentReceived: vi.fn(),
  removeQboPaymentFromUpr: vi.fn(),
  syncQboPaymentToUpr: vi.fn(),
}));

vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(),
}));

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  QBO_WEBHOOK_SECRET: 'server-secret',
};

const downstreamCalls = [
  buildAuthorizeUrl,
  createCharge,
  createCustomer,
  createPayment,
  deleteAttachable,
  disambiguatedCustomerPayload,
  findExistingCustomer,
  getConnection,
  mapContactToCustomer,
  notifyPaymentReceived,
  qboFetch,
  recordWorkerRun,
  removeQboPaymentFromUpr,
  syncQboPaymentToUpr,
  uploadAttachable,
];

const postConnectionCalls = downstreamCalls.filter((call) => call !== getConnection);

function request(path, {
  method = 'POST',
  headers = {},
  body = method === 'GET' ? undefined : '{}',
} = {}) {
  return new Request(`https://app.test/api/${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}

function mockAuthUser(status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(status === 200 ? JSON.stringify({ id: 'user-1' }) : '', { status }),
  );
}

function mockEmployee(employee) {
  return mockAuthUser().mockResolvedValueOnce(
    new Response(JSON.stringify(employee ? [{
      id: 'employee-1',
      role: 'admin',
      is_active: true,
      is_external: false,
      ...employee,
    }] : []), { status: 200 }),
  ).mockImplementation(async () => new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }));
}

function expectNoDownstream() {
  for (const call of downstreamCalls) expect(call).not.toHaveBeenCalled();
}

function expectNoCallsAfterConnection() {
  for (const call of postConnectionCalls) expect(call).not.toHaveBeenCalled();
}

function expectAuthReadsOnly(fetchSpy) {
  expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(String(fetchSpy.mock.calls[0][0])).toBe('https://db.test/auth/v1/user');
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(String(fetchSpy.mock.calls[1][0])).toMatch(/^https:\/\/db\.test\/rest\/v1\/employees\?/);
  expect(fetchSpy.mock.calls[1][1]).not.toHaveProperty('body');
}

async function expectJson(response, status, body) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(body);
}

const capabilityWorkers = [
  {
    label: 'qbo-sync-customer POST',
    invoke: (headers = {}) => syncCustomer({
      request: request('qbo-sync-customer', { headers }),
      env,
    }),
    disconnected: { status: 409, body: { error: 'QuickBooks not connected' } },
  },
  {
    label: 'qbo-payments-sync GET',
    invoke: (headers = {}) => syncPaymentsGet({
      request: request('qbo-payments-sync', { method: 'GET', headers }),
      env,
    }),
    disconnected: {
      status: 200,
      body: { ok: false, error: 'QuickBooks not connected' },
    },
  },
  {
    label: 'qbo-payments-sync POST',
    invoke: (headers = {}) => syncPaymentsPost({
      request: request('qbo-payments-sync', { headers }),
      env,
    }),
    disconnected: {
      status: 200,
      body: { ok: false, error: 'QuickBooks not connected' },
    },
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe.each(capabilityWorkers)('$label identity boundary', ({
  invoke,
  disconnected,
}) => {
  it('preserves 401 Unauthorized without a session and reaches no downstream helper', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expectJson(await invoke(), 401, { error: 'Unauthorized' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('preserves 401 Unauthorized for an invalid or expired session', async () => {
    const fetchSpy = mockAuthUser(401);

    await expectJson(
      await invoke({ Authorization: 'Bearer expired' }),
      401,
      { error: 'Unauthorized' },
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expectNoDownstream();
  });

  it('fails closed when Bearer-auth configuration is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { SUPABASE_ANON_KEY: _omitted, ...misconfiguredEnv } = env;
    const worker = capabilityWorkers.find((entry) => entry.invoke === invoke);
    const route = worker.label.includes('customer') ? 'qbo-sync-customer' : 'qbo-payments-sync';
    const method = worker.label.endsWith('GET') ? 'GET' : 'POST';
    const handler = worker.label.includes('customer')
      ? syncCustomer
      : method === 'GET'
        ? syncPaymentsGet
        : syncPaymentsPost;

    await expectJson(await handler({
      request: request(route, {
        method,
        headers: { Authorization: 'Bearer jwt' },
      }),
      env: misconfiguredEnv,
    }), 500, { error: 'Authorization check failed' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('fails closed when session verification cannot reach the auth service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      502,
      { error: 'Authorization check failed' },
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expectNoDownstream();
  });

  it('fails closed when employee lookup fails', async () => {
    const fetchSpy = mockAuthUser().mockRejectedValueOnce(new Error('database unavailable'));

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      500,
      { error: 'Authorization check failed' },
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });

  it.each([
    ['no employee row', null],
    ['inactive admin', { is_active: false }],
    ['external admin', { is_external: true }],
    ['office employee', { role: 'office' }],
    ['supervisor', { role: 'supervisor' }],
    ['field technician', { role: 'field_tech' }],
    ['project manager', { role: 'project_manager' }],
    ['CRM partner', { role: 'crm_partner' }],
  ])('returns 403 before downstream access for %s', async (_label, employee) => {
    const fetchSpy = mockEmployee(employee);

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      403,
      { error: 'Forbidden' },
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });

  it('preserves the active internal-admin disconnected response', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    getConnection.mockResolvedValue(null);

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      disconnected.status,
      disconnected.body,
    );

    expectAuthReadsOnly(fetchSpy);
    expect(getConnection).toHaveBeenCalledOnce();
    expectNoCallsAfterConnection();
  });

  it('preserves the exact server capability without Auth or employee reads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }));
    getConnection.mockResolvedValue(null);

    await expectJson(
      await invoke({ 'x-webhook-secret': 'server-secret' }),
      disconnected.status,
      disconnected.body,
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(getConnection).toHaveBeenCalledOnce();
    expectNoCallsAfterConnection();
  });

  it('rejects a wrong server secret when no Bearer session is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expectJson(
      await invoke({ 'x-webhook-secret': 'wrong-secret' }),
      401,
      { error: 'Unauthorized' },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('falls back from a wrong server secret to an active internal-admin Bearer', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    getConnection.mockResolvedValue(null);

    await expectJson(
      await invoke({
        'x-webhook-secret': 'wrong-secret',
        Authorization: 'Bearer jwt',
      }),
      disconnected.status,
      disconnected.body,
    );

    expectAuthReadsOnly(fetchSpy);
    expect(getConnection).toHaveBeenCalledOnce();
    expectNoCallsAfterConnection();
  });

  it('keeps the exact server capability secret-first when an expired Bearer is also present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }));
    getConnection.mockResolvedValue(null);

    await expectJson(
      await invoke({
        'x-webhook-secret': 'server-secret',
        Authorization: 'Bearer expired',
      }),
      disconnected.status,
      disconnected.body,
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(getConnection).toHaveBeenCalledOnce();
    expectNoCallsAfterConnection();
  });
});

describe('qbo-payments-sync scheduler contract', () => {
  it('keeps the direct Cloudflare scheduled entrypoint independent of HTTP authorization', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }));
    getConnection.mockResolvedValue(null);

    expect(syncPaymentsScheduled).toHaveLength(3);
    await syncPaymentsScheduled({}, env, {});

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(getConnection).toHaveBeenCalledOnce();
    expectNoCallsAfterConnection();
  });
});

describe('quickbooks-connect browser-only identity boundary', () => {
  const invoke = (headers = {}, workerEnv = env) => connectQuickBooks({
    request: request('quickbooks-connect', { method: 'GET', headers }),
    env: workerEnv,
  });

  it('preserves 401 Unauthorized without a session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expectJson(await invoke(), 401, { error: 'Unauthorized' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('preserves 401 Unauthorized for an invalid or expired session', async () => {
    const fetchSpy = mockAuthUser(401);

    await expectJson(
      await invoke({ Authorization: 'Bearer expired' }),
      401,
      { error: 'Unauthorized' },
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expectNoDownstream();
  });

  it('fails closed when auth configuration is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { SUPABASE_ANON_KEY: _omitted, ...misconfiguredEnv } = env;

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }, misconfiguredEnv),
      500,
      { error: 'Authorization check failed' },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('fails closed when session verification cannot reach the auth service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      502,
      { error: 'Authorization check failed' },
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expectNoDownstream();
  });

  it('fails closed when employee lookup fails', async () => {
    const fetchSpy = mockAuthUser().mockRejectedValueOnce(new Error('database unavailable'));

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      500,
      { error: 'Authorization check failed' },
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });

  it.each([
    ['no employee row', null],
    ['inactive admin', { is_active: false }],
    ['external admin', { is_external: true }],
    ['office employee', { role: 'office' }],
    ['supervisor', { role: 'supervisor' }],
    ['field technician', { role: 'field_tech' }],
    ['project manager', { role: 'project_manager' }],
    ['CRM partner', { role: 'crm_partner' }],
  ])('returns 403 before OAuth state access for %s', async (_label, employee) => {
    const fetchSpy = mockEmployee(employee);

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      403,
      { error: 'Forbidden' },
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });

  it('does not grant the server capability permission to replace OAuth state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expectJson(
      await invoke({ 'x-webhook-secret': 'server-secret' }),
      401,
      { error: 'Unauthorized' },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('preserves the exact missing-provider-configuration response after authorization', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      500,
      {
        error: 'QuickBooks not configured (missing QBO_CLIENT_ID / QBO_REDIRECT_URI env vars)',
      },
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });

  it('preserves OAuth state writes and the exact configured success response', async () => {
    const configuredEnv = {
      ...env,
      QBO_CLIENT_ID: 'client-id',
      QBO_REDIRECT_URI: 'https://app.test/api/quickbooks-callback',
    };
    const fetchSpy = mockEmployee({ role: 'admin' })
      .mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 201 }))
      .mockResolvedValueOnce(new Response('[]', { status: 201 }));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('fixed-oauth-state');
    buildAuthorizeUrl.mockReturnValue('https://provider.test/authorize');

    const response = await invoke({ Authorization: 'Bearer jwt' }, configuredEnv);

    await expectJson(response, 200, { url: 'https://provider.test/authorize' });
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://db.test/auth/v1/user');
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/^https:\/\/db\.test\/rest\/v1\/employees\?/);
    const oauthWrites = fetchSpy.mock.calls.slice(3, 5).map(([, init]) => JSON.parse(init.body));
    expect(oauthWrites).toEqual([
      {
        key: 'qbo_oauth_state',
        value: 'fixed-oauth-state',
        updated_at: expect.any(String),
      },
      {
        key: 'qbo_oauth_user',
        value: 'user-1',
        updated_at: expect.any(String),
      },
    ]);
    expect(buildAuthorizeUrl).toHaveBeenCalledWith(configuredEnv, 'fixed-oauth-state');
    for (const call of postConnectionCalls.filter((entry) => entry !== buildAuthorizeUrl)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('cleans OAuth state and refuses when the provider brake closes after persistence', async () => {
    const configuredEnv = { ...env, QBO_CLIENT_ID: 'client-id', QBO_REDIRECT_URI: 'https://app.test/api/quickbooks-callback' };
    const fetchSpy = mockEmployee({ role: 'admin' })
      .mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 201 }))
      .mockResolvedValueOnce(new Response('[]', { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'false' }]), { status: 200 }));

    await expectJson(await invoke({ Authorization: 'Bearer jwt' }, configuredEnv), 503, {
      error: 'QuickBooks is temporarily unavailable. Please try again shortly.',
      code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled',
    });

    const deletes = fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes).toHaveLength(2);
    expect(buildAuthorizeUrl).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    label: 'qbo-charge',
    expectedBoundary: {
      status: 503,
      body: {
        error: 'Keyed card charging is temporarily unavailable while its durable reconciliation boundary is completed.',
        code: 'qbo_charge_durable_boundary_required', reason: 'qbo_charge_durable_boundary_required',
      },
    },
    invoke: (headers = {}) => chargeCard({
      request: request('qbo-charge', {
        headers: {
          'Idempotency-Key': 'stable_request_1234',
          ...headers,
        },
        body: JSON.stringify({
          invoice_id: 'invoice-1',
          token: 'opaque-intuit-token',
          amount: 10,
        }),
      }),
      env,
    }),
  },
  {
    label: 'qbo-attach',
    expectedBoundary: { status: 400, body: { error: 'entity_type must be "invoice" or "estimate"' } },
    invoke: (headers = {}) => attachFile({
      request: request('qbo-attach', { headers }),
      env,
    }),
  },
])('$label external-identity reconciliation', ({ invoke, expectedBoundary }) => {
  it('rejects an external admin before connection, data, telemetry, or provider access', async () => {
    const fetchSpy = mockEmployee({ role: 'admin', is_external: true });

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      403,
      { error: 'Insufficient role' },
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });

  it('does not add a server-secret capability to the Bearer-only route', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expectJson(
      await invoke({ 'x-webhook-secret': 'server-secret' }),
      401,
      { error: 'Missing Authorization header' },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it('stops at the release boundary without a QBO connection or local side effect', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });

    await expectJson(
      await invoke({ Authorization: 'Bearer jwt' }),
      expectedBoundary.status,
      expectedBoundary.body,
    );

    expectAuthReadsOnly(fetchSpy);
    expectNoDownstream();
  });
});
