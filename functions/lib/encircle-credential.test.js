/**
 * ════════════════════════════════════════════════
 * FILE: encircle-credential.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves a proposed Encircle key is checked before it can be saved. It also
 *   proves failures are reduced to safe messages that never echo the key.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./encircle-credential.js
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { validateEncircleCredential } from './encircle-credential.js';

describe('validateEncircleCredential', () => {
  it('accepts a token only after a successful read-only organization request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ list: [{ id: 42, name: 'UPR' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(validateEncircleCredential('candidate-token', fetcher)).resolves.toEqual({
      organizationName: 'UPR',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.encircleapp.com/v1/organizations?limit=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer candidate-token' }),
      }),
    );
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
});
