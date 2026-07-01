// GET /api/meta-ads-connect
// Starts the Meta (Facebook) OAuth flow. Authenticated (Supabase Bearer).
// Returns { url } — the frontend redirects the browser there. A random `state`
// is stored so the callback can verify it (CSRF protection). Mirrors
// google-ads-connect.js / quickbooks-connect.js, per docs/crm-roadmap.md Phase 2.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { buildAuthorizeUrl } from '../lib/meta-ads.js';
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

  if (!env.META_APP_ID || !env.META_REDIRECT_URI) {
    return jsonResponse(
      { error: 'Meta Ads not configured (missing META_APP_ID / META_REDIRECT_URI env vars)' },
      500, request, env,
    );
  }

  const state = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.upsert('integration_config', { key: 'meta_ads_oauth_state', value: state, updated_at: now });
  await db.upsert('integration_config', { key: 'meta_ads_oauth_employee', value: employee.id, updated_at: now });

  return jsonResponse({ url: buildAuthorizeUrl(env, state) }, 200, request, env);
}
