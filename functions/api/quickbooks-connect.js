// GET /api/quickbooks-connect
// Starts the QuickBooks Online OAuth flow. Authenticated (Supabase Bearer).
// Returns { url } — the frontend redirects the browser there. A random `state`
// is stored so the callback can verify it (CSRF protection).

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { buildAuthorizeUrl } from '../lib/quickbooks.js';
import { supabase } from '../lib/supabase.js';

async function getAuthUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok ? res.json() : null;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const user = await getAuthUser(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  if (!env.QBO_CLIENT_ID || !env.QBO_REDIRECT_URI) {
    return jsonResponse(
      { error: 'QuickBooks not configured (missing QBO_CLIENT_ID / QBO_REDIRECT_URI env vars)' },
      500, request, env,
    );
  }

  const state = crypto.randomUUID();
  const db = supabase(env);
  const now = new Date().toISOString();
  // Stash transient OAuth state + the connecting auth user for the callback.
  await db.upsert('integration_config', { key: 'qbo_oauth_state', value: state, updated_at: now });
  await db.upsert('integration_config', { key: 'qbo_oauth_user',  value: user.id || '', updated_at: now });

  return jsonResponse({ url: buildAuthorizeUrl(env, state) }, 200, request, env);
}
