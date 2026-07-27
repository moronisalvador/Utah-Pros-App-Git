/**
 * Worker authorization coverage for the only legitimate employees writer.
 * All denied identities must stop after Supabase Auth plus the employee lookup;
 * no Auth Admin API or employee mutation may occur.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  onRequestDelete,
  onRequestPatch,
  onRequestPost,
  onRequestPut,
} from './admin-users.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

function request(method, body = {}, token = 'valid-token') {
  return new Request('https://app.test/api/admin-users', {
    method,
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      Origin: 'https://app.test',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockIdentity(employee = {
  id: 'employee-1',
  role: 'admin',
  is_active: true,
  is_external: false,
}) {
  const calls = [];
  const fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) {
      return json({ id: 'auth-user-1' });
    }
    if (String(url).includes('/rest/v1/employees?auth_user_id=eq.auth-user-1')) {
      return json(employee ? [employee] : []);
    }
    throw new Error(`unexpected downstream call: ${options.method || 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('admin-users authorization', () => {
  it('rejects a missing session before any service-role access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      request: request('POST', {}, null),
      env: ENV,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Missing Authorization header',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid session before employee or admin access', async () => {
    const fetchMock = vi.fn(async () => json({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      request: request('POST'),
      env: ENV,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Invalid or expired token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, 'Not an employee'],
    [
      {
        id: 'employee-1',
        role: 'admin',
        is_active: false,
        is_external: false,
      },
      'Inactive employee',
    ],
    [
      {
        id: 'employee-1',
        role: 'field_tech',
        is_active: true,
        is_external: false,
      },
      'Insufficient role',
    ],
    [
      {
        id: 'employee-1',
        role: 'admin',
        is_active: true,
        is_external: true,
      },
      'External employees cannot manage users',
    ],
  ])('denies %s before an Auth Admin or employee write', async (employee, error) => {
    const { calls } = mockIdentity(employee);

    const response = await onRequestPost({
      request: request('POST'),
      env: ENV,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://db.test/auth/v1/user');
    expect(calls[0].options.headers.apikey).toBe('anon-key');
    expect(calls[1].url).toContain(
      '/rest/v1/employees?auth_user_id=eq.auth-user-1',
    );
    expect(calls[1].url).toContain(
      'select=id,full_name,email,role,is_active,is_external',
    );
    expect(calls[1].options.headers.Authorization).toBe(
      'Bearer service-key',
    );
  });

  it.each([
    ['PATCH', onRequestPatch],
    ['PUT', onRequestPut],
    ['DELETE', onRequestDelete],
  ])(
    'denies an external admin on %s before the method-specific mutation',
    async (method, handler) => {
      const { calls } = mockIdentity({
        id: 'employee-1',
        role: 'admin',
        is_active: true,
        is_external: true,
      });

      const response = await handler({
        request: request(method),
        env: ENV,
      });

      expect(response.status).toBe(403);
      expect(calls).toHaveLength(2);
    },
  );

  it('allows only an active internal admin to reach request validation', async () => {
    const { calls } = mockIdentity();

    const response = await onRequestPost({
      request: request('POST'),
      env: ENV,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Email is required' });
    expect(calls).toHaveLength(2);
  });
});
