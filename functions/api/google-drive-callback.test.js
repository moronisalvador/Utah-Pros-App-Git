/**
 * ════════════════════════════════════════════════
 * FILE: google-drive-callback.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Google OAuth callback worker sends the browser back to
 *   /settings/my-account (not the old /settings) on every outcome — a
 *   successful connect, a state mismatch, a missing code, and an upstream
 *   error. Settings Overhaul P4 retargeted this redirect once the Google
 *   panel moved off the old Settings.jsx monolith onto its own route.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/google-drive-callback.js (mocks ../lib/supabase.js
 *              and ../lib/google-drive.js)
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/google-drive.js', () => ({
  exchangeCodeForTokens: vi.fn(async () => ({ access_token: 'tok', refresh_token: 'rtok' })),
  fetchUserEmail: vi.fn(async () => 'tech@utah-pros.com'),
  saveTokens: vi.fn(async () => {}),
}));

vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    select: vi.fn(async (table, query) => {
      if (query.includes('gdrive_oauth_state')) return [{ value: 'expected-state' }];
      if (query.includes('gdrive_oauth_user')) return [{ value: 'employee-1' }];
      return [];
    }),
    delete: vi.fn(async () => null),
  }),
}));

import { onRequestGet } from './google-drive-callback.js';

const env = { APP_BASE_URL: 'https://dev.utahpros.app' };

function reqUrl(params) {
  return { url: `https://dev.utahpros.app/api/google-drive-callback?${new URLSearchParams(params)}` };
}

describe('google-drive-callback onRequestGet', () => {
  it('redirects to /settings/my-account on a successful connect', async () => {
    const res = await onRequestGet({ request: reqUrl({ code: 'abc', state: 'expected-state' }), env });
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location');
    expect(loc).toContain('/settings/my-account?');
    expect(loc).toContain('gdrive=connected');
  });

  it('redirects to /settings/my-account on a state mismatch', async () => {
    const res = await onRequestGet({ request: reqUrl({ code: 'abc', state: 'wrong-state' }), env });
    const loc = res.headers.get('Location');
    expect(loc).toContain('/settings/my-account?');
    expect(loc).toContain('gdrive=badstate');
  });

  it('redirects to /settings/my-account on a missing code', async () => {
    const res = await onRequestGet({ request: reqUrl({}), env });
    const loc = res.headers.get('Location');
    expect(loc).toContain('/settings/my-account?');
    expect(loc).toContain('gdrive=error');
  });

  it('redirects to /settings/my-account when Google reports an upstream error', async () => {
    const res = await onRequestGet({ request: reqUrl({ error: 'access_denied' }), env });
    const loc = res.headers.get('Location');
    expect(loc).toContain('/settings/my-account?');
    expect(loc).toContain('gdrive=error');
  });
});
