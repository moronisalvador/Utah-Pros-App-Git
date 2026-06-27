/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-drive-disconnect.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Disconnects the signed-in staff member's Google Drive. It tells Google to
 *   revoke the app's access and deletes their stored keys, so the app can no
 *   longer reach their Drive until they connect again.
 *
 * WHERE IT LIVES:
 *   Route: POST /api/google-drive-disconnect  (authenticated — Supabase Bearer)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/cors.js, ../lib/google-drive.js, ../lib/supabase.js
 *   Data:      reads  → employees, user_google_accounts
 *              writes → user_google_accounts (deletes the caller's row)
 *
 * NOTES / GOTCHAS:
 *   - Revoke at Google is best-effort; the row is deleted regardless so the app
 *     state is always consistent.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { getActorEmployee, getConnection } from '../lib/google-drive.js';
import { supabase } from '../lib/supabase.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  // Best-effort revoke at Google (don't block disconnect on it).
  try {
    const conn = await getConnection(env, employee.id);
    const token = conn?.refresh_token || conn?.access_token;
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    }
  } catch { /* ignore — proceed to delete the row */ }

  await db.delete('user_google_accounts', `employee_id=eq.${employee.id}`);
  return jsonResponse({ disconnected: true }, 200, request, env);
}
