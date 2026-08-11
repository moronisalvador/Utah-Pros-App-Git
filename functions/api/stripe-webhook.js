/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Verifies that an inbound Stripe delivery is authentic, then refuses payment
 *   projection with a retryable response. It does not claim the event, record a
 *   payment, notify staff, or call Stripe or QuickBooks after verification.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, stripe
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Invalid signatures stay 400. Valid deliveries receive the unconditional 503
 *     before Supabase access so Stripe may retry without colliding with a local claim.
 * ════════════════════════════════════════════════
 */

import { jsonResponse } from '../lib/cors.js';
import { stripeConfigured, constructEvent } from '../lib/stripe.js';

export const STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED = 'stripe_projection_durable_boundary_required';

function durableBoundaryResponse(request, env) {
  return jsonResponse({
    error: 'Stripe payment projection is unavailable until its durable boundary is enabled',
    code: STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
    reason: STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!stripeConfigured(env) || !env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Stripe not configured' }, 503, request, env);
  }

  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature');
  try {
    await constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return jsonResponse({ error: `Webhook signature: ${error.message}` }, 400, request, env);
  }

  return durableBoundaryResponse(request, env);
}
