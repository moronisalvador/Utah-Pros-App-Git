/**
 * ════════════════════════════════════════════════
 * FILE: analyze-xactimate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Accepts an authorized Xactimate-import request only long enough to validate its basic shape,
 *   then refuses it. The import stays unavailable until one durable operation owns AI spending,
 *   document egress, invoice-line insertion, and retry recovery together.
 *
 * DEPENDS ON:
 *   Packages:  n/a
 *   Internal:  cors, bounded HTTP, QBO browser authorization, Supabase worker client
 *   Data:      reads  → authentication and employee authorization only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Do not add a document, Storage, Anthropic, QuickBooks, invoice, or line-item read/write ahead
 *     of this refusal. A source-only UI gate is not a substitute for this server boundary.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { authorizeQboBrowserRequest } from '../lib/qbo-auth.js';
import { supabase } from '../lib/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED = 'xactimate_import_durable_boundary_required';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboBrowserRequest(request, env, db);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* validation below owns malformed bodies */ }
  if (!UUID_RE.test(String(body.invoice_id || ''))) {
    return jsonResponse({ error: 'invoice_id must be a UUID' }, 400, request, env);
  }
  if (!body.file_path || typeof body.file_path !== 'string') {
    return jsonResponse({ error: 'Provide file_path' }, 400, request, env);
  }

  return jsonResponse({
    error: 'Xactimate import is temporarily unavailable while its durable operation boundary is deployed.',
    code: XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED,
    reason: XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED,
  }, 503, request, env);
}
