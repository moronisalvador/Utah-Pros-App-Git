/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This legacy route accepts an authenticated estimate action only long enough
 *   to validate its basic shape, then refuses it. QuickBooks estimate writes
 *   stay disabled until the durable command boundary is deployed.
 *
 * WHERE IT LIVES:
 *   Route: POST /api/qbo-estimate
 *
 * DEPENDS ON:
 *   Internal: cors, qbo-auth, supabase
 *   Data: reads → authentication and employee authorization only
 *
 * NOTES / GOTCHAS:
 *   - Do not add a provider, configuration, connection, or business-record
 *     read ahead of this refusal.
 *   - Local estimate editing remains available through its normal database path.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboRequest } from '../lib/qbo-auth.js';
import { supabase } from '../lib/supabase.js';

export const QBO_ESTIMATE_DURABLE_BOUNDARY_REQUIRED = 'qbo_estimate_durable_boundary_required';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await authorizeQboRequest(request, env, db);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* validation below owns malformed bodies */ }
  if (!body?.estimate_id) return jsonResponse({ error: 'Provide estimate_id' }, 400, request, env);
  if (body.action != null && !['send', 'delete'].includes(body.action)) {
    return jsonResponse({ error: 'action must be "send" or "delete" when provided' }, 400, request, env);
  }

  return jsonResponse({
    error: 'QuickBooks estimate actions are temporarily unavailable while the durable command boundary is deployed.',
    code: QBO_ESTIMATE_DURABLE_BOUNDARY_REQUIRED,
    reason: QBO_ESTIMATE_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}
