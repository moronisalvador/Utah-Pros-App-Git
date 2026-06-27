/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/google-drive-callback.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Google sends the browser back here after the staff member approves access.
 *   It checks the one-time code matches, swaps the approval for long-lived keys,
 *   looks up the staff member's email, saves everything for that employee, and
 *   then bounces the browser back to Settings with a success flag.
 *
 * WHERE IT LIVES:
 *   Route: GET /api/google-drive-callback  (top-level browser redirect — no CORS)
 *
 * DEPENDS ON:
 *   Internal:  ../lib/google-drive.js, ../lib/supabase.js
 *   Data:      reads  → integration_config (state + connecting employee id)
 *              writes → user_google_accounts (tokens), integration_config (clears state)
 *
 * NOTES / GOTCHAS:
 *   - No onRequestOptions: this is a navigation, not a fetch, so it answers with
 *     302 redirects to /settings?gdrive=<status>.
 *   - gdrive_oauth_user holds the EMPLOYEE id (set by the connect worker), so no
 *     extra auth_user_id → employee lookup is needed here.
 * ════════════════════════════════════════════════
 */

import { exchangeCodeForTokens, fetchUserEmail, saveTokens } from '../lib/google-drive.js';
import { supabase } from '../lib/supabase.js';

function appBaseFrom(env) {
  if (env.APP_BASE_URL) return env.APP_BASE_URL;
  try { return new URL(env.GOOGLE_REDIRECT_URI).origin; } catch { return 'https://dev.utahpros.app'; }
}

function redirect(env, status, msg) {
  const base = appBaseFrom(env);
  const qs = new URLSearchParams({ gdrive: status });
  if (msg) qs.set('msg', msg.slice(0, 200));
  return new Response(null, { status: 302, headers: { Location: `${base}/settings?${qs.toString()}` } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const u = new URL(request.url);

  if (u.searchParams.get('error')) {
    return redirect(env, 'error', u.searchParams.get('error_description') || u.searchParams.get('error'));
  }

  const code  = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code) return redirect(env, 'error', 'Missing code');

  const db = supabase(env);
  try {
    // Verify state (CSRF).
    const cfg = await db.select('integration_config', `key=eq.gdrive_oauth_state&limit=1`);
    const expected = cfg?.[0]?.value;
    if (!expected || expected !== state) return redirect(env, 'badstate');

    // The connecting employee id was stashed by the connect worker.
    const userRows = await db.select('integration_config', `key=eq.gdrive_oauth_user&limit=1`);
    const employeeId = userRows?.[0]?.value;
    if (!employeeId) return redirect(env, 'error', 'No connecting user');

    const tokens = await exchangeCodeForTokens(env, code);
    const googleEmail = await fetchUserEmail(tokens.access_token);

    await saveTokens(env, employeeId, tokens, {
      google_email: googleEmail,
      connected_at: new Date().toISOString(),
    });

    // Clear transient state.
    await db.delete('integration_config', `key=eq.gdrive_oauth_state`);
    await db.delete('integration_config', `key=eq.gdrive_oauth_user`);

    return redirect(env, 'connected');
  } catch (e) {
    return redirect(env, 'error', e.message || 'connect failed');
  }
}
