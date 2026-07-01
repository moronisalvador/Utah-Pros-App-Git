/**
 * ════════════════════════════════════════════════
 * FILE: callrail-connect.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Saves (or removes) the CallRail API key that lets our app pull call/form
 *   data. CallRail doesn't use the "sign in with CallRail" flow other
 *   integrations use — it's just a key you copy from CallRail's dashboard
 *   and paste into ours, so this is a simple save/delete endpoint instead of
 *   an OAuth callback. On first save it also generates the shared secret the
 *   CallRail webhook uses to prove requests are really from CallRail (see
 *   callrail-webhook.js NOTES) — that secret is never regenerated on
 *   reconnect, since it's already been pasted into CallRail's dashboard.
 *
 * ENDPOINT:
 *   GET    /api/callrail-connect     (authenticated — Supabase Bearer)
 *          returns { secret: string|null } — the webhook shared secret, so
 *          the Integrations page can show the webhook URL to paste into
 *          CallRail's dashboard. null before the first connect.
 *   POST   /api/callrail-connect     (authenticated — Supabase Bearer)
 *          body: { api_key: string } — returns { connected: true, secret }
 *   DELETE /api/callrail-connect     (authenticated — Supabase Bearer)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/cors.js, ../lib/supabase.js, ../lib/google-drive.js
 *              (reuses its generic getActorEmployee Bearer-token check —
 *              not Google-Drive-specific despite the file name)
 *   Data:      reads  → employees (auth lookup, via getActorEmployee),
 *                        integration_config
 *              writes → integration_credentials (provider='callrail'),
 *                        integration_config (webhook secret, first connect only)
 *
 * NOTES / GOTCHAS:
 *   - The API key is stored in integration_credentials.access_token —
 *     CallRail has no OAuth refresh flow, so refresh_token stays NULL.
 *     get_integration_status() was widened in the Phase 1 migration to
 *     recognize an access_token-only connection as "connected".
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';
import { resolveCallRailAccountId } from '../lib/callrail-api.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const [row] = await db.select('integration_config', `key=eq.callrail_webhook_secret&select=value`);
  return jsonResponse({ secret: row?.value || null }, 200, request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const body = await request.json().catch(() => ({}));
  const apiKey = (body.api_key || '').trim();
  if (!apiKey) return jsonResponse({ error: 'api_key is required' }, 400, request, env);

  await db.upsert('integration_credentials', {
    provider: 'callrail',
    access_token: apiKey,
    environment: 'production',
    connected_by: employee.id,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Generate the webhook shared secret once — never rotate it on reconnect,
  // since it's already pasted into CallRail's dashboard by then.
  let [secretRow] = await db.select('integration_config', `key=eq.callrail_webhook_secret&select=value`);
  if (!secretRow) {
    [secretRow] = await db.insert('integration_config', {
      key: 'callrail_webhook_secret',
      value: crypto.randomUUID(),
    });
  }

  // Resolve + store the account id the backfill needs (also validates the key
  // against CallRail). Best-effort — a failure here doesn't block connecting.
  await resolveCallRailAccountId(db, apiKey, env).catch(() => {});

  return jsonResponse({ connected: true, secret: secretRow.value }, 200, request, env);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  await db.delete('integration_credentials', `provider=eq.callrail`);
  return jsonResponse({ disconnected: true }, 200, request, env);
}
