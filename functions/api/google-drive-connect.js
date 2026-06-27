/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-drive-connect.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Starts the "Connect your Google Drive" flow for the signed-in staff member.
 *   It remembers who is connecting (and a random one-time code to prevent
 *   tampering), then hands back the Google sign-in URL for the browser to open.
 *
 * WHERE IT LIVES:
 *   Route: GET /api/google-drive-connect  (authenticated — Supabase Bearer)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/cors.js, ../lib/google-drive.js, ../lib/supabase.js
 *   Data:      reads  → employees (via getActorEmployee)
 *              writes → integration_config (transient OAuth state + user id)
 *
 * NOTES / GOTCHAS:
 *   - State + connecting employee id are stashed in integration_config under
 *     gdrive_oauth_state / gdrive_oauth_user for the callback to verify/resolve.
 *   - Returns { url }; the frontend does window.location.href = url.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { buildAuthorizeUrl, getActorEmployee } from '../lib/google-drive.js';
import { supabase } from '../lib/supabase.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
    return jsonResponse(
      { error: 'Google Drive not configured (missing GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI env vars)' },
      500, request, env,
    );
  }

  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  // Stash transient OAuth state + the connecting employee for the callback.
  await db.upsert('integration_config', { key: 'gdrive_oauth_state', value: state, updated_at: now });
  await db.upsert('integration_config', { key: 'gdrive_oauth_user',  value: employee.id, updated_at: now });

  return jsonResponse({ url: buildAuthorizeUrl(env, state) }, 200, request, env);
}
