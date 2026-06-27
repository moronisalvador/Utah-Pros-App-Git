/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-drive-token.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Hands the browser a short-lived Google access token so the Google file
 *   picker can open. The token is minted on the server from the staff member's
 *   stored connection (and refreshed automatically if it's about to expire).
 *   The long-lived secret key never leaves the server.
 *
 * WHERE IT LIVES:
 *   Route: GET /api/google-drive-token  (authenticated — Supabase Bearer)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/cors.js, ../lib/google-drive.js, ../lib/supabase.js
 *   Data:      reads  → employees, user_google_accounts
 *              writes → user_google_accounts (only if a refresh occurs)
 *
 * NOTES / GOTCHAS:
 *   - Returns 409 when the employee hasn't connected Google Drive yet, so the
 *     button can prompt them to connect in Settings.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { getActorEmployee, getValidAccessToken } from '../lib/google-drive.js';
import { supabase } from '../lib/supabase.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  try {
    const { accessToken, expiresAt } = await getValidAccessToken(env, employee.id);
    return jsonResponse({ access_token: accessToken, expires_at: expiresAt }, 200, request, env);
  } catch (e) {
    return jsonResponse({ error: e.message || 'Google Drive not connected' }, 409, request, env);
  }
}
