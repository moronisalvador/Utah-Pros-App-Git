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
import {
  createCharge,
  createPayment,
  getConnection,
} from '../lib/quickbooks.js';
import { createCheckoutSession } from '../lib/stripe.js';
import {
  chargeAmountCents,
  onRequestPost as chargeCard,
} from './qbo-charge.js';
import { onRequestPost as createPayLink } from './stripe-pay-link.js';

vi.mock('../lib/quickbooks.js', () => ({
  createCharge: vi.fn(),
  createPayment: vi.fn(),
  getConnection: vi.fn(),
}));
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
    }] : []), { status: 200 }));
}

function expectNoProviderCall() {
  expect(createCharge).not.toHaveBeenCalled();
  expect(createPayment).not.toHaveBeenCalled();
  expect(createCheckoutSession).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe.each([
  ['QBO card charge', chargeCard, 'qbo-charge'],
  ['Stripe pay link', createPayLink, 'stripe-pay-link'],
])('%s authorization', (_label, handler, path) => {
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

  it.each(['admin', 'manager'])('allows the %s role through the server gate', async (role) => {
    const fetchSpy = mockEmployee({ role });
    getConnection.mockResolvedValue(null);
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

  it('passes the stable client key to Intuit and records actor/date after authorization', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T05:30:00Z')); // July 23, 23:30 MDT
    getConnection.mockResolvedValue({
      refresh_token: 'present',
      granted_scopes: 'com.intuit.quickbooks.payment',
    });
    createCharge.mockResolvedValue({ id: 'charge-1', status: 'captured' });
    createPayment.mockResolvedValue({ Id: 'qbo-payment-1' });

    const fetchSpy = mockEmployee({ role: 'admin' })
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'invoice-1',
        job_id: 'job-1',
        contact_id: 'contact-1',
        qbo_invoice_id: 'qbo-invoice-1',
        total: 100,
        adjusted_total: null,
        amount_paid: 20,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        qbo_customer_id: 'qbo-customer-1',
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'payment-1',
      }]), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'payment-1',
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'run-1',
      }]), { status: 201 }));

    const res = await chargeCard({ request: request('qbo-charge'), env });

    expect(res.status).toBe(200);
    expect(createCharge).toHaveBeenCalledWith(env, {
      amount: 10,
      token: 'opaque-intuit-token',
      requestId: 'stable_request_1234',
    });
    expect(createPayment).toHaveBeenCalledWith(env, expect.objectContaining({
      amount: 10,
      txnDate: '2026-07-23',
    }));
    const paymentInsert = fetchSpy.mock.calls.find(([url, init]) =>
      String(url).endsWith('/rest/v1/payments') && init?.method === 'POST'
    );
    expect(paymentInsert).toBeTruthy();
    expect(JSON.parse(paymentInsert[1].body)).toMatchObject({
      amount: 10,
      payment_date: '2026-07-23',
      recorded_by: 'employee-1',
    });
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

  it('rejects an over-balance charge before provider access', async () => {
    getConnection.mockResolvedValue({
      refresh_token: 'present',
      granted_scopes: 'com.intuit.quickbooks.payment',
    });
    const fetchSpy = mockEmployee({ role: 'admin' })
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'invoice-1',
        job_id: 'job-1',
        contact_id: 'contact-1',
        qbo_invoice_id: 'qbo-invoice-1',
        total: 100,
        adjusted_total: null,
        amount_paid: 20,
      }]), { status: 200 }));

    const res = await chargeCard({
      request: request('qbo-charge', true, { amount: 80.01 }),
      env,
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expectNoProviderCall();
  });
});
