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

const h = vi.hoisted(() => ({ twilio: null, callrail: null }));
vi.mock('./twilio.js', () => ({
  sendMessage: (...args) => h.twilio(...args),
}));
vi.mock('./callrail-messaging.js', () => ({
  sendCallRailMessage: (...args) => h.callrail(...args),
}));

import {
  resolveMessagingSchemaMode,
  resolveMessagingSendMode,
  sendMessage,
} from './messaging-transport.js';

beforeEach(() => {
  h.twilio = vi.fn(async () => ({
    sid: 'SM-test',
    status: 'queued',
    to: '+15551112222',
    from: '+15553334444',
    dateCreated: '2026-07-23T12:00:00Z',
  }));
  h.callrail = vi.fn(async () => ({
    provider: 'callrail',
    accepted: true,
    status: 'queued',
    providerConversationId: 'conversation-1',
  }));
});

describe('messaging transport', () => {
  const command = {
    purpose: 'staff_p2p',
    recipient: { address: '+15551112222' },
    content: {
      body: 'Rep: hello',
      mediaUrls: ['https://files.test/photo.jpg'],
      media: [{
        url: 'https://files.test/photo.jpg',
        verified: true,
      }],
    },
    statusCallbackUrl: 'https://app.test/api/twilio-status',
  };

  it('maps the neutral command to Twilio and returns its result unchanged', async () => {
    const env = { marker: 'env' };

    const result = await sendMessage(env, command, { provider: 'twilio' });

    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio).toHaveBeenCalledWith(env, {
      to: '+15551112222',
      body: 'Rep: hello',
      mediaUrls: ['https://files.test/photo.jpg'],
      statusCallback: 'https://app.test/api/twilio-status',
    });
    expect(result).toEqual({
      sid: 'SM-test',
      status: 'queued',
      to: '+15551112222',
      from: '+15553334444',
      dateCreated: '2026-07-23T12:00:00Z',
    });
  });

  it('dispatches the same neutral command to an explicit CallRail selection', async () => {
    await expect(
      sendMessage({ marker: 'env' }, command, { provider: 'callrail' }),
    ).resolves.toMatchObject({
      provider: 'callrail',
      accepted: true,
    });
    expect(h.callrail).toHaveBeenCalledWith(
      { marker: 'env' },
      command,
      { db: undefined },
    );
  });

  it.each(['toString', 'unknown'])(
    'fails closed for unsupported provider %s without calling Twilio',
    async (provider) => {
      await expect(
        sendMessage({}, command, { provider }),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_MESSAGING_PROVIDER',
        message: `Unsupported messaging provider: ${provider}`,
      });
      expect(h.twilio).not.toHaveBeenCalled();
      expect(h.callrail).not.toHaveBeenCalled();
    },
  );

  it('fails closed when provider selection is omitted or disabled', async () => {
    await expect(sendMessage({}, command)).rejects.toMatchObject({
      code: 'MESSAGING_SEND_DISABLED',
    });
    await expect(
      sendMessage({}, command, { provider: 'disabled' }),
    ).rejects.toMatchObject({
      code: 'MESSAGING_SEND_DISABLED',
    });
    expect(h.twilio).not.toHaveBeenCalled();
    expect(h.callrail).not.toHaveBeenCalled();
  });

  it('resolves only the three allowed server modes and defaults unknown values to disabled', () => {
    expect(resolveMessagingSendMode({ MESSAGING_SEND_MODE: 'twilio' })).toBe('twilio');
    expect(resolveMessagingSendMode({ MESSAGING_SEND_MODE: 'callrail' })).toBe('callrail');
    expect(resolveMessagingSendMode({ MESSAGING_SEND_MODE: 'disabled' })).toBe('disabled');
    expect(resolveMessagingSendMode({ MESSAGING_SEND_MODE: 'TWILIO' })).toBe('disabled');
    expect(resolveMessagingSendMode({ MESSAGING_SEND_MODE: 'anything' })).toBe('disabled');
    expect(resolveMessagingSendMode({})).toBe('disabled');
  });

  it('uses legacy persistence until the applied schema is explicitly enabled', () => {
    expect(resolveMessagingSchemaMode({})).toBe('legacy');
    expect(resolveMessagingSchemaMode({ MESSAGING_SCHEMA_MODE: 'legacy' })).toBe('legacy');
    expect(resolveMessagingSchemaMode({ MESSAGING_SCHEMA_MODE: 'FOUNDATION' })).toBe('legacy');
    expect(resolveMessagingSchemaMode({ MESSAGING_SCHEMA_MODE: 'foundation' })).toBe('foundation');
  });

  it('gives Twilio a short-lived URL for canonical private media', async () => {
    const db = {
      signStorage: vi.fn(async () => 'https://db.test/signed/photo.jpg?token=x'),
    };
    const privateCommand = {
      ...command,
      content: {
        ...command.content,
        mediaUrls: ['upr-storage://message-attachments/outbound/c/photo.jpg'],
        media: [{
          storagePath: 'outbound/c/photo.jpg',
          verified: true,
          mimeType: 'image/jpeg',
          byteSize: 10,
          bytes: new Uint8Array([1]),
        }],
      },
    };
    await sendMessage({}, privateCommand, { provider: 'twilio', db });
    expect(db.signStorage).toHaveBeenCalledWith(
      'message-attachments',
      'outbound/c/photo.jpg',
      3600,
    );
    expect(h.twilio).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        mediaUrls: ['https://db.test/signed/photo.jpg?token=x'],
      }),
    );
  });

  it('refuses unverified Twilio media even when a URL is present', async () => {
    await expect(sendMessage({}, {
      ...command,
      content: {
        ...command.content,
        media: [],
      },
    }, { provider: 'twilio' })).rejects.toMatchObject({
      code: 'MESSAGE_MEDIA_UNVERIFIED',
    });
    expect(h.twilio).not.toHaveBeenCalled();
  });
});
