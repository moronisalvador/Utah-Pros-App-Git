/**
 * ════════════════════════════════════════════════
 * FILE: twilio.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant read UPR's text-message history and send a text (SMS/MMS)
 *   from a Claude chat, through the same Twilio account the app uses for customer
 *   messaging. It can list recent messages, look one up by its id, or send a new
 *   one. The Twilio account id/token never touch the browser — this reuses the
 *   SAME credentials the app's send-message worker uses.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (pure fetch + HTTP Basic auth)
 *   Internal:      none
 *   External API:  Twilio REST API (api.twilio.com/2010-04-01)
 *   Config:        TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (worker secrets); optional
 *                  TWILIO_MESSAGING_SERVICE_SID / TWILIO_PHONE_NUMBER (send-from)
 *
 * NOTES / GOTCHAS:
 *   - Ported from functions/lib/twilio.js (the sendMessage shape). Prefers the
 *     Messaging Service SID (handles the sender pool + RCS upgrade); falls back to
 *     TWILIO_PHONE_NUMBER as the From.
 *   - Returns a clean "not configured" error until the secrets are set, so the
 *     tool is dormant-safe (mirrors resend.js / encircle.js).
 *   - Sending a text is a guarded [WRITE] in tools.js — it costs money and reaches
 *     a real person, so it previews unless confirm:true.
 * ════════════════════════════════════════════════
 */

const BASE = 'https://api.twilio.com/2010-04-01';

function creds(env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('Twilio is not configured for the MCP worker — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (wrangler secret put …).');
  }
  return { accountSid, authToken };
}

// Core fetch. `path` is relative to /Accounts/{sid} (begins with '/'). GET uses
// querystring; POST uses form-encoding. Surfaces Twilio's error message.
async function twilioFetch(env, path, { method = 'GET', params } = {}) {
  const { accountSid, authToken } = creds(env);
  let url = `${BASE}/Accounts/${accountSid}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) };
  const init = { method, headers };
  if (method === 'GET') {
    if (params) url += '?' + new URLSearchParams(params).toString();
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = params ? params.toString() : '';
  }
  const res = await fetch(url, init);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Twilio ${method} ${path} → HTTP ${res.status}: ${data.message || data.code || 'error'}`);
  }
  return data;
}

// ─── Generic power tools (reach any endpoint under /Accounts/{sid}) ──────────────
export function twilioGet(env, path, params) {
  return twilioFetch(env, path, { method: 'GET', params });
}
export function twilioRequest(env, method, path, params) {
  const form = params ? new URLSearchParams(params) : undefined;
  return twilioFetch(env, path, { method: String(method || 'POST').toUpperCase(), params: form });
}

// ─── Messages ──────────────────────────────────────────────────────────────────
// GET /Messages.json — recent messages, optionally filtered by number/date.
export function listMessages(env, { to, from, date_sent, page_size = 30 } = {}) {
  const params = { PageSize: String(Math.min(Number(page_size) || 30, 200)) };
  if (to) params.To = to;
  if (from) params.From = from;
  if (date_sent) params.DateSent = date_sent;
  return twilioFetch(env, '/Messages.json', { params });
}

// GET /Messages/{sid}.json — one message by its SID.
export function getMessage(env, sid) {
  return twilioFetch(env, `/Messages/${encodeURIComponent(String(sid))}.json`);
}

// POST /Messages.json — send an SMS/MMS. Prefers the Messaging Service SID.
export function sendMessage(env, { to, body, mediaUrls }) {
  const params = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else if (env.TWILIO_PHONE_NUMBER) params.set('From', env.TWILIO_PHONE_NUMBER);
  else throw new Error('No Twilio sender configured — set TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER.');
  if (Array.isArray(mediaUrls)) mediaUrls.forEach((u) => params.append('MediaUrl', u));
  return twilioFetch(env, '/Messages.json', { method: 'POST', params });
}
