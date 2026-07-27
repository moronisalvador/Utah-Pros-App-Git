/**
 * ════════════════════════════════════════════════
 * FILE: encircle-credential.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves a proposed Encircle key is checked before it can be saved, that
 *   failures never echo the key, and that the request we send is the one the
 *   real Encircle API actually accepts.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./encircle-credential.js
 *
 * NOTES / GOTCHAS:
 *   - The previous version of this suite MOCKED THE API INTO AGREEING WITH THE
 *     CODE: it asserted the URL was `/v1/organizations?limit=1` and returned a
 *     fabricated `name` field. Both were wrong, so the suite passed while the
 *     validator rejected every key in production. Measured 2026-07-26 with a
 *     known-good key:
 *         GET /v1/organizations         -> 200 {"list":[{"id":"<uuid>"}]}
 *         GET /v1/organizations?limit=1 -> 400 Unknown query parameter: `limit`
 *   - A mock is only as good as the shape it imitates. Every fixture below uses
 *     the measured shape. When Encircle's contract changes, re-probe and update
 *     the measurement comment with the date — do not adjust a fixture to make a
 *     failing test pass.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { validateEncircleCredential } from './encircle-credential.js';

// The exact live response shape, measured 2026-07-26. Note: no `name` field.
const LIVE_SHAPE = { list: [{ id: 'f87c96f8-ce68-422c-bc4a-44c01a928b79' }] };

const okFetcher = (body = LIVE_SHAPE) => vi.fn().mockResolvedValue(new Response(
  JSON.stringify(body),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
));

describe('validateEncircleCredential', () => {
  it('sends NO query parameter — the regression that rejected every key', async () => {
    const fetcher = okFetcher();
    await validateEncircleCredential('candidate-token', fetcher);

    const [url] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.encircleapp.com/v1/organizations');
    // The specific failure: `?limit=1` returns 400 from the live endpoint, so any
    // query string here makes the validator reject valid keys.
    expect(url).not.toContain('?');
    expect(url).not.toContain('limit');
  });

  it('accepts a valid candidate against the MEASURED live response shape', async () => {
    const fetcher = okFetcher();
    // The live endpoint returns only `id`, so organizationName is null. Asserting
    // null here is the point: a fabricated `name` is what hid the bug before.
    await expect(validateEncircleCredential('candidate-token', fetcher)).resolves.toEqual({
      organizationName: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.encircleapp.com/v1/organizations',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer candidate-token',
          'X-Encircle-Attribution': 'UtahProsRestorationApp',
        }),
      }),
    );
  });

  it('still surfaces a name if Encircle ever starts returning one', async () => {
    const fetcher = okFetcher({ list: [{ id: 'abc', name: 'Utah Pros Restoration' }] });
    await expect(validateEncircleCredential('candidate-token', fetcher)).resolves.toEqual({
      organizationName: 'Utah Pros Restoration',
    });
  });

  it('rejects an invalid candidate without echoing it', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'candidate-token is invalid' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(validateEncircleCredential('candidate-token', fetcher))
      .rejects.toThrow('Encircle rejected the candidate credential');
    await expect(validateEncircleCredential('candidate-token', fetcher))
      .rejects.not.toThrow(/candidate-token/);
  });

  it('distinguishes a 400 from a bad key, so a contract break is not blamed on the user', async () => {
    // A 400 means WE sent something the API does not accept — the exact case that
    // was misreported as a rejected credential for however long `?limit=1` shipped.
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Unknown query parameter: `limit`' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ));
    await expect(validateEncircleCredential('candidate-token', fetcher))
      .rejects.toThrow('Encircle could not process the validation request');
  });

  it('treats a transport failure as unavailable, not as a bad key', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('socket hang up'));
    await expect(validateEncircleCredential('candidate-token', fetcher))
      .rejects.toThrow('Encircle credential validation is temporarily unavailable');
  });

  it('requires a non-empty candidate', async () => {
    await expect(validateEncircleCredential('   ')).rejects.toThrow('Encircle credential is required');
  });
});
