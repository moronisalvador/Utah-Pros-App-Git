/**
 * ════════════════════════════════════════════════
 * FILE: environment.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one question for the server-side code: "am I running on a
 *   developer's laptop, or on the real Cloudflare servers?" From that it decides,
 *   for each outside company we talk to, whether we may use the real live
 *   account, a practice account, or a pretend one. On a laptop it never allows
 *   the real account. On Cloudflare nothing changes at all.
 *
 * DEPENDS ON:
 *   Packages:  none (runs in V8 isolates)
 *   Internal:  none — this module is deliberately dependency-free so anything
 *              may import it without creating a cycle
 *   Data:      reads  → the Worker `env` object only
 *              writes → none
 *
 * EXPORTS:
 *   uprTier(env)               → 'local' | 'cloud'
 *   isLocal(env)               → boolean
 *   providerMode(env, name)    → 'live' | 'sandbox' | 'mock'
 *   assertNotLiveCredential(name, value, env) → throws on a live key locally
 *
 * NOTES / GOTCHAS:
 *   - **CLOUD BEHAVIOUR IS UNCHANGED, BY CONSTRUCTION.** The only signal for
 *     "local" is `UPR_ENV=local`, which lives in `.dev.vars` — a file that ONLY
 *     `wrangler pages dev` reads. Cloudflare Pages never sets it, in either the
 *     Production or Preview variable set. So on a deployed Worker every function
 *     here returns exactly what the old code did.
 *   - This is deliberately NOT "flip the default from production to sandbox".
 *     `functions/lib/quickbooks.js` reads `env.QBO_ENVIRONMENT || 'production'`,
 *     and UPR-Web-Context.md claims Cloudflare Production sets QBO_ENVIRONMENT
 *     explicitly — but AGENTS.md warns that a repository declaration is not proof
 *     a provider console is configured. If that variable were ever missing in
 *     Cloudflare, flipping the fallback would silently point live QuickBooks at
 *     sandbox. Gating on the local marker instead cannot do that.
 *   - `mock` is not a lesser `sandbox`. CallRail, Encircle, PropertyMeld, Webflow
 *     and (verified 2026-08-15 on this account) Twilio sell NO test environment,
 *     so locally there is nothing real to point at and a fake is the only option.
 *   - Nothing here loosens an authorization check. It narrows what a laptop can
 *     reach; it never widens what a deployed Worker can.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Tier ──────────────

/**
 * 'local'  — a developer laptop running `wrangler pages dev` with .dev.vars
 * 'cloud'  — a deployed Cloudflare Pages Function (Production OR Preview)
 */
export function uprTier(env) {
  return env?.UPR_ENV === 'local' ? 'local' : 'cloud';
}

export function isLocal(env) {
  return uprTier(env) === 'local';
}

// ─── SECTION: Provider capability map ──────────────

// What each provider can be pointed at FROM A LAPTOP.
//   'sandbox' — the vendor runs a real, separate test environment
//   'mock'    — the vendor sells no test environment; only a fake is possible
//
// Anything absent from this map is treated as 'mock' locally: deny by default,
// so a newly-integrated provider cannot reach a live account from a laptop just
// because nobody remembered to classify it.
const LOCAL_CAPABILITY = Object.freeze({
  quickbooks: 'sandbox',   // Intuit Development keys + a sandbox company
  stripe: 'sandbox',       // test mode on the same account (sk_test_…)
  apns: 'sandbox',         // Apple's sandbox push gateway
  google: 'sandbox',       // a separate OAuth client with a localhost redirect
  meta: 'sandbox',         // sandbox ad account
  resend: 'sandbox',       // test API key; Mailpit also serves locally

  twilio: 'mock',          // VERIFIED: no Test credentials section on this account
  callrail: 'mock',        // vendor sells no sandbox
  encircle: 'mock',        // vendor sells no sandbox
  propertymeld: 'mock',    // vendor sells no sandbox
  webflow: 'mock',         // inbound webhook only
});

/**
 * What mode a given provider runs in, right now.
 *
 * On cloud this is ALWAYS 'live' — deployed Workers keep talking to the real
 * providers exactly as before. The whole map above applies only to a laptop.
 */
export function providerMode(env, provider) {
  if (!isLocal(env)) return 'live';
  const key = String(provider || '').toLowerCase();
  return LOCAL_CAPABILITY[key] || 'mock';
}

// ─── SECTION: Live-credential refusal ──────────────

// Shapes that unambiguously identify a production credential.
const LIVE_SHAPES = [
  /^sk_live_/,      // Stripe secret
  /^rk_live_/,      // Stripe restricted
  /^pk_live_/,      // Stripe publishable
];

/**
 * Refuse a live credential on a laptop, loudly, before it is ever used.
 *
 * This exists because the Stripe CLI stores a LIVE restricted key for the real
 * business account next to the test one, and the dashboard shows them a click
 * apart. A wrong paste should fail immediately and obviously, not quietly move
 * real money.
 *
 * No-op on cloud, where live credentials are the correct thing to hold.
 */
