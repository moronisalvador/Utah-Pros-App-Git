/**
 * ════════════════════════════════════════════════
 * FILE: provider-event-ops.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the provider-event repair endpoint is visible only to the active
 *   internal owner and can change only one exact failed event at a time.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./provider-event-ops.js
 *   Data:      none — authentication and database access are mocked
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null }));

vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));

import { onRequestGet, onRequestPost } from './provider-event-ops.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-key',
};

const EVENT_ID = '79d5a4cd-7c76-4944-82dd-a5dd4379be22';
const OWNER = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'admin',
  email: 'moroni@utah-pros.com',
  full_name: 'Moroni Salvador',
  is_active: true,
  is_external: false,
};
const FAILED_EVENT = {
  id: EVENT_ID,
  provider: 'callrail',
  direction: 'outbound',
  message_type: 'sms',
  error_code: 'CALLRAIL_OUTBOUND_UNMATCHED',
  processing_state: 'failed',
  processing_attempts: 8,
  sender_address: '385-360-4121',
  recipient_address: '385-314-5700',
  provider_message_id: 'SCI-test',
  received_at: '2026-07-27T00:06:01.266Z',
  next_attempt_at: null,
  resolved_at: null,
  outcome: 'processing_blocked',
  content: 'must never leave the server',
  raw_body_hash: 'must-never-leave-the-server',
};

function request(method = 'GET', body, token = 'valid-token', search = '') {
  return new Request(`https://app.test/api/provider-event-ops${search}`, {
    method,
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      Origin: 'https://app.test',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeDb(employee = OWNER, events = [FAILED_EVENT]) {
  return {
    select: vi.fn(async (table, query = '') => {
      if (table === 'employees') return employee ? [employee] : [];
      if (table !== 'message_provider_events') return [];
      if (query.includes(`id=eq.${EVENT_ID}`)) return events.filter((row) => row.id === EVENT_ID);
      return events;
    }),
    rpc: vi.fn(async (fn) => {
      if (fn === 'rearm_callrail_provider_event') {
        return [{ ...FAILED_EVENT, processing_state: 'received', processing_attempts: 0 }];
      }
      if (fn === 'resolve_provider_event') {
        return [{ ...FAILED_EVENT, resolved_at: '2026-07-29T15:00:00.000Z' }];
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    }),
  };
}

beforeEach(() => {
  h.db = makeDb();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ id: 'auth-user-1' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )));
});

describe('provider-event-ops authorization', () => {
  it('rejects a missing session before any provider-event read or write', async () => {
    const response = await onRequestGet({
      request: request('GET', undefined, null),
      env: ENV,
    });

    expect(response.status).toBe(401);
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...OWNER, role: 'office' }, 'Insufficient role'],
    [{ ...OWNER, email: 'another-admin@utah-pros.com' }, 'Insufficient role'],
    [{ ...OWNER, is_external: true }, 'External employees cannot manage provider events'],
  ])('rejects a non-owner identity before provider-event access', async (employee, error) => {
    h.db = makeDb(employee);

    const response = await onRequestGet({ request: request(), env: ENV });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error });
    expect(h.db.select).toHaveBeenCalledTimes(1);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });
});

describe('provider-event-ops read contract', () => {
  it('returns a bounded, no-store list without message content or raw payload data', async () => {
    const response = await onRequestGet({
      request: request('GET', undefined, 'valid-token', '?offset=0'),
      env: ENV,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      id: EVENT_ID,
      error_code: 'CALLRAIL_OUTBOUND_UNMATCHED',
    });
    expect(JSON.stringify(body)).not.toContain('must never leave the server');
    expect(h.db.select).toHaveBeenLastCalledWith(
      'message_provider_events',
      expect.stringContaining('select=id,provider,direction,message_type,error_code'),
    );
    expect(h.db.select).toHaveBeenLastCalledWith(
      'message_provider_events',
      expect.stringContaining('limit=51'),
    );
  });
});

describe('provider-event-ops mutation contract', () => {
  it('retries one exact failed event using the server-read error code', async () => {
    const response = await onRequestPost({
      request: request('POST', {
        action: 'retry',
        event_id: EVENT_ID,
        expected_error_code: 'CALLER_MUST_NOT_CONTROL_THIS',
      }),
      env: ENV,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: 'retry',
      event_id: EVENT_ID,
      changed: true,
    });
    expect(h.db.rpc).toHaveBeenCalledWith('rearm_callrail_provider_event', {
      p_event_id: EVENT_ID,
      p_expect_error_code: 'CALLRAIL_OUTBOUND_UNMATCHED',
    });
  });

  it('records the verified owner employee on one exact resolution', async () => {
    const response = await onRequestPost({
      request: request('POST', { action: 'resolve', event_id: EVENT_ID }),
      env: ENV,
    });

    expect(response.status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('resolve_provider_event', {
      p_event_id: EVENT_ID,
      p_resolved_by: OWNER.id,
    });
  });

  it('refuses to retry a row that is no longer failed', async () => {
    h.db = makeDb(OWNER, [{ ...FAILED_EVENT, processing_state: 'retryable' }]);

    const response = await onRequestPost({
      request: request('POST', { action: 'retry', event_id: EVENT_ID }),
      env: ENV,
    });

    expect(response.status).toBe(409);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('treats a concurrent no-op as an idempotent success', async () => {
    h.db.rpc.mockResolvedValueOnce([]);

    const response = await onRequestPost({
      request: request('POST', { action: 'resolve', event_id: EVENT_ID }),
      env: ENV,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      changed: false,
    });
  });
});
