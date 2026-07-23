import { describe, expect, it, vi } from 'vitest';
import {
  buildCallrailRetryPatch,
  CallrailMessageProcessingError,
  normalizeStoredCallrailEvent,
  processCallrailTextEvent,
} from './callrail-message-processor.js';

const BASE = {
  eventId: 'event-1',
  provider: 'callrail',
  providerMessageId: 'msg-1',
  providerConversationId: 'provider-conv-1',
  occurredAt: '2026-07-23T18:00:00.000Z',
  direction: 'inbound',
  messageType: 'sms',
  from: '+18015551212',
  to: '+13853360611',
  body: 'Need help with water damage',
};

function createDb({
  projection = {
    outcome: 'inbound_persisted',
    message_id: 'message-1',
    conversation_id: 'conv-1',
    contact_id: 'contact-1',
    inserted: true,
    requires_staff_reply: false,
  },
  outboundProjection = {
    outcome: 'outbound_confirmed',
    message_id: 'message-1',
    send_attempt_id: 'attempt-1',
  },
  conversation = { id: 'conv-1', assigned_to: null },
  contact = { id: 'contact-1', phone: '+18015551212' },
  attempt = null,
} = {}) {
  return {
    select: vi.fn(async (table, query = '') => {
      if (table === 'conversations') return conversation ? [conversation] : [];
      if (table === 'contacts') return contact ? [contact] : [];
      if (table === 'message_send_attempts') {
        if (query.includes('provider_message_id=eq.')) {
          return attempt?.provider_message_id ? [attempt] : [];
        }
        return attempt ? [attempt] : [];
      }
      throw new Error(`unexpected select ${table}`);
    }),
    insert: vi.fn(),
    update: vi.fn(async () => [{ id: 'updated' }]),
    rpc: vi.fn(async (name) => [
      name === 'project_callrail_outbound_event' ? outboundProjection : projection,
    ]),
  };
}

