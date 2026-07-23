import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(async () => undefined),
}));

import {
  onRequestPost,
  recoverMessageSendAttempts,
} from './recover-message-send-attempts.js';

function createDb({
  attempts = [{ id: 'attempt-1' }],
  secret = 'cron-secret',
  projections = [{
    outcome: 'message_materialized',
    message_id: 'message-1',
  }],
} = {}) {
  const rpcCalls = [];
  let projectionIndex = 0;
  return {
    rpcCalls,
    select: vi.fn(async (table) => {
      if (table === 'integration_config') return secret ? [{ value: secret }] : [];
      if (table === 'message_send_attempts') return attempts;
      throw new Error(`unexpected select ${table}`);
    }),
    rpc: vi.fn(async (name, payload) => {
      rpcCalls.push({ name, payload });
      const projection = projections[projectionIndex];
      projectionIndex += 1;
      if (projection instanceof Error) throw projection;
      return [projection];
    }),
    insert: vi.fn(),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('outbound canonical message recovery', () => {
  it('is inert before foundation schema mode', async () => {
    const db = createDb();
    const result = await recoverMessageSendAttempts(db, {
      MESSAGING_SCHEMA_MODE: 'legacy',
    });
    expect(result).toMatchObject({
      success: false,
      recovered: 0,
      error: 'MESSAGING_SCHEMA_NOT_READY',
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('materializes accepted attempts through the service-only RPC without a provider call', async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const db = createDb({
      attempts: [{ id: 'attempt-1' }, { id: 'attempt-2' }],
      projections: [
        { outcome: 'message_materialized', message_id: 'message-1' },
        { outcome: 'message_already_materialized', message_id: 'message-2' },
      ],
    });
    const result = await recoverMessageSendAttempts(db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
    });
    expect(result).toEqual({
      success: true,
      recovered: 1,
      replayed: 1,
      failed: 0,
      scanned: 2,
    });
    expect(db.rpcCalls).toEqual([
      {
        name: 'materialize_message_send_attempt',
        payload: { p_attempt_id: 'attempt-1' },
      },
      {
        name: 'materialize_message_send_attempt',
        payload: { p_attempt_id: 'attempt-2' },
      },
    ]);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('keeps replay idempotency inside the RPC and fails closed on malformed results', async () => {
    const db = createDb({
      attempts: [{ id: 'attempt-1' }, { id: 'attempt-2' }],
      projections: [
        { outcome: 'message_already_materialized', message_id: 'message-1' },
        { outcome: 'message_materialized', message_id: null },
      ],
    });
    const result = await recoverMessageSendAttempts(db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
    });
    expect(result).toEqual({
      success: false,
      recovered: 0,
      replayed: 1,
      failed: 1,
      scanned: 2,
    });
  });

  it('requires the scheduler secret on the HTTP route', async () => {
    h.db = createDb({ secret: null });
    const response = await onRequestPost({
      request: new Request('https://app.test/api/recover-message-send-attempts', {
        method: 'POST',
      }),
      env: { MESSAGING_SCHEMA_MODE: 'foundation' },
    });
    expect(response.status).toBe(401);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });
});
