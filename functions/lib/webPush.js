/**
 * ════════════════════════════════════════════════
 * FILE: webPush.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the engine that lets our server send a push notification straight to
 *   a phone or laptop's web browser — the buzz that shows up on a locked iPhone
 *   home screen. Two jobs: (1) it scrambles (encrypts) the message so ONLY the
 *   one device that subscribed can read it — the push service in the middle just
 *   relays sealed bytes; and (2) it signs a short "this is really Utah Pros"
 *   token so the push service trusts the request. It talks the exact standards
 *   browsers require (RFC 8291 for the encryption, RFC 8292 "VAPID" for the
 *   token), using only built-in crypto so it runs inside a Cloudflare Worker
 *   with no external library.
 *
 * IMPORTED BY:
 *   functions/api/feedback-notify.js (and, later, the notification dispatcher).
 *
 * DEPENDS ON:
 *   Packages:  none (WebCrypto globalThis.crypto.subtle — Workers + Node 18+)
 *   Internal:  none
 *   Data:      none directly (callers pass in a { endpoint, keys:{p256dh,auth} }
 *              subscription row and the VAPID_* env values)
 *
 * NOTES / GOTCHAS:
 *   - The VAPID private key must be stored as PKCS8 (base64 or PEM). WebCrypto
 *     cannot importKey('raw', …) an EC PRIVATE key, only a public one — the same
 *     constraint send-push.js's APNs importP8Key hits. Public keys import raw.
 *   - encrypt() takes an injectable { asKeyPair, salt } so the RFC 8291 Appendix
 *     A vector is reproducible byte-for-byte in the test; production omits both
 *     and gets a fresh ephemeral keypair + random salt every call (required —
 *     reusing them across messages is a crypto break).
 *   - Missing VAPID env is the caller's concern: sendWebPush returns
 *     { skipped:true, status:503 } so a worker can wire the call before the owner
 *     sets the keys (the APNs 503-skip precedent), never throwing into the
 *     request path.
 *   - 404/410 from the push service = a dead subscription; sendWebPush surfaces
 *     res.status so the caller can prune it.
 * ════════════════════════════════════════════════
 */

const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
const RECORD_SIZE = 4096;

// ─── SECTION: base64url helpers ───

/** Bytes → unpadded, URL-safe base64. */
export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (or standard base64, padded or not) → Uint8Array. */
export function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

function concatBytes(...chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ─── SECTION: HKDF (RFC 5869 via WebCrypto) ───

async function hkdf(salt, ikm, info, length) {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ─── SECTION: RFC 8291 message encryption (aes128gcm) ───

/**
 * Encrypt a push payload for one subscription per RFC 8291 (aes128gcm content
 * coding, RFC 8188). Returns the message body (86-byte header ‖ ciphertext) as a
 * Uint8Array, ready to POST with `Content-Encoding: aes128gcm`.
 *
 * @param payload      string | Uint8Array — the plaintext (usually a JSON string).
 * @param keys         { p256dh, auth } — the subscription's base64url keys.
 * @param opts.asKeyPair  injected ECDH CryptoKeyPair (test/deterministic); prod
 *                        generates a fresh ephemeral pair.
 * @param opts.salt       injected 16-byte salt (test); prod uses a random one.
 */
export async function encrypt(payload, keys, opts = {}) {
  const subtle = globalThis.crypto.subtle;
  const plaintext = typeof payload === 'string' ? utf8(payload) : payload;

  const uaPublicRaw = b64urlDecode(keys.p256dh);       // 65 bytes, uncompressed
  const authSecret = b64urlDecode(keys.auth);          // 16 bytes
  const salt = opts.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));

  // Application-server (sender) ephemeral keypair — injectable for the RFC vector.
  const asKeyPair = opts.asKeyPair || await subtle.generateKey(CURVE, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await subtle.exportKey('raw', asKeyPair.publicKey));

  // ECDH shared secret between sender private and receiver public.
  const uaPublicKey = await subtle.importKey('raw', uaPublicRaw, CURVE, false, []);
  const sharedBits = await subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedBits);

  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret,
  //   "WebPush: info\0" ‖ ua_public ‖ as_public, 32)
  const keyInfo = concatBytes(utf8('WebPush: info\0'), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // RFC 8188 §2.2: PRK = HKDF(salt, IKM, "", 32); CEK/NONCE via labeled expands.
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // Single record: plaintext ‖ 0x02 (last-record delimiter, no extra padding).
  const record = concatBytes(plaintext, new Uint8Array([0x02]));
  const cekKey = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, record);
  const ciphertext = new Uint8Array(cipherBuf);

  // aes128gcm header: salt(16) ‖ rs(uint32 BE) ‖ idlen(1) ‖ keyid(as_public,65).
  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublicRaw.length;
  header.set(asPublicRaw, 21);

  return concatBytes(header, ciphertext);
}

// ─── SECTION: VAPID (RFC 8292) ES256 JWT ───

