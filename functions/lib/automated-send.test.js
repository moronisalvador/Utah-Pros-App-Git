/**
 * ════════════════════════════════════════════════
 * FILE: automated-send.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the automated SMS door is safe. It checks that when the global SMS
 *   kill-switch is OFF (its default), NOTHING is sent to Twilio — the message
 *   is skipped and the reason recorded. It checks that even with the switch ON,
 *   a contact who hasn't opted in (or is Do Not Disturb) is still skipped and
 *   never texted. And it checks that only when the switch is ON AND the contact
 *   has consented does a text actually go to Twilio. Twilio and the database
 *   are mocked, so nothing real is sent.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./automated-send.js (system under test); ./supabase.js + ./twilio.js
 *              are mocked; ./sms-consent.js + ./phone.js run for real.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test — no network, no DB. The kill-switch value + the twilio
 *     call log are controlled through the module mocks below.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable state the mocks read/record between tests.
const state = {
  smsEnabled: false,
  sentTo: [],
  inserts: [],
  updates: [],
  selects: [],
  rpcs: [],
  consentStatus: null,
  supabaseFetchImpls: [],
  failDbRead: false,
};

vi.mock('./twilio.js', () => ({
  // Behaviour is overridable per-test via state.sendImpl (e.g. to throw a 429).
  sendMessage: vi.fn(async (
    _env,
    {
      to,
      body,
      mediaUrls,
      statusCallback,
      failClosedOnCredentialError,
    },
  ) => {
    state.sentTo.push({
      to,
      body,
      mediaUrls,
      statusCallback,
      failClosedOnCredentialError,
    });
    if (state.sendImpl) return state.sendImpl({ to, body, mediaUrls, statusCallback });
    return { sid: 'SM_test', status: 'queued' };
  }),
}));

vi.mock('./supabase.js', () => ({
  supabase: (_env, fetchImpl) => {
    state.supabaseFetchImpls.push(fetchImpl);
    return {
    async select(table, query = '') {
      if (state.failDbRead) {
        throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
      }
      state.selects.push({ table, query });
      if (table === 'crm_orgs') return [{ id: 'org-real' }];
      if (table === 'automation_settings') return [{ sms_sending_enabled: state.smsEnabled }];
      if (table === 'contacts') return [state.contact];
      if (table === 'message_templates') return [];
      // No existing thread → the send path find-or-creates one.
      if (table === 'conversation_participants') return [];
      if (table === 'conversations') {
        return state.existingConversation ? [state.existingConversation] : [];
      }
      return [];
    },
    async insert(table, data) {
      // Simulate a thread-write outage AFTER the send has already gone out.
      if (state.failThreadWrite && (table === 'conversations' || table === 'messages')) {
        throw new Error('DB unavailable (thread write)');
      }
      state.inserts.push({ table, data });
      if (table === 'conversations') return [{ id: 'conv-1', ...data }];
      if (table === 'messages') return [{ id: 'msg-1', ...data }];
      return [{ ...data }];
    },
    async update(table, filter, data) { state.updates.push({ table, filter, data }); return null; },
    async rpc(name, params) {
      state.rpcs.push({ name, params });
      if (name === 'get_service_sms_consent_status') return state.consentStatus;
      if (name === 'materialize_message_send_attempt') {
        if (state.failMaterialize) {
          throw new Error('DB unavailable (attempt materialization)');
        }
        return [{ outcome: 'message_materialized', message_id: 'msg-reserved' }];
      }
      return null;
    },
    };
  },
}));

import {
  sendAutomatedMessage,
  isWithinQuietHours,
  hourInTimeZone,
  timezoneForContact,
  classifySendError,
  sendSmsWithBackoff,
} from './automated-send.js';
import { sendMessage } from './twilio.js';
import {
  isTransactionalServiceSmsPurpose,
  TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES,
} from './sms-consent.js';
import { fetchWithTimeout } from './http.js';
// Non-owned held-retry consumers — Phase D must not break their dependence on the
// frozen return vocabulary (sms-experience-wave-ownership §3/§8).
import { planStepOutcome } from '../api/process-sequences.js';
import { planRunOutcome } from '../api/process-crm-automations.js';

const OPTED_IN = { id: 'c1', name: 'Jane', phone: '+18014471917', opt_in_status: true, dnd: false };

// Fixed instants for the tz-aware quiet-hours gate (default zone America/Denver):
// 18:00Z is midday in Denver (12:00 MDT / 11:00 MST — daytime either way); 08:00Z
// is the small hours there (02:00 MDT / 01:00 MST — inside quiet hours).
const DAYTIME = '2026-07-02T18:00:00Z';
const NIGHTTIME = '2026-07-02T08:00:00Z';

beforeEach(() => {
  state.smsEnabled = false;
  state.sentTo = [];
  state.inserts = [];
  state.updates = [];
  state.selects = [];
  state.rpcs = [];
  state.supabaseFetchImpls = [];
  state.failDbRead = false;
  state.contact = OPTED_IN;
  state.consentStatus = { allowed: true, code: 'GLOBAL_OPT_IN' };
  state.sendImpl = null;
  state.failThreadWrite = false;
  state.failMaterialize = false;
  state.existingConversation = null;
  sendMessage.mockClear();
});

describe('sendAutomatedMessage — SMS gate', () => {
  it('fails closed before the provider when the bounded database transport times out', async () => {
    state.smsEnabled = true;
    state.failDbRead = true;

    await expect(sendAutomatedMessage(
      'sms',
      'c1',
      null,
      {},
      {},
      { body: 'hi', now: DAYTIME },
    )).rejects.toThrow('request timed out');

    expect(state.supabaseFetchImpls).toEqual([fetchWithTimeout]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reserves implied service permission for the three reviewed transactional producers', () => {
    expect([
      'appointment_scheduled',
      'appointment_canceled',
      'signature_request',
    ].every(isTransactionalServiceSmsPurpose)).toBe(true);
    expect(isTransactionalServiceSmsPurpose('project_update')).toBe(false);
    expect(TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES).toContain(
      'IMPLIED_CONSENT',
    );
  });

  it('does NOT text when the kill-switch is OFF (default)', async () => {
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('sms_disabled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT text a non-consented contact even if the database returns implied permission', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    state.consentStatus = { allowed: true, code: 'IMPLIED_CONSENT' };
    const res = await sendAutomatedMessage(
      'sms', 'c1', null, {}, {}, { body: 'hi', now: DAYTIME },
    );
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no_consent');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT text when the database refuses, whatever the local row says', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    state.consentStatus = { allowed: false, code: 'NO_CONSENT', source: 'pending_stop' };
    const res = await sendAutomatedMessage(
      'sms', 'c1', null, {}, {}, { body: 'hi', now: DAYTIME },
    );
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no_consent');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT accept staff-only SERVICE_CONSENT for automated traffic', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    state.consentStatus = { allowed: true, code: 'SERVICE_CONSENT' };
    const res = await sendAutomatedMessage(
      'sms', 'c1', null, {}, {}, { body: 'hi', now: DAYTIME },
    );
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no_consent');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    'appointment_scheduled',
    'appointment_canceled',
    'signature_request',
  ])('does not let generic automation assert the %s service exception', async (servicePurpose) => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    state.consentStatus = { allowed: true, code: 'IMPLIED_CONSENT' };

    const res = await sendAutomatedMessage(
      'sms',
      'c1',
      null,
      {},
      {},
      {
        body: 'Service notice',
        now: DAYTIME,
        servicePurpose,
        sentBy: 'employee-1',
      },
    );

    expect(res).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'no_consent',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not let an unknown service-purpose label bypass opt-in', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    state.consentStatus = { allowed: true, code: 'IMPLIED_CONSENT' };

    const res = await sendAutomatedMessage(
      'sms',
      'c1',
      null,
      {},
      {},
      {
        body: 'Generic automation',
        now: DAYTIME,
        servicePurpose: 'project_update',
      },
    );

    expect(res).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'no_consent',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps DND and explicit opt-out blocking an allowlisted service notice', async () => {
    state.smsEnabled = true;
    state.contact = {
      ...OPTED_IN,
      opt_in_status: false,
      dnd: true,
      opt_out_at: '2026-07-28T12:00:00.000Z',
    };
    state.consentStatus = { allowed: false, code: 'DND_ACTIVE' };

    const res = await sendAutomatedMessage(
      'sms',
      'c1',
      null,
      {},
      {},
      {
        body: 'Appointment canceled',
        now: DAYTIME,
        servicePurpose: 'appointment_canceled',
      },
    );

    expect(res).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'dnd',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT text a Do Not Disturb contact even with the switch ON', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, dnd: true };
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('dnd');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT text an explicitly opted-out contact when the legacy opt-in boolean is stale true', async () => {
    state.smsEnabled = true;
    state.contact = {
      ...OPTED_IN,
      opt_out_at: '2026-07-23T18:00:00.000Z',
    };

    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });

    expect(res).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'no_consent',
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.inserts).toContainEqual(expect.objectContaining({
      table: 'sms_consent_log',
      data: expect.objectContaining({
        event_type: 'send_blocked_no_consent',
      }),
    }));
    expect(state.selects.find(({ table }) => table === 'contacts')?.query)
      .toContain('opt_out_at');
  });

  it('does NOT consume staff-only service consent for an automated SMS', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    state.consentStatus = { allowed: true, code: 'SERVICE_CONSENT' };

    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });

    expect(res).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'no_consent',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed while an inbound STOP event is awaiting projection', async () => {
    state.smsEnabled = true;
    state.consentStatus = { allowed: false, code: 'CONTACT_PENDING_STOP' };

    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });

    expect(res).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'no_consent',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('texts an opted-in contact only when the switch is ON (within the quiet-hours window)', async () => {
    state.smsEnabled = true;
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hello there', now: DAYTIME });
    expect(res.ok).toBe(true);
    expect(res.sid).toBe('SM_test');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sentTo[0].to).toBe('+18014471917');
    expect(state.sentTo[0].body).toBe('hello there');
  });

  it('preserves scheduled destination, media, thread, sender, and additive messageId', async () => {
    state.smsEnabled = true;
    state.existingConversation = { id: 'conv-scheduled' };
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'Employee: customer-facing body',
      recordBody: 'customer-facing body',
      now: DAYTIME,
      destinationPhone: '+13855550100',
      mediaUrls: ['https://example.test/photo.jpg'],
      conversationId: 'conv-scheduled',
      sentBy: 'employee-1',
      markWaitingOnClient: true,
    });

    expect(res).toMatchObject({
      ok: true,
      skipped: false,
      sid: 'SM_test',
      messageId: 'msg-1',
    });
    expect(state.sentTo[0]).toMatchObject({
      to: '+13855550100',
      body: 'Employee: customer-facing body',
      mediaUrls: ['https://example.test/photo.jpg'],
    });
    expect(state.selects).toContainEqual({
      table: 'conversations',
      query: 'id=eq.conv-scheduled&limit=1',
    });
    const message = state.inserts.find(({ table }) => table === 'messages');
    expect(message.data).toMatchObject({
      conversation_id: 'conv-scheduled',
      body: 'customer-facing body',
      channel: 'mms',
      sent_by: 'employee-1',
      media_urls: JSON.stringify(['https://example.test/photo.jpg']),
    });
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: 'conversations',
      data: expect.objectContaining({
        status: 'waiting_on_client',
        status_changed_at: expect.any(String),
      }),
    }));
  });

  it('reserves a scheduled delivery only after every compliance gate passes', async () => {
    const reserveDelivery = vi.fn(async () => ({
      shouldSubmit: true,
      attemptId: 'attempt-scheduled',
    }));

    const disabled = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'held while disabled',
      reserveDelivery,
      maxProviderAttempts: 1,
    });

    expect(disabled).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'sms_disabled',
    });
    expect(reserveDelivery).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    state.smsEnabled = true;
    const sent = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'one reserved send',
      recordBody: 'one reserved send',
      conversationId: 'conv-scheduled',
      sentBy: 'employee-1',
      now: DAYTIME,
      reserveDelivery,
      maxProviderAttempts: 1,
    });

    expect(reserveDelivery).toHaveBeenCalledTimes(1);
    expect(state.sentTo).toEqual([
      expect.objectContaining({ failClosedOnCredentialError: true }),
    ]);
    expect(sent).toMatchObject({
      ok: true,
      skipped: false,
      sid: 'SM_test',
      messageId: 'msg-reserved',
      deliveryAttemptId: 'attempt-scheduled',
    });
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: 'message_send_attempts',
      filter: 'id=eq.attempt-scheduled',
      data: expect.objectContaining({
        state: 'accepted',
        provider_message_id: 'SM_test',
      }),
    }));
    expect(state.rpcs).toContainEqual({
      name: 'materialize_message_send_attempt',
      params: { p_attempt_id: 'attempt-scheduled' },
    });
    expect(state.inserts).toContainEqual(expect.objectContaining({
      table: 'sms_consent_log',
      data: expect.objectContaining({
        event_type: 'automated_send',
        performed_by: 'employee-1',
      }),
    }));
    expect(state.inserts.some(({ table }) => table === 'messages')).toBe(false);
  });

  it('samples the live clock after async compliance reads and before reservation', async () => {
    state.smsEnabled = true;
    const clock = vi.fn(() => NIGHTTIME);
    const reserveDelivery = vi.fn(async () => ({
      shouldSubmit: true,
      attemptId: 'attempt-too-late',
    }));

    const result = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'hold after the boundary',
      clock,
      reserveDelivery,
      maxProviderAttempts: 1,
    });

    expect(state.rpcs).toContainEqual(expect.objectContaining({
      name: 'get_service_sms_consent_status',
    }));
    expect(clock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'quiet_hours',
    });
    expect(reserveDelivery).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', () => new Date('invalid')],
    ['throwing', () => { throw new Error('clock unavailable'); }],
  ])('fails closed before reservation when the %s live clock is unavailable', async (_label, clock) => {
    state.smsEnabled = true;
    const reserveDelivery = vi.fn();

    const result = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'hold until time is known',
      clock,
      reserveDelivery,
      maxProviderAttempts: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'quiet_hours',
    });
    expect(reserveDelivery).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('never invokes the provider when a scheduled delivery is already reserved', async () => {
    state.smsEnabled = true;

    const result = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'do not replay',
      now: DAYTIME,
      reserveDelivery: async () => ({
        shouldSubmit: false,
        attemptId: 'attempt-existing',
        reason: 'delivery_reserved',
      }),
      maxProviderAttempts: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      skipped: true,
      reason: 'delivery_reserved',
      deliveryAttemptId: 'attempt-existing',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('caps a reserved scheduled delivery at one provider invocation', async () => {
    state.smsEnabled = true;
    state.sendImpl = () => {
      throw new Error('Twilio send failed: Too Many Requests');
    };

    const result = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'single provider submission',
      now: DAYTIME,
      reserveDelivery: async () => ({
        shouldSubmit: true,
        attemptId: 'attempt-once',
      }),
      // Even a mistakenly wider caller hint cannot override a durable
      // scheduled reservation's one-submission invariant.
      maxProviderAttempts: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      permanent: false,
      deliveryAttemptId: 'attempt-once',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: 'message_send_attempts',
      filter: 'id=eq.attempt-once',
      data: expect.objectContaining({ state: 'failed' }),
    }));
  });

  it('retains the provider SID when accepted delivery materialization is pending', async () => {
    state.smsEnabled = true;
    state.failMaterialize = true;

    const result = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'accepted once',
      now: DAYTIME,
      reserveDelivery: async () => ({
        shouldSubmit: true,
        attemptId: 'attempt-pending',
      }),
      maxProviderAttempts: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      skipped: false,
      sid: 'SM_test',
      ambiguous: true,
      deliveryAttemptId: 'attempt-pending',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: 'message_send_attempts',
      filter: 'id=eq.attempt-pending',
      data: expect.objectContaining({
        state: 'accepted',
        provider_message_id: 'SM_test',
        error_code: 'SCHEDULED_MATERIALIZATION_PENDING',
      }),
    }));
  });

  it('DEFERS (does not text) inside TCPA quiet-hours, even when consented + switch ON', async () => {
    state.smsEnabled = true;
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi', now: NIGHTTIME });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('quiet_hours');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces an ambiguous provider result without retrying the customer message', async () => {
    state.smsEnabled = true;
    state.sendImpl = () => {
      const error = new Error('provider timeout after submission');
      error.ambiguous = true;
      throw error;
    };

    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, {
      body: 'one submission only',
      now: DAYTIME,
    });

    expect(res).toMatchObject({
      ok: false,
      skipped: false,
      permanent: false,
      ambiguous: true,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported channel', async () => {
    await expect(sendAutomatedMessage('carrier-pigeon', 'c1', null, {}, {}, {}))
      .rejects.toThrow(/unsupported channel/);
  });
});

// ─── isWithinQuietHours — the tz-aware TCPA 8am–9pm predicate ──────────────────
describe('isWithinQuietHours (TCPA 8am–9pm, tz-aware, DST-safe)', () => {
  const TZ = 'America/Denver';
  it('midday is allowed', () => {
    expect(isWithinQuietHours(new Date('2026-07-02T18:00:00Z'), TZ)).toBe(false); // 12:00 MDT
  });
  it('2am is quiet', () => {
    expect(isWithinQuietHours(new Date('2026-07-02T08:00:00Z'), TZ)).toBe(true);  // 02:00 MDT
  });
  it('8:00am exactly is allowed (inclusive start)', () => {
    expect(isWithinQuietHours(new Date('2026-07-02T14:00:00Z'), TZ)).toBe(false); // 08:00 MDT
  });
  it('7:59am is quiet (before start)', () => {
    expect(isWithinQuietHours(new Date('2026-07-02T13:59:00Z'), TZ)).toBe(true);  // 07:59 MDT
  });
  it('9:00pm is quiet (exclusive end)', () => {
    expect(isWithinQuietHours(new Date('2026-07-03T03:00:00Z'), TZ)).toBe(true);  // 21:00 MDT
  });
  it('8:30pm is allowed (before end)', () => {
    expect(isWithinQuietHours(new Date('2026-07-03T02:30:00Z'), TZ)).toBe(false); // 20:30 MDT
  });
  it('honors DST — the wall-clock hour tracks MST vs MDT automatically', () => {
    expect(isWithinQuietHours(new Date('2026-01-15T14:00:00Z'), TZ)).toBe(true);  // 07:00 MST — quiet
    expect(isWithinQuietHours(new Date('2026-01-15T15:00:00Z'), TZ)).toBe(false); // 08:00 MST — allowed
  });
  it('falls back to the UTC hour on an unrecognized timezone', () => {
    expect(hourInTimeZone(new Date('2026-07-02T12:00:00Z'), 'Not/AZone')).toBe(12);
    expect(isWithinQuietHours(new Date('2026-07-02T12:00:00Z'), 'Not/AZone')).toBe(false);
  });
});

// ─── F-12: automated sends are visible in-thread + delivery-tracked ────────────
describe('sendAutomatedMessage — thread visibility + status callback (F-12)', () => {
  it('mirrors a successful automated SMS into a conversation + messages row and tracks delivery', async () => {
    state.smsEnabled = true;
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hello there', now: DAYTIME });
    expect(res.ok).toBe(true);

    // A conversation was created (no existing thread) and a participant linked.
    const conv = state.inserts.find((i) => i.table === 'conversations');
    expect(conv).toBeTruthy();
    expect(state.inserts.some((i) => i.table === 'conversation_participants')).toBe(true);

    // The outbound message row carries the frozen sms_outbound shape + twilio_sid.
    const msg = state.inserts.find((i) => i.table === 'messages');
    expect(msg.data.type).toBe('sms_outbound');
    expect(msg.data.channel).toBe('sms');
    expect(msg.data.twilio_sid).toBe('SM_test');
    expect(msg.data.sent_by).toBeNull(); // automated — no staff sender

    // The conversation preview/last_message were bumped so the thread sorts.
    expect(state.updates.some((u) => u.table === 'conversations')).toBe(true);

    // A statusCallback URL was passed to Twilio for delivery receipts.
    expect(state.sentTo[0].statusCallback).toMatch(/\/api\/twilio-status$/);
  });

  it('stores the thread row as queued even when Twilio returns status:accepted (Messaging Service)', async () => {
    // Under a Messaging Service the initial Twilio status is 'accepted', which is
    // OUTSIDE messages_status_check — storing it raw would 400 the insert and the
    // best-effort catch would silently drop the F-12 row. We must normalize to 'queued'.
    state.smsEnabled = true;
    state.sendImpl = () => ({ sid: 'SM_ms', status: 'accepted' });
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi', now: DAYTIME });
    expect(res.ok).toBe(true);
    const msg = state.inserts.find((i) => i.table === 'messages');
    expect(msg).toBeTruthy();
    expect(msg.data.status).toBe('queued'); // normalized, not the raw 'accepted'
    expect(msg.data.twilio_sid).toBe('SM_ms');
  });

  it('never writes a thread row (or texts) when the send is gated off', async () => {
    // Kill-switch OFF (default) → skipped before any Twilio/thread write.
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });
    expect(res.reason).toBe('sms_disabled');
    expect(state.inserts.some((i) => i.table === 'messages')).toBe(false);
    expect(state.inserts.some((i) => i.table === 'conversations')).toBe(false);
  });

  it('a delivered text is NOT reported as failed even if the thread-write throws', async () => {
    state.smsEnabled = true;
    state.failThreadWrite = true; // conversations/messages inserts throw
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi', now: DAYTIME });
    expect(res.ok).toBe(true);   // send is the source of truth; visibility is best-effort
    expect(res.sid).toBe('SM_test');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    state.failThreadWrite = false;
  });
});

// ─── Per-recipient quiet-hours timezone (area code → state → default) ──────────
describe('timezoneForContact', () => {
  it('derives the zone from the phone area code', () => {
    expect(timezoneForContact({ phone: '+18014471917' })).toBe('America/Denver');   // 801 Utah
    expect(timezoneForContact({ phone: '+12125550123' })).toBe('America/New_York');  // 212 NYC
    expect(timezoneForContact({ phone: '+13125550123' })).toBe('America/Chicago');   // 312 Chicago
    expect(timezoneForContact({ phone: '+14155550123' })).toBe('America/Los_Angeles'); // 415 SF
    expect(timezoneForContact({ phone: '+16025550123' })).toBe('America/Phoenix');   // 602 Phoenix
  });
  it('accepts a 10-digit number without country code', () => {
    expect(timezoneForContact({ phone: '8014471917' })).toBe('America/Denver');
  });
  it('falls back to the billing state when the area code is unknown', () => {
    expect(timezoneForContact({ phone: '+19995550123', billing_state: 'CA' })).toBe('America/Los_Angeles');
    expect(timezoneForContact({ phone: null, billing_state: 'tx' })).toBe('America/Chicago');
  });
  it('prefers an explicit contact.timezone when present (future-proof)', () => {
    expect(timezoneForContact({ phone: '+12125550123', timezone: 'America/Denver' })).toBe('America/Denver');
  });
  it('falls back to env override then the Mountain default', () => {
    expect(timezoneForContact({ phone: null }, { SMS_QUIET_HOURS_TZ: 'America/Chicago' })).toBe('America/Chicago');
    expect(timezoneForContact({ phone: null })).toBe('America/Denver');
  });
});

// ─── Send-error classification + backoff (429 / transient / permanent) ─────────
describe('classifySendError', () => {
  it('classifies rate-limit (429) as transient + rateLimited', () => {
    const c = classifySendError(new Error('Twilio send failed: Too Many Requests'));
    expect(c.transient).toBe(true);
    expect(c.rateLimited).toBe(true);
  });
  it('classifies a 5xx / network error as transient', () => {
    expect(classifySendError(new Error('Twilio send failed: 503 Service Unavailable')).transient).toBe(true);
    expect(classifySendError(new Error('fetch failed')).transient).toBe(true);
  });
  it('classifies an invalid-number / unknown failure as permanent', () => {
    expect(classifySendError(new Error("Twilio send failed: Invalid 'To' Phone Number")).transient).toBe(false);
    expect(classifySendError(new Error('Twilio send failed: 21610')).transient).toBe(false);
  });
});

describe('sendSmsWithBackoff', () => {
  const noSleep = async () => {};
  it('retries a transient (429) error then succeeds', async () => {
    let calls = 0;
    state.sendImpl = () => {
      calls++;
      if (calls === 1) throw new Error('Twilio send failed: Too Many Requests');
      return { sid: 'SM_ok', status: 'queued' };
    };
    const res = await sendSmsWithBackoff({}, { to: '+18014471917', body: 'hi', sleep: noSleep });
    expect(res.sid).toBe('SM_ok');
    expect(calls).toBe(2);
  });
  it('passes media through every retry attempt', async () => {
    let calls = 0;
    state.sendImpl = ({ mediaUrls }) => {
      calls++;
      expect(mediaUrls).toEqual(['https://example.test/photo.jpg']);
      if (calls === 1) throw new Error('Twilio send failed: 503 Service Unavailable');
      return { sid: 'SM_media', status: 'queued' };
    };
    const res = await sendSmsWithBackoff({}, {
      to: '+18014471917',
      body: 'photo',
      mediaUrls: ['https://example.test/photo.jpg'],
      sleep: noSleep,
    });
    expect(res.sid).toBe('SM_media');
    expect(calls).toBe(2);
  });
  it('never retries an ambiguous provider outcome', async () => {
    let calls = 0;
    state.sendImpl = () => {
      calls++;
      const error = new Error('Twilio send outcome is ambiguous');
      error.ambiguous = true;
      throw error;
    };
    await expect(sendSmsWithBackoff({}, {
      to: '+18014471917',
      body: 'do not duplicate',
      sleep: noSleep,
    })).rejects.toMatchObject({
      ambiguous: true,
      permanent: false,
    });
    expect(calls).toBe(1);
  });
  it('fails fast on a permanent error (no retry) and marks it permanent', async () => {
    let calls = 0;
    state.sendImpl = () => { calls++; throw new Error("Twilio send failed: Invalid 'To' Phone Number"); };
    await expect(sendSmsWithBackoff({}, { to: 'x', body: 'hi', sleep: noSleep }))
      .rejects.toMatchObject({ permanent: true });
    expect(calls).toBe(1); // did NOT retry a permanent failure
  });
  it('gives up after maxAttempts on a persistent transient error', async () => {
    let calls = 0;
    state.sendImpl = () => { calls++; throw new Error('Twilio send failed: Too Many Requests'); };
    await expect(sendSmsWithBackoff({}, { to: 'x', body: 'hi', sleep: noSleep, maxAttempts: 3 }))
      .rejects.toMatchObject({ permanent: false });
    expect(calls).toBe(3);
  });
});

// ─── BACKWARD-COMPAT: the frozen return still drives held-retry (§3/§8) ────────
// process-sequences (Phase 8) + process-crm-automations (Phase 5) HOLD-and-retry
// on reason 'sms_disabled' / 'quiet_hours'. Phase D must never rename/reshape the
// return — these prove both non-owned callers still get the action they depend on
// against sendGatedSms's ACTUAL return shapes.
describe('frozen sendAutomatedMessage return still drives non-owned held-retry', () => {
  const NOW = new Date('2026-07-02T12:00:00Z');
  const steps = [{ step_order: 0 }, { step_order: 1 }];
  const enrollment = { current_step: 0 };
  const actions = [{ delay_hours: 0 }, { delay_hours: 24 }];
  const run = { current_action: 0 };

  // The exact shapes sendGatedSms returns today.
  const R = {
    disabled: { ok: false, skipped: true, reason: 'sms_disabled' },
    quiet: { ok: false, skipped: true, reason: 'quiet_hours' },
    dnd: { ok: false, skipped: true, reason: 'dnd' },
    noConsent: { ok: false, skipped: true, reason: 'no_consent' },
    sent: { ok: true, skipped: false, sid: 'SM_x' },
    transientFail: { ok: false, skipped: false, error: 'boom', permanent: false },
    newReason: { ok: false, skipped: true, reason: 'some_future_reason' }, // additive
  };

  it('process-sequences HOLDS sms_disabled + quiet_hours, SKIPS durable, SENDS ok', () => {
    expect(planStepOutcome(enrollment, steps, R.disabled, NOW).action).toBe('held');
    expect(planStepOutcome(enrollment, steps, R.quiet, NOW).action).toBe('held');
    expect(planStepOutcome(enrollment, steps, R.dnd, NOW).action).toBe('skipped');
    expect(planStepOutcome(enrollment, steps, R.noConsent, NOW).action).toBe('skipped');
    expect(planStepOutcome(enrollment, steps, R.sent, NOW).action).toBe('sent');
    expect(planStepOutcome(enrollment, steps, R.transientFail, NOW).action).toBe('retry');
    // A NEW additive reason must fall through to the durable-skip branch, never held.
    expect(planStepOutcome(enrollment, steps, R.newReason, NOW).action).toBe('skipped');
  });

  it('process-crm-automations maps the same held/skipped/sent decisions onto its run cursor', () => {
    expect(planRunOutcome(run, actions, R.disabled, NOW).action).toBe('held');
    expect(planRunOutcome(run, actions, R.quiet, NOW).action).toBe('held');
    expect(planRunOutcome(run, actions, R.dnd, NOW).action).toBe('skipped');
    expect(planRunOutcome(run, actions, R.noConsent, NOW).action).toBe('skipped');
    expect(planRunOutcome(run, actions, R.sent, NOW).action).toBe('sent');
    expect(planRunOutcome(run, actions, R.transientFail, NOW).action).toBe('retry');
    expect(planRunOutcome(run, actions, R.newReason, NOW).action).toBe('skipped');
  });
});
