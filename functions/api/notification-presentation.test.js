/**
 * ════════════════════════════════════════════════
 * FILE: notification-presentation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the notification presentation Settings Worker denies unauthorized
 *   callers before configuration access, previews without writes/sends, and
 *   performs only the audited service-role mutation RPC.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./notification-presentation.js
 *   Data:      fakes only; no database or provider
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleNotificationPresentation,
} from './notification-presentation.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-key',
};

function request({
  method = 'GET',
  path = '/api/notification-presentation?action=catalog',
  token = 'valid-token',
  body,
} = {}) {
  return new Request(`https://app.test${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeDb(employee = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'admin',
  is_active: true,
  is_external: false,
}) {
  const calls = [];
  return {
    calls,
    select: vi.fn(async (table) => {
      calls.push({ kind: 'select', table });
      if (table === 'employees') return employee ? [employee] : [];
      if (table === 'notification_types') {
        return [{
          type_key: 'estimate.accepted',
          label: 'Estimate accepted',
          description: 'An estimate was accepted.',
          category: 'billing',
          audience: 'Admins',
          enabled: true,
          sort_order: 30,
        }];
      }
      return [];
    }),
    rpc: vi.fn(async (fn, params) => {
      calls.push({ kind: 'rpc', fn, params });
      return { revision: 1, config: params.p_config, replayed: false };
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'auth-user-1' }),
  })));
});

describe('notification presentation authorization', () => {
  it('rejects a missing session before any database access', async () => {
    const db = makeDb();
    const result = await handleNotificationPresentation({
      request: request({ token: null }),
      env: ENV,
      db,
    });

    expect(result.status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it.each([
    [null],
    [{ id: 'e1', role: 'admin', is_active: false, is_external: false }],
    [{ id: 'e1', role: 'office', is_active: true, is_external: false }],
    [{ id: 'e1', role: 'admin', is_active: true, is_external: true }],
  ])('denies unauthorized employees before presentation access', async (employee) => {
    const db = makeDb(employee);
    const result = await handleNotificationPresentation({
      request: request(),
      env: ENV,
      db,
    });

    expect(result.status).toBe(403);
    expect(db.calls.map((call) => call.table).filter(Boolean)).toEqual(['employees']);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('notification presentation contracts', () => {
  it('returns only code-catalog events that exist in notification_types', async () => {
    const db = makeDb();
    const result = await handleNotificationPresentation({
      request: request(),
      env: ENV,
      db,
    });

    expect(result.status).toBe(200);
    expect(result.data.events).toHaveLength(1);
    expect(result.data.events[0]).toMatchObject({
      type_key: 'estimate.accepted',
      label: 'Estimate accepted',
    });
    expect(result.data.events[0].surfaces.native_push.variables.map(({ key }) => key))
      .toEqual(['estimate_number', 'amount', 'customer_name']);
  });

  it('previews synthetic data without configuration reads, RPCs, or providers', async () => {
    const db = makeDb();
    const result = await handleNotificationPresentation({
      request: request({
        method: 'POST',
        body: {
          action: 'preview',
          type_key: 'estimate.accepted',
          surface: 'bell',
          config: {
            title_template: 'Estimate {{estimate_number}} accepted',
            body_template: '{{customer_name}} approved {{amount}}',
            route_id: 'estimate.detail',
            contract_version: 1,
          },
        },
      }),
      env: ENV,
      db,
    });

    expect(result).toMatchObject({
      status: 200,
      data: {
        presentation: {
          title: 'Estimate EST-1042 accepted',
          body: 'Jordan Lee approved $1,250.00',
          url: '/estimates/estimate-demo',
        },
      },
    });
    expect(db.calls.map((call) => call.table).filter(Boolean)).toEqual(['employees']);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('allows typed native details but rejects arbitrary routes', async () => {
    const db = makeDb();
    const preview = await handleNotificationPresentation({
      request: request({
        method: 'POST',
        body: {
          action: 'preview',
          type_key: 'estimate.accepted',
          surface: 'native_push',
          config: {
            title_template: 'Estimate {{estimate_number}} accepted',
            body_template: '{{customer_name}} approved {{amount}}',
            route_id: 'field.home',
            contract_version: 1,
          },
        },
      }),
      env: ENV,
      db,
    });
    expect(preview).toMatchObject({
      status: 200,
      data: {
        presentation: {
          title: 'Estimate EST-1042 accepted',
          body: 'Jordan Lee approved $1,250.00',
          url: '/',
        },
      },
    });

    const rejected = await handleNotificationPresentation({
      request: request({
        method: 'POST',
        body: {
          action: 'preview',
          type_key: 'estimate.accepted',
          surface: 'native_push',
          config: {
            title_template: 'Jordan accepted $1,250',
            body_template: 'Open https://evil.test',
            route_id: 'https://evil.test',
            contract_version: 1,
          },
        },
      }),
      env: ENV,
      db,
    });

    expect(rejected.status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('saves through the one audited RPC with actor and revision identity', async () => {
    const db = makeDb();
    const body = {
      action: 'save',
      type_key: 'estimate.accepted',
      surface: 'bell',
      config: {
        title_template: 'Estimate {{estimate_number}} accepted',
        body_template: '{{customer_name}} approved {{amount}}',
        route_id: 'estimate.detail',
        contract_version: 1,
      },
      expected_revision: 0,
      request_id: '00000000-0000-4000-8000-000000000010',
    };
    const result = await handleNotificationPresentation({
      request: request({ method: 'POST', body }),
      env: ENV,
      db,
    });

    expect(result.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('mutate_notification_presentation', {
      p_actor_id: '00000000-0000-4000-8000-000000000001',
      p_type_key: 'estimate.accepted',
      p_surface: 'bell',
      p_action: 'save',
      p_config: body.config,
      p_expected_revision: 0,
      p_request_id: '00000000-0000-4000-8000-000000000010',
    });
  });

  it('rejects malformed request ids before the mutation RPC', async () => {
    const db = makeDb();
    const result = await handleNotificationPresentation({
      request: request({
        method: 'POST',
        body: {
          action: 'reset',
          type_key: 'estimate.accepted',
          surface: 'bell',
          expected_revision: 0,
          request_id: 'not-a-uuid',
        },
      }),
      env: ENV,
      db,
    });

    expect(result).toEqual({
      status: 400,
      data: { error: 'Invalid mutation identity' },
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('fails closed before database access when the auth lookup times out', async () => {
    const db = makeDb();
    const result = await handleNotificationPresentation({
      request: request(),
      env: ENV,
      db,
      fetchImpl: vi.fn(async () => {
        throw new DOMException('Timed out', 'TimeoutError');
      }),
    });

    expect(result).toEqual({
      status: 502,
      data: { error: 'Auth check failed' },
    });
    expect(db.calls).toEqual([]);
  });

  it('returns a revision conflict without discarding the client draft', async () => {
    const db = makeDb();
    db.rpc.mockRejectedValueOnce(new Error('REVISION_CONFLICT'));
    const result = await handleNotificationPresentation({
      request: request({
        method: 'POST',
        body: {
          action: 'reset',
          type_key: 'estimate.accepted',
          surface: 'bell',
          expected_revision: 2,
          request_id: '00000000-0000-4000-8000-000000000011',
        },
      }),
      env: ENV,
      db,
    });

    expect(result).toEqual({
      status: 409,
      data: { error: 'Another administrator saved a newer revision' },
    });
  });
});
