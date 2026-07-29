/**
 * ════════════════════════════════════════════════
 * FILE: twilio-inbound-auth.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the public webhook loads only Twilio's verification token and account
 *   identity before trusting a request. It also proves the fallback stays narrow.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio-inbound-auth.js
 *   Data:      reads  → simulated integration_credentials, integration_config
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are source-level worker tests; they do not read a hosted database.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveTwilioInboundAuth } from './twilio-inbound-auth.js';

describe('Twilio inbound pre-authentication credential lookup', () => {
  it('reads only the exact token row and AccountSid key', async () => {
    const db = {
      select: vi.fn(async (table) => (
        table === 'integration_credentials'
          ? [{ access_token: 'db-token' }]
          : [{ value: `AC${'a'.repeat(32)}` }]
      )),
    };
    await expect(resolveTwilioInboundAuth({}, db)).resolves.toEqual({
      authToken: 'db-token',
      accountSid: `AC${'a'.repeat(32)}`,
    });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.select).toHaveBeenCalledWith(
      'integration_credentials',
      'provider=eq.twilio&select=access_token&limit=1',
    );
    expect(db.select).toHaveBeenCalledWith(
      'integration_config',
      'key=eq.twilio_account_sid&select=value&limit=1',
    );
    expect(db.select.mock.calls.flat().join(' ')).not.toMatch(
      /messaging_service|phone_number|managed_status/i,
    );
  });

  it('fails back only to the two exact legacy authentication values', async () => {
    const db = { select: vi.fn(async () => { throw new Error('unavailable'); }) };
    await expect(resolveTwilioInboundAuth({
      TWILIO_AUTH_TOKEN: 'env-token',
      TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`,
      TWILIO_MESSAGING_SERVICE_SID: 'must-not-be-read',
      TWILIO_PHONE_NUMBER: 'must-not-be-read',
    }, db)).resolves.toEqual({
      authToken: 'env-token',
      accountSid: `AC${'b'.repeat(32)}`,
    });
  });
});
