/**
 * NATIVE-API-01 — the origin allowlist in front of every browser-callable Worker.
 *
 * This file is frozen by six ownership manifests and sits ahead of messaging,
 * consent and money. It had no test at all. Adding the installed app's origin is
 * what makes the native /api rewrite usable, so the allowlist's exact behaviour —
 * especially what it REFUSES — is pinned here.
 *
 * Note what CORS is and is not: it is a browser convenience, not the gate. Every
 * browser-callable Worker authorizes on a Supabase Bearer session plus a
 * server-side role predicate (functions/lib/auth.js, messaging-auth.js). Origin
 * is read exactly once in all of functions/ — here — and never gates a decision.
 */
import { describe, it, expect } from 'vitest';
import { corsHeaders, handleOptions } from './cors.js';

const req = (origin) => new Request('https://dev.utahpros.app/api/x', {
  headers: origin === undefined ? {} : { Origin: origin },
});

describe('corsHeaders — allows', () => {
  it('the installed iOS app', () => {
    // Capacitor serves the bundled app from this custom-scheme origin, so every
    // Worker call from the app is cross-origin and needs this entry.
    expect(corsHeaders(req('capacitor://localhost'), {})['Access-Control-Allow-Origin'])
      .toBe('capacitor://localhost');
  });

  it('the deployed sites and local dev', () => {
    for (const origin of [
      'https://dev.utahpros.app',
      'https://utah-pros-app-git.pages.dev',
      'http://localhost:5173',
      'http://localhost:4173',
    ]) {
      expect(corsHeaders(req(origin), {})['Access-Control-Allow-Origin'], origin).toBe(origin);
    }
  });

  it('one extra origin supplied via PAGES_URL', () => {
    expect(corsHeaders(req('https://preview.pages.dev'), { PAGES_URL: 'https://preview.pages.dev' })['Access-Control-Allow-Origin'])
      .toBe('https://preview.pages.dev');
  });
});

describe('corsHeaders — refuses', () => {
  it('the opaque "null" origin', () => {
    // THE important one. An opaque origin serialises as the literal string
    // "null", and any sandboxed iframe or data: document can produce it — so
    // allowlisting it would hand every hostile page the app's access.
    expect(corsHeaders(req('null'), {})['Access-Control-Allow-Origin']).toBe('');
  });

  it('a lookalike of the app origin', () => {
    for (const origin of [
      'capacitor://evil',
      'capacitor://localhost.evil.com',
      'https://capacitor://localhost',
      'ionic://localhost',
      'http://localhost',
    ]) {
      expect(corsHeaders(req(origin), {})['Access-Control-Allow-Origin'], origin).toBe('');
    }
  });

  it('a lookalike of a trusted site', () => {
    for (const origin of [
      'https://dev.utahpros.app.evil.com',
      'https://evil.com',
      'http://dev.utahpros.app',
    ]) {
      expect(corsHeaders(req(origin), {})['Access-Control-Allow-Origin'], origin).toBe('');
    }
  });

  it('a missing or empty Origin', () => {
    expect(corsHeaders(req(undefined), {})['Access-Control-Allow-Origin']).toBe('');
    expect(corsHeaders(req(''), {})['Access-Control-Allow-Origin']).toBe('');
  });

  it('a malformed request, without throwing', () => {
    // Every response in the two media Workers is now built through this helper,
    // so a throw here would 500 the whole endpoint rather than omit a header.
    // Existing Worker tests also pass request stubs that carry no headers.
    for (const bad of [undefined, null, {}, { headers: null }, { headers: {} }]) {
      expect(() => corsHeaders(bad, {})).not.toThrow();
      expect(corsHeaders(bad, {})['Access-Control-Allow-Origin']).toBe('');
    }
  });

  it('an empty PAGES_URL, which must not match an empty Origin', () => {
    // `pagesUrl && origin === pagesUrl` — without the truthiness guard an unset
    // PAGES_URL would allow every request that omits Origin.
    expect(corsHeaders(req(undefined), { PAGES_URL: '' })['Access-Control-Allow-Origin']).toBe('');
  });

  it('never answers with a wildcard', () => {
    for (const origin of ['capacitor://localhost', 'https://evil.com', 'null']) {
      expect(corsHeaders(req(origin), {})['Access-Control-Allow-Origin']).not.toBe('*');
    }
  });
});

describe('corsHeaders — cache correctness', () => {
  it('varies on Origin', () => {
    // The body is identical per origin but the Allow-Origin header is not, so a
    // shared cache must key on it or one origin's response can be replayed to
    // another carrying the wrong header.
    expect(corsHeaders(req('capacitor://localhost'), {}).Vary).toBe('Origin');
  });
});

describe('handleOptions', () => {
  it('answers a preflight from the app with 204 and the origin', async () => {
    const res = handleOptions(req('capacitor://localhost'), {});
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('does not hand an unknown origin a usable preflight', () => {
    expect(handleOptions(req('https://evil.com'), {}).headers.get('Access-Control-Allow-Origin'))
      .toBeFalsy();
  });
});

describe('the two media Workers now answer a preflight at all', () => {
  it('export onRequestOptions and emit CORS on their responses', async () => {
    // They previously imported no CORS helper and exported no OPTIONS handler, so
    // the app's preflight got nothing back and the request never left the device —
    // adding the origin to the allowlist alone would not have reached them.
    for (const mod of ['../api/message-media-upload.js', '../api/message-media-url.js']) {
      const loaded = await import(mod);
      expect(typeof loaded.onRequestOptions, mod).toBe('function');
      const res = loaded.onRequestOptions({ request: req('capacitor://localhost'), env: {} });
      expect(res.status, mod).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin'), mod).toBe('capacitor://localhost');
    }
  });
});
