/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/google-workspace.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the server act on behalf of any Utah Pros staff member's Google account
 *   without that person logging in. Using a single Google "service account" that
 *   the Workspace admin has authorized (domain-wide delegation), this mints a
 *   short-lived access token "as" a given employee's email, so the calendar sync
 *   can write events straight onto everyone's calendar — no per-person connect.
 *
 * WHERE IT LIVES:
 *   Worker library — imported by functions/lib/google-calendar.js. Not a route.
 *
 * DEPENDS ON:
 *   Packages:  none (Web Crypto for RS256 JWT signing, runs in CF isolates)
 *   Config:    env.GOOGLE_SA_CLIENT_EMAIL  — service account email
 *              env.GOOGLE_SA_PRIVATE_KEY   — service account private key (PEM)
 *   External:  oauth2.googleapis.com/token (JWT-bearer grant)
 *
 * NOTES / GOTCHAS:
 *   - Requires Workspace **domain-wide delegation**: the service account's client
 *     id must be authorized for the calendar.events scope in the Admin console.
 *   - The private key is a secret — store it as a Cloudflare encrypted env var.
 *     Newlines may arrive escaped ("\n"); we un-escape them before importing.
 *   - Tokens are cached per impersonated email (~1h) to avoid re-signing on every
 *     event write. The cache lives for the isolate's lifetime only.
 *   - `sub` MUST be the user's real Workspace email (their actual Google calendar
 *     owner). If an employee's UPR email differs from their Google login, the
 *     token mint fails for them — surfaced as a per-employee error upstream.
 * ════════════════════════════════════════════════
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE     = 'https://www.googleapis.com/auth/calendar.events';

const tokenCache = new Map(); // userEmail → { token, exp (epoch seconds) }

export function hasDelegation(env) {
  return Boolean(env.GOOGLE_SA_CLIENT_EMAIL && env.GOOGLE_SA_PRIVATE_KEY);
}

function b64urlFromString(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromBytes(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// Returns a calendar.events access token that acts AS `userEmail` (impersonation
// via domain-wide delegation). Cached until ~1 min before expiry.
export async function getDelegatedToken(env, userEmail) {
  if (!hasDelegation(env)) {
    throw new Error('Workspace delegation not configured (GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY)');
  }
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(userEmail);
  if (cached && cached.exp > now + 60) return cached.token;

  const header = b64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlFromString(JSON.stringify({
    iss:   env.GOOGLE_SA_CLIENT_EMAIL,
    sub:   userEmail,                 // impersonate this employee
    scope: SCOPE,
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const sigBuf = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlFromBytes(sigBuf)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Delegation token for ${userEmail} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  tokenCache.set(userEmail, { token: data.access_token, exp: now + (data.expires_in || 3600) });
  return data.access_token;
}
