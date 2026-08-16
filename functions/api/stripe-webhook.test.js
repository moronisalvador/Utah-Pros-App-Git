/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the dormant Stripe webhook verifies a delivery and then refuses
 *   it before it can record an event, change a payment, or call another provider.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  stripe-webhook.js (read as source)
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source contract; it does not send a webhook or contact Stripe.
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
    expect(src).toMatch(/Stripe webhook signature or payload is invalid/);
    expect(src).toMatch(/stripe_webhook_invalid/);
    expect(src).not.toMatch(/error\.message/);
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
