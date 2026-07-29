/**
 * ════════════════════════════════════════════════
 * FILE: send-push.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the company owner send one fixed notification to their own registered
 *   iPhone while checking setup. It cannot choose another employee, change the
 *   message, or open an arbitrary screen.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/send-push
 *   Rendered by:  n/a
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/auth.js, ../lib/cors.js,
 *              ../lib/apns.js
 *   Data:      reads  → employees (authentication), device_tokens
 *              writes → device_tokens (permanent-token cleanup only)
 *
 * NOTES / GOTCHAS:
 *   - This is an owner-only diagnostic seam, not a general notification API.
 *     Normal notification delivery goes through notify.js so audience and
 *     employee preferences remain authoritative.
 *   - request_id is client-created and stable across retries; it becomes the
 *     durable delivery claim and APNs collapse identity for this diagnostic.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { requireOwner } from '../lib/auth.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { sendNativePushToEmployee } from '../lib/apns.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await requireOwner(request, env, db);
  if (auth.error) {
    return jsonResponse({ error: auth.error }, auth.status, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }
  if (
    !payload
    || Object.keys(payload).some((key) => key !== 'request_id')
    || !UUID_RE.test(payload.request_id || '')
  ) {
    return jsonResponse(
      { error: 'request_id must be a UUID and is the only accepted field' },
      400,
      request,
      env,
    );
  }

  const result = await sendNativePushToEmployee({
    db,
    env,
    employeeId: auth.employee.id,
    title: 'UPR notifications are ready',
    body: 'This iPhone can receive UPR alerts.',
    data: { url: '/tech/settings' },
    eventKey: `owner-native-push-test:${payload.request_id}`,
  });

  const status = result.skipped && result.reason === 'apns_not_configured'
    ? 503
    : 200;
  return jsonResponse(result, status, request, env);
}
