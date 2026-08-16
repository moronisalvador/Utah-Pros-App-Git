/**
 * ════════════════════════════════════════════════
 * FILE: dev-credentials-set.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Asks you for each outside-service key one at a time and saves it in the
 *   right place, so you never have to hand-edit the secrets file. It checks the
 *   shape of what you paste and refuses anything that looks like a LIVE
 *   production key, because this file is for local development only. Nothing is
 *   printed back to the screen and nothing leaves this machine.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run dev:credentials:set [provider]`
 *                  e.g. `npm run dev:credentials:set stripe`
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:readline, node:url
 *   Internal:  .dev.vars (gitignored)
 *   Data:      reads  → .dev.vars
 *              writes → .dev.vars
 *
 * NOTES / GOTCHAS:
 *   - REFUSES live-mode credentials by pattern (sk_live_, rk_live_, pk_live_).
 *     The Stripe CLI stores a live restricted key for this business account, so
 *     pasting the wrong one is a genuinely easy mistake with real consequences.
 *   - Press Enter to skip any field; existing values are left untouched.
 *   - Values are never echoed and never logged.
 * ════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS = path.join(ROOT, '.dev.vars');

// Any of these in a pasted value means production credentials. Hard refusal.
const LIVE_PATTERNS = [/sk_live_/, /rk_live_/, /pk_live_/, /^AC[0-9a-f]{32}$/i];

const GROUPS = {
  quickbooks: {
    title: 'QuickBooks — Intuit SANDBOX app',
    where: 'https://developer.intuit.com/app/developer/dashboard → your app → Keys & OAuth → Development',
    fields: [
      ['QBO_CLIENT_ID', 'Client ID (Development tab)'],
      ['QBO_CLIENT_SECRET', 'Client Secret (Development tab)'],
      ['QBO_REDIRECT_URI', 'Redirect URI', 'http://localhost:8788/api/quickbooks-callback'],
      ['QBO_WEBHOOK_VERIFIER_TOKEN', 'Webhook verifier token (optional)'],
    ],
  },
  stripe: {
    title: 'Stripe — TEST mode only',
    where: 'https://dashboard.stripe.com/test/apikeys  (toggle must read "Test mode")',
    fields: [
      ['STRIPE_SECRET_KEY', 'Secret key — must start sk_test_'],
      ['STRIPE_WEBHOOK_SECRET', 'Webhook secret from `stripe listen` — starts whsec_'],
    ],
  },
  twilio: {
    title: 'Twilio — TEST credentials',
    where: 'https://console.twilio.com → Account → API keys & tokens → Test credentials',
    fields: [
      ['TWILIO_ACCOUNT_SID', 'TEST Account SID (starts AC…, from the Test section)'],
      ['TWILIO_AUTH_TOKEN', 'TEST Auth Token'],
      ['TWILIO_PHONE_NUMBER', 'Magic test number', '+15005550006'],
    ],
  },
  apns: {
    title: 'Apple Push (APNs) — for real-device push',
    where: 'https://developer.apple.com/account/resources/authkeys/list → + → Apple Push Notifications service',
    fields: [
      ['APNS_KEY_ID', 'Key ID (10 chars, shown once)'],
      ['APNS_TEAM_ID', 'Team ID (Membership page)'],
      ['APNS_TOPIC', 'Bundle id', 'com.utahprosrestoration.upr.dev'],
      ['APNS_P8_KEY', 'Contents of the .p8 file (paste as one line, \\n for newlines)'],
    ],
  },
  resend: {
    title: 'Resend — transactional email',
    where: 'https://resend.com/api-keys',
    fields: [['RESEND_API_KEY', 'API key — starts re_']],
  },
  anthropic: {
    title: 'Anthropic — AI features',
    where: 'https://console.anthropic.com/settings/keys',
    fields: [['ANTHROPIC_API_KEY', 'API key — starts sk-ant-']],
  },
};

const arg = (process.argv[2] || '').toLowerCase();
const chosen = arg && GROUPS[arg] ? { [arg]: GROUPS[arg] } : GROUPS;

if (arg && !GROUPS[arg]) {
  console.error(`Unknown provider "${arg}". Options: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(1);
}

if (!existsSync(DEV_VARS)) {
  console.error('.dev.vars not found — copy .dev.vars.example to .dev.vars first.');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

function setVar(contents, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(contents) ? contents.replace(re, `${key}=${value}`) : `${contents.replace(/\n*$/, '\n')}${key}=${value}\n`;
}

let contents = readFileSync(DEV_VARS, 'utf8');
let written = 0;
let refused = 0;

console.log('\nPaste each value, or press Enter to skip. Nothing is echoed back.\n');

for (const [, group] of Object.entries(chosen)) {
  console.log(`\n── ${group.title}`);
  console.log(`   ${group.where}\n`);

  for (const [key, label, fallback] of group.fields) {
    const suffix = fallback ? ` [Enter = ${fallback}]` : ' [Enter = skip]';
    const value = (await ask(`   ${label}${suffix}\n   ${key}= `)) || fallback || '';
    if (!value) continue;

    if (LIVE_PATTERNS.some((re) => re.test(value))) {
      console.log('   ✗ REFUSED: that looks like a LIVE production credential. .dev.vars is local-only.\n');
      refused++;
      continue;
    }
    if (key === 'STRIPE_SECRET_KEY' && !value.startsWith('sk_test_')) {
      console.log('   ✗ REFUSED: Stripe secret key must start with sk_test_.\n');
      refused++;
      continue;
    }
    contents = setVar(contents, key, value);
    written++;
    console.log('   ✓ saved\n');
  }
}

rl.close();

if (written) {
  writeFileSync(DEV_VARS, contents, 'utf8');
  console.log(`\nWrote ${written} value(s) to .dev.vars.`);
}
if (refused) console.log(`Refused ${refused} value(s) that looked like production credentials.`);
console.log('Check the result with:  npm run dev:credentials\n');
