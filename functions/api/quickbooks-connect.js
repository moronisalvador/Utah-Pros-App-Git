// GET /api/quickbooks-connect
// Starts the QuickBooks Online OAuth flow. Authenticated as an active internal
// admin via Supabase Bearer; server secrets are intentionally not accepted.
// Returns { url } — the frontend redirects the browser there. A random `state`
// is stored so the callback can verify it (CSRF protection).

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboBrowserRequest, QBO_ADMIN_ROLES } from '../lib/qbo-auth.js';
import { buildAuthorizeUrl } from '../lib/quickbooks.js';
import { supabase } from '../lib/supabase.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-document-command-gate.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const auth = await authorizeQboBrowserRequest(request, env, db, undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }

  if (!env.QBO_CLIENT_ID || !env.QBO_REDIRECT_URI) {
    return jsonResponse(
      { error: 'QuickBooks not configured (missing QBO_CLIENT_ID / QBO_REDIRECT_URI env vars)' },
      500, request, env,
    );
  }

  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  // Stash transient OAuth state + the connecting auth user for the callback.
  await db.upsert('integration_config', { key: 'qbo_oauth_state', value: state, updated_at: now });
  await db.upsert('integration_config', { key: 'qbo_oauth_user',  value: auth.user.id || '', updated_at: now });

  return jsonResponse({ url: buildAuthorizeUrl(env, state) }, 200, request, env);
}
