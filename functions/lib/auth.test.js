/**
 * ════════════════════════════════════════════════
 * FILE: auth.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves an owner-only worker fails closed when its bounded Supabase Auth
 *   request times out, before it reads an employee row or performs work.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./auth.js
 *   Data:      reads/writes → none (all transport and database calls are fake)
 *
 * NOTES / GOTCHAS:
 *   - The injected rejecting transport models fetchWithTimeout aborting.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

import { requireOwner } from './auth.js';

describe('owner worker authorization transport', () => {
  it('fails closed on an Auth timeout before the employee lookup', async () => {
    const request = new Request('https://worker.test/api/private', {
      headers: { Authorization: 'Bearer test-session-token' },
    });
    const timedOutFetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('request timed out'), { name: 'TimeoutError' }),
    );
    const db = { select: vi.fn() };

    await expect(requireOwner(
      request,
      {
        SUPABASE_URL: 'https://project.test',
        SUPABASE_ANON_KEY: 'test-anon-key',
      },
      db,
      timedOutFetch,
    )).resolves.toEqual({
      error: 'Auth check failed',
      status: 502,
    });

    expect(timedOutFetch).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });
});
