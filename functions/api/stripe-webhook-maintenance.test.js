/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook-maintenance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the Stripe listener's front door: a forged message is rejected, and
 *   while the payment feature is switched off a genuine message is politely
 *   refused without recording anything anywhere.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  stripe-webhook.js and mocked stripe/database helpers
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Reading the feature flag is itself one Supabase call, so "no database
 *     access at all" is no longer the right assertion for the switched-off path.
 *     What matters — and what these tests pin — is that NO event is claimed and
 *     no business read, write or provider call happens before the gate passes.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null, flagRows: [] }));
vi.mock('../lib/cors.js', () => ({ jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }) }));
vi.mock('../lib/stripe.js', () => ({
  stripeConfigured: () => true,
  constructEvent: vi.fn(),
  retrieveCharge: vi.fn(),
}));
vi.mock('../lib/supabase.js', () => ({ supabase: vi.fn(() => state.db) }));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(), createPayment: vi.fn(), createPurchase: vi.fn(),
  createTransfer: vi.fn(), deletePayment: vi.fn(), deleteEntity: vi.fn(),
}));
vi.mock('../lib/qbo-payment-sync.js', () => ({ notifyPaymentReceived: vi.fn() }));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: vi.fn() }));

import { constructEvent } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, createPayment, createPurchase, createTransfer } from '../lib/quickbooks.js';
import { onRequestPost } from './stripe-webhook.js';

const request = () => new Request('https://app.test/api/stripe-webhook', {
  method: 'POST', body: '{}', headers: { 'stripe-signature': 'sig' },
});
const env = { STRIPE_WEBHOOK_SECRET: 'secret', STRIPE_SECRET_KEY: 'sk_test' };

beforeEach(() => {
  vi.clearAllMocks();
  state.flagRows = [];
  state.db = {
    // Only the feature-flag read should ever answer while the gate is closed.
    select: vi.fn(async (table) => (table === 'feature_flags' ? state.flagRows : [])),
    rpc: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  };
});

const expectNoProviderCall = () => {
  expect(createPayment).not.toHaveBeenCalled();
  expect(createPurchase).not.toHaveBeenCalled();
  expect(createTransfer).not.toHaveBeenCalled();
  expect(getConnection).not.toHaveBeenCalled();
};

describe('Stripe webhook — signature is the front door', () => {
  it('rejects an invalid signature before every local operation', async () => {
    constructEvent.mockRejectedValue(new Error('Signature verification failed'));

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'stripe_webhook_invalid' });
    // Nothing at all — not even a client — before the signature is trusted.
    expect(supabase).not.toHaveBeenCalled();
    for (const method of Object.values(state.db)) expect(method).not.toHaveBeenCalled();
    expectNoProviderCall();
  });

  it('refuses when Stripe is not configured, before reading the body', async () => {
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(supabase).not.toHaveBeenCalled();
  });
});

describe('Stripe webhook — the durable projection gate', () => {
  it('returns the stable retryable refusal while the flag is absent', async () => {
    constructEvent.mockResolvedValue({ id: 'evt_1', type: 'payment_intent.succeeded' });
    state.flagRows = [];

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'stripe_projection_durable_boundary_required',
      reason: 'stripe_projection_durable_boundary_required',
    });
    expect(constructEvent).toHaveBeenCalledWith('{}', 'sig', 'secret');
    // The ONLY database access permitted before the gate passes is the flag read.
    expect(state.db.select).toHaveBeenCalledTimes(1);
    expect(state.db.select.mock.calls[0][0]).toBe('feature_flags');
    // Critically: the event is NOT claimed, so Stripe can redeliver it cleanly
    // once the feature is switched on.
    expect(state.db.rpc).not.toHaveBeenCalled();
    expect(state.db.insert).not.toHaveBeenCalled();
    expect(state.db.update).not.toHaveBeenCalled();
    expectNoProviderCall();
  });

  it('stays closed when the flag row says enabled=false', async () => {
    constructEvent.mockResolvedValue({ id: 'evt_2', type: 'payment_intent.succeeded' });
    state.flagRows = [{ key: 'feature:stripe_payment_command_v1', enabled: false, force_disabled: false }];

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(503);
    expect(state.db.rpc).not.toHaveBeenCalled();
    expectNoProviderCall();
  });

  it('stays closed when force_disabled overrides an enabled flag — the kill switch', async () => {
    constructEvent.mockResolvedValue({ id: 'evt_3', type: 'payment_intent.succeeded' });
    state.flagRows = [{ key: 'feature:stripe_payment_command_v1', enabled: true, force_disabled: true }];

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(503);
    expect(state.db.rpc).not.toHaveBeenCalled();
    expectNoProviderCall();
  });

  it('fails CLOSED when the flag lookup itself errors', async () => {
    // A projection that writes to UPR and QuickBooks must never open because a
    // lookup failed.
    constructEvent.mockResolvedValue({ id: 'evt_4', type: 'payment_intent.succeeded' });
    state.db.select = vi.fn(async () => { throw new Error('PostgREST unavailable'); });

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(503);
    expect(state.db.rpc).not.toHaveBeenCalled();
    expectNoProviderCall();
  });
});
