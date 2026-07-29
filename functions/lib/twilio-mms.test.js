/**
 * ════════════════════════════════════════════════
 * FILE: twilio-mms.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves incoming Twilio pictures are accepted only from the matching account
 *   and message, checked as real images, bounded, and saved to private paths.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio-mms.js
 *   Data:      reads  → simulated Twilio Media responses
 *              writes → simulated message-attachments Storage objects
 *
 * NOTES / GOTCHAS:
 *   - Provider failures are split into retryable and permanent outcomes.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ingestTwilioMms,
  TWILIO_MMS_BUCKET,
  TWILIO_MMS_FETCH_TIMEOUT_MS,
  validateTwilioMediaUrl,
} from './twilio-mms.js';

const ACCOUNT = `AC${'a'.repeat(32)}`;
const MESSAGE = `MM${'b'.repeat(32)}`;
const MEDIA = `ME${'c'.repeat(32)}`;
const MEDIA_URL =
  `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}` +
  `/Messages/${MESSAGE}/Media/${MEDIA}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);

function response(bytes = JPEG, contentType = 'image/jpeg', extraHeaders = {}) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      ...extraHeaders,
    },
  });
}

function harness() {
  return {
    db: { uploadStorage: vi.fn(async () => true) },
    fetchImpl: vi.fn(async () => response()),
  };
}

describe('Twilio inbound MMS private ownership', () => {
  it('accepts only the exact signed account/message/media URL', () => {
    expect(validateTwilioMediaUrl({
      accountSid: ACCOUNT,
      messageSid: MESSAGE,
      mediaUrl: MEDIA_URL,
    })).toEqual({ url: MEDIA_URL, mediaSid: MEDIA });

    for (const bad of [
      MEDIA_URL.replace('api.twilio.com', 'attacker.test'),
      MEDIA_URL.replace(ACCOUNT, `AC${'d'.repeat(32)}`),
      MEDIA_URL.replace(MESSAGE, `MM${'e'.repeat(32)}`),
      `${MEDIA_URL}?download=true`,
      `${MEDIA_URL}.json`,
    ]) {
      expect(() => validateTwilioMediaUrl({
        accountSid: ACCOUNT,
        messageSid: MESSAGE,
        mediaUrl: bad,
      })).toThrowError(expect.objectContaining({ code: 'TWILIO_MMS_URL_INVALID' }));
    }
  });

  it('downloads with bounded Basic auth and stores only an owned deterministic reference', async () => {
    const h = harness();
    const result = await ingestTwilioMms({
      db: h.db,
      accountSid: ACCOUNT,
      authToken: 'secret-token',
      messageSid: MESSAGE,
      media: [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }],
    }, {
      fetchImpl: h.fetchImpl,
    });

    expect(h.fetchImpl).toHaveBeenCalledWith(
      MEDIA_URL,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Authorization: `Basic ${btoa(`${ACCOUNT}:secret-token`)}`,
          Accept: 'image/jpeg, image/png, image/gif',
        },
      },
      TWILIO_MMS_FETCH_TIMEOUT_MS,
    );
    expect(h.db.uploadStorage).toHaveBeenCalledWith(
      TWILIO_MMS_BUCKET,
      expect.stringMatching(
        new RegExp(`^twilio/${ACCOUNT}/${MESSAGE}/0-${MEDIA}-[a-f0-9]{16}\\.jpg$`),
      ),
      expect.any(Uint8Array),
      'image/jpeg',
    );
    expect(result.media[0].storageRef).toMatch(
      new RegExp(`^upr-storage://message-attachments/twilio/${ACCOUNT}/${MESSAGE}/`),
    );
    expect(JSON.stringify(result)).not.toContain('api.twilio.com');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('fails closed on content-type drift, redirects, bad bytes, and oversize media', async () => {
    const cases = [
      response(JPEG, 'image/png'),
      new Response(null, { status: 302, headers: { Location: 'https://attacker.test/file' } }),
      response(new TextEncoder().encode('<html>bad</html>'), 'image/jpeg'),
      response(JPEG, 'image/jpeg', { 'Content-Length': '5000001' }),
    ];
    const expectedCodes = [
      'TWILIO_MMS_CONTENT_TYPE_MISMATCH',
      'TWILIO_MMS_DOWNLOAD_REJECTED',
      'TWILIO_MMS_CONTENT_INVALID',
      'TWILIO_MMS_SIZE_UNSUPPORTED',
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const h = harness();
      h.fetchImpl.mockResolvedValue(cases[index]);
      await expect(ingestTwilioMms({
        db: h.db,
        accountSid: ACCOUNT,
        authToken: 'secret-token',
        messageSid: MESSAGE,
        media: [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }],
      }, {
        fetchImpl: h.fetchImpl,
      })).rejects.toMatchObject({ code: expectedCodes[index] });
      expect(h.db.uploadStorage).not.toHaveBeenCalled();
    }
  });

  it('classifies 429/5xx/network failures as retryable without storing anything', async () => {
    for (const failure of [
      new Response('busy', { status: 429 }),
      new Response('down', { status: 503 }),
      new Error('network timeout'),
    ]) {
      const h = harness();
      if (failure instanceof Response) h.fetchImpl.mockResolvedValue(failure);
      else h.fetchImpl.mockRejectedValue(failure);
      await expect(ingestTwilioMms({
        db: h.db,
        accountSid: ACCOUNT,
        authToken: 'secret-token',
        messageSid: MESSAGE,
        media: [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }],
      }, {
        fetchImpl: h.fetchImpl,
      })).rejects.toMatchObject({ retryable: true });
      expect(h.db.uploadStorage).not.toHaveBeenCalled();
    }
  });
});
