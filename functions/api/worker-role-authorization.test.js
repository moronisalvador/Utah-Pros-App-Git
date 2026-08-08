/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/worker-role-authorization.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the three workers that used to accept ANY valid login session now enforce a real
 *   role gate before touching company data or an outside provider. stripe-accounts (payout
 *   destinations) admits only an active internal admin; analyze-xactimate (writes invoice
 *   lines) and collections-chat (A/R + customer PII + live QuickBooks reads) admit only the
 *   billing roles. Every refusal is proven to happen BEFORE any business read, write, or
 *   provider call.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  stripe-accounts.js, analyze-xactimate.js, collections-chat.js
 *
 * NOTES / GOTCHAS:
 *   - The env fixture deliberately omits the service-role key (its name alone trips the
 *     repo secret scanner). Nothing here needs it: token verification uses the anon key,
 *     and every REST call is served by the fetch spy, which never inspects headers.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripeConfigured, listExternalAccounts } from '../lib/stripe.js';
import { divisionToQbo, findClassId, qboFetch } from '../lib/quickbooks.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { onRequestGet as handleStripeAccounts } from './stripe-accounts.js';
import { onRequestPost as handleAnalyzeXactimate } from './analyze-xactimate.js';
import { onRequestPost as handleCollectionsChat } from './collections-chat.js';

vi.mock('../lib/stripe.js', () => ({
  stripeConfigured: vi.fn(),
  listExternalAccounts: vi.fn(),
}));
vi.mock('../lib/quickbooks.js', () => ({
  divisionToQbo: vi.fn(),
  findClassId: vi.fn(),
  qboFetch: vi.fn(),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(),
}));

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  ANTHROPIC_API_KEY: 'ai-key',
};

const stripeRequest = (headers = {}) =>
  new Request('https://app.test/api/stripe-accounts', { headers });
