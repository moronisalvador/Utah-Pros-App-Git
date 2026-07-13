/**
 * ════════════════════════════════════════════════
 * FILE: phase0-security-gates.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the UX-Quality Phase 0 hardening actually closed the holes: the
 *   Encircle proxy endpoints and the media-purge endpoint now reject callers
 *   with no valid session/secret, and the instant-payout endpoint refuses a
 *   request with no login. Each check exercises the real request handler and
 *   asserts the unauthenticated request is turned away (401) BEFORE any external
 *   call or side effect runs.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  the worker handlers under test
 *
 * NOTES / GOTCHAS:
 *   - The no-auth path short-circuits before any fetch / DB / Stripe call, so
 *     these tests need no network mocks and no service key.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { onRequestGet as encircleSearch } from './encircle-search.js';
import { onRequestGet as encircleRooms } from './encircle-rooms.js';
import { onRequestPost as encircleUpload } from './encircle-upload.js';
import { onRequestGet as purgeMedia } from './purge-feedback-media.js';
import { onRequestPost as stripePayout } from './stripe-payout.js';

const req = (url, init) => new Request(url, init);

describe('Phase 0 — Encircle proxies require a Supabase session', () => {
  it('encircle-search returns 401 without a Bearer token', async () => {
    const res = await encircleSearch({ request: req('https://x/api/encircle-search?policyholder_name=a'), env: {} });
    expect(res.status).toBe(401);
  });

  it('encircle-rooms returns 401 without a Bearer token', async () => {
    const res = await encircleRooms({ request: req('https://x/api/encircle-rooms?claim_id=1'), env: {} });
    expect(res.status).toBe(401);
  });

  it('encircle-upload (mutating) returns 401 without a Bearer token', async () => {
    const res = await encircleUpload({
      request: req('https://x/api/encircle-upload', { method: 'POST', body: '{}' }),
      env: {},
    });
    expect(res.status).toBe(401);
  });
});

describe('Phase 0 — media purge requires the scheduler secret', () => {
  it('returns 401 without the x-webhook-secret header', async () => {
    const res = await purgeMedia({ request: req('https://x/api/purge-feedback-media?days=0'), env: {} });
    expect(res.status).toBe(401);
  });
});

describe('Phase 0 — instant payout requires a billing role', () => {
  it('returns 401 without a Bearer token (Stripe configured)', async () => {
    const res = await stripePayout({
      request: req('https://x/api/stripe-payout', { method: 'POST', body: '{}' }),
      env: { STRIPE_SECRET_KEY: 'sk_test_placeholder' },
    });
    expect(res.status).toBe(401);
  });

  it('still returns 503 when Stripe is not configured (unchanged)', async () => {
    const res = await stripePayout({
      request: req('https://x/api/stripe-payout', { method: 'POST', body: '{}' }),
      env: {},
    });
    expect(res.status).toBe(503);
  });
});
