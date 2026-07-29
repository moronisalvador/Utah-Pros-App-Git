/**
 * ════════════════════════════════════════════════
 * FILE: twilio-inbound.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves Twilio form signatures, text normalization, replay comparisons, and
 *   database-result handling behave consistently without external services.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio.js, ./twilio-inbound.js,
 *              ./twilio-inbound-processor.js
 *   Data:      reads  → simulated projection result
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Future and repeated form fields are part of signature verification.
 *   - These tests do not prove the database migration's runtime behavior.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  parseTwilioInbound,
  sameTwilioInboundEvent,
} from './twilio-inbound.js';
import {
  validateTwilioFormSignature,
  validateTwilioSignature,
} from './twilio.js';
import { processTwilioInboundEvent } from './twilio-inbound-processor.js';

const ACCOUNT = `AC${'a'.repeat(32)}`;
const MESSAGE = `MM${'b'.repeat(32)}`;
const MEDIA = `ME${'c'.repeat(32)}`;
const URL = 'https://example.test/api/twilio-webhook?source=twilio%20console';
const TOKEN = 'test-auth-token';

function groupedSignatureInput(url, params) {
  const grouped = new Map();
  for (const [key, value] of params.entries()) {
    const values = grouped.get(key) || [];
    values.push(String(value));
    grouped.set(key, values);
  }
  let input = url;
  for (const key of [...grouped.keys()].sort()) {
    for (const value of [...new Set(grouped.get(key))].sort()) {
      input += key + value;
    }
  }
  return input;
}

async function sign(params, { url = URL, token = TOKEN } = {}) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(groupedSignatureInput(url, params)),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function baseParams() {
  return new URLSearchParams({
    AccountSid: ACCOUNT,
    MessageSid: MESSAGE,
    From: '+18015550101',
    To: '+13853360611',
    Body: 'Basement water',
    NumMedia: '0',
  });
}

describe('Twilio evolving form signature validation', () => {
  it('validates the exact URL and every current or future parameter', async () => {
    const params = baseParams();
    params.append('FutureTwilioField', 'new-value');
    const signature = await sign(params);
    await expect(validateTwilioFormSignature({
      signature,
      authToken: TOKEN,
      url: URL,
      params,
    })).resolves.toBe(true);

    params.set('FutureTwilioField', 'tampered');
    await expect(validateTwilioFormSignature({
      signature,
      authToken: TOKEN,
      url: URL,
      params,
    })).resolves.toBe(false);
  });

  it('sorts and de-duplicates repeated form values like the maintained Twilio helper', async () => {
    const params = baseParams();
    params.append('Repeated', 'z');
    params.append('Repeated', 'a');
    params.append('Repeated', 'z');
    const signature = await sign(params);
    await expect(validateTwilioFormSignature({
      signature,
      authToken: TOKEN,
      url: URL,
      params,
    })).resolves.toBe(true);
  });

  it('rejects a signature made for another public URL', async () => {
    const params = baseParams();
    const signature = await sign(params);
    await expect(validateTwilioFormSignature({
      signature,
      authToken: TOKEN,
      url: 'https://preview.example.test/api/twilio-webhook',
      params,
    })).resolves.toBe(false);
  });

  it('preserves the existing request-based validator used by status callbacks', async () => {
    const params = baseParams();
    const signature = await sign(params);
    const request = new Request(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': signature,
      },
      body: params,
    });
    await expect(validateTwilioSignature(request, TOKEN, URL)).resolves.toBe(true);
  });
});

describe('Twilio inbound event normalization', () => {
  it('normalizes SMS to the provider-neutral event identity', () => {
    expect(parseTwilioInbound(baseParams())).toMatchObject({
      provider: 'twilio',
      eventType: 'message.received',
      providerEventId: MESSAGE,
      providerMessageId: MESSAGE,
      providerConversationId: null,
      direction: 'inbound',
      messageType: 'sms',
      accountSid: ACCOUNT,
      from: '+18015550101',
      to: '+13853360611',
      body: 'Basement water',
      mediaCount: 0,
      dedupeKey: `twilio:message.received:${MESSAGE}`,
    });
  });

  it('normalizes every signed MMS URL and content type without persisting it', () => {
    const params = baseParams();
    params.set('NumMedia', '1');
    params.set(
      'MediaUrl0',
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}` +
        `/Messages/${MESSAGE}/Media/${MEDIA}`,
    );
    params.set('MediaContentType0', 'image/png; charset=binary');
    const event = parseTwilioInbound(params);
    expect(event.messageType).toBe('mms');
    expect(event.ephemeralMedia).toEqual([{
      index: 0,
      url: expect.stringContaining('/Media/'),
      contentType: 'image/png',
    }]);
  });

  it('rejects missing identities and impossible media counts', () => {
    const missing = baseParams();
    missing.delete('MessageSid');
    expect(() => parseTwilioInbound(missing)).toThrowError(
      expect.objectContaining({ code: 'TWILIO_INBOUND_FIELD_MISSING' }),
    );

    const tooMany = baseParams();
    tooMany.set('NumMedia', '11');
    expect(() => parseTwilioInbound(tooMany)).toThrowError(
      expect.objectContaining({ code: 'TWILIO_INBOUND_MEDIA_COUNT_UNSUPPORTED' }),
    );
  });

  it('treats a changed replay body/hash as an immutable dedupe conflict', () => {
    const event = parseTwilioInbound(baseParams());
    const row = {
      provider: 'twilio',
      event_type: event.eventType,
      provider_event_id: MESSAGE,
      provider_message_id: MESSAGE,
      provider_conversation_id: null,
      direction: 'inbound',
      message_type: 'sms',
      sender_address: event.from,
      recipient_address: event.to,
      content: event.body,
      media_count: 0,
      raw_body_hash: 'hash-a',
    };
    expect(sameTwilioInboundEvent(row, event, 'hash-a')).toBe(true);
    expect(sameTwilioInboundEvent(row, { ...event, body: 'changed' }, 'hash-b')).toBe(false);
  });
});

describe('Twilio atomic projection adapter', () => {
  it('maps the frozen RPC result vocabulary', async () => {
    const db = {
      rpc: async () => [{
        outcome: 'inbound_persisted',
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        contact_id: 'contact-1',
        inserted: true,
        requires_staff_reply: false,
      }],
    };
    await expect(processTwilioInboundEvent({
      db,
      event: { provider: 'twilio', eventId: 'event-1' },
    })).resolves.toEqual({
      outcome: 'inbound_persisted',
      messageId: 'message-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      inserted: true,
      requiresStaffReply: false,
    });
  });

  it('turns RPC transport failures into retryable retained-event failures', async () => {
    const db = { rpc: async () => { throw new Error('temporary database failure'); } };
    await expect(processTwilioInboundEvent({
      db,
      event: { provider: 'twilio', eventId: 'event-1' },
    })).rejects.toMatchObject({
      code: 'TWILIO_ATOMIC_PROJECTION_FAILED',
      retryable: true,
    });
  });
});
