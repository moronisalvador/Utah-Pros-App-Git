/**
 * ════════════════════════════════════════════════
 * FILE: encircle-credential.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Encircle key-management endpoint rejects callers before any key
 *   can be checked or saved. It covers missing sessions, inactive admins, wrong
 *   roles, and the default-off rollout switch.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./encircle-credential.js
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './encircle-credential.js';

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ENCIRCLE_API_KEY: 'legacy',
};

function request(body = { action: 'activate', candidate: 'new-token' }, token = 'jwt') {
  return new Request('https://app.test/api/encircle-credential', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.restoreAllMocks());

describe('encircle credential authorization and dark gate', () => {
  it('returns 401 without a session before provider validation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await onRequestPost({ request: request({}, null), env });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive admin', { role: 'admin', is_active: false }],
    ['wrong role', { role: 'technician', is_active: true }],
  ])('returns 403 for %s before provider validation', async (_label, employee) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'emp-1', ...employee }]), { status: 200 }));

    const res = await onRequestPost({ request: request(), env });
    expect(res.status).toBe(403);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when the rollout flag is absent/off', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'emp-1', role: 'admin', is_active: true,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const res = await onRequestPost({ request: request(), env });
    expect(res.status).toBe(404);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not persist a candidate rejected by Encircle', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'emp-1', role: 'admin', is_active: true,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        enabled: true, dev_only_user_id: null,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'invalid' }), { status: 401 }));

    const res = await onRequestPost({ request: request(), env });
    expect(res.status).toBe(422);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    expect(await res.text()).not.toContain('new-token');
  });

  it('validates first, then persists without returning the candidate', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'emp-1', role: 'admin', is_active: true,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        enabled: true, dev_only_user_id: null,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        list: [{ id: 42, name: 'UPR' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        provider: 'encircle',
      }]), { status: 201 }));

    const res = await onRequestPost({ request: request(), env });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    expect(await res.text()).not.toContain('new-token');

    const validationUrl = globalThis.fetch.mock.calls[3][0];
    const persistenceUrl = globalThis.fetch.mock.calls[4][0];
    expect(String(validationUrl)).toContain('api.encircleapp.com');
    expect(String(persistenceUrl)).toContain('/rest/v1/integration_credentials');
  });
});
