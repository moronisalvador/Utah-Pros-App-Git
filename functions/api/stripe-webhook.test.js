/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: source-level regression checks for the dormant Stripe webhook.
 * A valid delivery must be signature verified and refused before it can claim an
 * event, project a payment, call another provider, or write worker telemetry.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('./stripe-webhook.js', import.meta.url)), 'utf8');

describe('stripe-webhook durable-boundary source contract', () => {
  it('verifies a configured Stripe signature and returns the stable retryable refusal', () => {
    expect(src).toMatch(/constructEvent\(rawBody, sig, env\.STRIPE_WEBHOOK_SECRET\)/);
    expect(src).toMatch(/stripe_projection_durable_boundary_required/);
    expect(src).toMatch(/}, 503, request, env\)/);
    expect(src).toMatch(/Webhook signature/);
  });

  it('contains no local money, event-claim, notification, telemetry, or provider path', () => {
    for (const forbidden of [
      'claim_stripe_event', 'stripe_events', 'payments', 'retrieveCharge',
      'notifyPaymentReceived', 'recordWorkerRun', 'quickbooks', 'supabase',
    ]) {
      expect(src, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
