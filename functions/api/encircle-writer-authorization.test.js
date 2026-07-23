/**
 * ════════════════════════════════════════════════
 * FILE: encircle-writer-authorization.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Encircle service-role writers reject callers outside their
 *   server-side capability boundary before any Encircle or database mutation.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  encircle-import.js, encircle-backfill.js, sync-encircle.js,
 *              sync-claim-to-encircle.js
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  onRequestPost as importEncircle,
} from './encircle-import.js';
import {
  onRequestPost as backfillEncircle,
} from './encircle-backfill.js';
import {
  onRequestPost as syncEncircle,
} from './sync-encircle.js';
import {
  onRequestPost as syncClaimToEncircle,
} from './sync-claim-to-encircle.js';
import {
  onRequestGet as searchEncircle,
} from './encircle-search.js';

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ENCIRCLE_API_KEY: 'legacy-encircle-key',
};

function request(path, body = {}) {
  return new Request(`https://app.test/api/${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function mockEmployee(employee) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{
      id: 'employee-1',
      role: 'field_tech',
      is_active: true,
      ...employee,
    }]), { status: 200 }));
}

beforeEach(() => vi.restoreAllMocks());

describe('Encircle privileged writer authorization', () => {
  it.each([
    ['manual import', importEncircle, 'encircle-import', { action: 'import' }],
    ['historical backfill', backfillEncircle, 'encircle-backfill', {}],
    ['legacy bulk sync', syncEncircle, 'sync-encircle', {}],
  ])('rejects a field technician from %s before side effects', async (
    _label,
    handler,
    path,
    body,
  ) => {
    const fetchSpy = mockEmployee();
    const res = await handler({ request: request(path, body), env });

    expect(res.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects an inactive technician from the new-job claim sync', async () => {
    const fetchSpy = mockEmployee({ is_active: false });
    const res = await syncClaimToEncircle({
      request: request('sync-claim-to-encircle', { claim_id: 'claim-1' }),
      env,
    });

    expect(res.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-owner active admin from historical backfill', async () => {
    const fetchSpy = mockEmployee({
      role: 'admin',
      email: 'another-admin@utah-pros.com',
    });
    const res = await backfillEncircle({
      request: request('encircle-backfill'),
      env,
    });

    expect(res.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps Scope Sheet Encircle search available to an active field technician', async () => {
    const fetchSpy = mockEmployee()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const res = await searchEncircle({
      request: new Request(
        'https://app.test/api/encircle-search?policyholder_name=smith',
        { headers: { Authorization: 'Bearer jwt' } },
      ),
      env,
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