export function assertNotLiveCredential(provider, value, env) {
  if (!isLocal(env) || !value) return value;
  if (LIVE_SHAPES.some((re) => re.test(String(value)))) {
    throw new Error(
      `UPR_ENV=local refuses a live ${provider} credential. ` +
      'Local development must use test/sandbox credentials — see npm run dev:credentials.',
    );
  }
  return value;
}

// ─── SECTION: Outbound call guard ──────────────

/**
 * Refuse an outbound call to a provider that has no test environment, when
 * running on a laptop. Call this immediately before the provider fetch.
 *
 * This FAILS CLOSED and is the whole point: for Twilio, CallRail, Encircle,
 * PropertyMeld and Webflow there is no sandbox to fall back to, so the only
 * credentials that exist are live ones. Without this guard, running a worker
 * locally with a populated .dev.vars would send a real SMS, or write to the real
 * CallRail account, from a developer's laptop.
 *
 * Twilio is the sharpest case: AGENTS.md §14 notes TCPA penalties are per
 * message, and the worker is the sole writer of provider message rows. A local
 * test run must not be able to text a customer.
 *
 * No-op on cloud, where these calls are exactly what the Worker is for.
 *
 * @throws {Error} when local and the provider is mock-only
 */
export function assertProviderCallAllowed(env, provider) {
  const mode = providerMode(env, provider);
  if (mode !== 'mock') return mode;

  // Narrow, owner-directed exception for SMS. See localSmsAllowlist below.
  if (String(provider).toLowerCase() === 'twilio' && localSmsAllowlist(env).length) {
    return 'live-allowlisted';
  }

  throw new Error(
    `UPR_ENV=local blocked an outbound ${provider} call. ` +
    `${provider} has no sandbox, so a local call would hit the real account. ` +
    'Use a fixture in the test, or verify this path on dev.utahpros.app.',
  );
}

// ─── SECTION: local SMS allowlist ──────────────

/**
 * Phone numbers a LOCAL run is permitted to text, from
 * `UPR_LOCAL_SMS_ALLOWLIST` in .dev.vars (comma-separated).
 *
 * WHY THIS EXISTS (owner-directed): Twilio has no test credentials on this
 * account, so blocking it outright left the messaging path as the one thing that
 * could not be iterated on locally — the exact cost the local tier exists to
 * remove. And `dev.utahpros.app` already sends through live Twilio, so testing
 * against the real provider is the existing status quo, not a new risk.
 *
 * WHAT IT ACTUALLY GUARDS: not the owner deliberately texting themselves — that
 * is the point of it. It guards the LOOP. A local run reads the local database;
 * the moment anyone seeds that with real contacts, one bad iteration in an
 * automation or bulk path becomes hundreds of real texts from a laptop, with no
 * deploy in front of it. The allowlist makes that failure stop at the owner's
 * own handset.
 *
 * Modelled on the money-path precedent in AGENTS.md §15, which permits real
 * QuickBooks invoice and payment flows ONLY against allowlisted test customers,
 * ONLY under $10, ONLY with cleanup. Same shape: narrow, deliberate, bounded.
 *
 * Empty (the default) means Twilio stays fully blocked locally.
 */
export function localSmsAllowlist(env) {
  if (!isLocal(env)) return [];
  return String(env?.UPR_LOCAL_SMS_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toE164)
    .filter(Boolean);
}

// Local copy of the normalization in functions/lib/phone.js, which is frozen for
// the CRM wave. Importing it here would couple this dependency-free module to it;
// the comparison only needs digits-to-E.164, and a mismatch fails CLOSED.
function toE164(raw) {
  let phone = String(raw || '').replace(/\D/g, '');
  if (phone.length === 10) phone = `1${phone}`;
  if (phone.length < 10) return null;
  return `+${phone}`;
}

/**
 * Refuse a local SMS to any destination outside the allowlist.
 *
 * No-op on cloud. On local with an empty allowlist the caller never reaches here,
 * because assertProviderCallAllowed() has already refused the provider outright.
 *
 * @throws {Error} when local and `to` is not allowlisted
 */
export function assertLocalSmsDestinationAllowed(env, to) {
  if (!isLocal(env)) return to;

  const allowed = localSmsAllowlist(env);
  if (!allowed.length) {
    throw new Error(
      'UPR_ENV=local blocked an SMS: no UPR_LOCAL_SMS_ALLOWLIST is set. ' +
      'Add your own number to .dev.vars to send real local test texts.',
    );
  }

  const dest = toE164(to);
  if (!dest || !allowed.includes(dest)) {
    throw new Error(
      `UPR_ENV=local refused an SMS to ${to || '(no destination)'} — not in UPR_LOCAL_SMS_ALLOWLIST. ` +
      'A local run may only text allowlisted numbers, so a loop cannot reach a customer.',
    );
  }
  return to;
}
