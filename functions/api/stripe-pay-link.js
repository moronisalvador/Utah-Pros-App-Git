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

// The billing-edit list, mirroring src/lib/claimUtils.js BILLING_EDIT_ROLES and
// functions/lib/qbo-auth.js QBO_BROWSER_ROLES. It read ['admin', 'manager'] until
// 2026-08-19: 'manager' is not an employee_role, so the gate was admin-only by
// accident while office and project_manager could already do every other part of
// invoicing. Dormant today (the durable-boundary 503 below refuses every caller
// regardless), so this fixes the trap rather than opening anything.
const BILLING_ROLES = ['admin', 'office', 'project_manager'];
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
