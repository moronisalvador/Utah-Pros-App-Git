/**
 * ════════════════════════════════════════════════
 * FILE: messaging-transport.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the new messaging door behaves exactly like the existing Twilio
 *   sender today. It also proves an unknown provider is rejected without any
 *   provider call, so the system cannot silently fall back.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./messaging-transport.js, ./twilio.js (mocked)
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test: no network, database, credentials, or live message.
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ twilio: null }));
vi.mock('./twilio.js', () => ({
  sendMessage: (...args) => h.twilio(...args),
}));

import { sendMessage } from './messaging-transport.js';

beforeEach(() => {
  h.twilio = vi.fn(async () => ({
    sid: 'SM-test',
    status: 'queued',
    to: '+15551112222',
    from: '+15553334444',
    dateCreated: '2026-07-23T12:00:00Z',
  }));
});

describe('messaging transport', () => {
  it('delegates the existing arguments to Twilio and returns its result unchanged', async () => {
    const env = { marker: 'env' };
    const message = {
      to: '+15551112222',
      body: 'Rep: hello',
      mediaUrls: ['https://files.test/photo.jpg'],
      statusCallback: 'https://app.test/api/twilio-status',
    };

    const result = await sendMessage(env, message);

    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio).toHaveBeenCalledWith(env, message);
    expect(result).toEqual({
      sid: 'SM-test',
      status: 'queued',
      to: '+15551112222',
      from: '+15553334444',
      dateCreated: '2026-07-23T12:00:00Z',
    });
  });

  it('supports an explicit Twilio selection with the same behavior', async () => {
    const env = { marker: 'env' };
    const message = { to: '+15551112222', body: 'Rep: hello' };

    await expect(sendMessage(env, message, { provider: 'twilio' })).resolves.toMatchObject({
      sid: 'SM-test',
      status: 'queued',
    });
    expect(h.twilio).toHaveBeenCalledWith(env, message);
  });

  it.each(['callrail', 'toString'])(
    'fails closed for unsupported provider %s without calling Twilio',
    async (provider) => {
      await expect(
        sendMessage({}, { to: '+15551112222', body: 'Rep: hello' }, { provider }),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_MESSAGING_PROVIDER',
        message: `Unsupported messaging provider: ${provider}`,
      });
      expect(h.twilio).not.toHaveBeenCalled();
    },
  );
});
