// POST /api/send-push
// Sends an APNs push to every device token associated with an employee.
//
// Auth: requires an admin/manager session (requireRole) — pushing to an
//       arbitrary employee_id is privileged; a valid session alone is not enough.
//
// Body: { employee_id: uuid, title: string, body: string, data?: object }
//
// Requires these env vars (set in Cloudflare Pages → Settings → Environment Variables):
//   APNS_P8_KEY    — contents of the AuthKey_XXX.p8 file (full PEM, newlines preserved)
//   APNS_KEY_ID    — 10-char Key ID from Apple Developer portal
//   APNS_TEAM_ID   — 10-char Team ID from Apple Developer portal
//   APNS_TOPIC     — bundle id, e.g. "com.utahprosrestoration.upr"
//   APNS_ENV       — "sandbox" (TestFlight/dev) or "production" (App Store). Defaults to sandbox.
//
// Until those are configured the endpoint returns 503 so callers can wire triggers
// safely without accidentally hitting Apple with bad credentials.

import { supabase } from '../lib/supabase.js';
import { requireRole } from '../lib/auth.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

// Server-side role gate: sending a push to an ARBITRARY employee_id is a
// privileged action (a valid session alone is not enough — workers-standard.md
// §1). Mirrors the device_tokens RLS admin tier ('admin','project_manager').
const PUSH_SEND_ROLES = ['admin', 'project_manager'];

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const db = supabase(env);
  const auth = await requireRole(request, env, db, PUSH_SEND_ROLES);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const cfg = readApnsConfig(env);
  if (!cfg.ok) {
    return jsonResponse({ error: 'APNs not configured', missing: cfg.missing }, 503, request, env);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env); }

  const { employee_id, title, body: messageBody, data } = body || {};
  if (!employee_id || !title || !messageBody) {
    return jsonResponse({ error: 'employee_id, title, and body are required' }, 400, request, env);
  }

  const tokens = await db.select(
    'device_tokens',
    `employee_id=eq.${employee_id}&platform=eq.ios&select=id,token`
  );

  if (tokens.length === 0) {
    return jsonResponse({ sent: 0, note: 'No iOS tokens registered for employee' }, 200, request, env);
  }

  const jwt = await signApnsJwt(cfg);
  const apnsHost = cfg.env === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';

  const payload = JSON.stringify({
    aps: {
      alert: { title, body: messageBody },
      sound: 'default',
      'mutable-content': 1,
    },
    ...(data ? { data } : {}),
  });

  const results = await Promise.all(tokens.map(async (row) => {
    const res = await fetch(`${apnsHost}/3/device/${row.token}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': cfg.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': '0',
      },
      body: payload,
    });

    // 410 Gone = token invalid/unregistered; prune from DB
    if (res.status === 410) {
      try { await db.delete('device_tokens', `id=eq.${row.id}`); } catch { /* best-effort prune */ }
      return { token_id: row.id, status: 410, pruned: true };
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // 400 BadDeviceToken = permanently invalid token (wrong APNs env or a
      // malformed/stale token) — prune it like a 410 so it stops being retried.
      if (res.status === 400 && /BadDeviceToken/i.test(errBody)) {
        try { await db.delete('device_tokens', `id=eq.${row.id}`); } catch { /* best-effort prune */ }
        return { token_id: row.id, status: 400, pruned: true, error: errBody };
      }
      return { token_id: row.id, status: res.status, error: errBody };
    }

    return { token_id: row.id, status: res.status, ok: true };
  }));

  const sent = results.filter(r => r.ok).length;
  return jsonResponse({ sent, total: results.length, results }, 200, request, env);
}

// ── APNs config + JWT ────────────────────────────────────────────────────────

function readApnsConfig(env) {
  const missing = [];
  if (!env.APNS_P8_KEY) missing.push('APNS_P8_KEY');
  if (!env.APNS_KEY_ID) missing.push('APNS_KEY_ID');
  if (!env.APNS_TEAM_ID) missing.push('APNS_TEAM_ID');
  if (!env.APNS_TOPIC) missing.push('APNS_TOPIC');
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    p8: env.APNS_P8_KEY,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    topic: env.APNS_TOPIC,
    env: (env.APNS_ENV || 'sandbox').toLowerCase(),
  };
}

// Cached per isolate — APNs JWTs are valid up to 1h; regen every 50 min to be safe
let _jwtCache = { jwt: null, expiresAt: 0 };

async function signApnsJwt(cfg) {
  const now = Math.floor(Date.now() / 1000);
  if (_jwtCache.jwt && _jwtCache.expiresAt > now + 60) return _jwtCache.jwt;

  const key = await importP8Key(cfg.p8);
  const header = b64urlJson({ alg: 'ES256', kid: cfg.keyId });
  const claims = b64urlJson({ iss: cfg.teamId, iat: now });
  const unsigned = `${header}.${claims}`;
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(sigBuf))}`;

  _jwtCache = { jwt, expiresAt: now + 50 * 60 };
  return jwt;
}

async function importP8Key(pem) {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bin,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}
