import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: null,
  config: null,
  outcome: null,
}));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/callrail-reconcile.js', () => ({
  resolveCallrailReconcileConfig: (...args) => h.config(...args),
  findCallrailAttemptOutcome: (...args) => h.outcome(...args),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(async () => undefined),
}));

import {
  onRequestPost,
  reconcileDueCallrailMessages,
} from './reconcile-callrail-messages.js';

const ATTEMPT = {
  id: 'attempt-1',
  message_id: 'message-1',
  provider: 'callrail',
  state: 'ambiguous',
  recipient_address: '+18015551212',
};
const MESSAGE = {
  id: 'message-1',
  provider: 'callrail',
  body: 'Hello',
  recipient_address: '+18015551212',
};

function db({ attempts = [ATTEMPT], message = MESSAGE, secret = 'cron-secret' } = {}) {
  const inserts = [];
  const updates = [];
  const rpcCalls = [];
  return {
    inserts,
    updates,
    rpcCalls,
    select: vi.fn(async (table) => {
      if (table === 'integration_config') return secret ? [{ value: secret }] : [];
      if (table === 'message_send_attempts') return attempts;
      if (table === 'messages') return message ? [message] : [];
      if (table === 'message_provider_events') return [];
      return [];
    }),
    insert: vi.fn(async (table, payload) => {
      inserts.push({ table, payload });
      return [{ id: 'event-1', ...payload }];
    }),
    update: vi.fn(async (table, filter, payload) => {
      updates.push({ table, filter, payload });
      return [{ id: table === 'messages' ? 'message-1' : 'attempt-1' }];
    }),
    rpc: vi.fn(async (name, payload) => {
      rpcCalls.push({ name, payload });
      return true;
    }),
  };
}

beforeEach(() => {
  h.config = vi.fn(async () => ({
    accountId: 'ACC-test',
    apiKey: 'secret',
    companyId: 'COM-test',
    trackingNumber: '+13853360611',
  }));
  h.outcome = vi.fn(async () => ({
    attemptId: 'attempt-1',
    messageId: 'message-1',
    providerMessageId: 'provider-message-1',
    providerConversationId: 'provider-conv-1',
    companyResourceId: 'COM-test',
    senderAddress: '+13853360611',
    recipientAddress: '+18015551212',
    providerStatus: 'sent',
    occurredAt: '2026-07-23T18:00:08.000Z',
    confirmed: true,
  }));
});

describe('CallRail reconciliation worker', () => {
  it('is inert before foundation schema mode', async () => {
    h.db = db();
    const result = await reconcileDueCallrailMessages(h.db, {
      MESSAGING_SCHEMA_MODE: 'legacy',
    });
    expect(result).toEqual({
      success: false,
      reconciled: 0,
      error: 'MESSAGING_SCHEMA_NOT_READY',
    });
    expect(h.config).not.toHaveBeenCalled();
  });

  it('confirms a uniquely matched attempt and records a durable event', async () => {
    h.db = db();
    const result = await reconcileDueCallrailMessages(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
    }, { now: new Date('2026-07-23T18:05:00.000Z') });
    expect(result).toEqual({
      success: true,
      reconciled: 1,
      deferred: 0,
      failed: 0,
      scanned: 1,
    });
    expect(h.db.rpcCalls[0]).toMatchObject({
      name: 'project_callrail_reconcile_outcome',
      payload: {
        p_attempt_id: 'attempt-1',
        p_message_id: 'message-1',
        p_provider_message_id: 'provider-message-1',
        p_confirmed: true,
      },
    });
    expect(h.db.inserts).toHaveLength(0);
    expect(h.db.updates).toHaveLength(0);
  });

  it('defers an inconclusive lookup and never invokes a provider send', async () => {
    h.db = db();
    h.outcome = vi.fn(async () => {
      throw Object.assign(new Error('No exact match'), {
        code: 'CALLRAIL_RECONCILE_MESSAGE_NOT_FOUND',
        retryable: true,
      });
    });
    const result = await reconcileDueCallrailMessages(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
    }, { now: new Date('2026-07-23T18:05:00.000Z') });
    expect(result).toMatchObject({ success: true, reconciled: 0, deferred: 1 });
    expect(h.db.inserts).toHaveLength(0);
    expect(h.db.updates[0].payload).toMatchObject({
      error_code: 'CALLRAIL_RECONCILE_MESSAGE_NOT_FOUND',
      reconcile_after: '2026-07-23T18:10:00.000Z',
    });
  });

  it('requires the scheduler secret on the HTTP route', async () => {
    h.db = db({ secret: null });
    const response = await onRequestPost({
      request: new Request('https://app.test/api/reconcile-callrail-messages', {
        method: 'POST',
      }),
      env: { MESSAGING_SCHEMA_MODE: 'foundation' },
    });
    expect(response.status).toBe(401);
    expect(h.config).not.toHaveBeenCalled();
  });
});
