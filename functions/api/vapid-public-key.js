/**
 * ════════════════════════════════════════════════
 * FILE: vapid-public-key.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Hands the browser the PUBLIC half of our Web Push signing key so it can
 *   subscribe a device to push. The public key is not a secret (it only lets a
 *   device verify pushes come from us), so this is an open GET. It reads the key
 *   from Cloudflare env if set, otherwise from Supabase — so the owner can store
 *   everything in the database and never touch Cloudflare. If no key is
 *   configured yet, it says so with { configured:false } (never an error), and
 *   the "Enable push" button stays disabled.
 *
 * WHERE IT LIVES:
 *   Route:        GET /api/vapid-public-key  (Cloudflare Pages Function)
 *   Rendered by:  n/a (worker) — called by src/lib/webPushClient.js
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/webPush.js (loadVapidConfig), ../lib/supabase.js, ../lib/cors.js
 *   Data:      reads → integration_credentials (provider=web_push),
 *                       integration_config (vapid_public_key / vapid_subject)
 *
 * NOTES / GOTCHAS:
 *   - Returns ONLY the public key — never the private key or subject.
 *   - Always 200 with a `configured` flag; the client treats "no key" as
 *     "push not available yet", not an error.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { loadVapidConfig } from '../lib/webPush.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const cfg = await loadVapidConfig(env, supabase(env));
    if (!cfg.ok) return jsonResponse({ configured: false }, 200, request, env);
    // Public key only — the private key never leaves the server.
    return jsonResponse({ configured: true, publicKey: cfg.publicKey }, 200, request, env);
  } catch {
    return jsonResponse({ configured: false }, 200, request, env);
  }
}
