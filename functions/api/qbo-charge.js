/**
 * ════════════════════════════════════════════════
 * FILE: qbo-charge.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Refuses the older keyed-card charge flow after checking the employee and the
 *   basic request shape. It never captures a card, creates a local payment, or
 *   writes a QuickBooks payment.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, auth, http, supabase
 *   Data:      reads  → employee authorization through the shared auth helper
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The stable 503 is unconditional because the former card-capture and accounting
 *     mirror did not share one durable recovery record. No flag can restore it.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

const BILLING_ROLES = ['admin', 'manager'];
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const QBO_CHARGE_DURABLE_BOUNDARY_REQUIRED = 'qbo_charge_durable_boundary_required';

export function chargeAmountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 1e-8) return null;
  return cents;
}

function disabledResponse(request, env) {
  return jsonResponse({
    error: 'Keyed card charging is temporarily unavailable while its durable reconciliation boundary is completed.',
    code: QBO_CHARGE_DURABLE_BOUNDARY_REQUIRED,
    reason: QBO_CHARGE_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await requireRole(request, env, db, BILLING_ROLES, fetchWithTimeout);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  if (auth.employee.is_external) return jsonResponse({ error: 'Insufficient role' }, 403, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const amountCents = chargeAmountCents(body.amount);
  const idempotencyKey = request.headers.get('Idempotency-Key') || '';
  if (!body.invoice_id) return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);
  if (!body.token) return jsonResponse({ error: 'Provide a card token' }, 400, request, env);
  if (amountCents == null) return jsonResponse({ error: 'Provide a positive amount in whole cents' }, 400, request, env);
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return jsonResponse({ error: 'Provide a stable Idempotency-Key (16–64 letters, numbers, _ or -)' }, 400, request, env);
  }

  return disabledResponse(request, env);
}
