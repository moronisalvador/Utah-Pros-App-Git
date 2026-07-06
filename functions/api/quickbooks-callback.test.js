/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-callback.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QuickBooks OAuth callback worker sends the browser back to the
 *   NEW home of the connect UI — Settings → Integrations — after Intuit
 *   authorizes (or errors). This is the worker half of the P2 atomic round-trip:
 *   the worker redirect target and the page that reads the ?qbo= param must
 *   agree, and they moved together off the retired /dev-tools tab.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./quickbooks-callback.js (buildReturnLocation, appBaseFrom,
 *              QBO_RETURN_PATH — the pure redirect helpers)
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test of the redirect-target contract. The token exchange /
 *     saveTokens path is not exercised here (it hits Intuit + Supabase).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { buildReturnLocation, appBaseFrom, QBO_RETURN_PATH } from './quickbooks-callback.js';

describe('quickbooks-callback redirect target (P2 retarget)', () => {
  it('returns to /settings/integrations, not the retired /dev-tools tab', () => {
    expect(QBO_RETURN_PATH).toBe('/settings/integrations');
    const loc = buildReturnLocation('https://dev.utahpros.app', 'connected');
    expect(loc).toBe('https://dev.utahpros.app/settings/integrations?qbo=connected');
    expect(loc).not.toContain('/dev-tools');
  });

  it('carries the qbo status through each return state', () => {
    for (const status of ['connected', 'error', 'badstate']) {
      const loc = buildReturnLocation('https://app.test', status);
      expect(loc).toBe(`https://app.test/settings/integrations?qbo=${status}`);
    }
  });

  it('appends a truncated msg (≤200 chars) only when provided', () => {
    expect(buildReturnLocation('https://app.test', 'error')).not.toContain('msg=');

    const long = 'x'.repeat(500);
    const loc = buildReturnLocation('https://app.test', 'error', long);
    const msg = new URL(loc).searchParams.get('msg');
    expect(msg).toHaveLength(200);
    expect(new URL(loc).pathname).toBe('/settings/integrations');
  });

  it('appBaseFrom prefers APP_BASE_URL, else the redirect-URI origin', () => {
    expect(appBaseFrom({ APP_BASE_URL: 'https://utahpros.app' })).toBe('https://utahpros.app');
    expect(appBaseFrom({ QBO_REDIRECT_URI: 'https://dev.utahpros.app/api/quickbooks-callback' }))
      .toBe('https://dev.utahpros.app');
    expect(appBaseFrom({})).toBe('https://dev.utahpros.app');
  });
});
