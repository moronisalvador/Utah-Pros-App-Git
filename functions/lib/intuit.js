/**
 * ════════════════════════════════════════════════
 * FILE: intuit.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small helpers for receiving QuickBooks (Intuit) webhooks safely. QuickBooks
 *   signs every webhook it sends us; this file checks that signature so we only
 *   trust real messages from Intuit, and provides a tiny hashing helper used to
 *   give each event a stable, safe id.
 *
 * WHERE IT LIVES:
 *   Used by:  functions/api/qbo-webhook.js
 *
 * DEPENDS ON:
 *   Packages:  none (Web Crypto, available in Cloudflare Workers)
 *   Internal:  none
 *   Data:      reads → none   writes → none
 *
 * NOTES / GOTCHAS:
 *   - Intuit signs webhooks as: intuit-signature = base64( HMAC-SHA256(rawBody, verifierToken) ).
 *     The verifier token comes from the Intuit Developer dashboard (Webhooks) and is
 *     stored in the QBO_WEBHOOK_VERIFIER_TOKEN env var — DISTINCT from QBO_WEBHOOK_SECRET
 *     (which is only used for internal DB-trigger → worker auth).
 *   - Verify against the RAW request body bytes — parse the JSON only after verifying.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Helpers ──────────────
function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── SECTION: Exports ──────────────

// Verify Intuit's webhook signature. Returns true only on an exact HMAC match.
export async function verifyIntuitSignature(rawBody, signatureHeader, verifierToken) {
  if (!verifierToken || !signatureHeader || rawBody == null) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(verifierToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = bytesToBase64(new Uint8Array(mac));
  return timingSafeEqual(expected, signatureHeader.trim());
}

// Stable hex hash — used to turn a composite event key into a safe primary-key string
// (no colons/timestamps that would need URL-encoding in PostgREST filters).
export async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
