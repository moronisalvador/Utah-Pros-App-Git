/**
 * ════════════════════════════════════════════════
 * FILE: encircle.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the separate owner automation worker follows the same Encircle key
 *   selection rules as the main app and immediately honors an emergency disable.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./encircle.js
 *   Data:      test fixtures only
 *
 * NOTES / GOTCHAS:
 *   - No real credential or network request is used.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEncircleCredentialCache, resolveEncircleApiKey } from './encircle.js';

beforeEach(() => {
  vi.restoreAllMocks();
  clearEncircleCredentialCache();
});

describe('upr-mcp Encircle managed credential parity', () => {
  it('uses an active managed token before the worker secret', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify([
      { access_token: 'managed', managed_status: 'active' },
    ]), { status: 200 }));

    await expect(resolveEncircleApiKey({
      SUPABASE_URL: 'https://db.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      ENCIRCLE_API_KEY: 'legacy',
    })).resolves.toEqual({ apiKey: 'managed', source: 'managed' });
  });

  it('uses the legacy secret only for fallback state and suppresses it when disabled', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { access_token: null, managed_status: 'fallback' },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { access_token: null, managed_status: 'disabled' },
      ]), { status: 200 }));

    const env = {
      SUPABASE_URL: 'https://db.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      ENCIRCLE_API_KEY: 'legacy',
    };
    await expect(resolveEncircleApiKey(env)).resolves.toEqual({
      apiKey: 'legacy', source: 'environment',
    });
    await expect(resolveEncircleApiKey(env)).resolves.toEqual({
      apiKey: undefined, source: 'disabled',
    });
  });
});
