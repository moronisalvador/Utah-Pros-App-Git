/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/qbo-worker-authorization.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the four legacy QuickBooks workers reject unapproved browser callers before they can
 *   read company records or contact QuickBooks. It also locks the existing trusted-server path
 *   and missing-session response so the containment does not break deployed callers.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-invoice.js, qbo-estimate.js, qbo-payment.js, qbo-query.js
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEstimate,
  createInvoice,
  createPayment,
  deleteEstimate,
  deleteInvoice,
  deletePayment,
  divisionToQbo,
  ensureQboCustomer,
  findClassId,
  getConnection,
  qboFetch,
  sendEstimate,
  sendInvoice,
  updateEstimate,
  updateInvoice,
} from '../lib/quickbooks.js';
import { onRequestPost as handleInvoice } from './qbo-invoice.js';
import { onRequestPost as handleEstimate } from './qbo-estimate.js';
import { onRequestPost as handlePayment } from './qbo-payment.js';
import { onRequestPost as handleQuery } from './qbo-query.js';

vi.mock('../lib/quickbooks.js', () => ({
  createEstimate: vi.fn(),
  createInvoice: vi.fn(),
  createPayment: vi.fn(),
  deleteEstimate: vi.fn(),
  deleteInvoice: vi.fn(),
  deletePayment: vi.fn(),
  divisionToQbo: vi.fn(),
  ensureQboCustomer: vi.fn(),
  findClassId: vi.fn(),
  getConnection: vi.fn(),
  qboFetch: vi.fn(),
  sendEstimate: vi.fn(),
  sendInvoice: vi.fn(),
  updateEstimate: vi.fn(),
  updateInvoice: vi.fn(),
}));

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  QBO_WEBHOOK_SECRET: 'server-secret',
};

const workers = [
  ['qbo-invoice', handleInvoice, 'Provide invoice_id'],
  ['qbo-estimate', handleEstimate, 'Provide estimate_id'],
  ['qbo-payment', handlePayment, 'Provide payment_id'],
  ['qbo-query', handleQuery, 'Provide a "query"'],
];

const providerCalls = [
  createEstimate,
  createInvoice,
  createPayment,
  deleteEstimate,
  deleteInvoice,
  deletePayment,
  divisionToQbo,
  ensureQboCustomer,
  findClassId,
  qboFetch,
  sendEstimate,
  sendInvoice,
  updateEstimate,
  updateInvoice,
];

const INVOICE_ID = '00000000-0000-4000-8000-000000000123';
const INVOICE_COMMAND_ID = '00000000-0000-4000-8000-000000000456';

