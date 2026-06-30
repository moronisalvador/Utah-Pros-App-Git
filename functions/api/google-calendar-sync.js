/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-calendar-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The database calls this whenever an appointment (or its crew list) is
 *   created, changed, or deleted. It then pushes that change to the Google
 *   Calendars of the assigned crew — creating, updating, or removing the event.
 *
 * WHERE IT LIVES:
 *   Route: POST /api/google-calendar-sync  (called server-to-server by the
 *   Postgres trigger via pg_net — NOT from the browser)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/cors.js, ../lib/google-calendar.js, ../lib/supabase.js
 *   Data:      reads  → appointments, appointment_crew, jobs, user_google_accounts,
 *                       integration_config (webhook secret)
 *              writes → google_calendar_links
 *
 * NOTES / GOTCHAS:
 *   - Authenticated by a shared secret header (x-webhook-secret) that matches
 *     integration_config.gcal_webhook_secret — same pattern as qbo-sync-customer.
 *   - source_type is currently always 'appointment'; the body shape already
 *     carries it so the job_schedule refactor can reuse this endpoint unchanged.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { syncAppointment, removeSourceEvents, sendClientCancellation } from '../lib/google-calendar.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  // Verify the shared secret set by the DB trigger.
  const provided = request.headers.get('x-webhook-secret') || '';
  const cfg = await db.select('integration_config', `key=eq.gcal_webhook_secret&limit=1`);
  const expected = cfg?.[0]?.value || '';
  if (!expected || provided !== expected) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  }

  let payload;
  try { payload = await request.json(); }
  catch { return jsonResponse({ error: 'Bad JSON' }, 400, request, env); }

  const sourceId = payload?.source_id;
  const op = payload?.op || 'upsert';
  if (!sourceId) return jsonResponse({ error: 'Missing source_id' }, 400, request, env);

  try {
    let result;
    if (op === 'delete') {
      result = await removeSourceEvents(env, db, sourceId);
      // The trigger rides the client's cancellation details along on delete
      // (the appointment row is already gone, so we can't look them up here).
      if (payload.cancel_client) {
        await sendClientCancellation(env, payload.cancel_client, env.APP_BASE_URL || 'https://utahpros.app');
      }
    } else {
      result = await syncAppointment(env, db, sourceId, { notify: payload.notify !== false });
    }
    return jsonResponse({ ok: true, ...result }, 200, request, env);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e.message || e) }, 500, request, env);
  }
}
