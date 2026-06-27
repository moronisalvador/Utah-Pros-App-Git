/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-calendar-resync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A "sync my calendar now" button for the signed-in staff member. It finds the
 *   upcoming appointments they're assigned to and pushes each one to Google
 *   Calendar, so existing appointments show up immediately without waiting for
 *   the next time someone edits them.
 *
 * WHERE IT LIVES:
 *   Route: POST /api/google-calendar-resync  (authenticated — Supabase Bearer)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/cors.js, ../lib/google-drive.js (getActorEmployee),
 *              ../lib/google-calendar.js, ../lib/supabase.js
 *   Data:      reads  → employees, appointment_crew, appointments, jobs,
 *                       user_google_accounts
 *              writes → google_calendar_links
 *
 * NOTES / GOTCHAS:
 *   - Syncs the FULL appointment (every connected crew member on it), not just the
 *     caller — syncAppointment is idempotent, so this is safe and keeps everyone's
 *     copy current. The window is today → +60 days to avoid backfilling history.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { getActorEmployee } from '../lib/google-drive.js';
import { supabase } from '../lib/supabase.js';
import { syncAppointment } from '../lib/google-calendar.js';

const HORIZON_DAYS = 60;

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const today = new Date().toISOString().slice(0, 10);
  const until = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + HORIZON_DAYS); return d.toISOString().slice(0, 10); })();

  // Appointments this employee is on, in the upcoming window, not cancelled.
  const rows = await db.select(
    'appointment_crew',
    `employee_id=eq.${employee.id}&select=appointment_id,appointments!inner(id,date,status)` +
    `&appointments.date=gte.${today}&appointments.date=lte.${until}&appointments.status=neq.cancelled`,
  );

  const apptIds = [...new Set((rows || []).map((r) => r.appointment_id))];

  let synced = 0, failed = 0;
  for (const id of apptIds) {
    try { await syncAppointment(env, db, id); synced++; }
    catch { failed++; }
  }

  return jsonResponse({ ok: true, appointments: apptIds.length, synced, failed }, 200, request, env);
}
