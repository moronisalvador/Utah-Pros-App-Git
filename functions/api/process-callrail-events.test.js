/**
 * ════════════════════════════════════════════════
 * FILE: process-callrail-events.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves retained CallRail texts and images are recovered safely. It checks
 *   private inbound image capture, outbound confirmation, retries, and access.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  process-callrail-events.js and its mocked messaging helpers
 *   Data:      reads  → integration_config, message_provider_events
 *              writes → message_provider_events, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - The tests never contact CallRail or send a message.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, process: null, ingestMms: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/callrail-message-processor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    processCallrailTextEvent: (...args) => h.process(...args),
  };
});
vi.mock('../lib/callrail-mms.js', () => ({
  ingestVerifiedCallrailEventMms: (...args) => h.ingestMms(...args),
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

  it('confirms retained outbound MMS without downloading UPR-owned media', async () => {
    h.db = db({
      rows: [{
        ...ROW,
        direction: 'outbound',
        message_type: 'mms',
        owned_media: [],
      }],
    });
    h.ingestMms = vi.fn();
    h.process = vi.fn(async () => ({
      outcome: 'outbound_confirmed',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    }));

    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });

    expect(result).toEqual({ success: true, processed: 1, failed: 0, skipped: 0 });
    expect(h.ingestMms).not.toHaveBeenCalled();
    expect(h.process).toHaveBeenCalledWith({
      db: h.db,
      event: expect.objectContaining({
        direction: 'outbound',
        messageType: 'mms',
      }),
    });
  });

  it('stores inbound MMS privately before canonical projection', async () => {
    h.db = db({
      rows: [{
        ...ROW,
        message_type: 'mms',
        owned_media: [],
      }],
    });
    const media = [{
      storageRef: 'upr-storage://message-attachments/callrail/photo.jpg',
    }];
    h.ingestMms = vi.fn(async () => ({ media }));
    h.process = vi.fn(async () => ({
      outcome: 'inbound_persisted',
      messageId: 'message-1',
    }));

    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });

    expect(result).toEqual({ success: true, processed: 1, failed: 0, skipped: 0 });
    expect(h.ingestMms).toHaveBeenCalledOnce();
    expect(h.db.update).toHaveBeenCalledWith(
      'message_provider_events',
      'id=eq.event-1',
      expect.objectContaining({ owned_media: media }),
    );
    expect(h.process).toHaveBeenCalledWith({
      db: h.db,
      event: expect.objectContaining({ ownedMedia: media }),
    });
  });

  it('retains an inbound MMS when private media capture temporarily fails', async () => {
    h.db = db({
      rows: [{
        ...ROW,
        message_type: 'mms',
        owned_media: [],
        processing_attempts: 0,
      }],
    });
    h.ingestMms = vi.fn(async () => {
      throw Object.assign(new Error('provider media unavailable'), {
        code: 'CALLRAIL_MMS_DOWNLOAD_FAILED',
        retryable: true,
      });
    });
    h.process = vi.fn(async ({ consentOnly }) => ({
      outcome: consentOnly ? 'inbound_consent_checked' : 'unexpected',
    }));

    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });

    expect(result).toMatchObject({ success: false, processed: 0, failed: 1 });
    expect(h.process).toHaveBeenCalledTimes(1);
    expect(h.process).toHaveBeenCalledWith({
      db: h.db,
      event: expect.objectContaining({ messageType: 'mms', ownedMedia: [] }),
      consentOnly: true,
    });
    expect(h.db.updates.at(-1).data).toMatchObject({
      processing_state: 'retryable',
      outcome: 'processing_deferred',
      error_code: 'CALLRAIL_MMS_DOWNLOAD_FAILED',
    });
  });

  it('blocks an inbound MMS after a non-retryable private media rejection', async () => {
    h.db = db({
      rows: [{
        ...ROW,
        message_type: 'mms',
        owned_media: [],
        processing_attempts: 0,
      }],
    });
    h.ingestMms = vi.fn(async () => {
      throw Object.assign(new Error('provider media identity rejected'), {
        code: 'CALLRAIL_MMS_DOWNLOAD_REJECTED',
        retryable: false,
      });
    });
    h.process = vi.fn(async ({ consentOnly }) => ({
      outcome: consentOnly ? 'inbound_consent_checked' : 'unexpected',
    }));

    const result = await processCallrailEventQueue(h.db, {
      MESSAGING_SCHEMA_MODE: 'foundation',
      CALLRAIL_COMPANY_ID: 'COM-test',
    });

    expect(result).toMatchObject({ success: false, processed: 0, failed: 1 });
    expect(h.process).toHaveBeenCalledTimes(1);
    expect(h.process).toHaveBeenCalledWith({
      db: h.db,
      event: expect.objectContaining({ messageType: 'mms', ownedMedia: [] }),
      consentOnly: true,
    });
    expect(h.db.updates.at(-1).data).toMatchObject({
      processing_state: 'failed',
      next_attempt_at: null,
      outcome: 'processing_blocked',
      error_code: 'CALLRAIL_MMS_DOWNLOAD_REJECTED',
    });
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
