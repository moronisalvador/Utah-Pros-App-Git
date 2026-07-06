/**
 * ════════════════════════════════════════════════
 * FILE: resend-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The listener Resend calls when an email we sent hard-bounces (a permanently dead
 *   address) or gets marked as spam by the recipient. When that happens we add the
 *   address to our do-not-email list so we never mail it again — protecting the
 *   sending domain's reputation. It first proves the call really came from Resend by
 *   checking the signed message; an unsigned or tampered call is rejected, and if the
 *   signing secret isn't configured yet it refuses everything (fails closed).
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/resend-webhook  (Cloudflare Pages Function)
 *
 * DEPENDS ON:
 *   Packages:  none — Web Crypto (crypto.subtle) + atob/btoa, runs in V8 isolates
 *   Internal:  functions/lib/cors.js (jsonResponse), functions/lib/supabase.js
 *   Data:      reads  → none
 *              writes → email_suppressions (via record_email_suppression RPC),
 *                       email_inbound_events (dedup, via claim_inbound_email RPC),
 *                       worker_runs (audit)
 *
 * EXPORTS:
 *   onRequestPost(context)                          — the Pages Function entry
 *   verifySvixSignature(rawBody, headers, secret)   — exported for unit tests
 *
 * NOTES / GOTCHAS:
 *   - Resend signs webhooks with Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.
 *     ${rawBody}`, secret = base64 after stripping the `whsec_` prefix, signature in
 *     the `svix-signature` header as space-separated `v1,<base64>` tokens (any one may
 *     match). Same fail-closed / raw-body-before-parse shape as stripe-webhook.js.
 *   - Timestamp tolerance ±5 min guards replay; dedup on svix-id (via the shared
 *     email-event idempotency ledger, key `resend:<svix-id>`) makes re-delivery a no-op.
 *   - Suppress on bounce ONLY when data.bounce.type === 'Permanent'; ignore Transient/
 *     Undetermined. Key on data.to[0]. Complaints always suppress.
 *   - The owner adds the Resend webhook endpoint (/api/resend-webhook) and the
 *     RESEND_WEBHOOK_SECRET env var (both Cloudflare env sets). Until then this 503s.
 *   - Message-ID note: nothing here depends on Resend honoring a caller-supplied
 *     Message-ID (the roadmap's flagged fork). The plus-token is the sole thread
 *     correlator; this worker never reads a Message-ID. Left empirically UNVERIFIED
 *     (proxy blocks a live Resend send) — safe precisely because nothing relies on it.
 * ════════════════════════════════════════════════
 */

import { jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

// ─── SECTION: Helpers ──────────────

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Svix-signed webhook and return the parsed JSON event. Throws on any
 * verification failure (missing headers, bad signature, stale timestamp).
 * @param {string} rawBody  the exact request body text (verify BEFORE parsing)
 * @param {{id:string,timestamp:string,signature:string}} headers  svix-* header values
 * @param {string} secret   the `whsec_...` signing secret
 * @param {number} [toleranceSec=300]
 * @returns {Promise<object>} the parsed event
 */
export async function verifySvixSignature(rawBody, headers, secret, toleranceSec = 300) {
  if (!secret) throw new Error('Missing RESEND_WEBHOOK_SECRET');
  const { id, timestamp, signature } = headers || {};
  if (!id || !timestamp || !signature) throw new Error('Missing svix-* headers');

  // Replay guard first (cheap).
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSec) throw new Error('Timestamp outside tolerance');

  // Secret is base64 after the whsec_ prefix.
  const secretB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const keyBytes = base64ToBytes(secretB64);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  // svix-signature: space-separated "v1,<base64>" tokens; any v1 may match.
  const provided = signature.split(' ')
    .map((tok) => {
      const comma = tok.indexOf(',');
      if (comma === -1) return null;
      return { version: tok.slice(0, comma), sig: tok.slice(comma + 1) };
    })
    .filter((t) => t && t.version === 'v1');

  if (!provided.length) throw new Error('No v1 signature present');
  if (!provided.some((t) => timingSafeEqual(t.sig, expected))) throw new Error('Signature verification failed');

  return JSON.parse(rawBody);
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: 'resend-webhook', status, records_processed: processed,
      error_message: errorMessage || null, started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort audit */ }
}

// Map a verified event to a suppression action. Returns a small result object.
async function handleEvent(db, event) {
  const type = event?.type;

  if (type === 'email.bounced') {
    const bounceType = event?.data?.bounce?.type;
    const to = event?.data?.to?.[0];
    if (bounceType === 'Permanent' && to) {
      await db.rpc('record_email_suppression', { p_email: to, p_reason: 'hard_bounce', p_source: 'resend_bounce' });
      return { suppressed: true, reason: 'hard_bounce', email: to };
    }
    return { suppressed: false, ignored: `bounce:${bounceType || 'unknown'}` };
  }

  if (type === 'email.complained') {
    const to = event?.data?.to?.[0];
    if (to) {
      await db.rpc('record_email_suppression', { p_email: to, p_reason: 'complaint', p_source: 'resend_complaint' });
      return { suppressed: true, reason: 'complaint', email: to };
    }
    return { suppressed: false, ignored: 'complaint:no-recipient' };
  }

  return { suppressed: false, ignored: type || 'unknown' };
}

// ─── SECTION: Entry ──────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  // Fail closed until the owner configures the signing secret.
  if (!env?.RESEND_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Resend webhook not configured' }, 503, request, env);
  }

  // Raw body is required for signature verification — read it before parsing.
  const rawBody = await request.text();
  let event;
  try {
    event = await verifySvixSignature(rawBody, {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    }, env.RESEND_WEBHOOK_SECRET);
  } catch (e) {
    return jsonResponse({ error: `Webhook signature: ${e.message}` }, 400, request, env);
  }

  const db = supabase(env);

  // Event-level idempotency on svix-id (shared email-event ledger). A duplicate no-ops.
  const svixId = request.headers.get('svix-id');
  let claimed = true;
  try { claimed = await db.rpc('claim_inbound_email', { p_message_key: `resend:${svixId}` }); }
  catch { /* ledger unavailable → fall through; record_email_suppression upsert is itself idempotent */ }
  if (claimed === false) return jsonResponse({ duplicate: true }, 200, request, env);

  try {
    const result = await handleEvent(db, event);
    await logRun(db, 'completed', result.suppressed ? 1 : 0, null, startedAt);
    return jsonResponse({ ok: true, ...result }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    // 200 so Resend doesn't retry into the dedup guard; the error is recorded for support.
    return jsonResponse({ ok: false, error: e.message }, 200, request, env);
  }
}
