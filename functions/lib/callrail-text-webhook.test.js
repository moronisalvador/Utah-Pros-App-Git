/**
 * ════════════════════════════════════════════════
 * FILE: callrail-text-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves CallRail text webhooks are authenticated from their exact raw bytes,
 *   rejected outside the replay window, classified strictly as received/sent,
 *   and normalized without network, database, storage, or provider activity.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./callrail-text-webhook.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Fixtures use fictional numbers, IDs, content, and credentials.
 *   - MMS URLs remain ephemeral provider inputs; these tests never fetch them.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  deriveCallrailTextDedupeKey,
  normalizeCallrailTextWebhook,
  parseVerifiedCallrailTextWebhook,
  verifyCallrailSignature,
} from './callrail-text-webhook.js';

const SIGNING_KEY = 'fictional-callrail-signing-key';
const NOW_MS = Date.parse('2026-07-23T18:00:00.000Z');
const REPLAY_OPTIONS = {
  replayWindowMs: 5 * 60 * 1000,
  futureToleranceMs: 30 * 1000,
};

const receivedPayload = {
  id: 879204976,
  resource_id: 'SCI-received-001',
  source_number: '770-555-5555',
  destination_number: '770-123-4567',
  content: '<img src=x onerror=alert(1)>',
  message_type: 'sms',
  media_urls: [],
  timestamp: '2026-07-23T17:59:00.000Z',
  lead_status: null,
  conversation_id: 'crp-received',
  company_resource_id: 'COM-test',
  person_resource_id: 'PER-test',
};

const sentPayload = {
  ...receivedPayload,
  id: 980561249,
  resource_id: 'SCI-sent-001',
  agent: 'Test Agent',
  source_number: '770-123-4567',
  destination_number: '770-555-5555',
  content: 'A staff-written reply',
  conversation_id: 'crp-sent',
};

async function sign(rawBody, signingKey = SIGNING_KEY) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  );
  return btoa(String.fromCharCode(...digest));
}

async function parseSigned(payload, options = {}) {
  const rawBody = JSON.stringify(payload);
  return parseVerifiedCallrailTextWebhook({
    rawBody,
    signature: await sign(rawBody),
    signingKey: SIGNING_KEY,
    nowMs: NOW_MS,
    ...options,
  });
}

describe('CallRail text webhook signature verification', () => {
  it('accepts CallRail-compatible HMAC-SHA1 over the exact raw body', async () => {
    const rawBody = JSON.stringify(receivedPayload);
    const signature = await sign(rawBody);

    await expect(
      verifyCallrailSignature(rawBody, signature, SIGNING_KEY),
    ).resolves.toBe(true);
    await expect(
      verifyCallrailSignature(new TextEncoder().encode(rawBody), signature, SIGNING_KEY),
    ).resolves.toBe(true);
  });

  it('rejects a valid signature when even whitespace in the raw body changes', async () => {
    const rawBody = JSON.stringify(receivedPayload);
    const signature = await sign(rawBody);

    await expect(
      verifyCallrailSignature(`${rawBody}\n`, signature, SIGNING_KEY),
    ).resolves.toBe(false);
  });

  it.each([
    '',
    'not-base64',
    'AAAA',
    'UZAHbUdfm3GqL7qzilGozGzWV64',
    'UZAHbUdfm3GqL7qzilGozGzWV64= ',
  ])('rejects a missing or malformed signature: %j', async (signature) => {
    await expect(
      verifyCallrailSignature('{}', signature, SIGNING_KEY),
    ).resolves.toBe(false);
  });

  it('fails closed before parsing when the signature is invalid', async () => {
    await expect(
      parseVerifiedCallrailTextWebhook({
        rawBody: '{not-json',
        signature: await sign('{}'),
        signingKey: SIGNING_KEY,
        nowMs: NOW_MS,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CALLRAIL_SIGNATURE' });
  });
});

describe('CallRail text webhook replay window', () => {
  it('rejects a correctly signed stale timestamp', async () => {
    await expect(
      parseSigned({
        ...receivedPayload,
        timestamp: '2026-07-23T17:54:59.999Z',
      }, REPLAY_OPTIONS),
    ).rejects.toMatchObject({ code: 'STALE_CALLRAIL_TIMESTAMP' });
  });

  it('rejects a correctly signed timestamp too far in the future', async () => {
    await expect(
      parseSigned({
        ...receivedPayload,
        timestamp: '2026-07-23T18:00:30.001Z',
      }, REPLAY_OPTIONS),
    ).rejects.toMatchObject({ code: 'FUTURE_CALLRAIL_TIMESTAMP' });
  });

  it('rejects an impossible calendar timestamp', async () => {
    await expect(
      parseSigned({
        ...receivedPayload,
        timestamp: '2026-02-30T17:59:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CALLRAIL_TIMESTAMP' });
  });

  it('accepts signed events at both replay-window boundaries', async () => {
    await expect(
      parseSigned({
        ...receivedPayload,
        timestamp: '2026-07-23T17:55:00.000Z',
      }, REPLAY_OPTIONS),
    ).resolves.toMatchObject({ eventType: 'message.received' });
    await expect(
      parseSigned({
        ...sentPayload,
        timestamp: '2026-07-23T18:00:30.000Z',
      }, REPLAY_OPTIONS),
    ).resolves.toMatchObject({ eventType: 'message.sent' });
  });

  it('does not discard a valid first delivery based on event age by default', async () => {
    await expect(
      parseSigned({
        ...receivedPayload,
        timestamp: '2026-07-22T18:00:00.000Z',
      }),
    ).resolves.toMatchObject({ eventType: 'message.received' });
  });
});

describe('CallRail text webhook normalization', () => {
  it('normalizes a received SMS while preserving content as untrusted text', async () => {
    const event = await parseSigned(receivedPayload);

    expect(event).toEqual({
      provider: 'callrail',
      eventType: 'message.received',
      direction: 'inbound',
      providerEventId: '879204976',
      providerMessageId: 'SCI-received-001',
      providerConversationId: 'crp-received',
      companyResourceId: 'COM-test',
      personResourceId: 'PER-test',
      from: '770-555-5555',
      to: '770-123-4567',
      body: '<img src=x onerror=alert(1)>',
      messageType: 'sms',
      ephemeralMediaUrls: [],
      providerTimestamp: '2026-07-23T17:59:00.000Z',
      occurredAt: '2026-07-23T17:59:00.000Z',
      leadStatus: null,
      agentName: null,
      dedupeKey: 'callrail:message.received:SCI-received-001',
    });
  });

  it('normalizes a sent SMS only when the documented agent field is present', async () => {
    await expect(parseSigned(sentPayload)).resolves.toMatchObject({
      eventType: 'message.sent',
      direction: 'outbound',
      agentName: 'Test Agent',
      from: '770-123-4567',
      to: '770-555-5555',
      dedupeKey: 'callrail:message.sent:SCI-sent-001',
    });
  });

  it.each([
    ['missing', { id: undefined }],
    ['null', { id: null }],
  ])('accepts a %s secondary event id when resource_id is present', async (_label, override) => {
    await expect(parseSigned({
      ...receivedPayload,
      ...override,
    })).resolves.toMatchObject({
      providerEventId: null,
      providerMessageId: 'SCI-received-001',
      dedupeKey: 'callrail:message.received:SCI-received-001',
    });
  });

  it('retains MMS URLs only under the explicit ephemeral input field', async () => {
    const event = await parseSigned({
      ...receivedPayload,
      resource_id: 'SCI-mms-001',
      message_type: 'mms',
      media_urls: ['https://media.callrail.test/short-lived/image.png'],
    });

    expect(event.ephemeralMediaUrls).toEqual([
      'https://media.callrail.test/short-lived/image.png',
    ]);
    expect(event).not.toHaveProperty('mediaUrls');
    expect(event).not.toHaveProperty('rawPayload');
    expect(Object.isFrozen(event.ephemeralMediaUrls)).toBe(true);
  });

  it('derives the same dedupe key for replayed copies of the same event', async () => {
    const first = await parseSigned(receivedPayload);
    const replay = await parseSigned({ ...receivedPayload });

    expect(first.dedupeKey).toBe(replay.dedupeKey);
    expect(deriveCallrailTextDedupeKey(replay)).toBe(first.dedupeKey);
  });

  it('rejects call, form, and unknown webhook payloads', () => {
    expect(() => normalizeCallrailTextWebhook({
      ...receivedPayload,
      answered: true,
      call_type: 'inbound',
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CALLRAIL_EVENT' }));

    expect(() => normalizeCallrailTextWebhook({
      ...receivedPayload,
      form_data: { name: 'Test' },
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CALLRAIL_EVENT' }));

    expect(() => normalizeCallrailTextWebhook({
      ...receivedPayload,
      message_type: 'chat',
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CALLRAIL_EVENT' }));
  });

  it('rejects malformed text events instead of guessing their type', () => {
    expect(() => normalizeCallrailTextWebhook({
      ...sentPayload,
      agent: null,
    })).toThrowError(expect.objectContaining({
      code: 'INVALID_CALLRAIL_TEXT_EVENT',
      field: 'agent',
    }));

    expect(() => normalizeCallrailTextWebhook({
      ...receivedPayload,
      message_type: 'mms',
      media_urls: [],
    })).toThrowError(expect.objectContaining({
      code: 'INVALID_CALLRAIL_TEXT_EVENT',
      field: 'media_urls',
    }));
  });

  it.each([
    ['id', { id: { invalid: true } }],
    ['resource_id', { resource_id: null }],
    ['conversation_id', { conversation_id: null }],
    ['company_resource_id', { company_resource_id: null }],
    ['person_resource_id', { person_resource_id: null }],
    ['source_number', { source_number: null }],
    ['destination_number', { destination_number: null }],
    ['content', { content: null }],
    ['media_urls', { media_urls: null }],
    ['lead_status', { lead_status: 'unexpected_status' }],
  ])('identifies invalid %s without retaining its value', (field, override) => {
    let caught;
    try {
      normalizeCallrailTextWebhook({ ...receivedPayload, ...override });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'INVALID_CALLRAIL_TEXT_EVENT',
      field,
    });
    expect(caught).not.toHaveProperty('value');
  });
});
