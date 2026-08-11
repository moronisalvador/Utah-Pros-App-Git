/**
 * ════════════════════════════════════════════════
 * FILE: qbo-attach.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Refuses legacy QuickBooks attachment upload and delete requests after checking
 *   the employee and request shape. Existing attachment metadata stays readable
 *   elsewhere, but this file cannot change QuickBooks or UPR attachment records.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, auth, http, supabase
 *   Data:      reads  → employee authorization through the shared auth helper
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The stable 503 is unconditional. No feature flag or maintenance setting can
 *     restore mutation; that requires a separately reviewed durable command design.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

const BILLING_ROLES = ['admin', 'manager'];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_B64_LEN = Math.ceil(MAX_BYTES / 3) * 4 + 256;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const QBO_ATTACHMENT_DURABLE_BOUNDARY_REQUIRED = 'qbo_attachment_durable_boundary_required';

function disabledResponse(request, env) {
  return jsonResponse({
    error: 'QuickBooks attachment changes are temporarily unavailable while their durable reconciliation boundary is completed.',
    code: QBO_ATTACHMENT_DURABLE_BOUNDARY_REQUIRED,
    reason: QBO_ATTACHMENT_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await requireRole(request, env, db, BILLING_ROLES);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);
  if (auth.employee.is_external) return jsonResponse({ error: 'Insufficient role' }, 403, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  if (body.action === 'delete') {
    if (!UUID_RE.test(String(body.attachment_id || ''))) {
      return jsonResponse({ error: 'Provide a valid attachment_id' }, 400, request, env);
    }
    return disabledResponse(request, env);
  }

  const entityType = body.entity_type;
  const uprId = body.id;
  const fileName = (body.file_name || '').trim();
  const idempotencyKey = request.headers.get('Idempotency-Key') || '';
  if (!['invoice', 'estimate'].includes(entityType)) return jsonResponse({ error: 'entity_type must be "invoice" or "estimate"' }, 400, request, env);
  if (!UUID_RE.test(String(uprId || ''))) return jsonResponse({ error: 'Provide a valid id' }, 400, request, env);
  if (!fileName) return jsonResponse({ error: 'Provide file_name' }, 400, request, env);
  if (!body.file_base64) return jsonResponse({ error: 'Provide file_base64' }, 400, request, env);
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return jsonResponse({ error: 'Provide a stable Idempotency-Key (16–64 letters, numbers, _ or -)' }, 400, request, env);
  }
  if (String(body.file_base64).length > MAX_B64_LEN) {
    return jsonResponse({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` }, 413, request, env);
  }
  return disabledResponse(request, env);
}
