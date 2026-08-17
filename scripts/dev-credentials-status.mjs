/**
 * ════════════════════════════════════════════════
 * FILE: dev-credentials-status.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lists every outside service the app talks to, and tells you which ones your
 *   laptop is set up for and which are still missing. It also says, for each
 *   one, whether that company offers a safe practice mode ("sandbox") or whether
 *   we have to fake it locally. It only reads files on this machine and never
 *   prints a secret value.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run dev:credentials`
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url
 *   Internal:  .dev.vars (worker secrets, gitignored), .env.local (frontend)
 *   Data:      reads  → those two files, if present
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Prints only whether a value is PRESENT, never the value. Safe to paste.
 *   - The var list is maintained here, not derived, so a newly-referenced var
 *     will not appear until it is added. Re-derive the truth with:
 *       grep -rhoE 'env\.[A-Z][A-Z0-9_]+' functions/ | sed 's/env\.//' | sort -u
 *   - "sandbox: none" is a statement about the vendor, not about our setup.
 *     CallRail, Encircle and PropertyMeld genuinely do not sell a test
 *     environment; those are mock-only locally.
 * ════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// tier: what a LOCAL developer should use.
//   sandbox — the vendor offers a real test environment; use it
//   test    — the vendor offers test-mode keys on the same account
//   mock    — no vendor test environment exists; fake it locally
//   local   — satisfied by the local stack, no vendor involved
const PROVIDERS = [
  { name: 'Supabase',      tier: 'local',   vars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'],
    how: 'local stack — `npm run db:local` prints the keys' },
  { name: 'QuickBooks',    tier: 'sandbox', vars: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_ENVIRONMENT', 'QBO_REDIRECT_URI', 'QBO_WEBHOOK_SECRET', 'QBO_WEBHOOK_VERIFIER_TOKEN'],
    how: 'developer.intuit.com → create app → Sandbox company. Set QBO_ENVIRONMENT=sandbox' },
  { name: 'Stripe',        tier: 'test',    vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    how: 'dashboard.stripe.com test mode → sk_test_… ; webhook secret from `stripe listen`' },
  // VERIFIED 2026-08-15 in the live console: the Utah Pros Restoration account's
  // "API keys & tokens" page renders a Live credentials card and nothing else —
  // no Test credentials section, and zero API keys or credentials. Twilio's own
  // docs (twilio.com/docs/iam/test-credentials) say to scroll down to a Test
  // credentials section on exactly that page, so this is an account-level
  // absence rather than a navigation mistake. Mock locally; the magic numbers
  // (+15005550006 etc.) only work WITH test credentials, so they don't help here.
  { name: 'Twilio',        tier: 'mock',    vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_PHONE_NUMBER'],
    how: 'NO Test credentials section on this account — mock locally. Never use the live token.' },
  // CALLRAIL_API_KEY is not read from env by any worker (the key lives in
  // integration_credentials), but .dev.vars.example still ships it — so it can be
  // sitting in a real .dev.vars. Listed here deliberately: this report's job is to
  // notice a live credential on the laptop, not only one the code currently reads.
  { name: 'CallRail',      tier: 'mock',    vars: ['CALLRAIL_API_KEY', 'CALLRAIL_ACCOUNT_ID', 'CALLRAIL_COMPANY_ID', 'CALLRAIL_SIGNING_KEY', 'CALLRAIL_TRACKING_NUMBER'],
    how: 'NO vendor sandbox exists — mock locally, verify on dev.utahpros.app' },
  { name: 'Encircle',      tier: 'mock',    vars: ['ENCIRCLE_API_KEY', 'ENCIRCLE_ORGANIZATION_ID', 'ENCIRCLE_BRAND_ID'],
    how: 'NO vendor sandbox — mock locally' },
  { name: 'PropertyMeld',  tier: 'mock',    vars: ['INBOUND_MELD_SECRET'],
    how: 'NO vendor sandbox — mock locally' },
  { name: 'Resend (email)',tier: 'test',    vars: ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'EMAIL_FROM', 'EMAIL_REPLY_TO'],
    how: 'resend.com → test API key. Local stack also has Mailpit on :54324' },
  { name: 'Anthropic',     tier: 'test',    vars: ['ANTHROPIC_API_KEY'],
    how: 'console.anthropic.com → API key (billed per use; no free sandbox)' },
  { name: 'Google OAuth',  tier: 'sandbox', vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
    how: 'console.cloud.google.com → separate OAuth client with localhost redirect' },
  { name: 'Google Ads',    tier: 'sandbox', vars: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'GOOGLE_ADS_REDIRECT_URI'],
    how: 'Google Ads API test account (developer token starts in test access)' },
  { name: 'Meta Ads',      tier: 'sandbox', vars: ['META_APP_ID', 'META_APP_SECRET', 'META_AD_ACCOUNT_ID', 'META_REDIRECT_URI'],
    how: 'developers.facebook.com → App → Sandbox ad account' },
  { name: 'Web Push',      tier: 'local',   vars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    how: 'generate your own throwaway pair: npx web-push generate-vapid-keys' },
  { name: 'Apple Push',    tier: 'sandbox', vars: ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_P8_KEY', 'APNS_TOPIC', 'APNS_ENV'],
    how: 'Apple Developer → Keys → APNs .p8. APNS_ENV=sandbox for dev builds' },
  { name: 'Turnstile',     tier: 'test',    vars: ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
    how: 'Cloudflare provides always-pass test keys in their docs' },
  { name: 'Webflow',       tier: 'mock',    vars: ['WEBFLOW_WEBHOOK_SECRET'],
    how: 'inbound webhook only — mock by posting a signed body locally' },
];

function parseEnvFile(file) {
  if (!existsSync(file)) return null;
  const out = new Map();
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    // A placeholder counts as absent — that is the whole point of this report.
    //
    // The `xxxx` test matters more than it looks: .dev.vars.example ships
    // TWILIO_ACCOUNT_SID=ACxxxx… and TWILIO_MESSAGING_SERVICE_SID=MGxxxx…, which
    // are shaped exactly like real credentials but are obviously fake in the
    // middle rather than at the start. Without this, copying the example file
    // makes the no-sandbox alarm below fire on nothing — and an alarm that cries
    // wolf on a fresh checkout is one people learn to ignore, which costs more
    // than having no alarm at all.
    const placeholder = !val
      || /^(your-|xxx|changeme|todo|example|<)/i.test(val)
      || /x{4,}/i.test(val)
      || /^\+1555|^\+1800555/.test(val)
      || val.endsWith('-here');
    out.set(key, !placeholder);
  }
  return out;
}

const devVars = parseEnvFile(path.join(ROOT, '.dev.vars'));
const envLocal = parseEnvFile(path.join(ROOT, '.env.local'));

const has = (k) => (devVars?.get(k) ?? false) || (envLocal?.get(k) ?? false);

const TIER_LABEL = {
  local: 'local stack',
  sandbox: 'vendor sandbox',
  test: 'vendor test mode',
  mock: 'MOCK ONLY (no vendor sandbox)',
};

console.log('\nUPR local credential status — values are never printed, only presence.\n');
if (!devVars) console.log('  ! .dev.vars not found — copy .dev.vars.example to .dev.vars first.\n');

const ready = [];
const partial = [];
const missing = [];

for (const p of PROVIDERS) {
  const present = p.vars.filter(has);
  const bucket = present.length === p.vars.length ? ready : present.length ? partial : missing;
  bucket.push({ ...p, present: present.length, total: p.vars.length });
}

const render = (list, heading) => {
  if (!list.length) return;
  console.log(`${heading}`);
  for (const p of list) {
    console.log(`  ${p.name.padEnd(16)} ${String(p.present).padStart(2)}/${p.total}  ${TIER_LABEL[p.tier]}`);
    if (p.present !== p.total) console.log(`  ${''.padEnd(16)}       ↳ ${p.how}`);
  }
  console.log('');
};

render(ready, 'READY');
render(partial, 'PARTIAL');
render(missing, 'NOT CONFIGURED');

const mockOnly = PROVIDERS.filter((p) => p.tier === 'mock').map((p) => p.name);
console.log(`No vendor sandbox exists for: ${mockOnly.join(', ')}.`);
console.log('Those can only be mocked locally or verified on dev.utahpros.app.\n');

// ─── SECTION: the dangerous case ──────────────
// A mock-only provider with credentials present locally is the one genuinely
// unsafe state this report can detect. There is no test account for these, so
// any value that works is a LIVE one — and a local run would then reach the real
// CallRail account, or text a real customer through the real Twilio account.
// Flag it loudly; this is the threat the local tier exists to prevent.
// Only AUTHENTICATING values count. An account SID, a company id, a tracking
// number or a phone number is an identifier, not a secret: holding one grants
// nothing, and .dev.vars.example legitimately ships real ones. Alarming on those
// makes the warning fire on a clean checkout, and a warning that fires when
// nothing is wrong is one people stop reading.
const SECRET_VARS = /(_API_KEY|_AUTH_TOKEN|_SECRET|_SIGNING_KEY|_PRIVATE_KEY|_P8_KEY|_TOKEN)$/;

const populatedMockProviders = PROVIDERS
  .filter((p) => p.tier === 'mock')
  .map((p) => ({ name: p.name, hits: p.vars.filter((v) => SECRET_VARS.test(v) && has(v)) }))
  .filter((p) => p.hits.length);

if (populatedMockProviders.length) {
  console.log('⚠️  LIVE CREDENTIALS FOR A NO-SANDBOX PROVIDER ARE PRESENT LOCALLY\n');
  for (const p of populatedMockProviders) {
    console.log(`    ${p.name}: ${p.hits.join(', ')}`);
  }
  console.log('\n    These vendors sell no test environment, so a working value is a live one.');
  console.log('    Remove them from .dev.vars unless you intend local runs to hit the real');
  console.log('    account. Sending as the company is priced per message (AGENTS.md §14).\n');
  process.exitCode = 1;
}
