import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: null,
  apiKey: null,
  discover: null,
}));

vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/callrail-messaging.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveCallRailApiKey: (...args) => h.apiKey(...args),
  };
});
vi.mock('../lib/callrail-api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    discoverCallRailMessagingOptions: (...args) => h.discover(...args),
  };
});

import { onRequestGet } from './messaging-setup.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-key',
  CF_PAGES_BRANCH: 'dev',
  MESSAGING_SCHEMA_MODE: 'foundation',
  MESSAGING_SEND_MODE: 'disabled',
};

function request(path = '/api/messaging-setup', token = 'valid-token') {
  return new Request(`https://app.test${path}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      Origin: 'https://app.test',
    },
  });
}

function makeDb(employee = {
  id: 'employee-1',
  role: 'admin',
  email: 'admin@test.invalid',
  is_active: true,
  is_external: false,
}) {
  const calls = [];
  return {
    calls,
    select: vi.fn(async (table, query = '') => {
      calls.push({ table, query });
      if (table === 'employees') return employee ? [employee] : [];
      if (table === 'integration_config') return [{ value: 'ACC1' }];
      return [];
    }),
  };
}

beforeEach(() => {
  h.db = makeDb();
  h.apiKey = vi.fn(async () => 'stored-key');
  h.discover = vi.fn(async () => []);
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'auth-user-1' }),
  })));
});

describe('messaging-setup authorization', () => {
  it('rejects a missing session before database setup reads', async () => {
    const response = await onRequestGet({ request: request('/api/messaging-setup', null), env: ENV });

    expect(response.status).toBe(401);
    expect(h.db.calls).toEqual([]);
    expect(h.apiKey).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'Not an employee'],
    [{ id: 'x', role: 'admin', is_active: false, is_external: false }, 'Inactive employee'],
    [{ id: 'x', role: 'technician', is_active: true, is_external: false }, 'Insufficient role'],
    [{ id: 'x', role: 'admin', is_active: true, is_external: true }, 'External employees cannot manage integrations'],
  ])('rejects an unauthorized employee before credential/provider access', async (employee, error) => {
    h.db = makeDb(employee);

    const response = await onRequestGet({ request: request(), env: ENV });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error });
    expect(h.apiKey).not.toHaveBeenCalled();
    expect(h.discover).not.toHaveBeenCalled();
  });
});

describe('messaging-setup authorized contracts', () => {
  it('returns no-store redacted status without provider access', async () => {
    const response = await onRequestGet({ request: request(), env: ENV });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.transport).toEqual(expect.objectContaining({
      send_mode: 'disabled',
      mode_mutable_in_app: false,
    }));
    expect(body.callrail.credential_configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain('stored-key');
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.db.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'message_provider_events',
        query: expect.stringContaining('processing_state=in.(received,claimed,retryable)'),
      }),
      expect.objectContaining({
        table: 'message_provider_events',
        query: expect.stringContaining('processing_state=eq.failed'),
      }),
      expect.objectContaining({
        table: 'message_send_attempts',
        query: expect.stringContaining('state=eq.ambiguous'),
      }),
      expect.objectContaining({
        table: 'message_notification_outbox',
        query: expect.stringContaining('delivery_state=in.(pending,processing,retryable)'),
      }),
      expect.objectContaining({
        table: 'message_notification_outbox',
        query: expect.stringContaining('delivery_state=eq.dead_letter'),
      }),
    ]));
  });

  it('performs read-only eligible-number discovery with the stored credential', async () => {
    h.discover = vi.fn(async () => [{
      id: 'COM1',
      name: 'Utah Pros',
      senders: [{ option_id: 'opaque', tracking_number: '+18015550100' }],
    }]);

    const response = await onRequestGet({
      request: request('/api/messaging-setup?action=callrail-options'),
      env: ENV,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.companies).toHaveLength(1);
    expect(h.discover).toHaveBeenCalledWith('stored-key', { accountId: 'ACC1' });
    expect(h.db.calls.every((call) => (
      call.table === 'employees'
      || call.table === 'integration_credentials'
      || call.table === 'integration_config'
    ))).toBe(true);
  });

  it('verifies only an exact configured company and sender pair', async () => {
    h.discover = vi.fn(async () => [{
      id: 'COM1',
      name: 'Utah Pros',
      senders: [{
        option_id: 'opaque',
        tracker_id: 'TRK1',
        tracking_number: '+18015550100',
      }],
    }]);

    const response = await onRequestGet({
      request: request('/api/messaging-setup?action=callrail-options'),
      env: {
        ...ENV,
        CALLRAIL_COMPANY_ID: 'COM1',
        CALLRAIL_TRACKING_NUMBER: '(801) 555-0100',
      },
    });
    const body = await response.json();

    expect(body.complete).toBe(true);
    expect(body.configured_sender_verified).toBe(true);
    expect(body.companies[0].senders[0].configured).toBe(true);
  });

  it('rejects unknown actions before provider access', async () => {
    const response = await onRequestGet({
      request: request('/api/messaging-setup?action=activate'),
      env: ENV,
    });

    expect(response.status).toBe(400);
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.apiKey).not.toHaveBeenCalled();
  });

  it('does not call discovery when no credential is configured', async () => {
    h.apiKey = vi.fn(async () => null);

    const response = await onRequestGet({
      request: request('/api/messaging-setup?action=callrail-options'),
      env: ENV,
    });

    expect(response.status).toBe(409);
    expect(h.discover).not.toHaveBeenCalled();
  });
});
