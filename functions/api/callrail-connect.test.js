/**
 * ════════════════════════════════════════════════
 * FILE: callrail-connect.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that only a currently active administrator can view or change the
 *   CallRail connection. It also checks that successful responses keep their
 *   existing shapes and never reveal the saved or newly submitted API key.
 *
 * HOW TO RUN:
 *   `npm test -- --run functions/api/callrail-connect.test.js`
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/callrail-connect.js
 *
 * NOTES / GOTCHAS:
 *   - Supabase and CallRail account discovery are mocked. The global fetch
 *     stub represents Supabase Auth's /user response; no provider is called.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, resolveAccountId: null }));

vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/callrail-api.js', () => ({
  resolveCallRailAccountId: (...args) => h.resolveAccountId(...args),
}));

import {
  onRequestDelete,
  onRequestGet,
  onRequestPost,
} from './callrail-connect.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  PAGES_URL: 'https://app.test',
};

function request({ token = 'valid-token', body = {} } = {}) {
  return {
    headers: {
      get: (name) => {
        if (name === 'Authorization') return token ? `Bearer ${token}` : null;
        if (name === 'Origin') return 'https://app.test';
        return null;
      },
    },
    json: async () => body,
  };
}

function makeDb({
  employee = {
    id: 'employee-1',
    full_name: 'Admin',
    email: 'admin@test.invalid',
    role: 'admin',
    is_active: true,
    is_external: false,
  },
  isActive = true,
  webhookSecret = 'webhook-secret',
} = {}) {
  const calls = [];
  return {
    calls,
    select: vi.fn(async (table, query = '') => {
      calls.push({ method: 'select', table, query });
      if (table === 'employees' && query.includes('auth_user_id=')) {
        return employee ? [employee] : [];
      }
      if (table === 'employees' && query.includes('is_active=eq.true')) {
        return isActive ? [{ id: employee.id }] : [];
      }
      if (table === 'integration_config' && query.includes('callrail_webhook_secret')) {
        return webhookSecret ? [{ value: webhookSecret }] : [];
      }
      return [];
    }),
    insert: vi.fn(async (table, payload) => {
      calls.push({ method: 'insert', table, payload });
      return [{ ...payload }];
    }),
    upsert: vi.fn(async (table, payload) => {
      calls.push({ method: 'upsert', table, payload });
      return [{ ...payload }];
    }),
    delete: vi.fn(async (table, query) => {
      calls.push({ method: 'delete', table, query });
      return null;
    }),
  };
}

const HANDLERS = [
  ['GET', onRequestGet, () => request()],
  ['POST', onRequestPost, () => request({ body: { api_key: 'submitted-key' } })],
  ['DELETE', onRequestDelete, () => request()],
];

beforeEach(() => {
  h.resolveAccountId = vi.fn(async () => 'account-1');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'auth-user-1' }),
  })));
});

describe.each(HANDLERS)('callrail-connect %s authorization', (_method, handler, makeRequest) => {
  it('rejects a missing session before reading integration configuration', async () => {
    h.db = makeDb();

    const res = await handler({ request: request({ token: null }), env: ENV });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Missing Authorization header' });
    expect(h.db.calls).toEqual([]);
  });

  it('rejects an invalid session before reading integration configuration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    h.db = makeDb();

    const res = await handler({ request: makeRequest(), env: ENV });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid or expired token' });
    expect(h.db.calls).toEqual([]);
  });

  it('rejects an auth user with no employee membership', async () => {
    h.db = makeDb({ employee: null });

    const res = await handler({ request: makeRequest(), env: ENV });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not an employee' });
    expect(h.db.calls).toHaveLength(1);
  });

  it('rejects an inactive admin before reading integration configuration', async () => {
    h.db = makeDb({
      employee: {
        id: 'employee-1',
        full_name: 'Admin',
        email: 'admin@test.invalid',
        role: 'admin',
        is_active: false,
        is_external: false,
      },
      isActive: false,
    });

    const res = await handler({ request: makeRequest(), env: ENV });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Inactive employee' });
    expect(h.db.calls).toHaveLength(1);
  });

  it('rejects an external admin before reading integration configuration', async () => {
    h.db = makeDb({
      employee: {
        id: 'employee-external',
        full_name: 'External Admin',
        email: 'external@test.invalid',
        role: 'admin',
        is_active: true,
        is_external: true,
      },
    });

    const res = await handler({ request: makeRequest(), env: ENV });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'External employees cannot manage integrations',
    });
    expect(h.db.calls).toHaveLength(1);
  });

  it('rejects an active non-admin before reading integration configuration', async () => {
    h.db = makeDb({
      employee: {
        id: 'employee-2',
        full_name: 'Technician',
        email: 'tech@test.invalid',
        role: 'technician',
        is_active: true,
        is_external: false,
      },
    });

    const res = await handler({ request: makeRequest(), env: ENV });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Insufficient role' });
    expect(h.db.calls).toHaveLength(1);
  });
});

describe('callrail-connect authorized contracts', () => {
  it('GET returns the existing secret-only contract to an active admin', async () => {
    h.db = makeDb();

    const res = await onRequestGet({ request: request(), env: ENV });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ secret: 'webhook-secret' });
    expect(JSON.stringify(data)).not.toContain('api_key');
    expect(JSON.stringify(data)).not.toContain('access_token');
  });

  it('POST stores the key but returns only the existing connected/secret contract', async () => {
    h.db = makeDb();

    const res = await onRequestPost({
      request: request({ body: { api_key: 'submitted-key' } }),
      env: ENV,
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ connected: true, secret: 'webhook-secret' });
    expect(JSON.stringify(data)).not.toContain('submitted-key');
    expect(h.db.upsert).toHaveBeenCalledWith(
      'integration_credentials',
      expect.objectContaining({
        provider: 'callrail',
        access_token: 'submitted-key',
        connected_by: 'employee-1',
      }),
    );
  });

  it('DELETE keeps the existing disconnected contract for an active admin', async () => {
    h.db = makeDb();

    const res = await onRequestDelete({ request: request(), env: ENV });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ disconnected: true });
    expect(h.db.delete).toHaveBeenCalledWith(
      'integration_credentials',
      'provider=eq.callrail',
    );
  });
});
