// GET /api/meta-ads-callback
// Meta redirects the browser here after the user grants access. Exchanges the
// auth code for a short-lived token, immediately exchanges that for a
// long-lived (~60 day) token (see meta-ads.js NOTES — Meta has no classic
// refresh_token grant), stores the connection, then redirects back to
// /crm/integrations. Top-level navigation (not a fetch), so 302 redirects.

import { exchangeCodeForTokens, exchangeForLongLivedToken, saveTokens } from '../lib/meta-ads.js';
import { supabase } from '../lib/supabase.js';

function appBaseFrom(env) {
  if (env.APP_BASE_URL) return env.APP_BASE_URL;
  try { return new URL(env.META_REDIRECT_URI).origin; } catch { return 'https://dev.utahpros.app'; }
}

function redirect(env, status, msg) {
  const base = appBaseFrom(env);
  const qs = new URLSearchParams({ meta_ads: status });
  if (msg) qs.set('msg', msg.slice(0, 200));
  return new Response(null, { status: 302, headers: { Location: `${base}/crm/integrations?${qs.toString()}` } });
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
    const cfg = await db.select('integration_config', `key=eq.meta_ads_oauth_state&limit=1`);
    const expected = cfg?.[0]?.value;
    if (!expected || expected !== state) return redirect(env, 'badstate');

    const shortLived = await exchangeCodeForTokens(env, code);
    const longLived = await exchangeForLongLivedToken(env, shortLived.access_token);

    const empRows = await db.select('integration_config', `key=eq.meta_ads_oauth_employee&limit=1`);
    const connectedBy = empRows?.[0]?.value || null;

    await saveTokens(env, longLived, {
      connected_by: connectedBy,
      connected_at: new Date().toISOString(),
    });

    await db.delete('integration_config', `key=eq.meta_ads_oauth_state`);
    await db.delete('integration_config', `key=eq.meta_ads_oauth_employee`);

    return redirect(env, 'connected');
  } catch (e) {
    return redirect(env, 'error', e.message || 'connect failed');
  }
}
