import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, process: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/callrail-message-processor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    processCallrailTextEvent: (...args) => h.process(...args),
  };
});
vi.mock('../lib/callrail-mms.js', () => ({
  ingestVerifiedCallrailEventMms: vi.fn(),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(async () => undefined),
}));

import { onRequestPost, processCallrailEventQueue } from './process-callrail-events.js';

const ROW = {
  id: 'event-1',
  provider: 'callrail',
  provider_message_id: 'msg-1',
  provider_conversation_id: 'provider-conv-1',
  occurred_at: '2026-07-23T18:00:00.000Z',
  direction: 'inbound',
  message_type: 'sms',
  sender_address: '+18015551212',
  recipient_address: '+13853360611',
  content: 'Hello',
  company_resource_id: 'COM-test',
};

function db({ rows = [ROW], secret = 'cron-secret', claim = true } = {}) {
  const updates = [];
  const selectedTables = [];
  const rpcs = [];
  return {
    updates,
    selectedTables,
    rpcs,
    select: vi.fn(async (table) => {
      selectedTables.push(table);
      if (table === 'integration_config') return secret ? [{ value: secret }] : [];
      if (table === 'message_provider_events') return rows;
      return [];
    }),
    update: vi.fn(async (table, filter, data) => {
      updates.push({ table, filter, data });
      return [{ id: ROW.id }];
    }),
    rpc: vi.fn(async (name, params) => {
      rpcs.push({ name, params });
      if (name === 'claim_callrail_provider_event') {
        return claim ? [{ ...ROW, processing_attempts: 1 }] : [];
      }
      return [];
    }),
    insert: vi.fn(async () => []),
  };
}

describe('CallRail event recovery worker', () => {
  it('is inert until foundation schema mode is enabled', async () => {
    h.db = db();
    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'legacy',
    });
    expect(result).toMatchObject({ success: false, error: 'MESSAGING_SCHEMA_NOT_READY' });
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('claims and processes retained SMS events', async () => {
    h.db = db();
    h.process = vi.fn(async () => ({
      outcome: 'inbound_persisted',
      messageId: 'message-1',
      inserted: true,
      conversation: { id: 'conversation-1' },
      contact: { id: 'contact-1', name: 'Jane' },
    }));
    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });
    expect(result).toEqual({ success: true, processed: 1, failed: 0, skipped: 0 });
    expect(h.db.rpc).toHaveBeenCalledWith('claim_callrail_provider_event', {
      p_event_id: ROW.id,
      p_now: expect.any(String),
      p_stale_before: expect.any(String),
    });
    expect(h.db.updates.at(-1).data).toMatchObject({
      processing_state: 'processed',
      message_id: 'message-1',
    });
    expect(h.db.selectedTables).not.toContain('notification_types');
  });

  it('skips an event when the atomic claim fence loses a race', async () => {
    h.db = db({ claim: false });
    h.process = vi.fn();
    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });
    expect(result).toEqual({ success: true, processed: 0, failed: 0, skipped: 1 });
    expect(h.process).not.toHaveBeenCalled();
  });

  it('returns 401 without the scheduler secret', async () => {
    h.db = db();
    h.process = vi.fn();
    const response = await onRequestPost({
      request: { headers: { get: () => null } },
      env: { MESSAGING_SCHEMA_MODE: 'foundation' },
    });
    expect(response.status).toBe(401);
    expect(h.process).not.toHaveBeenCalled();
  });

  it('accepts the shared cron secret check and processes the queue', async () => {
    h.db = db();
    h.process = vi.fn(async () => ({
      outcome: 'inbound_persisted',
      messageId: 'message-1',
    }));
    const response = await onRequestPost({
      request: {
        headers: {
          get: (name) => name === 'x-webhook-secret' ? 'cron-secret' : null,
        },
      },
      env: {
        MESSAGING_SCHEMA_MODE: 'foundation',
        CALLRAIL_COMPANY_ID: 'COM-test',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, processed: 1 });
    expect(h.db.select).toHaveBeenCalledWith(
      'integration_config',
      'key=eq.cron_worker_secret&select=value&limit=1',
    );
  });

  it('retains transient processor failures for another run', async () => {
    h.db = db();
    h.process = vi.fn(async () => {
      throw Object.assign(new Error('temporary'), { retryable: true });
    });
    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });
    expect(result).toMatchObject({ success: false, failed: 1 });
    expect(h.db.updates.at(-1).data.processing_state).toBe('retryable');
  });
});
