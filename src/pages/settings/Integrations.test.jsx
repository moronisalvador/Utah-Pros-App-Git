/**
 * ════════════════════════════════════════════════
 * FILE: Integrations.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the page half of the QuickBooks OAuth round-trip: when the callback
 *   worker sends the browser back to /settings/integrations with ?qbo=…, the
 *   page turns that param into the right toast (connected → success, bad state /
 *   error → the correct error message). Pairs with quickbooks-callback.test.js,
 *   which asserts the worker's redirect target.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  @/pages/settings/Integrations (qboReturnToast — pure helper)
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

// The page imports the Supabase-backed auth/realtime client at module eval; this
// test only exercises the pure qboReturnToast helper, so stub those seams (vi.mock
// is hoisted above the import) to avoid needing live Supabase env vars.
vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: {} }) }));

import { qboReturnToast } from '@/pages/settings/Integrations';

describe('qboReturnToast (?qbo= return handler)', () => {
  it('returns null when there is no qbo param', () => {
    expect(qboReturnToast('')).toBeNull();
    expect(qboReturnToast('?foo=bar')).toBeNull();
  });

  it('maps connected → success toast', () => {
    expect(qboReturnToast('?qbo=connected')).toEqual({ type: 'success', message: 'QuickBooks connected' });
  });

  it('maps badstate → the state-mismatch error', () => {
    expect(qboReturnToast('?qbo=badstate')).toEqual({
      type: 'error',
      message: 'QuickBooks connect failed: state mismatch — try again',
    });
  });

  it('maps error (and any other value) → a generic error, appending msg when present', () => {
    expect(qboReturnToast('?qbo=error')).toEqual({ type: 'error', message: 'QuickBooks connect failed' });
    expect(qboReturnToast('?qbo=error&msg=token%20expired')).toEqual({
      type: 'error',
      message: 'QuickBooks connect failed: token expired',
    });
  });
});