/**
 * Import a VAPID private key (PKCS8, base64 or PEM-armored) as an ECDSA P-256
 * signing key. Mirrors send-push.js's importP8Key — raw EC private import is
 * unsupported, so the key MUST be PKCS8.
 */
export async function importVapidPrivateKey(pkcs8) {
  const base64 = String(pkcs8)
    .replace(/-----[^-]+-----/g, '')     // strip any PEM armor
    .replace(/\s+/g, '')
    .replace(/-/g, '+').replace(/_/g, '/'); // tolerate base64url too
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const bin = atob(base64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return globalThis.crypto.subtle.importKey(
    'pkcs8', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
}

/**
 * Build a signed VAPID JWT.
 * @param audience    the push endpoint's ORIGIN (scheme://host), not the full URL.
 * @param subject     a mailto: or https: contact URI.
 * @param privateKey  an ECDSA P-256 CryptoKey (from importVapidPrivateKey).
 * @param expiration  optional epoch-seconds exp; default now + 12h (≤ 24h per RFC 8292).
 */
export async function buildVapidJwt({ audience, subject, privateKey, expiration, now }) {
  const nowSec = Number.isFinite(now) ? now : Math.floor(Date.now() / 1000);
  const exp = Number.isFinite(expiration) ? expiration : nowSec + 12 * 60 * 60;
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(utf8(JSON.stringify({ aud: audience, exp, sub: subject })));
  const signingInput = `${header}.${claims}`;
  const sigBuf = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, utf8(signingInput),
  );
  // WebCrypto returns the raw r‖s (64-byte) signature — exactly JOSE ES256 form.
  return `${signingInput}.${b64urlEncode(new Uint8Array(sigBuf))}`;
}

/**
 * The full `Authorization: vapid t=<jwt>, k=<publicKey>` header value for a push
 * request. Derives the JWT audience from the endpoint's origin.
 * @param endpoint       the subscription's push endpoint URL.
 * @param privateKey     ECDSA P-256 CryptoKey.
 * @param publicKeyRaw   the VAPID public key as raw 65 bytes (or base64url string).
 * @param subject        mailto:/https: contact URI.
 */
export async function vapidAuthorizationHeader(endpoint, { privateKey, publicKeyRaw, subject, now }) {
  const audience = new URL(endpoint).origin;
  const jwt = await buildVapidJwt({ audience, subject, privateKey, now });
  const k = typeof publicKeyRaw === 'string' ? publicKeyRaw : b64urlEncode(publicKeyRaw);
  return `vapid t=${jwt}, k=${k}`;
}

// ─── SECTION: send one push ───

/**
 * Read + validate VAPID config from env. Returns { ok:false, missing:[...] } when
 * anything is absent so callers can 503-skip (the APNs precedent).
 */
export function readVapidConfig(env) {
  const missing = [];
  if (!env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY');
  if (!env.VAPID_PUBLIC_KEY) missing.push('VAPID_PUBLIC_KEY');
  if (!env.VAPID_SUBJECT) missing.push('VAPID_SUBJECT');
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    privateKeyPkcs8: env.VAPID_PRIVATE_KEY,
    publicKey: env.VAPID_PUBLIC_KEY,      // base64url raw, doubles as `k=` + applicationServerKey
    subject: env.VAPID_SUBJECT,
  };
}

/**
 * Encrypt + POST one Web Push message to a single subscription.
 *
 * @param subscription  { endpoint, keys:{ p256dh, auth } } (or { p256dh, auth } flat).
 * @param payload       string | object (objects are JSON-stringified) | Uint8Array.
 * @param env           Worker env carrying VAPID_*.
 * @param opts.ttl      seconds the push service may hold the message (default 2419200 = 28d).
 * @param opts.urgency  'very-low' | 'low' | 'normal' | 'high' (default 'normal').
 * @param opts.fetchImpl  injectable fetch for tests.
 * @returns { status, ok, skipped? } — skipped:true + status:503 when VAPID env is unset.
 */
export async function sendWebPush(subscription, payload, env, opts = {}) {
  const cfg = readVapidConfig(env);
  if (!cfg.ok) return { skipped: true, status: 503, missing: cfg.missing };

  const fetchImpl = opts.fetchImpl || fetch;
  const endpoint = subscription.endpoint;
  const keys = subscription.keys || { p256dh: subscription.p256dh, auth: subscription.auth };

  const bodyStr = typeof payload === 'string' || payload instanceof Uint8Array
    ? payload
    : JSON.stringify(payload ?? {});
  const cipher = await encrypt(bodyStr, keys);

  const privateKey = await importVapidPrivateKey(cfg.privateKeyPkcs8);
  const authorization = await vapidAuthorizationHeader(endpoint, {
    privateKey, publicKeyRaw: cfg.publicKey, subject: cfg.subject,
  });

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(opts.ttl ?? 2419200),
      'Urgency': opts.urgency || 'normal',
    },
    body: cipher,
  });

  return { status: res.status, ok: res.ok };
}
