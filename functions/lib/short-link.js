/**
 * ════════════════════════════════════════════════
 * FILE: short-link.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Rewrites the long random code in a signing link into a shorter, friendlier
 *   form. The code a customer receives goes from
 *   "5f82ce54-4420-4b6d-a7dc-525b744f6982" to something like "2mK9pQxL7vR3nT8wZa"
 *   — same code underneath, just written in a denser alphabet. It matters because
 *   the long dashed version looks like a database error to a normal person, and
 *   people do not tap links that look like malware.
 *
 * DEPENDS ON:
 *   Packages:  none (BigInt is built in)
 *   Internal:  none — pure, safe in a Worker and in the browser bundle
 *   Data:      reads/writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is an ENCODING, not a new secret. The full 122 bits of the original
 *     UUID survive, so the link is exactly as hard to guess as it was before.
 *     Do not "shorten" further by truncating — that would cut real entropy from
 *     an unauthenticated link that authorizes signing a legal document.
 *   - Not fixed-width. A UUID with leading zero bytes encodes to fewer than 22
 *     characters; decode pads it back. Round-trip is exact either way.
 *   - The old /sign/<uuid> URLs must keep working forever — links already sent
 *     have a 30-day life and customers will tap them.
 * ════════════════════════════════════════════════
 */

// Digits first so the alphabet is stable and obvious; case-sensitive base62.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = 62n;
const MAX_CODE_LENGTH = 22; // ceil(128 bits / log2(62))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[0-9A-Za-z]{1,22}$/;

/** Is this already a plain UUID (an old-style /sign/<token> link)? */
export function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

/** UUID → base62 code. Returns null if the input is not a UUID. */
export function encodeUuidToCode(uuid) {
  const hex = String(uuid || '').replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;

  let n = BigInt(`0x${hex}`);
  if (n === 0n) return ALPHABET[0];

  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  return out;
}

/** base62 code → UUID. Returns null for anything malformed or out of range. */
export function decodeCodeToUuid(code) {
  const raw = String(code || '');
  if (!CODE_RE.test(raw)) return null;

  let n = 0n;
  for (const ch of raw) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * BASE + BigInt(i);
  }

  const hex = n.toString(16);
  if (hex.length > 32) return null; // decoded past 128 bits — not a real token
  const p = hex.padStart(32, '0');
  return `${p.slice(0, 8)}-${p.slice(8, 12)}-${p.slice(12, 16)}-${p.slice(16, 20)}-${p.slice(20)}`;
}

/**
 * Accept either form and return the UUID token, or null.
 * Lets one route serve both new short links and every link already in the wild.
 */
export function resolveSignToken(value) {
  const raw = String(value || '');
  if (isUuid(raw)) return raw.toLowerCase();
  return decodeCodeToUuid(raw);
}

/** The customer-facing signing URL for a token. */
export function buildSigningUrl(appUrl, token) {
  const code = encodeUuidToCode(token);
  const base = String(appUrl || '').replace(/\/+$/, '');
  // Fall back to the long form if the token is not a UUID — never emit a broken
  // link just because the shortener could not handle an unexpected shape.
  return code ? `${base}/s/${code}` : `${base}/sign/${token}`;
}

export const SHORT_LINK_MAX_CODE_LENGTH = MAX_CODE_LENGTH;
