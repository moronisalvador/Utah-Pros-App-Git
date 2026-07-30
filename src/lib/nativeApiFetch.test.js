/**
 * NATIVE-API-01 — the /api rewrite that makes Workers reachable from the app.
 *
 * Two properties matter more than the happy path:
 *   1. On WEB nothing is patched at all. The owner froze the PWA; a global fetch
 *      patch leaking into the browser would be the worst possible regression.
 *   2. Only same-origin /api paths move. Supabase REST, Storage and third-party
 *      calls already name their host and must be passed through untouched — the
 *      device evidence for this bug was literally an absolute Supabase call
 *      succeeding beside a relative /api call failing.
 */
import { describe, it, expect, vi } from 'vitest';
import { installNativeApiFetch, rewriteApiRequestUrl } from './nativeApiFetch';

const APP = 'capacitor://localhost';
const API = 'https://dev.utahpros.app';

const native = { isNativePlatform: () => true };
const web = { isNativePlatform: () => false };

/** A fresh scope with a spy fetch, standing in for globalThis. */
const makeScope = () => ({ fetch: vi.fn(async () => ({ ok: true })) });

describe('rewriteApiRequestUrl — rewrites', () => {
  it('a relative /api path', () => {
    expect(rewriteApiRequestUrl('/api/send-message', APP, API))
      .toBe('https://dev.utahpros.app/api/send-message');
  });

  it('and preserves query and fragment', () => {
    expect(rewriteApiRequestUrl('/api/x?a=1&b=2#f', APP, API))
      .toBe('https://dev.utahpros.app/api/x?a=1&b=2#f');
  });

  it('an absolute URL that is same-origin with the app', () => {
    expect(rewriteApiRequestUrl(`${APP}/api/notify`, APP, API))
      .toBe('https://dev.utahpros.app/api/notify');
  });

  it('a URL object', () => {
    expect(rewriteApiRequestUrl(new URL(`${APP}/api/x`), APP, API))
      .toBe('https://dev.utahpros.app/api/x');
  });

  it('an object carrying a .url, the shape a Request has', () => {
    expect(rewriteApiRequestUrl({ url: `${APP}/api/x` }, APP, API))
      .toBe('https://dev.utahpros.app/api/x');
  });
});

describe('rewriteApiRequestUrl — the custom-scheme trap', () => {
  it('matches same-origin under capacitor:, whose .origin is the string "null"', () => {
    // The first implementation compared url.origin to pageOrigin. For a
    // NON-SPECIAL scheme the URL spec defines origin as the opaque string
    // "null" (verified: new URL('/api/x','capacitor://localhost').origin ===
    // 'null'), so nothing ever matched and the rewrite silently did nothing —
    // it would have shipped as a fix that changed no behaviour at all.
    expect(new URL('/api/x', APP).origin).toBe('null');
    expect(rewriteApiRequestUrl('/api/x', APP, API)).toBe('https://dev.utahpros.app/api/x');
  });

  it('does not treat two different custom-scheme hosts as one origin', () => {
    // The same "null" origin quirk in the other direction: comparing parsed
    // origins would have made every capacitor:// host look identical.
    expect(rewriteApiRequestUrl('capacitor://elsewhere/api/x', APP, API)).toBeNull();
  });

  it('works for an https page origin too, so the rule is not scheme-specific', () => {
    expect(rewriteApiRequestUrl('/api/x', 'https://dev.utahpros.app', API))
      .toBe('https://dev.utahpros.app/api/x');
  });
});

