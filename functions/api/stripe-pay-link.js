/**
 * ════════════════════════════════════════════════
 * FILE: stripe-pay-link.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Refuses Stripe payment-link creation after checking the employee and invoice
 *   identifier. It never reads the invoice, creates a Stripe Checkout session, or
 *   changes any local payment record.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, auth, http, supabase
 *   Data:      reads  → employee authorization through the shared auth helper
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The stable 503 is unconditional until Stripe ingestion and accounting share
 *     a separately reviewed durable command/recovery boundary.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

const BILLING_ROLES = ['admin', 'manager'];
export const STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED = 'stripe_projection_durable_boundary_required';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

function durableBoundaryResponse(request, env) {
  return jsonResponse({
    error: 'Stripe payment links are unavailable until their durable projection boundary is enabled',
    code: STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
    reason: STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await requireRole(request, env, db, BILLING_ROLES, fetchWithTimeout);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env); }
  if (!body || typeof body.invoice_id !== 'string' || !body.invoice_id.trim()) {
    return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);
  }

  return durableBoundaryResponse(request, env);
}
