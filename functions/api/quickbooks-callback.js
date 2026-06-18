// GET /api/quickbooks-callback
// Intuit redirects the browser here after the user authorizes. Exchanges the
// auth code for tokens, stores the connection, then redirects back to /dev-tools.
// This is a top-level navigation (not a fetch), so it responds with 302 redirects.

import {
  exchangeCodeForTokens,
  saveTokens,
  fetchCompanyName,
  qboEnvironment,
} from '../lib/quickbooks.js';
import { supabase } from '../lib/supabase.js';

function appBaseFrom(env) {
  if (env.APP_BASE_URL) return env.APP_BASE_URL;
  try { return new URL(env.QBO_REDIRECT_URI).origin; } catch { return 'https://dev.utahpros.app'; }
}

function redirect(env, status, msg) {
  const base = appBaseFrom(env);
  const qs = new URLSearchParams({ qbo: status });
  if (msg) qs.set('msg', msg.slice(0, 200));
  return new Response(null, { status: 302, headers: { Location: `${base}/dev-tools?${qs.toString()}` } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const u = new URL(request.url);

  if (u.searchParams.get('error')) {
    return redirect(env, 'error', u.searchParams.get('error_description') || u.searchParams.get('error'));
  }

  const code    = u.searchParams.get('code');
  const state   = u.searchParams.get('state');
  const realmId = u.searchParams.get('realmId');
  if (!code || !realmId) return redirect(env, 'error', 'Missing code or realmId');

  const db = supabase(env);
  try {
    // Verify state (CSRF).
    const cfg = await db.select('integration_config', `key=eq.qbo_oauth_state&limit=1`);
    const expected = cfg?.[0]?.value;
    if (!expected || expected !== state) return redirect(env, 'badstate');

    const tokens = await exchangeCodeForTokens(env, code);
    const environment = qboEnvironment(env);

    // Resolve the connecting employee (best-effort) from the stashed auth user id.
    let connectedBy = null;
    const userRows = await db.select('integration_config', `key=eq.qbo_oauth_user&limit=1`);
    const authUid = userRows?.[0]?.value;
    if (authUid) {
      const emp = await db.select('employees', `auth_user_id=eq.${authUid}&select=id&limit=1`);
      connectedBy = emp?.[0]?.id || null;
    }

    await saveTokens(env, tokens, {
      realm_id:     realmId,
      environment,
      connected_at: new Date().toISOString(),
      connected_by: connectedBy,
    });

    const companyName = await fetchCompanyName(env);
    if (companyName) {
      await db.update('integration_credentials', `provider=eq.quickbooks`, { company_name: companyName });
    }

    // Clear transient state.
    await db.delete('integration_config', `key=eq.qbo_oauth_state`);
    await db.delete('integration_config', `key=eq.qbo_oauth_user`);

    return redirect(env, 'connected');
  } catch (e) {
    return redirect(env, 'error', e.message || 'connect failed');
  }
}