function request(path, headers = {}, body) {
  const invoiceHeaders = path === 'qbo-invoice'
    ? { 'Idempotency-Key': INVOICE_COMMAND_ID }
    : {};
  const defaultBody = path === 'qbo-invoice'
    ? JSON.stringify({ invoice_id: INVOICE_ID })
    : '{}';
  return new Request(`https://app.test/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...invoiceHeaders, ...headers },
    body: body ?? defaultBody,
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
  );
}

function expectNoProviderOrConnection() {
  expect(getConnection).not.toHaveBeenCalled();
  for (const providerCall of providerCalls) expect(providerCall).not.toHaveBeenCalled();
}

function expectAuthReadsOnly(fetchSpy) {
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(String(fetchSpy.mock.calls[0][0])).toBe('https://db.test/auth/v1/user');
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(String(fetchSpy.mock.calls[1][0])).toMatch(/^https:\/\/db\.test\/rest\/v1\/employees\?/);
  expect(fetchSpy.mock.calls[1][1]).not.toHaveProperty('body');
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe.each(workers)('%s authorization containment', (path, handler, missingBodyError) => {
  it('preserves 401 Unauthorized without a session and performs no reads or provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await handler({ request: request(path), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoProviderOrConnection();
  });

  it('preserves 401 Unauthorized for an invalid or expired session', async () => {
    const fetchSpy = mockAuthUser(401);
    const res = await handler({
      request: request(path, { Authorization: 'Bearer expired' }),
      env,
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNoProviderOrConnection();
  });

  it('fails closed when the Bearer-auth configuration is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { SUPABASE_ANON_KEY: _omitted, ...misconfiguredEnv } = env;
    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }),
      env: misconfiguredEnv,
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoProviderOrConnection();
  });

  it('fails closed when session verification cannot reach the auth service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }),
      env,
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNoProviderOrConnection();
  });

  it('fails closed when the employee lookup fails', async () => {
    const fetchSpy = mockAuthUser().mockRejectedValueOnce(new Error('database unavailable'));
    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }),
      env,
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expectAuthReadsOnly(fetchSpy);
    expectNoProviderOrConnection();
  });

  it('returns 403 before business reads for a session with no employee row', async () => {
    const fetchSpy = mockEmployee(null);
    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }),
      env,
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expectAuthReadsOnly(fetchSpy);
    expectNoProviderOrConnection();
  });

  // office and project_manager moved OUT of this deny-list on 2026-08-05, owner-directed:
  // the 2026-08-04 billing widening (src/lib/claimUtils BILLING_EDIT_ROLES and
  // public.billing_edit_access()) was confirmed to cover pushing to QuickBooks, not only
  // writing invoice rows in UPR. Their allowed-path proof is the it.each below.
  // Everything still listed here stays denied — an inactive or external employee is
  // refused REGARDLESS of role, which is the containment this file exists for.
  it.each([
    ['inactive admin', { is_active: false }],
    ['external admin', { is_external: true }],
    ['inactive office employee', { role: 'office', is_active: false }],
    ['external project manager', { role: 'project_manager', is_external: true }],
    ['supervisor', { role: 'supervisor' }],
    ['field technician', { role: 'field_tech' }],
    ['CRM partner', { role: 'crm_partner' }],
  ])('returns 403 before business reads for an %s', async (_label, employee) => {
    const fetchSpy = mockEmployee(employee);
    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }),
      env,
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expectAuthReadsOnly(fetchSpy);
    expectNoProviderOrConnection();
  });

  // Every billing role reaches the gate, not just admin (owner-directed 2026-08-05).
  // Before this, office/project_manager saw enabled Save invoice / Send to customer /
  // Revert to draft in InvoiceEditor and got 403 from here — the UI offered what the
  // server refused. Asserting the SAME downstream 409 for each proves the gate opened
  // without altering what happens after it.
  it.each([
    ['admin', 'admin'],
    ['office employee', 'office'],
    ['project manager', 'project_manager'],
  ])('allows an active internal %s through the gate without changing the downstream response', async (_label, role) => {
    const fetchSpy = mockEmployee({ role });
    getConnection.mockResolvedValue(null);

    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }),
      env,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'QuickBooks not connected' });
    expectAuthReadsOnly(fetchSpy);
    expect(getConnection).toHaveBeenCalledOnce();
    for (const providerCall of providerCalls) expect(providerCall).not.toHaveBeenCalled();
  });

  it('keeps the server-secret bypass off the human invoice endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    getConnection.mockResolvedValue(null);

    const res = await handler({
      request: request(path, { 'x-webhook-secret': 'server-secret' }),
      env,
    });

    expect(res.status).toBe(path === 'qbo-invoice' ? 401 : 409);
    await expect(res.json()).resolves.toEqual(path === 'qbo-invoice'
      ? { error: 'Unauthorized' }
      : { error: 'QuickBooks not connected' });
    expect(fetchSpy).not.toHaveBeenCalled();
    if (path === 'qbo-invoice') expectNoProviderOrConnection();
    else {
      expect(getConnection).toHaveBeenCalledOnce();
      for (const providerCall of providerCalls) expect(providerCall).not.toHaveBeenCalled();
    }
  });

  it('rejects an invalid server secret when no valid Bearer session is present', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await handler({
      request: request(path, { 'x-webhook-secret': 'wrong-secret' }),
      env,
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoProviderOrConnection();
  });

  it('falls back to a valid internal-admin Bearer when a supplied server secret is wrong', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    getConnection.mockResolvedValue(null);

    const res = await handler({
      request: request(path, {
        'x-webhook-secret': 'wrong-secret',
        Authorization: 'Bearer jwt',
      }),
      env,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'QuickBooks not connected' });
    expectAuthReadsOnly(fetchSpy);
    expect(getConnection).toHaveBeenCalledOnce();
    for (const providerCall of providerCalls) expect(providerCall).not.toHaveBeenCalled();
  });

  it('does not let a server secret bypass an expired Bearer session on invoices', async () => {
    const fetchSpy = path === 'qbo-invoice' ? mockAuthUser(401) : vi.spyOn(globalThis, 'fetch');
    getConnection.mockResolvedValue(null);

    const res = await handler({
      request: request(path, {
        'x-webhook-secret': 'server-secret',
        Authorization: 'Bearer expired',
      }),
      env,
    });

    expect(res.status).toBe(path === 'qbo-invoice' ? 401 : 409);
    await expect(res.json()).resolves.toEqual(path === 'qbo-invoice'
      ? { error: 'Unauthorized' }
      : { error: 'QuickBooks not connected' });
    if (path === 'qbo-invoice') expect(fetchSpy).toHaveBeenCalledOnce();
    else expect(fetchSpy).not.toHaveBeenCalled();
    if (path === 'qbo-invoice') expectNoProviderOrConnection();
    else {
      expect(getConnection).toHaveBeenCalledOnce();
      for (const providerCall of providerCalls) expect(providerCall).not.toHaveBeenCalled();
    }
  });

  it('preserves the post-auth malformed-body contract without a business or provider write', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    getConnection.mockResolvedValue({ refresh_token: 'present' });

    const res = await handler({
      request: request(path, { Authorization: 'Bearer jwt' }, '{'),
      env,
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: missingBodyError });
    expectAuthReadsOnly(fetchSpy);
    if (path === 'qbo-invoice') expect(getConnection).not.toHaveBeenCalled();
    else expect(getConnection).toHaveBeenCalledOnce();
    for (const providerCall of providerCalls) expect(providerCall).not.toHaveBeenCalled();
  });
});
