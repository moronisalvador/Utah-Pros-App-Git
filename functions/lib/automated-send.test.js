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
const state = { smsEnabled: false, sentTo: [] };

vi.mock('./twilio.js', () => ({
  sendMessage: vi.fn(async (_env, { to, body }) => {
    state.sentTo.push({ to, body });
    return { sid: 'SM_test', status: 'queued' };
  }),
}));

vi.mock('./supabase.js', () => ({
  supabase: () => ({
    async select(table) {
      if (table === 'crm_orgs') return [{ id: 'org-real' }];
      if (table === 'automation_settings') return [{ sms_sending_enabled: state.smsEnabled }];
      if (table === 'contacts') return [state.contact];
      if (table === 'message_templates') return [];
      return [];
    },
    async insert() { return [{}]; },
  }),
}));

import { sendAutomatedMessage, isWithinQuietHours, hourInTimeZone } from './automated-send.js';
import { sendMessage } from './twilio.js';

const OPTED_IN = { id: 'c1', name: 'Jane', phone: '+18014471917', opt_in_status: true, dnd: false };

// Fixed instants for the tz-aware quiet-hours gate (default zone America/Denver):
// 18:00Z is midday in Denver (12:00 MDT / 11:00 MST — daytime either way); 08:00Z
// is the small hours there (02:00 MDT / 01:00 MST — inside quiet hours).
const DAYTIME = '2026-07-02T18:00:00Z';
const NIGHTTIME = '2026-07-02T08:00:00Z';

beforeEach(() => {
  state.smsEnabled = false;
  state.sentTo = [];
  state.contact = OPTED_IN;
  sendMessage.mockClear();
});

describe('sendAutomatedMessage — SMS gate', () => {
  it('does NOT text when the kill-switch is OFF (default)', async () => {
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('sms_disabled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT text a non-consented contact even with the switch ON', async () => {
    state.smsEnabled = true;
    state.contact = { ...OPTED_IN, opt_in_status: false };
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi' });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no_consent');
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

  it('texts an opted-in contact only when the switch is ON (within the quiet-hours window)', async () => {
    state.smsEnabled = true;
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hello there', now: DAYTIME });
    expect(res.ok).toBe(true);
    expect(res.sid).toBe('SM_test');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sentTo[0].to).toBe('+18014471917');
    expect(state.sentTo[0].body).toBe('hello there');
  });

  it('DEFERS (does not text) inside TCPA quiet-hours, even when consented + switch ON', async () => {
    state.smsEnabled = true;
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hi', now: NIGHTTIME });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('quiet_hours');
    expect(sendMessage).not.toHaveBeenCalled();
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
