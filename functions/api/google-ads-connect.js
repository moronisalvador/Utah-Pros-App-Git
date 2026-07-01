// GET /api/google-ads-connect
// Starts the Google Ads OAuth flow. Authenticated (Supabase Bearer).
// Returns { url } — the frontend redirects the browser there. A random `state`
// is stored so the callback can verify it (CSRF protection). Mirrors
// quickbooks-connect.js's shape, per docs/crm-roadmap.md Phase 2 — reuses
// getActorEmployee (google-drive.js) for the auth check, same as
// callrail-connect.js, rather than duplicating the Supabase Bearer lookup.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { buildAuthorizeUrl } from '../lib/google-ads.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_REDIRECT_URI) {
    return jsonResponse(
      { error: 'Google Ads not configured (missing GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_REDIRECT_URI env vars)' },
      500, request, env,
    );
  }

  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.upsert('integration_config', { key: 'google_ads_oauth_state', value: state, updated_at: now });
  await db.upsert('integration_config', { key: 'google_ads_oauth_employee', value: employee.id, updated_at: now });

  return jsonResponse({ url: buildAuthorizeUrl(env, state) }, 200, request, env);
}
