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
  { name: 'Twilio',        tier: 'test',    vars: ['TWILIO_AUTH_TOKEN', 'TWILIO_ADVANCED_OPT_OUT'],
    how: 'console.twilio.com → Test Credentials + magic numbers (+15005550006)' },
  { name: 'CallRail',      tier: 'mock',    vars: ['CALLRAIL_ACCOUNT_ID', 'CALLRAIL_COMPANY_ID', 'CALLRAIL_SIGNING_KEY', 'CALLRAIL_TRACKING_NUMBER'],
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
    const placeholder = !val || /^(your-|xxx|changeme|todo|<)/i.test(val) || val.endsWith('-here');
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