describe('CallRail canonical text processor', () => {
  it('backs off transient failures and fails terminally at the retry ceiling', () => {
    const now = new Date('2026-07-23T18:00:00.000Z');
    expect(buildCallrailRetryPatch({
      previousAttempts: 0,
      error: Object.assign(new Error('temporary'), { retryable: true }),
      now,
    })).toMatchObject({
      processing_state: 'retryable',
      processing_attempts: 1,
      next_attempt_at: '2026-07-23T18:05:00.000Z',
    });
    expect(buildCallrailRetryPatch({
      previousAttempts: 7,
      error: Object.assign(new Error('still broken'), { retryable: true }),
      now,
    })).toMatchObject({
      processing_state: 'failed',
      processing_attempts: 8,
      next_attempt_at: null,
    });
  });

  it('normalizes the durable event ID needed by the atomic RPC', () => {
    expect(normalizeStoredCallrailEvent({
      id: 'event-1',
      provider: 'callrail',
      provider_message_id: 'msg-1',
      provider_conversation_id: 'provider-conv-1',
      occurred_at: BASE.occurredAt,
      direction: 'inbound',
      message_type: 'sms',
      sender_address: BASE.from,
      recipient_address: BASE.to,
      content: BASE.body,
      owned_media: [],
    })).toMatchObject({
      eventId: 'event-1',
      providerMessageId: 'msg-1',
    });
  });

  it('projects inbound SMS through one event-keyed RPC and loads notification entities', async () => {
    const db = createDb();
    const result = await processCallrailTextEvent({ db, event: BASE });
    expect(db.rpc).toHaveBeenCalledWith('project_callrail_inbound_event', {
      p_event_id: 'event-1',
      p_consent_only: false,
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: 'inbound_persisted',
      messageId: 'message-1',
      inserted: true,
      conversation: { id: 'conv-1' },
      contact: { id: 'contact-1' },
    });
  });

  it('returns a STOP outcome without any JS-side partial consent writes', async () => {
    const db = createDb({
      projection: {
        outcome: 'inbound_stop',
        message_id: null,
        conversation_id: null,
        contact_id: 'contact-1',
        inserted: false,
        requires_staff_reply: false,
      },
    });
    const result = await processCallrailTextEvent({
      db,
      event: { ...BASE, body: 'STOP' },
    });
    expect(result.outcome).toBe('inbound_stop');
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('surfaces stale START suppression from the transaction', async () => {
    const db = createDb({
      projection: {
        outcome: 'inbound_start_stale',
        message_id: 'message-1',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
        inserted: true,
        requires_staff_reply: false,
      },
    });
    const result = await processCallrailTextEvent({
      db,
      event: { ...BASE, body: 'yes' },
    });
    expect(result.outcome).toBe('inbound_start_stale');
    expect(result.inserted).toBe(true);
  });

  it('maps HELP to staff-reply notification state', async () => {
    const db = createDb({
      projection: {
        outcome: 'inbound_help',
        message_id: 'message-1',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
        inserted: true,
        requires_staff_reply: true,
      },
    });
    const result = await processCallrailTextEvent({
      db,
      event: { ...BASE, body: 'HELP' },
    });
    expect(result.requiresStaffReply).toBe(true);
  });

  it('defers an immediate inbound event until it has a durable event ID', async () => {
    const db = createDb();
    await expect(processCallrailTextEvent({
      db,
      event: { ...BASE, eventId: undefined },
    })).rejects.toMatchObject({
      code: 'CALLRAIL_EVENT_ID_REQUIRED',
      retryable: true,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('fails closed for MMS until private media capture has completed', async () => {
    const db = createDb();
    await expect(processCallrailTextEvent({
      db,
      event: { ...BASE, messageType: 'mms' },
    })).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_NOT_ENABLED',
      retryable: false,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('projects an MMS only after it has a UPR-owned reference', async () => {
    const db = createDb();
    await processCallrailTextEvent({
      db,
      event: {
        ...BASE,
        messageType: 'mms',
        ownedMedia: [{
          storageRef: 'upr-storage://message-attachments/callrail/photo.jpg',
        }],
      },
    });
    expect(db.rpc).toHaveBeenCalledWith('project_callrail_inbound_event', {
      p_event_id: 'event-1',
      p_consent_only: false,
    });
  });

  it('applies MMS consent keywords transactionally even before media capture succeeds', async () => {
    const db = createDb({
      projection: {
        outcome: 'inbound_stop',
        message_id: null,
        conversation_id: null,
        contact_id: 'contact-1',
        inserted: false,
        requires_staff_reply: false,
      },
    });
    const result = await processCallrailTextEvent({
      db,
      event: { ...BASE, messageType: 'mms', body: 'STOP' },
      consentOnly: true,
    });
    expect(db.rpc).toHaveBeenCalledWith('project_callrail_inbound_event', {
      p_event_id: 'event-1',
      p_consent_only: true,
    });
    expect(result.outcome).toBe('inbound_stop');
  });

  it('does not reload notification entities on an idempotent replay', async () => {
    const db = createDb({
      projection: {
        outcome: 'inbound_persisted',
        message_id: 'message-1',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
        inserted: false,
        requires_staff_reply: false,
      },
    });
    const result = await processCallrailTextEvent({ db, event: BASE });
    expect(result.inserted).toBe(false);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('projects an outbound sent event through one event-keyed RPC', async () => {
    const db = createDb({
      attempt: {
        id: 'attempt-1',
        message_id: null,
        provider_conversation_id: 'provider-conv-1',
        submitted_body: 'Rep: exact outbound',
        recipient_address: '+18015551212',
        started_at: '2026-07-23T17:59:00.000Z',
      },
    });
    const result = await processCallrailTextEvent({
      db,
      event: {
        ...BASE,
        direction: 'outbound',
        from: '+13853360611',
        to: '+18015551212',
        body: 'Rep: exact outbound',
      },
    });
    expect(result).toMatchObject({
      outcome: 'outbound_confirmed',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    });
    expect(db.rpc).toHaveBeenCalledWith('project_callrail_outbound_event', {
      p_event_id: 'event-1',
      p_attempt_id: 'attempt-1',
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('treats an idempotent outbound replay as the same atomic projection', async () => {
    const attempt = {
      id: 'attempt-1',
      message_id: 'message-1',
      provider_message_id: 'msg-1',
      provider_conversation_id: 'provider-conv-1',
      submitted_body: 'Rep: exact outbound',
      recipient_address: '+18015551212',
      started_at: '2026-07-23T17:59:00.000Z',
    };
    const db = createDb({
      attempt,
      outboundProjection: {
        outcome: 'outbound_already_projected',
        message_id: 'message-1',
        send_attempt_id: 'attempt-1',
      },
    });
    const result = await processCallrailTextEvent({
      db,
      event: {
        ...BASE,
        direction: 'outbound',
        from: '+13853360611',
        to: '+18015551212',
        body: 'Rep: exact outbound',
      },
    });
    expect(result).toEqual({
      outcome: 'outbound_already_projected',
      messageId: 'message-1',
      attemptId: 'attempt-1',
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('defers an outbound event until the durable event inbox has claimed it', async () => {
    const db = createDb();
    await expect(processCallrailTextEvent({
      db,
      event: {
        ...BASE,
        eventId: undefined,
        direction: 'outbound',
      },
    })).rejects.toMatchObject({
      code: 'CALLRAIL_EVENT_ID_REQUIRED',
      retryable: true,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when more than one accepted attempt matches an outbound event', async () => {
    const attempt = {
      id: 'attempt-1',
      message_id: 'message-1',
      provider_conversation_id: 'provider-conv-1',
      submitted_body: 'Rep: exact outbound',
      recipient_address: '+18015551212',
      started_at: '2026-07-23T17:59:00.000Z',
    };
    const db = createDb();
    db.select.mockImplementation(async (table, query = '') => {
      if (table === 'message_send_attempts' && query.includes('provider_message_id=eq.')) return [];
      if (table === 'message_send_attempts') return [attempt, { ...attempt, id: 'attempt-2' }];
      if (table === 'messages') return [];
      throw new Error(`unexpected select ${table}`);
    });
    await expect(processCallrailTextEvent({
      db,
      event: {
        ...BASE,
        direction: 'outbound',
        from: '+13853360611',
        to: '+18015551212',
        body: 'Rep: exact outbound',
      },
    })).rejects.toMatchObject({
      code: 'CALLRAIL_OUTBOUND_AMBIGUOUS',
      retryable: false,
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects non-CallRail events', async () => {
    const db = createDb();
    await expect(processCallrailTextEvent({
      db,
      event: { ...BASE, provider: 'twilio' },
    })).rejects.toBeInstanceOf(CallrailMessageProcessingError);
  });
});