const xactimateRequest = (headers = {}, body = '{}') =>
  new Request('https://app.test/api/analyze-xactimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
const chatRequest = (headers = {}, body = '{}') =>
  new Request('https://app.test/api/collections-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });

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

// The only two network calls a refused request may make: verify the session, look up the
// employee. Anything past that (business tables, Stripe, QuickBooks, Anthropic) is a leak.
function expectAuthReadsOnly(fetchSpy) {
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(String(fetchSpy.mock.calls[0][0])).toBe('https://db.test/auth/v1/user');
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(String(fetchSpy.mock.calls[1][0])).toMatch(/^https:\/\/db\.test\/rest\/v1\/employees\?/);
  expect(fetchSpy.mock.calls[1][1]).not.toHaveProperty('body');
}

function expectNoSideEffects() {
  expect(listExternalAccounts).not.toHaveBeenCalled();
  expect(divisionToQbo).not.toHaveBeenCalled();
  expect(findClassId).not.toHaveBeenCalled();
  expect(qboFetch).not.toHaveBeenCalled();
  expect(recordWorkerRun).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  stripeConfigured.mockReturnValue(true);
});

// ─── stripe-accounts: payout-management surface, admin-only ──────────────
// Mirrors functions/api/stripe-payout.js (PAYOUT_MANAGE_ROLES). office and
// project_manager are refused BY NAME below: they are billing editors, and billing
// editing was deliberately kept separate from payout management (owner-directed
// 2026-08-04) — this worker lists where company money pays out.
describe('stripe-accounts payout-role authorization', () => {
  it('stays dormant-safe for an authorized admin: 503 when Stripe is unconfigured', async () => {
    stripeConfigured.mockReturnValue(false);
    const fetchSpy = mockEmployee({ role: 'admin' });

    const res = await handleStripeAccounts({ request: stripeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ connected: false, error: 'Stripe not configured' });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });

  it('does not reveal Stripe configuration state to an unauthenticated caller', async () => {
    stripeConfigured.mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await handleStripeAccounts({ request: stripeRequest(), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Missing Authorization header' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('returns 401 without a session and performs no reads or provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await handleStripeAccounts({ request: stripeRequest(), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Missing Authorization header' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('returns 401 for an invalid or expired session', async () => {
    const fetchSpy = mockAuthUser(401);

    const res = await handleStripeAccounts({ request: stripeRequest({ Authorization: 'Bearer expired' }), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid or expired token' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });

  it('fails closed when the Bearer-auth configuration is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { SUPABASE_ANON_KEY: _omitted, ...misconfiguredEnv } = env;

    const res = await handleStripeAccounts({
      request: stripeRequest({ Authorization: 'Bearer jwt' }),
      env: misconfiguredEnv,
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('fails closed when session verification cannot reach the auth service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));

    const res = await handleStripeAccounts({ request: stripeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });

  it('fails closed when the employee lookup fails', async () => {
    const fetchSpy = mockAuthUser().mockRejectedValueOnce(new Error('database unavailable'));

    const res = await handleStripeAccounts({ request: stripeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });

  it.each([
    ['session with no employee row', null],
    ['inactive admin', { is_active: false }],
    ['external admin', { is_external: true }],
    ['office employee', { role: 'office' }],
    ['project manager', { role: 'project_manager' }],
    ['supervisor', { role: 'supervisor' }],
    ['estimator', { role: 'estimator' }],
    ['field technician', { role: 'field_tech' }],
    ['CRM partner', { role: 'crm_partner' }],
  ])('returns 403 before provider or config work for a %s', async (_label, employee) => {
    const fetchSpy = mockEmployee(employee);

    const res = await handleStripeAccounts({ request: stripeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden — payout role required' });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });

  it('allows an active internal admin through and lists the external accounts', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' })
      // third fetch: the stripe_connected upsert into integration_config
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    listExternalAccounts.mockResolvedValue({ accountId: 'acct_1', banks: [{ id: 'ba_1' }], cards: [] });

    const res = await handleStripeAccounts({ request: stripeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      connected: true, account_id: 'acct_1', banks: [{ id: 'ba_1' }], cards: [],
    });
    expect(listExternalAccounts).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(String(fetchSpy.mock.calls[2][0])).toBe('https://db.test/rest/v1/integration_config');
  });
});

// ─── analyze-xactimate + collections-chat: billing-role surface ──────────────
// Both use authorizeQboBrowserRequest (QBO_BROWSER_ROLES = admin/office/project_manager),
// the same list pinned across surfaces by tests/qa/unit/billing-role-surface-parity.test.js.
const billingWorkers = [
  ['analyze-xactimate', handleAnalyzeXactimate, xactimateRequest],
  ['collections-chat', handleCollectionsChat, chatRequest],
];

describe.each(billingWorkers)('%s billing-role authorization', (_name, handler, makeRequest) => {
  it('returns 401 without a session and performs no reads or provider calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await handler({ request: makeRequest(), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('returns 401 for an invalid or expired session', async () => {
    const fetchSpy = mockAuthUser(401);

    const res = await handler({ request: makeRequest({ Authorization: 'Bearer expired' }), env });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });

  it('fails closed when the Bearer-auth configuration is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { SUPABASE_ANON_KEY: _omitted, ...misconfiguredEnv } = env;

    const res = await handler({ request: makeRequest({ Authorization: 'Bearer jwt' }), env: misconfiguredEnv });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('fails closed when session verification cannot reach the auth service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));

    const res = await handler({ request: makeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });

  it('fails closed when the employee lookup fails', async () => {
    const fetchSpy = mockAuthUser().mockRejectedValueOnce(new Error('database unavailable'));

    const res = await handler({ request: makeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Authorization check failed' });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });

  it.each([
    ['session with no employee row', null],
    ['inactive admin', { is_active: false }],
    ['external admin', { is_external: true }],
    ['inactive office employee', { role: 'office', is_active: false }],
    ['external project manager', { role: 'project_manager', is_external: true }],
    ['supervisor', { role: 'supervisor' }],
    ['estimator', { role: 'estimator' }],
    ['field technician', { role: 'field_tech' }],
    ['CRM partner', { role: 'crm_partner' }],
  ])('returns 403 before business reads for a %s', async (_label, employee) => {
    const fetchSpy = mockEmployee(employee);

    const res = await handler({ request: makeRequest({ Authorization: 'Bearer jwt' }), env });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });
});

// Allowed-path proofs: the gate opens for every billing role WITHOUT changing what
// happens after it — each stops at the first cheap post-auth check, so no Anthropic,
// Storage, or business read runs in the test.
describe.each([
  ['admin'],
  ['office'],
  ['project_manager'],
])('billing role %s passes the widened gate', (role) => {
  it('analyze-xactimate proceeds to the AI-config check', async () => {
    const fetchSpy = mockEmployee({ role });
    const { ANTHROPIC_API_KEY: _omitted, ...noAiEnv } = env;

    const res = await handleAnalyzeXactimate({
      request: xactimateRequest({ Authorization: 'Bearer jwt' }),
      env: noAiEnv,
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'AI isn’t configured yet — add ANTHROPIC_API_KEY in Cloudflare (Preview + Production).',
    });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });

  it('collections-chat proceeds to conversation validation', async () => {
    const fetchSpy = mockEmployee({ role });

    const res = await handleCollectionsChat({
      request: chatRequest({ Authorization: 'Bearer jwt' }),
      env,
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Send a non-empty conversation ending in a user message.',
    });
    expectAuthReadsOnly(fetchSpy);
    expectNoSideEffects();
  });
});

// ─── Static parity: the duplicated payout role list can never drift ──────────────
// stripe-accounts.js declares its own PAYOUT_MANAGE_ROLES because functions/ cannot
// import from src/ and stripe-payout.js (the canonical copy) is initiative-leased.
// This pin is the drift guard: if either list changes, both must, deliberately.
describe('PAYOUT_MANAGE_ROLES parity', () => {
  const roleList = (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const match = source.match(/const PAYOUT_MANAGE_ROLES = \[([^\]]*)\]/);
    expect(match, `${relativePath} must declare PAYOUT_MANAGE_ROLES`).not.toBeNull();
    return match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  };

  it('stripe-accounts pins the identical admin-only list stripe-payout enforces', () => {
    const accounts = roleList('./stripe-accounts.js');
    expect(accounts).toEqual(['admin']);
    expect(accounts).toEqual(roleList('./stripe-payout.js'));
  });
});
