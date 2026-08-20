/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/money-worker-authorization.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the keyed-card and Stripe pay-link Workers enforce the canonical
 *   billing role on the server before a provider can be called.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-charge.js, stripe-pay-link.js
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckoutSession } from '../lib/stripe.js';
import {
  chargeAmountCents,
  onRequestPost as chargeCard,
} from './qbo-charge.js';
import { onRequestPost as createPayLink } from './stripe-pay-link.js';

vi.mock('../lib/stripe.js', () => ({
  createCheckoutSession: vi.fn(),
  stripeConfigured: (env) => !!env.STRIPE_SECRET_KEY,
}));
vi.mock('../lib/qbo-payment-sync.js', () => ({
  notifyPaymentReceived: vi.fn(),
}));

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

function request(path, withAuth = true, {
  amount = 10,
  idempotencyKey = 'stable_request_1234',
} = {}) {
  return new Request(`https://app.test/api/${path}`, {
    method: 'POST',
    headers: {
      ...(withAuth ? { Authorization: 'Bearer jwt' } : {}),
      'Content-Type': 'application/json',
      ...(idempotencyKey == null ? {} : { 'Idempotency-Key': idempotencyKey }),
    },
    body: JSON.stringify({
      invoice_id: 'invoice-1',
      token: 'opaque-intuit-token',
      amount,
    }),
  });
}

function mockEmployee(employee) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(employee ? [{
      id: 'employee-1',
      role: 'field_tech',
      is_active: true,
      is_external: false,
      ...employee,
    }] : []), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }));
}

function expectNoProviderCall() {
  expect(createCheckoutSession).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

// The allow-list is per handler, not shared. stripe-pay-link was corrected to the
// real billing list on 2026-08-19; qbo-charge still carries the stale ('admin','manager')
// pair that workers-standard.md §1 names, and widening it is its own reviewed change —
// so a single shared list here would either hide that gap or pretend it was closed.
describe.each([
  ['QBO card charge', chargeCard, 'qbo-charge', ['admin', 'manager']],
  ['Stripe pay link', createPayLink, 'stripe-pay-link', ['admin', 'office', 'project_manager']],
])('%s authorization', (_label, handler, path, allowedRoles) => {
  it('returns 401 without a session before any database or provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await handler({ request: request(path, false), env });

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoProviderCall();
  });

  it('returns 403 for an active field technician before any provider call', async () => {
    const fetchSpy = mockEmployee({ role: 'field_tech' });
    const res = await handler({ request: request(path), env });

    expect(res.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expectNoProviderCall();
  });

  it('returns 403 for an inactive billing-role employee before any provider call', async () => {
    const fetchSpy = mockEmployee({ role: 'admin', is_active: false });
    const res = await handler({ request: request(path), env });

    expect(res.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expectNoProviderCall();
  });

  it('returns 403 when the authenticated user has no employee row', async () => {
    const fetchSpy = mockEmployee(null);
    const res = await handler({ request: request(path), env });

    expect(res.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expectNoProviderCall();
  });

  it.each(allowedRoles)('allows the %s role through the server gate', async (role) => {
    const fetchSpy = mockEmployee({ role });
    const res = await handler({ request: request(path), env });

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expectNoProviderCall();
  });
});

describe('QBO charge money and idempotency contract', () => {
  it.each([
    [10, 1000],
    ['10.25', 1025],
    [0.01, 1],
  ])('normalizes %s to integer cents', (amount, expected) => {
    expect(chargeAmountCents(amount)).toBe(expected);
  });

  it.each([0, -1, 'not-money', 10.001])('rejects invalid or fractional-cent amount %s', (amount) => {
    expect(chargeAmountCents(amount)).toBeNull();
  });

  it('source-disables every validated keyed-card request before invoice/payment work', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    const res = await chargeCard({ request: request('qbo-charge'), env });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'qbo_charge_durable_boundary_required', reason: 'qbo_charge_durable_boundary_required',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing', null],
    ['short', 'too_short'],
    ['unsafe', 'stable request with spaces'],
  ])('rejects a %s idempotency key before provider access', async (_label, idempotencyKey) => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    const res = await chargeCard({
      request: request('qbo-charge', true, { idempotencyKey }),
      env,
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expectNoProviderCall();
  });

  it('rejects a fractional-cent amount before provider access', async () => {
    const fetchSpy = mockEmployee({ role: 'admin' });
    const res = await chargeCard({
      request: request('qbo-charge', true, { amount: 10.001 }),
      env,
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expectNoProviderCall();
  });

});
