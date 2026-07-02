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

import { sendAutomatedMessage } from './automated-send.js';
import { sendMessage } from './twilio.js';

const OPTED_IN = { id: 'c1', name: 'Jane', phone: '+18014471917', opt_in_status: true, dnd: false };

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

  it('texts an opted-in contact only when the switch is ON', async () => {
    state.smsEnabled = true;
    const res = await sendAutomatedMessage('sms', 'c1', null, {}, {}, { body: 'hello there' });
    expect(res.ok).toBe(true);
    expect(res.sid).toBe('SM_test');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.sentTo[0].to).toBe('+18014471917');
    expect(state.sentTo[0].body).toBe('hello there');
  });

  it('rejects an unsupported channel', async () => {
    await expect(sendAutomatedMessage('carrier-pigeon', 'c1', null, {}, {}, {}))
      .rejects.toThrow(/unsupported channel/);
  });
});
