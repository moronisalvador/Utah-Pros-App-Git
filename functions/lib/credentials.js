/**
 * ════════════════════════════════════════════════
 * FILE: credentials.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One place the server-side workers ask "what is the key for Stripe / Twilio /
 *   Resend?" and get an answer. It looks in the app database FIRST (where an admin
 *   can paste and rotate keys from the Connections page) and falls back to the old
 *   Cloudflare environment variables if the database has nothing yet. That means
 *   the platform keeps working the whole way through the cutover — the env vars
 *   stay as a backup until the owner removes them. Answers are cached for a minute
 *   so a burst of sends doesn't hit the database once per message.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper for Cloudflare Workers)
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch via ./supabase.js — runs in V8 isolates)
 *   Internal:  ./supabase.js (service-role REST client, used to read the
 *              RLS-locked integration_credentials + integration_config tables)
 *   Data:      reads  → integration_credentials (access_token per provider),
 *                        integration_config (twilio_* non-secret bits)
 *              writes → none (writes happen via the admin-gated SECURITY DEFINER
 *                        RPCs in 20260707_p9_credential_management.sql)
 *
 * EXPORTS:
 *   resolveCredential(env, db, provider) → Promise<object>
 *     provider 'stripe' → { secretKey }
 *     provider 'resend' → { apiKey }
 *     provider 'twilio' → { accountSid, authToken, messagingServiceSid, phoneNumber }
 *   clearCredentialCache()  — drops the in-memory cache (tests / after a rotation)
 *
 * NOTES / GOTCHAS:
 *   - DB-FIRST, env-FALLBACK, per field. A field only falls back to env when the
 *     DB value is null/empty, so a partially-migrated provider still works.
 *   - If the worker env has no SUPABASE_URL (e.g. unit tests) the DB read is
 *     skipped entirely and the result is env-only — this is also why the existing
 *     sendEmail/sendMessage unit tests keep passing unchanged.
 *   - A DB read failure is swallowed (never throws) and falls back to env: a
 *     transient database blip must NOT block a payment, text, or email.
 *   - The secret is READ here for the worker's own outbound call only; it is never
 *     returned to the browser. The browser sees booleans via
 *     get_managed_credentials_status().
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

// ─── SECTION: Config ──────────────
const CACHE_TTL_MS = 60_000; // 1 minute — avoids a DB read per send during a burst

const PROVIDERS = ['stripe', 'twilio', 'resend'];

// provider → { value, expires } resolved object.
const cache = new Map();

// ─── SECTION: Helpers ──────────────
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
// DB value first, then env — per field, so a partial migration still resolves.
const pick = (dbVal, envVal) => clean(dbVal) ?? clean(envVal) ?? undefined;

// Read the provider's row + (for twilio) config bits from the RLS-locked tables.
// Returns { accessToken, config } or null when the DB is unreachable/unconfigured.
// NEVER throws — a DB blip must not block an outbound send.
async function readFromDb(env, db, provider) {
  // No SUPABASE_URL → can't reach the DB (e.g. unit tests): env-only. When a URL
  // is present the service client is built from env; a missing/blank service key
  // just makes the read fail below and fall through to the env fallback.
  if (!db && !env?.SUPABASE_URL) return null;
  try {
    const client = db || supabase(env);
    const [creds, cfgRows] = await Promise.all([
      client.select('integration_credentials', `provider=eq.${provider}&select=access_token`),
      provider === 'twilio'
        ? client.select('integration_config', `key=in.(twilio_account_sid,twilio_messaging_service_sid,twilio_phone_number)&select=key,value`)
        : Promise.resolve([]),
    ]);
    const config = {};
    for (const r of (cfgRows || [])) config[r.key] = r.value;
    return { accessToken: creds?.[0]?.access_token ?? null, config };
  } catch {
    return null; // fall back to env
  }
}

// Shape the DB + env values into the per-provider object the caller expects.
function shape(provider, dbRow, env) {
  const cfg = dbRow?.config || {};
  const token = dbRow?.accessToken;
  if (provider === 'stripe') {
    return { secretKey: pick(token, env?.STRIPE_SECRET_KEY) };
  }
  if (provider === 'resend') {
    return { apiKey: pick(token, env?.RESEND_API_KEY) };
  }
  // twilio: the auth token is the only secret; the rest are non-secret identifiers.
  return {
    accountSid:          pick(cfg.twilio_account_sid,            env?.TWILIO_ACCOUNT_SID),
    authToken:           pick(token,                             env?.TWILIO_AUTH_TOKEN),
    messagingServiceSid: pick(cfg.twilio_messaging_service_sid,  env?.TWILIO_MESSAGING_SERVICE_SID),
    phoneNumber:         pick(cfg.twilio_phone_number,           env?.TWILIO_PHONE_NUMBER),
  };
}

// ─── SECTION: Public API ──────────────
/**
 * Resolve a provider's credential(s), DB-first with an env fallback, cached ~60s.
 * @param {object} env      Cloudflare env (SUPABASE_URL for the DB read; the *_KEY vars for fallback)
 * @param {object|null} db  optional service-role client to reuse; when null one is built from env
 * @param {string} provider 'stripe' | 'twilio' | 'resend'
 * @returns {Promise<object>} provider-shaped credential object (see file header)
 */
export async function resolveCredential(env, db, provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`resolveCredential: unknown provider "${provider}"`);
  }

  const hit = cache.get(provider);
  if (hit && hit.expires > Date.now()) return hit.value;

  const dbRow = await readFromDb(env, db, provider);
  const value = shape(provider, dbRow, env);

  cache.set(provider, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Drop the in-memory cache — call after a key rotation, or between tests. */
export function clearCredentialCache() {
  cache.clear();
}
