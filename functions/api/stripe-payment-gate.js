/**
 * ════════════════════════════════════════════════
 * FILE: stripe-payment-gate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks whether the Stripe payment projection is allowed to run, and gives
 *   the Stripe workers one consistent "not available yet" answer when it is not.
 *   The switch is off unless the saved setting says on.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/cors.js
 *   Data:      reads  → feature_flags
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Fails CLOSED. Any error reading the flag — missing row, network blip,
 *     PostgREST refusal — is treated as "off". A projection that writes to UPR
 *     and QuickBooks must never open because a lookup failed.
 *   - Deliberately ignores dev-preview settings: only the exact enabled boolean,
 *     without force_disabled, opens the projection. Same posture as
 *     qbo-document-command-gate.js.
 *   - The refusal code is unchanged from the 2026-08-11 containment, so Stripe's
 *     retry behaviour and any existing monitoring keep working while the flag
 *     is off.
 * ════════════════════════════════════════════════
 */

import { jsonResponse } from '../lib/cors.js';

export const STRIPE_PAYMENT_COMMAND_V1_FLAG = 'feature:stripe_payment_command_v1';

/**
 * The containment code, preserved verbatim from the 2026-08-11 stubs. Stripe
 * treats the 503 as retryable, which is what we want: an event refused while the
 * flag is off is redelivered later rather than lost.
 */
export const STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED = 'stripe_projection_durable_boundary_required';

export function stripeProjectionUnavailableResponse(request, env, message) {
  return jsonResponse({
    error: message || 'Stripe payment projection is unavailable until its durable boundary is enabled',
    code: STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
    reason: STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}

export function isStripePaymentCommandV1Enabled(row) {
  return row?.enabled === true && row?.force_disabled !== true;
}

export async function requireStripePaymentCommandV1(db) {
  let rows;
  try {
    rows = await db.select(
      'feature_flags',
      `key=eq.${encodeURIComponent(STRIPE_PAYMENT_COMMAND_V1_FLAG)}&select=key,enabled,force_disabled&limit=1`,
    );
  } catch {
    return false;
  }
  return Array.isArray(rows) && rows.length === 1 && isStripePaymentCommandV1Enabled(rows[0]);
}
