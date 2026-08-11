/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook-maintenance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: proves a Stripe delivery is signature-checked, then remains
 * retryable and entirely outside UPR's local money ledger until a durable
 * projection boundary is separately enabled.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null }));
vi.mock('../lib/cors.js', () => ({ jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }) }));
vi.mock('../lib/stripe.js', () => ({
  stripeConfigured: () => true,
  constructEvent: vi.fn(),
}));
vi.mock('../lib/supabase.js', () => ({ supabase: vi.fn(() => state.db) }));

import { constructEvent } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { onRequestPost } from './stripe-webhook.js';

const request = () => new Request('https://app.test/api/stripe-webhook', {
  method: 'POST', body: '{}', headers: { 'stripe-signature': 'sig' },
});
const env = { STRIPE_WEBHOOK_SECRET: 'secret', STRIPE_SECRET_KEY: 'sk_test' };

beforeEach(() => {
  vi.clearAllMocks();
  state.db = { rpc: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn() };
});

describe('Stripe durable projection boundary', () => {
  it('returns a retryable stable refusal after a valid signature with zero local or provider work', async () => {
    constructEvent.mockResolvedValue({ id: 'evt_1', type: 'payment_intent.succeeded' });

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'stripe_projection_durable_boundary_required',
      reason: 'stripe_projection_durable_boundary_required',
    });
    expect(constructEvent).toHaveBeenCalledWith('{}', 'sig', 'secret');
    expect(supabase).not.toHaveBeenCalled();
    for (const method of Object.values(state.db)) expect(method).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature before every local operation', async () => {
    constructEvent.mockRejectedValue(new Error('Signature verification failed'));

    const res = await onRequestPost({ request: request(), env });

    expect(res.status).toBe(400);
    expect(supabase).not.toHaveBeenCalled();
    for (const method of Object.values(state.db)) expect(method).not.toHaveBeenCalled();
  });
});
