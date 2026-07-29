/**
 * ════════════════════════════════════════════════
 * FILE: twilio-webhook.handler.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises the full incoming Twilio request handler with a pretend database.
 *   It proves authentication, retries, replay safety, keyword replies, and
 *   picture ordering without contacting Twilio or Supabase.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio-webhook.js
 *   Data:      reads  → simulated message_provider_events
 *              writes → simulated message_provider_events and projection effects
 *
 * NOTES / GOTCHAS:
 *   - Database behavior and privileges are pinned separately by the QA source
 *     contract and rollback-only isolated SQL test.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import { handleTwilioInbound } from './twilio-webhook.js';

const ACCOUNT = `AC${'a'.repeat(32)}`;
const MESSAGE = `SM${'b'.repeat(32)}`;
const MMS_MESSAGE = `MM${'c'.repeat(32)}`;
const MEDIA = `ME${'d'.repeat(32)}`;
const WEBHOOK_URL = 'https://example.test/api/twilio-webhook';
const TOKEN = 'test-auth-token';

function signatureInput(url, params) {
  const grouped = new Map();
  for (const [key, value] of params.entries()) {
    const values = grouped.get(key) || [];
    values.push(String(value));
    grouped.set(key, values);
  }
  let input = url;
  for (const key of [...grouped.keys()].sort()) {
    for (const value of [...new Set(grouped.get(key))].sort()) input += key + value;
  }
  return input;
}

async function sign(params, url = WEBHOOK_URL) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TOKEN),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signatureInput(url, params)),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function params({
  body = 'Water in basement',
  messageSid = MESSAGE,
  media = false,
} = {}) {
  const form = new URLSearchParams({
    AccountSid: ACCOUNT,
    MessageSid: messageSid,
    From: '+18015550101',
    To: '+13853360611',
    Body: body,
    NumMedia: media ? '1' : '0',
  });
  if (media) {
    form.set(
      'MediaUrl0',
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}` +
        `/Messages/${messageSid}/Media/${MEDIA}`,
    );
    form.set('MediaContentType0', 'image/jpeg');
  }
  return form;
}

async function request(form, {
  signature = null,
  url = WEBHOOK_URL,
} = {}) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': signature ?? await sign(form, url),
    },
    body: form,
  });
}

function harness() {
  const events = [];
  const state = {
    events,
    messages: 0,
    unread: 0,
    outbox: 0,
    consent: [],
  };
  const db = {
    select: vi.fn(async (table, query) => {
      if (table !== 'message_provider_events') return [];
      const encoded = query.match(/dedupe_key=eq\.([^&]+)/)?.[1];
      const key = encoded ? decodeURIComponent(encoded) : null;
      return events.filter((event) => event.dedupe_key === key);
    }),
    insert: vi.fn(async (table, payload) => {
      if (table !== 'message_provider_events') return [];
      if (events.some((event) => event.dedupe_key === payload.dedupe_key)) {
        throw new Error('duplicate key');
      }
      const row = {
        id: `event-${events.length + 1}`,
        owned_media: [],
        processing_attempts: 0,
        ...payload,
      };
      events.push(row);
      return [row];
    }),
    update: vi.fn(async (table, filter, patch) => {
      if (table !== 'message_provider_events') return [];
      const id = filter.match(/id=eq\.([^&]+)/)?.[1];
      const row = events.find((event) => event.id === id);
      if (row) Object.assign(row, patch);
      return row ? [row] : [];
    }),
  };
  const processEventImpl = vi.fn(async ({ event, consentOnly = false }) => {
    const row = events.find((candidate) => candidate.id === event.eventId);
    const normalized = String(event.body || '').trim().toLowerCase();
    const keyword = ['stop', 'start', 'help', 'yes', 'info'].includes(normalized)
      ? normalized
      : null;
    if (keyword) state.consent.push(keyword);
    if (consentOnly) {
      return {
        outcome: keyword ? `inbound_${keyword}` : 'inbound_consent_not_applicable',
        inserted: false,
      };
    }
    const persists = !['stop', 'start'].includes(keyword);
    if (persists && row.processing_state !== 'processed') {
      state.messages += 1;
      state.unread += 1;
      state.outbox += 1;
    }
    Object.assign(row, {
      processing_state: 'processed',
      outcome: keyword ? `inbound_${keyword}` : 'inbound_persisted',
      message_id: persists ? `message-${state.messages}` : null,
      conversation_id: persists ? 'conversation-1' : null,
      contact_id: 'contact-1',
    });
    return {
      outcome: row.outcome,
      inserted: persists,
      messageId: row.message_id,
    };
  });
  return {
    db,
    state,
    processEventImpl,
    ingestMmsImpl: vi.fn(async () => ({
      media: [{
        storageRef:
          `upr-storage://message-attachments/twilio/${ACCOUNT}/${MMS_MESSAGE}/owned.jpg`,
      }],
    })),
    recordRunImpl: vi.fn(async () => {}),
    resolveInboundAuthImpl: vi.fn(async () => ({
      accountSid: ACCOUNT,
      authToken: TOKEN,
    })),
  };
}

async function invoke(h, form, options = {}) {
  return handleTwilioInbound({
    request: await request(form, options.request),
    env: options.env || { MESSAGING_SCHEMA_MODE: 'foundation' },
    db: h.db,
    resolveInboundAuthImpl: h.resolveInboundAuthImpl,
    ingestMmsImpl: h.ingestMmsImpl,
    processEventImpl: h.processEventImpl,
    recordRunImpl: h.recordRunImpl,
  });
}

describe('Twilio inbound durable Worker boundary', () => {
  it('fails closed before credentials or domain writes when the foundation is disabled', async () => {
    const h = harness();
    const response = await invoke(h, params(), { env: {} });
    expect(response.status).toBe(503);
    expect(h.resolveInboundAuthImpl).not.toHaveBeenCalled();
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.processEventImpl).not.toHaveBeenCalled();
    expect(h.recordRunImpl).not.toHaveBeenCalled();
  });

  it('fails closed without telemetry or domain writes when inbound auth is missing', async () => {
    const h = harness();
    h.resolveInboundAuthImpl.mockResolvedValue({});
    const response = await invoke(h, params());
    expect(response.status).toBe(500);
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.processEventImpl).not.toHaveBeenCalled();
    expect(h.recordRunImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures before event, media, projection, or notification work', async () => {
    const h = harness();
    const response = await invoke(h, params(), {
      request: { signature: 'invalid' },
    });
    expect(response.status).toBe(403);
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.ingestMmsImpl).not.toHaveBeenCalled();
    expect(h.processEventImpl).not.toHaveBeenCalled();
    expect(h.recordRunImpl).not.toHaveBeenCalled();
    expect(h.state).toMatchObject({ messages: 0, unread: 0, outbox: 0 });
  });

  it('accepts evolving signed parameters and returns immediate empty TwiML after durable projection', async () => {
    const h = harness();
    const form = params();
    form.set('FutureTwilioField', 'accepted-with-signature');
    const response = await invoke(h, form);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/xml');
    await expect(response.text()).resolves.toContain('<Response></Response>');
    expect(h.state).toMatchObject({ messages: 1, unread: 1, outbox: 1 });
    expect(h.state.events).toHaveLength(1);
    expect(h.state.events[0]).toMatchObject({
      provider: 'twilio',
      provider_message_id: MESSAGE,
      dedupe_key: `twilio:message.received:${MESSAGE}`,
      processing_state: 'processed',
    });
  });

  it('collapses MessageSid replay across event, canonical, unread, outbox, and occurrence', async () => {
    const h = harness();
    const first = await invoke(h, params());
    const replay = await invoke(h, params());
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(h.state.events).toHaveLength(1);
    expect(h.state).toMatchObject({ messages: 1, unread: 1, outbox: 1 });
    expect(h.processEventImpl).toHaveBeenCalledTimes(1);
  });

  it('serializes a concurrent duplicate behind one event/projection occurrence', async () => {
    const h = harness();
    let releaseProjection;
    const projectionGate = new Promise((resolve) => { releaseProjection = resolve; });
    const original = h.processEventImpl;
    h.processEventImpl = vi.fn(async (args) => {
      await projectionGate;
      return original(args);
    });

    const firstPromise = invoke(h, params());
    await vi.waitFor(() => expect(h.state.events).toHaveLength(1));
    const duplicate = await invoke(h, params());
    expect(duplicate.status).toBe(500);
    releaseProjection();
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(h.state.events).toHaveLength(1);
    expect(h.state).toMatchObject({ messages: 1, unread: 1, outbox: 1 });
    expect(h.processEventImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a transient projection failure from the retained event without another insert', async () => {
    const h = harness();
    const original = h.processEventImpl.getMockImplementation();
    h.processEventImpl
      .mockRejectedValueOnce(Object.assign(new Error('database unavailable'), {
        code: 'TWILIO_ATOMIC_PROJECTION_FAILED',
        retryable: true,
      }))
      .mockImplementation(original);

    const first = await invoke(h, params());
    expect(first.status).toBe(500);
    expect(h.state.events[0].processing_state).toBe('retryable');
    const retry = await invoke(h, params());
    expect(retry.status).toBe(200);
    expect(h.state.events).toHaveLength(1);
    expect(h.state).toMatchObject({ messages: 1, unread: 1, outbox: 1 });
    expect(h.db.insert).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when retaining retry state fails instead of acknowledging the event', async () => {
    const h = harness();
    h.processEventImpl.mockRejectedValueOnce(Object.assign(
      new Error('database unavailable'),
      {
        code: 'TWILIO_ATOMIC_PROJECTION_FAILED',
        retryable: true,
      },
    ));
    h.db.update.mockRejectedValueOnce(new Error('retry-state update unavailable'));

    const response = await invoke(h, params());
    expect(response.status).toBe(500);
    expect(h.state.events).toHaveLength(1);
    expect(h.state.events[0].processing_state).toBe('claimed');
    expect(h.state).toMatchObject({ messages: 0, unread: 0, outbox: 0 });
  });

  it('privately owns MMS before projection and never stores the provider URL', async () => {
    const h = harness();
    const form = params({ messageSid: MMS_MESSAGE, media: true, body: '' });
    const response = await invoke(h, form);
    expect(response.status).toBe(200);
    expect(h.ingestMmsImpl).toHaveBeenCalledBefore(h.processEventImpl);
    expect(h.state.events[0].owned_media[0].storageRef).toContain(
      'upr-storage://message-attachments/twilio/',
    );
    expect(JSON.stringify(h.state.events[0])).not.toContain('api.twilio.com');
    expect(h.state).toMatchObject({ messages: 1, unread: 1, outbox: 1 });
  });

  it('applies STOP consent-only before a transient MMS failure and emits no notification', async () => {
    const h = harness();
    h.ingestMmsImpl.mockRejectedValue(Object.assign(new Error('media timeout'), {
      code: 'TWILIO_MMS_DOWNLOAD_FAILED',
      retryable: true,
    }));
    const response = await invoke(h, params({
      messageSid: MMS_MESSAGE,
      media: true,
      body: 'STOP',
    }));
    expect(response.status).toBe(500);
    expect(h.processEventImpl).toHaveBeenCalledWith(expect.objectContaining({
      consentOnly: true,
    }));
    expect(h.state.consent).toEqual(['stop']);
    expect(h.state).toMatchObject({ messages: 0, unread: 0, outbox: 0 });
    expect(h.state.events[0].processing_state).toBe('retryable');
  });

  it.each([
    ['STOP', 'unsubscribed'],
    ['START', 're-subscribed'],
    ['HELP', 'SMS Support'],
  ])('projects %s before returning its preserved TwiML reply', async (body, reply) => {
    const h = harness();
    const response = await invoke(h, params({ body }));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(reply);
    expect(h.processEventImpl).toHaveBeenCalledTimes(1);
    expect(h.state.consent).toEqual([body.toLowerCase()]);
  });

  it('keeps Advanced Opt-Out silent while still committing STOP', async () => {
    const h = harness();
    const response = await invoke(h, params({ body: 'STOP' }), {
      env: {
        MESSAGING_SCHEMA_MODE: 'foundation',
        TWILIO_ADVANCED_OPT_OUT: 'true',
      },
    });
    await expect(response.text()).resolves.toContain('<Response></Response>');
    expect(h.state.consent).toEqual(['stop']);
  });

  it('fails closed on account mismatch before durable claim', async () => {
    const h = harness();
    h.resolveInboundAuthImpl.mockResolvedValue({
      accountSid: `AC${'f'.repeat(32)}`,
      authToken: TOKEN,
    });
    const response = await invoke(h, params());
    expect(response.status).toBe(403);
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.processEventImpl).not.toHaveBeenCalled();
  });
});
