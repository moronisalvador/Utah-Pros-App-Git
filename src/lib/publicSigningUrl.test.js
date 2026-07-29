/**
 * ESIGN-01 — the copied signing link must be openable by a customer.
 *
 * In the Capacitor WKWebView `window.location.origin` is capacitor://localhost
 * (capacitor.config.json declares no server.url, so the webview serves local
 * files). Copying a signing link in the field therefore produced a URL nobody
 * outside that phone could open.
 */
import { describe, it, expect } from 'vitest';
import { PUBLIC_APP_FALLBACK, publicOrigin, publicSigningUrl } from './publicSigningUrl.js';

const TOKEN = '3f1c9a52-8e4b-4c77-9d21-6b0a5e7c1d84';

describe('publicOrigin', () => {
  it('keeps a real production origin', () => {
    expect(publicOrigin('https://utahpros.app/tech/jobs/1')).toBe('https://utahpros.app');
  });

  it('keeps the dev host, so a dev-built link still works on dev', () => {
    expect(publicOrigin('https://dev.utahpros.app/x')).toBe('https://dev.utahpros.app');
  });

  it('rejects the Capacitor origin — the actual bug', () => {
    expect(publicOrigin('capacitor://localhost/tech/jobs/1')).toBe(PUBLIC_APP_FALLBACK);
  });

  it('rejects other unreachable origins the allowlist also catches', () => {
    // Gating on isNativePlatform() would have fixed only the first of these.
    for (const href of [
      'file:///var/containers/app/index.html',
      'http://localhost:5173/tech',
      'https://upr-preview-123.pages.dev/tech',
      'ionic://localhost/tech',
    ]) {
      expect(publicOrigin(href), href).toBe(PUBLIC_APP_FALLBACK);
    }
  });

  it('rejects http even on an allowed host', () => {
    expect(publicOrigin('http://utahpros.app/x')).toBe(PUBLIC_APP_FALLBACK);
  });

  it('is not fooled by a lookalike hostname', () => {
    for (const href of [
      'https://utahpros.app.evil.test/x',
      'https://notutahpros.app/x',
      'https://evil.test/?next=https://utahpros.app',
    ]) {
      expect(publicOrigin(href), href).toBe(PUBLIC_APP_FALLBACK);
    }
  });

  it('falls back rather than throwing on unparseable input', () => {
    expect(publicOrigin('')).toBe(PUBLIC_APP_FALLBACK);
    expect(publicOrigin(undefined)).toBe(PUBLIC_APP_FALLBACK);
    expect(publicOrigin('not a url')).toBe(PUBLIC_APP_FALLBACK);
  });
});

describe('publicSigningUrl', () => {
  it('produces an externally openable link from the native origin', () => {
    const url = publicSigningUrl(TOKEN, 'capacitor://localhost/tech/jobs/1');
    expect(url.startsWith('https://utahpros.app/')).toBe(true);
    expect(url).not.toContain('capacitor');
    expect(url).not.toContain('localhost');
  });

  it('uses the short /s/ form for a real token', () => {
    // buildSigningUrl already shortens UUIDs; this just proves composition.
    expect(publicSigningUrl(TOKEN, 'https://utahpros.app/x')).toMatch(/^https:\/\/utahpros\.app\/s\/.+/);
  });

  it('still emits a usable long link when the token is not a UUID', () => {
    // Never emit a broken link just because the shortener could not help.
    const url = publicSigningUrl('legacy-token-value', 'https://utahpros.app/x');
    expect(url).toBe('https://utahpros.app/sign/legacy-token-value');
  });

  it('keeps the dev host end to end', () => {
    expect(publicSigningUrl(TOKEN, 'https://dev.utahpros.app/x'))
      .toMatch(/^https:\/\/dev\.utahpros\.app\/s\/.+/);
  });
});
