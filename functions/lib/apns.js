/**
 * ════════════════════════════════════════════════
 * FILE: apns.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Delivers an employee notification to the iPhones registered for the exact
 *   Apple environment being used. It refuses incomplete configuration, limits
 *   simultaneous Apple calls, and removes only permanently invalid registrations.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./http.js
 *   Data:      reads  → device_tokens
 *              writes → device_tokens (permanent-token cleanup only)
 *
 * NOTES / GOTCHAS:
 *   - APNS_ENV is mandatory and must be sandbox or production. There is no
 *     default because a wrong guess makes one environment delete another's token.
 *   - Results never include raw APNs tokens.
 *   - A stable content-derived apns-id makes retrying an uncertain delivery
 *     reuse Apple's idempotency identity instead of creating a second alert.
 * ════════════════════════════════════════════════
 */
import { fetchWithTimeout } from './http.js';

const APNS_TIMEOUT_MS = 15_000;
const APNS_CONCURRENCY = 5;
const jwtCache = new Map();

export function readApnsConfig(env = {}) {
  const missing = [];
  if (!env.APNS_P8_KEY) missing.push('APNS_P8_KEY');
  if (!env.APNS_KEY_ID) missing.push('APNS_KEY_ID');
  if (!env.APNS_TEAM_ID) missing.push('APNS_TEAM_ID');
  if (!env.APNS_TOPIC) missing.push('APNS_TOPIC');
  if (env.APNS_ENV !== 'sandbox' && env.APNS_ENV !== 'production') {
    missing.push('APNS_ENV');
  }
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    p8: env.APNS_P8_KEY,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    topic: env.APNS_TOPIC,
    environment: env.APNS_ENV,
  };
}

function b64url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlJson(value) {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function importP8Key(pem) {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function signApnsJwt(config, nowSeconds = Math.floor(Date.now() / 1000)) {
  const cacheKey = `${config.teamId}:${config.keyId}`;
  const cached = jwtCache.get(cacheKey);
  if (cached?.expiresAt > nowSeconds + 60) return cached.jwt;

  const key = await importP8Key(config.p8);
  const header = b64urlJson({ alg: 'ES256', kid: config.keyId });
  const claims = b64urlJson({ iss: config.teamId, iat: nowSeconds });
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  jwtCache.set(cacheKey, { jwt, expiresAt: nowSeconds + 50 * 60 });
  return jwt;
}

export async function stableApnsId(value) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

async function responseReason(response) {
  try {
    const parsed = JSON.parse(await response.text());
    return typeof parsed?.reason === 'string'
      ? parsed.reason.slice(0, 120)
      : 'APNs rejected notification';
  } catch {
    return 'APNs rejected notification';
  }
}

async function mapBounded(items, limit, fn) {
  const results = [];
  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

export async function sendNativePushToEmployee({
  db,
  env,
  employeeId,
  title,
  body,
  data = {},
  eventKey,
  fetchImpl = fetchWithTimeout,
  signJwtImpl = signApnsJwt,
}) {
  const config = readApnsConfig(env);
  if (!config.ok) {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_not_configured',
    };
  }
  if (!employeeId || !title || !eventKey) {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'invalid_notification',
    };
  }

  let tokens = [];
  try {
    tokens = await db.select(
      'device_tokens',
      `employee_id=eq.${employeeId}`
        + `&platform=eq.ios`
        + `&apns_environment=eq.${config.environment}`
        + '&select=id,token',
    );
  } catch {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'token_lookup_failed',
    };
  }
  if (!tokens?.length) {
    return { sent: 0, attempted: 0, pruned: 0, reason: 'no_tokens' };
  }

  let jwt;
  try {
    jwt = await signJwtImpl(config);
  } catch {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_signing_failed',
    };
  }

  const host = config.environment === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
  const payload = JSON.stringify({
    aps: {
      alert: { title, body: body || '' },
      sound: 'default',
    },
    data,
  });

  const results = await mapBounded(tokens, APNS_CONCURRENCY, async (row) => {
    const apnsId = await stableApnsId(`${eventKey}:${employeeId}:${row.id}`);
    try {
      const response = await fetchImpl(
        `${host}/3/device/${row.token}`,
        {
          method: 'POST',
          headers: {
            authorization: `bearer ${jwt}`,
            'apns-topic': config.topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-expiration': '0',
            'apns-id': apnsId,
          },
          body: payload,
        },
        APNS_TIMEOUT_MS,
      );
      if (response.ok) return { id: row.id, ok: true, status: response.status };

      const reason = await responseReason(response);
      const permanent = response.status === 410
        || (response.status === 400 && reason === 'BadDeviceToken');
      let pruned = false;
      if (permanent) {
        try {
          await db.delete(
            'device_tokens',
            `id=eq.${row.id}&apns_environment=eq.${config.environment}`,
          );
          pruned = true;
        } catch {
          pruned = false;
        }
      }
      return { id: row.id, ok: false, status: response.status, reason, pruned };
    } catch {
      return { id: row.id, ok: false, status: 0, reason: 'provider_unavailable' };
    }
  });

  return {
    sent: results.filter((result) => result.ok).length,
    attempted: results.length,
    pruned: results.filter((result) => result.pruned).length,
    results,
  };
}