describe('rewriteApiRequestUrl — leaves alone', () => {
  it('a call that already names another host', () => {
    // Supabase REST and Storage. Redirecting these would break everything that
    // currently WORKS in the app.
    for (const url of [
      'https://glsmljpabrwonfiltiqm.supabase.co/rest/v1/jobs',
      'https://glsmljpabrwonfiltiqm.supabase.co/storage/v1/object/job-files/x.jpg',
      'https://api.twilio.com/whatever',
      'https://dev.utahpros.app/api/already-absolute',
    ]) {
      expect(rewriteApiRequestUrl(url, APP, API), url).toBeNull();
    }
  });

  it('same-origin paths that are not Workers', () => {
    // Rewriting these would send the app bundle's own asset requests to the
    // network, which would break the app entirely offline and slow it down on.
    for (const path of ['/', '/tech', '/app-assets/index.js', '/assets/logo.svg', '/apitest', '/api']) {
      expect(rewriteApiRequestUrl(path, APP, API), path).toBeNull();
    }
  });

  it('inputs it cannot interpret', () => {
    for (const input of [null, undefined, 42, {}, []]) {
      expect(rewriteApiRequestUrl(input, APP, API)).toBeNull();
    }
  });

  it('anything, when an origin is missing', () => {
    expect(rewriteApiRequestUrl('/api/x', null, API)).toBeNull();
    expect(rewriteApiRequestUrl('/api/x', APP, null)).toBeNull();
  });
});

describe('installNativeApiFetch — web is untouched', () => {
  it('does not patch fetch off-native', () => {
    const scope = makeScope();
    const before = scope.fetch;
    const uninstall = installNativeApiFetch({ platform: web, scope, env: {}, pageOrigin: 'https://dev.utahpros.app' });
    expect(scope.fetch).toBe(before);
    expect(scope.fetch.__uprNativeApiFetch).toBeUndefined();
    uninstall();
    expect(scope.fetch).toBe(before);
  });
});

describe('installNativeApiFetch — native', () => {
  const install = (scope, env = {}) =>
    installNativeApiFetch({ platform: native, scope, env, pageOrigin: APP });

  it('sends a relative /api call to the configured origin', async () => {
    const scope = makeScope();
    const original = scope.fetch;
    install(scope, { VITE_NATIVE_API_ORIGIN: 'https://utahpros.app' });
    await scope.fetch('/api/send-message', { method: 'POST' });
    expect(original).toHaveBeenCalledWith('https://utahpros.app/api/send-message', { method: 'POST' });
  });

  it('defaults to dev when no origin is configured', async () => {
    const scope = makeScope();
    const original = scope.fetch;
    install(scope);
    await scope.fetch('/api/x');
    expect(original).toHaveBeenCalledWith('https://dev.utahpros.app/api/x', undefined);
  });

  it('passes the caller init through untouched', async () => {
    const scope = makeScope();
    const original = scope.fetch;
    install(scope);
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: '{"a":1}',
    };
    await scope.fetch('/api/x', init);
    // Same object, not a copy: a dropped Authorization header would turn every
    // authenticated call into a 401.
    expect(original.mock.calls[0][1]).toBe(init);
  });

  it('does not touch a Supabase call', async () => {
    const scope = makeScope();
    const original = scope.fetch;
    install(scope);
    const url = 'https://glsmljpabrwonfiltiqm.supabase.co/rest/v1/jobs?select=*';
    await scope.fetch(url);
    expect(original).toHaveBeenCalledWith(url, undefined);
  });

  it('is idempotent', () => {
    const scope = makeScope();
    install(scope);
    const first = scope.fetch;
    install(scope);
    expect(scope.fetch).toBe(first);
  });

  it('restores the original fetch on uninstall', async () => {
    const scope = makeScope();
    const original = scope.fetch;
    const uninstall = install(scope);
    expect(scope.fetch).not.toBe(original);
    uninstall();
    expect(scope.fetch).toBe(original);
    await scope.fetch('/api/x');
    expect(original).toHaveBeenCalledWith('/api/x');
  });

  it('never breaks a request if the rewrite throws', async () => {
    const scope = makeScope();
    const original = scope.fetch;
    install(scope);
    // A getter that explodes stands in for any exotic input.
    const hostile = { get url() { throw new Error('boom'); } };
    await expect(scope.fetch(hostile)).resolves.toEqual({ ok: true });
    // Identity, not toHaveBeenCalledWith: deep-equality would read .url and
    // rethrow inside the assertion rather than testing the code.
    expect(original.mock.calls[0][0]).toBe(hostile);
  });

  it('does nothing when the scope has no fetch', () => {
    expect(() => installNativeApiFetch({ platform: native, scope: {}, env: {}, pageOrigin: APP })).not.toThrow();
  });
});
