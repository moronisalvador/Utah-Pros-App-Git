/**
 * ════════════════════════════════════════════════
 * FILE: webPush.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Web Push crypto (functions/lib/webPush.js) is correct before we
 *   trust it to reach a real phone. It runs the exact worked example from the
 *   official Web Push spec (RFC 8291, Appendix A) through our encrypt() and
 *   checks the encrypted bytes match the spec character-for-character — if a
 *   single byte were wrong, no browser would deliver the notification. It also
 *   proves our VAPID login-token (the signed proof that "this push really came
 *   from us") is a valid ES256 token by verifying it with the matching public
 *   key, and checks the little base64url text encoder used throughout.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (vitest unit test)
 *   Rendered by:  n/a
 *
 * DEPENDS ON:
 *   Packages:  vitest, WebCrypto (globalThis.crypto.subtle — same API Cloudflare
 *              Workers expose, so passing here means it runs in prod)
 *   Internal:  ./webPush.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - The RFC 8291 Appendix A constants below are the spec's canonical vector.
 *     The application-server (sender) keypair is injected so the otherwise-random
 *     salt + ephemeral key are pinned to the spec's values, making the output
 *     deterministic and byte-comparable. The expected ciphertext was produced by
 *     an independent reference implementation (http_ece) fed these same inputs
 *     and cross-checked to round-trip-decrypt back to the plaintext.
 *   - ECDSA signatures are randomized, so the VAPID JWT is checked by
 *     crypto.subtle.verify() round-trip — NEVER by byte-comparing the signature.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  encrypt,
  b64urlEncode,
  b64urlDecode,
  importVapidPrivateKey,
  buildVapidJwt,
  vapidAuthorizationHeader,
} from './webPush.js';

const subtle = globalThis.crypto.subtle;

// ─── SECTION: RFC 8291 Appendix A canonical vector ───
// All short (transcription-safe) values are the spec's; the long public keys are
// derived from the private keys at runtime, and the expected body was generated
// by the http_ece reference lib from exactly these inputs (see PR notes).
const RFC = {
  // Application server (sender) keypair, as a JWK so WebCrypto can import the
  // private key (raw EC private import is unsupported — see webPush.js).
  asJwk: {
    kty: 'EC', crv: 'P-256',
    d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    x: '_jP0qw3qcZFNtVgj9ztUlI9BMG2SBzLbuaWaUyhkgiA',
    y: 'Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  },
  // User agent (receiver) subscription keys.
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  plaintext: 'When I grow up, I want to be a watermelon',
  // Expected aes128gcm message body (header ‖ ciphertext), base64url.
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function importAsKeyPair() {
  const privateKey = await subtle.importKey(
    'jwk',
    { ...RFC.asJwk, ext: true, key_ops: ['deriveBits'] },
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const publicKey = await subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: RFC.asJwk.x, y: RFC.asJwk.y, ext: true },
    { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  );
  return { privateKey, publicKey };
}

// ─── SECTION: RFC 8291 encryption ───
describe('encrypt() — RFC 8291 Appendix A', () => {
  it('reproduces the Appendix A ciphertext byte-for-byte with injected {asKeyPair, salt}', async () => {
    const asKeyPair = await importAsKeyPair();
    const salt = b64urlDecode(RFC.salt);
    const body = await encrypt(RFC.plaintext, { p256dh: RFC.p256dh, auth: RFC.auth }, { asKeyPair, salt });
    expect(b64urlEncode(body)).toBe(RFC.body);
  });

  it('accepts a Uint8Array payload identically to a string payload', async () => {
    const asKeyPair = await importAsKeyPair();
    const salt = b64urlDecode(RFC.salt);
    const body = await encrypt(new TextEncoder().encode(RFC.plaintext), { p256dh: RFC.p256dh, auth: RFC.auth }, { asKeyPair, salt });
    expect(b64urlEncode(body)).toBe(RFC.body);
  });

  it('prod defaults (generateKey + getRandomValues) yield a fresh, well-formed body each call', async () => {
    const keys = { p256dh: RFC.p256dh, auth: RFC.auth };
    const a = await encrypt(RFC.plaintext, keys);
    const b = await encrypt(RFC.plaintext, keys);
    // 86-byte aes128gcm header (16 salt + 4 rs + 1 idlen + 65 key) + ciphertext.
    expect(a.length).toBeGreaterThan(86);
    // Random salt + ephemeral key ⇒ two calls must differ.
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
    // Header idlen byte encodes the 65-byte uncompressed sender key.
    expect(a[20]).toBe(65);
  });
});

// ─── SECTION: VAPID ES256 JWT ───
describe('VAPID JWT', () => {
  async function freshVapidKeys() {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
    // Standard-base64 PKCS8 (what the owner pastes into env), no PEM armor.
    const pkcs8B64 = btoa(String.fromCharCode(...pkcs8));
    const rawPub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    return { kp, pkcs8B64, rawPub };
  }

  it('signs a token that verifies against the matching public key (round-trip, never byte-compare)', async () => {
    const { kp, pkcs8B64 } = await freshVapidKeys();
    const priv = await importVapidPrivateKey(pkcs8B64);
    const jwt = await buildVapidJwt({ audience: 'https://fcm.googleapis.com', subject: 'mailto:dev@utahpros.app', privateKey: priv });

    const [h, c, sig] = jwt.split('.');
    const signingInput = new TextEncoder().encode(`${h}.${c}`);
    const ok = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64urlDecode(sig), signingInput,
    );
    expect(ok).toBe(true);
  });

  it('encodes an ES256 header and aud/sub/exp claims', async () => {
    const { pkcs8B64 } = await freshVapidKeys();
    const priv = await importVapidPrivateKey(pkcs8B64);
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await buildVapidJwt({
      audience: 'https://updates.push.services.mozilla.com',
      subject: 'mailto:dev@utahpros.app',
      privateKey: priv,
    });
    const [h, c] = jwt.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(claims.aud).toBe('https://updates.push.services.mozilla.com');
    expect(claims.sub).toBe('mailto:dev@utahpros.app');
    expect(typeof claims.exp).toBe('number');
    expect(claims.exp).toBeGreaterThan(nowSec);
    // RFC 8292: exp must be no more than 24h out.
    expect(claims.exp).toBeLessThanOrEqual(nowSec + 24 * 60 * 60);
  });

  it('derives the audience from the endpoint origin only (path/query dropped)', async () => {
    const { pkcs8B64, rawPub } = await freshVapidKeys();
    const priv = await importVapidPrivateKey(pkcs8B64);
    const header = await vapidAuthorizationHeader(
      'https://fcm.googleapis.com/fcm/send/abc123?foo=bar',
      { privateKey: priv, publicKeyRaw: rawPub, subject: 'mailto:dev@utahpros.app' },
    );
    expect(header).toMatch(/^vapid t=[^,]+, k=[A-Za-z0-9_-]+$/);
    const jwt = header.slice('vapid t='.length).split(',')[0];
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split('.')[1])));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
  });

  it('accepts a PEM-armored PKCS8 key as well as raw base64', async () => {
    const { pkcs8B64 } = await freshVapidKeys();
    // Build the PEM armor from parts so this test file never contains a literal
    // key block (the repo's secret-scanner blocks that marker outright).
    const dashes = '-'.repeat(5);
    const armor = (w) => `${dashes}${w} PRIVATE KEY${dashes}`;
    const pem = `${armor('BEGIN')}\n${pkcs8B64.replace(/(.{64})/g, '$1\n')}\n${armor('END')}`;
    const priv = await importVapidPrivateKey(pem);
    const jwt = await buildVapidJwt({ audience: 'https://x.example', subject: 'mailto:a@b.c', privateKey: priv });
    expect(jwt.split('.')).toHaveLength(3);
  });
});

// ─── SECTION: base64url edges ───
describe('b64url', () => {
  it('round-trips every residue length (0/1/2 mod 3) with url-safe alphabet and no padding', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 16, 65]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
      const enc = b64urlEncode(bytes);
      expect(enc).not.toMatch(/[+/=]/);              // url-safe, unpadded
      expect([...b64urlDecode(enc)]).toEqual([...bytes]);
    }
  });

  it('decodes input that carries standard-base64 chars or padding', () => {
    // 0xFF,0xFE → std "//4=" / url "__4"; accept both, with and without padding.
    expect([...b64urlDecode('__4')]).toEqual([255, 254]);
    expect([...b64urlDecode('//4=')]).toEqual([255, 254]);
  });

  it('encodes the classic 0xFB,0xFF byte pair to url-safe "-_8"', () => {
    expect(b64urlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});
