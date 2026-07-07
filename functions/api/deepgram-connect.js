/**
 * ════════════════════════════════════════════════
 * FILE: deepgram-connect.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Saves (or removes) the Deepgram API key that lets our app turn call
 *   recordings into readable, speaker-labeled transcripts. Deepgram doesn't use
 *   a "sign in with Deepgram" flow — it's just a key you copy from Deepgram's
 *   console and paste into our Connections page, so this is a simple
 *   save/status/delete endpoint (no OAuth redirect). The key is stored
 *   server-side and never sent back to the browser.
 *
 * ENDPOINT:
 *   GET    /api/deepgram-connect   (admin only — Supabase Bearer)
 *          → { connected: boolean, connected_at: string|null }
 *   POST   /api/deepgram-connect   (admin only — Supabase Bearer)
 *          body: { api_key: string }
 *          → { connected: true }
 *   DELETE /api/deepgram-connect   (admin only — Supabase Bearer)
 *          → { disconnected: true }
 *
 * DEPENDS ON:
 *   Packages:  none (platform fetch)
 *   Internal:  ../lib/cors.js, ../lib/supabase.js, ../lib/google-drive.js
 *              (reuses its generic getActorEmployee Bearer-token check)
 *   External:  Deepgram REST API (only to validate the pasted key via /v1/projects)
 *   Data:      reads  → employees (auth), integration_credentials
 *              writes → integration_credentials (provider='deepgram')
 *
 * NOTES / GOTCHAS:
 *   - The key lands in integration_credentials.access_token (RLS-locked to the
 *     service role — never exposed to PostgREST or the browser). The transcribe
 *     workers read it from there (transcribe-call.js / callrail-webhook.js),
 *     the same way GitHub and CallRail keys work. Deepgram has no OAuth refresh
 *     flow, so refresh_token stays NULL — get_integration_status() already
 *     recognizes an access_token-only connection as "connected".
 *   - POST validates the key against Deepgram's /v1/projects endpoint: a 401 is
 *     rejected with a clear message; a transient/non-401 failure is tolerated
 *     (best-effort, like callrail-connect's account resolve) so a Deepgram blip
 *     can't block a good key.
 *   - All methods require the caller's employees.role = 'admin' (requireAdmin),
 *     enforced here — not only on the admin-only UI route — since a direct API
 *     call would bypass the route guard, and this key bills our Deepgram account.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';

// Resolve the caller and require the 'admin' role. This endpoint manages a
// billable API key, so the gate is enforced HERE — not only on the admin-only
// UI route, which a direct API call would bypass. Returns either { employee }
// or { response } (a ready 401/403 to return).
async function requireAdmin(request, env, db) {
  const employee = await getActorEmployee(request, env, db);
  if (!employee) return { response: jsonResponse({ error: 'Unauthorized' }, 401, request, env) };
  const [row] = await db.select('employees', `id=eq.${employee.id}&select=role`);
  if (row?.role !== 'admin') return { response: jsonResponse({ error: 'Forbidden — admin only' }, 403, request, env) };
  return { employee };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const { response } = await requireAdmin(request, env, db);
  if (response) return response;

  const [cred] = await db.select('integration_credentials', `provider=eq.deepgram&select=access_token,connected_at`);
  return jsonResponse({ connected: !!cred?.access_token, connected_at: cred?.connected_at || null }, 200, request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const { employee, response } = await requireAdmin(request, env, db);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const apiKey = (body.api_key || '').trim();
  if (!apiKey) return jsonResponse({ error: 'api_key is required' }, 400, request, env);

  // Validate the pasted key against Deepgram. A 401 is a hard reject; other
  // failures are tolerated so a transient Deepgram error can't block a good key.
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (res.status === 401) return jsonResponse({ error: 'Deepgram rejected that key (401). Check the key and its permissions.' }, 400, request, env);
  } catch { /* network blip — save anyway (best-effort) */ }

  const [existing] = await db.select('integration_credentials', `provider=eq.deepgram&select=connected_at`);
  await db.upsert('integration_credentials', {
    provider: 'deepgram',
    access_token: apiKey,
    environment: 'production',
    connected_by: employee.id,
    // Preserve the original connect date when replacing an existing key.
    connected_at: existing?.connected_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return jsonResponse({ connected: true }, 200, request, env);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = supabase(env);

  const { response } = await requireAdmin(request, env, db);
  if (response) return response;

  await db.delete('integration_credentials', `provider=eq.deepgram`);
  return jsonResponse({ disconnected: true }, 200, request, env);
}
