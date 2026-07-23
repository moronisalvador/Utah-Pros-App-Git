/**
 * ════════════════════════════════════════════════
 * FILE: callrail-text-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the dedicated text route is disabled without a signing key, rejects
 *   unauthenticated payloads, claims signed events once, and stores no MMS URL.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./callrail-text-webhook.js
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: null,
  parse: null,
  process: null,
  ingestMms: null,
}));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/callrail-text-webhook.js', () => ({
  parseVerifiedCallrailTextWebhook: (...args) => h.parse(...args),
}));
vi.mock('../lib/callrail-message-processor.js', () => ({
  processCallrailTextEvent: (...args) => h.process(...args),
  buildCallrailRetryPatch: ({ previousAttempts = 0, error }) => ({
    processing_state: error.retryable === false ? 'failed' : 'retryable',
    processing_attempts: previousAttempts + 1,
    next_attempt_at: error.retryable === false ? null : expect.any(String),
    outcome: error.retryable === false ? 'processing_blocked' : 'processing_deferred',
    error_code: error.code,
    error_message: error.message,
    updated_at: expect.any(String),
  }),
}));
vi.mock('../lib/callrail-mms.js', () => ({
  ingestVerifiedCallrailEventMms: (...args) => h.ingestMms(...args),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(async () => undefined),
}));

import { onRequestPost } from './callrail-text-webhook.js';

const EVENT = {
  provider: 'callrail',
  eventType: 'message.received',
  providerEventId: '123',
  providerMessageId: 'SCI-test',
  providerConversationId: 'conversation-test',
  occurredAt: '2026-07-23T18:00:00.000Z',
  direction: 'inbound',
  messageType: 'mms',
  from: '+15551110001',
  to: '+15551110002',
  body: 'Photo',
  companyResourceId: 'COM-test',
  personResourceId: 'PER-test',
  agentName: null,
  dedupeKey: 'callrail:message.received:SCI-test',
  ephemeralMediaUrls: ['https://provider.test/short-lived.png'],
};
const CONFIGURED_ENV = {
  CALLRAIL_SIGNING_KEY: 'test-key',
  CALLRAIL_COMPANY_ID: 'COM-test',
  MESSAGING_SCHEMA_MODE: 'foundation',
};

function request({ body = '{"fixture":true}', contentLength = null } = {}) {
  return {
    headers: {
      get: (name) => (
        name === 'Signature'
          ? 'signed'
          : name === 'Content-Length'
            ? contentLength
            : null
      ),
    },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

async function storedEvent(overrides = {}, body = '{"fixture":true}') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const rawBodyHash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    id: 'event-1',
    processing_state: 'received',
    provider: EVENT.provider,
    event_type: EVENT.eventType,
    provider_event_id: EVENT.providerEventId,
    provider_message_id: EVENT.providerMessageId,
    provider_conversation_id: EVENT.providerConversationId,
    direction: EVENT.direction,
    message_type: EVENT.messageType,
    sender_address: EVENT.from,
    recipient_address: EVENT.to,
    content: EVENT.body,
    company_resource_id: EVENT.companyResourceId,
    person_resource_id: EVENT.personResourceId,
    agent_name: EVENT.agentName,
    media_count: EVENT.ephemeralMediaUrls.length,
    occurred_at: EVENT.occurredAt,
    raw_body_hash: rawBodyHash,
    ...overrides,
  };
}

function db({
  existing = null,
  selectError = null,
  insertError = null,
  winnerAfterError = null,
} = {}) {
  const inserts = [];
  let selects = 0;
  return {
    inserts,
    select: vi.fn(async () => {
      if (selectError) throw selectError;
      selects += 1;
      if (selects === 1) return existing ? [existing] : [];
      return winnerAfterError ? [winnerAfterError] : [];
    }),
    insert: vi.fn(async (table, payload) => {
      if (table === 'message_provider_events' && insertError) throw insertError;
      inserts.push({ table, payload });
      return [{ id: 'event-1', ...payload }];
    }),
    update: vi.fn(async () => [{ id: 'event-1' }]),
  };
}

beforeEach(() => {
  h.parse = vi.fn(async () => EVENT);
  h.process = vi.fn(async () => ({
    outcome: 'inbound_persisted',
    messageId: 'message-1',
  }));
  h.ingestMms = vi.fn(async () => ({
    media: [{
      storageRef: 'upr-storage://message-attachments/callrail/test.jpg',
      contentType: 'image/jpeg',
      byteSize: 10,
      sha256: 'a'.repeat(64),
    }],
  }));
  h.db = db();
});

describe('CallRail text webhook receiver', () => {
  it('stays disabled when the server signing key is absent', async () => {
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    expect(h.parse).not.toHaveBeenCalled();
  });

  it('stays disabled until foundation schema mode is enabled', async () => {
    const res = await onRequestPost({
      request: request(),
      env: { ...CONFIGURED_ENV, MESSAGING_SCHEMA_MODE: 'legacy' },
    });
    expect(res.status).toBe(503);
    expect(h.parse).not.toHaveBeenCalled();
  });

  it('returns 403 for an invalid signature or replay timestamp', async () => {
    h.parse.mockRejectedValueOnce(Object.assign(new Error('bad'), {
      code: 'INVALID_CALLRAIL_SIGNATURE',
    }));
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(403);
    expect(h.db.insert).not.toHaveBeenCalledWith(
      'message_provider_events',
      expect.anything(),
    );
  });

  it('rejects a signed event for a different CallRail company', async () => {
    const res = await onRequestPost({
      request: request(),
      env: { ...CONFIGURED_ENV, CALLRAIL_COMPANY_ID: 'COM-other' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CALLRAIL_COMPANY_MISMATCH');
    expect(h.db.insert).not.toHaveBeenCalled();
  });

  it('claims a signed normalized event and stores no ephemeral MMS URL', async () => {
    h.process.mockResolvedValueOnce({
      outcome: 'inbound_persisted',
      messageId: 'message-1',
      inserted: true,
      conversation: { id: 'conversation-1' },
      contact: { id: 'contact-1', name: 'Jane' },
    });
    const waitUntil = vi.fn();
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
      waitUntil,
    });
    expect(res.status).toBe(202);
    const claim = h.db.inserts.find((item) => item.table === 'message_provider_events');
    expect(claim.payload).toMatchObject({
      provider: 'callrail',
      provider_message_id: 'SCI-test',
      direction: 'inbound',
      message_type: 'mms',
      sender_address: '+15551110001',
      recipient_address: '+15551110002',
      content: 'Photo',
      media_count: 1,
      processing_state: 'claimed',
    });
    expect(JSON.stringify(claim.payload)).not.toContain('short-lived.png');
    expect(claim.payload.raw_body_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.process).toHaveBeenCalledWith({
      db: h.db,
      event: expect.objectContaining({
        providerMessageId: 'SCI-test',
        ownedMedia: expect.any(Array),
      }),
    });
    expect(h.db.update).toHaveBeenCalledWith(
      'message_provider_events',
      'id=eq.event-1',
      expect.objectContaining({
        processing_state: 'processed',
        message_id: 'message-1',
      }),
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('records unsupported MMS as failed without persisting provider URLs', async () => {
    h.process.mockRejectedValueOnce(Object.assign(new Error('not enabled'), {
      code: 'CALLRAIL_MMS_NOT_ENABLED',
      retryable: false,
    }));
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(202);
    expect(h.db.update).toHaveBeenCalledWith(
      'message_provider_events',
      'id=eq.event-1',
      expect.objectContaining({
        processing_state: 'failed',
        error_code: 'CALLRAIL_MMS_NOT_ENABLED',
      }),
    );
  });

  it('retains transient processing failures for reconciliation', async () => {
    h.process.mockRejectedValueOnce(Object.assign(new Error('database down'), {
      code: 'CALLRAIL_PROCESSING_FAILED',
      retryable: true,
    }));
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(202);
    expect(h.db.update).toHaveBeenCalledWith(
      'message_provider_events',
      'id=eq.event-1',
      expect.objectContaining({ processing_state: 'retryable' }),
    );
  });

  it('acknowledges an already-claimed duplicate without inserting', async () => {
    h.db = db({ existing: await storedEvent() });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, duplicate: true });
    expect(h.db.insert).not.toHaveBeenCalledWith(
      'message_provider_events',
      expect.anything(),
    );
  });

  it('fails closed when a dedupe key is reused with different immutable content', async () => {
    h.db = db({
      existing: await storedEvent({ content: 'Different message under the same key' }),
    });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Conflicting CallRail text event',
      code: 'CALLRAIL_EVENT_DEDUPE_CONFLICT',
    });
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.process).not.toHaveBeenCalled();
  });

  it('fails closed when normalized facts match but the signed raw body hash differs', async () => {
    h.db = db({
      existing: await storedEvent({ raw_body_hash: '0'.repeat(64) }),
    });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CALLRAIL_EVENT_DEDUPE_CONFLICT');
    expect(h.db.insert).not.toHaveBeenCalled();
  });

  it('treats a concurrent unique winner as a duplicate', async () => {
    h.db = db({
      insertError: new Error('duplicate key'),
      winnerAfterError: await storedEvent(),
    });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(200);
  });

  it('rejects a concurrent unique winner whose immutable facts conflict', async () => {
    h.db = db({
      insertError: new Error('duplicate key'),
      winnerAfterError: await storedEvent({ recipient_address: '+15559999999' }),
    });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CALLRAIL_EVENT_DEDUPE_CONFLICT');
  });

  it('returns observable 500 for a persistence failure pending polling recovery', async () => {
    h.db = db({ insertError: new Error('database down') });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(500);
  });

  it('contains an initial event-inbox lookup failure', async () => {
    h.db = db({ selectError: new Error('database down') });
    const res = await onRequestPost({
      request: request(),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(500);
  });

  it('rejects a declared oversized body before parsing', async () => {
    const res = await onRequestPost({
      request: request({ contentLength: String(256 * 1024 + 1) }),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(413);
    expect(h.parse).not.toHaveBeenCalled();
  });

  it('rejects an oversized buffered body when content length is absent', async () => {
    const res = await onRequestPost({
      request: request({ body: 'x'.repeat(256 * 1024 + 1) }),
      env: CONFIGURED_ENV,
    });
    expect(res.status).toBe(413);
    expect(h.parse).not.toHaveBeenCalled();
  });
});
