/**
 * NATIVE-API-01 — the origin the installed app sends /api calls to.
 *
 * This value decides where every authenticated Worker request in the app goes.
 * A wrong value is not a broken feature, it is a build silently talking to the
 * wrong environment, so the parser is deliberately strict and everything it
 * rejects is pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NATIVE_API_ORIGIN,
  parseNativeApiOrigin,
  resolveNativeApiOrigin,
  isApiPath,
} from './nativeApiOrigin';
import { NATIVE_APP_HTTPS_HOSTS } from './nativeHosts';

describe('parseNativeApiOrigin — accepts', () => {
  it('each host already trusted for universal links', () => {
    // One allowlist, not two. If a host is added for deep links it becomes
    // available here automatically; nothing can drift.
    for (const host of NATIVE_APP_HTTPS_HOSTS) {
      expect(parseNativeApiOrigin(`https://${host}`)).toBe(`https://${host}`);
    }
  });

  it('a trailing slash, which URL normalises away', () => {
    expect(parseNativeApiOrigin('https://dev.utahpros.app/')).toBe('https://dev.utahpros.app');
  });

  it('surrounding whitespace from an env file', () => {
    expect(parseNativeApiOrigin('  https://utahpros.app  ')).toBe('https://utahpros.app');
  });
});

describe('parseNativeApiOrigin — rejects', () => {
  it('a host that is not on the allowlist', () => {
    // The whole point: one env var must not be able to redirect every
    // authenticated request in the app to an attacker-chosen host.
    expect(parseNativeApiOrigin('https://evil.example.com')).toBeNull();
    expect(parseNativeApiOrigin('https://utahpros.app.evil.com')).toBeNull();
    expect(parseNativeApiOrigin('https://notutahpros.app')).toBeNull();
  });

  it('a non-https scheme', () => {
    // http would downgrade every Bearer token on the wire.
    expect(parseNativeApiOrigin('http://dev.utahpros.app')).toBeNull();
    expect(parseNativeApiOrigin('capacitor://localhost')).toBeNull();
    expect(parseNativeApiOrigin('file:///etc/passwd')).toBeNull();
  });

  it('an origin carrying a path, query or fragment', () => {
    // These would be silently dropped when the request URL is composed, so
    // accepting them would quietly do something other than what was written.
    expect(parseNativeApiOrigin('https://dev.utahpros.app/api')).toBeNull();
    expect(parseNativeApiOrigin('https://dev.utahpros.app/?x=1')).toBeNull();
    expect(parseNativeApiOrigin('https://dev.utahpros.app/#f')).toBeNull();
  });

  it('empty, missing and non-string values', () => {
    for (const value of ['', '   ', null, undefined, 42, {}, [], true]) {
      expect(parseNativeApiOrigin(value)).toBeNull();
    }
  });

  it('a malformed URL', () => {
    expect(parseNativeApiOrigin('not a url')).toBeNull();
    expect(parseNativeApiOrigin('https://')).toBeNull();
  });
});

describe('resolveNativeApiOrigin', () => {
  it('uses a valid configured origin', () => {
    expect(resolveNativeApiOrigin({ VITE_NATIVE_API_ORIGIN: 'https://utahpros.app' }))
      .toBe('https://utahpros.app');
  });

  it('falls back to DEV, never production, when unset', () => {
    // The safe direction for an accident is a test build hitting the test site.
    // A production default would mean a forgotten variable points a debug build
    // at live customer data.
    expect(resolveNativeApiOrigin({})).toBe(DEFAULT_NATIVE_API_ORIGIN);
    expect(resolveNativeApiOrigin(undefined)).toBe(DEFAULT_NATIVE_API_ORIGIN);
    expect(DEFAULT_NATIVE_API_ORIGIN).toBe('https://dev.utahpros.app');
  });

  it('falls back rather than honouring an untrusted value', () => {
    expect(resolveNativeApiOrigin({ VITE_NATIVE_API_ORIGIN: 'https://evil.example.com' }))
      .toBe(DEFAULT_NATIVE_API_ORIGIN);
  });
});

describe('isApiPath', () => {
  it('matches Pages Function routes only', () => {
    expect(isApiPath('/api/send-message')).toBe(true);
    expect(isApiPath('/api/message-conversations')).toBe(true);
  });

  it('does not match anything else the app loads', () => {
    // Rewriting one of these would break the app bundle itself.
    for (const path of ['/', '/tech', '/app-assets/index.js', '/apitest', '/api', '/f/abc']) {
      expect(isApiPath(path), path).toBe(false);
    }
  });

  it('is null-safe', () => {
    for (const value of [null, undefined, 42, {}]) expect(isApiPath(value)).toBe(false);
  });
});
