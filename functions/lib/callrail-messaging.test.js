/**
 * ════════════════════════════════════════════════
 * FILE: callrail-messaging.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that the CallRail sender accepts only one staff-written message,
 *   validates CallRail's content and picture limits, and never retries an
 *   uncertain provider request. All credentials and network responses are fake;
 *   these tests never contact CallRail or the database.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./callrail-messaging.js
 *   Data:      none (mocked)
 *
 * NOTES / GOTCHAS:
 *   - The adapter is deliberately unregistered and cannot send production traffic.
 *   - Timeout/network failures are marked ambiguous and non-resubmittable.
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: { select: vi.fn() },
  fetchWithTimeout: vi.fn(),
  resolveCallRailAccountId: vi.fn(),
}));

vi.mock('./supabase.js', () => ({ supabase: () => h.db }));
vi.mock('./http.js', () => ({ fetchWithTimeout: h.fetchWithTimeout }));
vi.mock('./callrail-api.js', () => ({
  resolveCallRailAccountId: h.resolveCallRailAccountId,
}));

import {
  CallRailMessagingError,
  sendCallRailMessage,
} from './callrail-messaging.js';

const env = {
  SUPABASE_URL: 'https://project.example',
  CALLRAIL_COMPANY_ID: 'COM-company',
  CALLRAIL_TRACKING_NUMBER: '+18015550100',
};

const command = {
  purpose: 'staff_p2p',
  recipient: { address: '+18015550101' },
  content: { body: 'Hello from Utah Pros', media: [] },
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);

function response(status, data = {}) {
  return {
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

async function expectCode(promise, code, properties = {}) {
  await expect(promise).rejects.toMatchObject({
    name: 'CallRailMessagingError',
    code,
    ...properties,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.select.mockResolvedValue([{ access_token: 'callrail-secret' }]);
  h.resolveCallRailAccountId.mockResolvedValue('ACC-account');
  h.fetchWithTimeout.mockResolvedValue(response(201, {
    id: 'conversation-1',
    customer_phone_number: '+18015550101',
    current_tracking_number: '+18015550100',
  }));
});

describe('sendCallRailMessage restrictions', () => {
  it.each([
    undefined,
    'automated',
    'scheduled',
    'group',
    'broadcast',
    'bulk',
    'campaign',
  ])('rejects purpose %s before credentials or network access', async (purpose) => {
    await expectCode(
      sendCallRailMessage(env, { ...command, purpose }),
      'CALLRAIL_PURPOSE_UNSUPPORTED'
    );
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.resolveCallRailAccountId).not.toHaveBeenCalled();
    expect(h.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'CALLRAIL_DESTINATION_INVALID'],
    ['+441234567890', 'CALLRAIL_DESTINATION_INVALID'],
    ['+11015550101', 'CALLRAIL_DESTINATION_INVALID'],
  ])('rejects invalid destination %s', async (address, code) => {
    await expectCode(
      sendCallRailMessage(env, { ...command, recipient: { address } }),
      code
    );
    expect(h.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('requires non-blank content', async () => {
    await expectCode(
      sendCallRailMessage(env, {
        ...command,
        content: { body: '   ', media: [] },
      }),
      'CALLRAIL_CONTENT_REQUIRED'
    );
  });

  it('accepts 140 final characters and rejects 141', async () => {
    await sendCallRailMessage(env, {
      ...command,
      content: { body: '🙂'.repeat(140), media: [] },
    });
    expect(h.fetchWithTimeout).toHaveBeenCalledTimes(1);

    await expectCode(
      sendCallRailMessage(env, {
        ...command,
        content: { body: '🙂'.repeat(141), media: [] },
      }),
      'CALLRAIL_CONTENT_TOO_LONG'
    );
    expect(h.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it.each([
    [[
      { url: 'https://cdn.example/one.jpg', mimeType: 'image/jpeg', byteSize: 10 },
      { bytes: JPEG, mimeType: 'image/jpeg', byteSize: JPEG.byteLength },
    ], 'CALLRAIL_MEDIA_COUNT_UNSUPPORTED'],
    [[
      { bytes: JPEG, mimeType: 'application/pdf', byteSize: JPEG.byteLength },
    ], 'CALLRAIL_MEDIA_TYPE_UNSUPPORTED'],
    [[
      { bytes: JPEG, mimeType: 'image/jpeg', byteSize: 5_000_001 },
    ], 'CALLRAIL_MEDIA_SIZE_UNSUPPORTED'],
    [[
      { url: 'https://cdn.example/image.jpg', mimeType: 'image/jpeg', byteSize: 10 },
    ], 'CALLRAIL_MEDIA_BYTES_REQUIRED'],
    [[
      { bytes: new TextEncoder().encode('<html>'), mimeType: 'image/jpeg', byteSize: 6 },
    ], 'CALLRAIL_MEDIA_SIGNATURE_INVALID'],
  ])('rejects incompatible media %#', async (media, code) => {
    await expectCode(
      sendCallRailMessage(env, { ...command, content: { ...command.content, media } }),
      code
    );
    expect(h.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('accepts one supported image at the 5 MB boundary', async () => {
    const gif = new Uint8Array(5_000_000);
    gif.set(new TextEncoder().encode('GIF89a'));
    await sendCallRailMessage(env, {
      ...command,
      content: {
        body: 'Photo attached',
        media: [{
          bytes: gif,
          mimeType: 'image/gif',
          byteSize: gif.byteLength,
          fileName: 'image.gif',
        }],
      },
    });

    const [, options] = h.fetchWithTimeout.mock.calls[0];
    expect(options.headers).toEqual({
      Authorization: 'Token token="callrail-secret"',
    });
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('content')).toBe('Photo attached');
    const uploaded = options.body.get('media_file');
    expect(uploaded.type).toBe('image/gif');
    expect(uploaded.size).toBe(5_000_000);
  });
});

describe('sendCallRailMessage configuration and submission', () => {
  it('uses server-side credentials/config and returns normalized acceptance', async () => {
    const result = await sendCallRailMessage(env, command);

    expect(h.db.select).toHaveBeenCalledWith(
      'integration_credentials',
      'provider=eq.callrail&select=access_token'
    );
    expect(h.resolveCallRailAccountId).toHaveBeenCalledWith(
      h.db,
      'callrail-secret',
      env
    );
    expect(h.fetchWithTimeout).toHaveBeenCalledTimes(1);

    const [url, options] = h.fetchWithTimeout.mock.calls[0];
    expect(url).toBe(
      'https://api.callrail.com/v3/a/ACC-account/text-messages.json'
    );
    expect(options).toEqual({
      method: 'POST',
      headers: {
        Authorization: 'Token token="callrail-secret"',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        company_id: 'COM-company',
        customer_phone_number: '+18015550101',
        tracking_number: '+18015550100',
        content: 'Hello from Utah Pros',
      }),
    });
    expect(result).toEqual({
      provider: 'callrail',
      providerMessageId: null,
      providerConversationId: 'conversation-1',
      accepted: true,
      status: 'queued',
      providerStatus: 'accepted',
      providerHttpStatus: 201,
      sentAt: null,
      from: '+18015550100',
      to: '+18015550101',
      rawReference: null,
    });
  });

  it('accepts CallRail live HTTP 200 contract with a conversation identity', async () => {
    h.fetchWithTimeout.mockResolvedValue(response(200, {
      id: 'conversation-live-200',
      customer_phone_number: '+18015550101',
      current_tracking_number: '+18015550100',
    }));

    const result = await sendCallRailMessage(env, command);

    expect(result).toMatchObject({
      provider: 'callrail',
      providerConversationId: 'conversation-live-200',
      accepted: true,
      providerHttpStatus: 200,
    });
  });

  it('falls back to a server-only API key when credential storage is unavailable', async () => {
    h.db.select.mockRejectedValue(new Error('database unavailable'));

    await sendCallRailMessage({ ...env, CALLRAIL_API_KEY: 'fallback-secret' }, command);

    expect(h.resolveCallRailAccountId).toHaveBeenCalledWith(
      h.db,
      'fallback-secret',
      expect.any(Object)
    );
  });

  it('requires API key, account id, company id, and tracking number configuration', async () => {
    h.db.select.mockResolvedValue([]);
    await expectCode(
      sendCallRailMessage(env, command),
      'CALLRAIL_API_KEY_MISSING'
    );

    h.db.select.mockResolvedValue([{ access_token: 'callrail-secret' }]);
    h.resolveCallRailAccountId.mockResolvedValue(null);
    await expectCode(
      sendCallRailMessage(env, command),
      'CALLRAIL_ACCOUNT_ID_MISSING'
    );

    h.resolveCallRailAccountId.mockResolvedValue('ACC-account');
    await expectCode(
      sendCallRailMessage({ ...env, CALLRAIL_COMPANY_ID: '' }, command),
      'CALLRAIL_COMPANY_ID_MISSING'
    );

    await expectCode(
      sendCallRailMessage({ ...env, CALLRAIL_TRACKING_NUMBER: '' }, command),
      'CALLRAIL_TRACKING_NUMBER_INVALID'
    );
    expect(h.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('normalizes ordinary 10-digit recipient and tracking numbers', async () => {
    await sendCallRailMessage(
      { ...env, CALLRAIL_TRACKING_NUMBER: '(801) 555-0100' },
      { ...command, recipient: { address: '801-555-0101' } }
    );

    const [, options] = h.fetchWithTimeout.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      customer_phone_number: '+18015550101',
      tracking_number: '+18015550100',
    });
  });
});

describe('sendCallRailMessage provider failures', () => {
  it.each([400, 401, 403, 404, 422])(
    'sanitizes provider rejection %i',
    async (status) => {
      h.fetchWithTimeout.mockResolvedValue(response(status, {
        error: 'secret upstream detail containing customer content',
      }));

      await expectCode(
        sendCallRailMessage(env, command),
        'CALLRAIL_REJECTED',
        { status, retryable: false, ambiguous: false }
      );
    }
  );

  it('classifies 429 without retrying', async () => {
    h.fetchWithTimeout.mockResolvedValue(response(429, { error: 'limit detail' }));

    await expectCode(
      sendCallRailMessage(env, command),
      'CALLRAIL_RATE_LIMITED',
      { status: 429, retryable: true, ambiguous: false }
    );
    expect(h.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it.each([500, 503])('marks provider error %i ambiguous without retrying', async (status) => {
    h.fetchWithTimeout.mockResolvedValue(response(status));

    await expectCode(
      sendCallRailMessage(env, command),
      'CALLRAIL_SEND_AMBIGUOUS',
      { status, retryable: false, ambiguous: true, reconciliationRequired: true }
    );
    expect(h.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it.each([
    Object.assign(new Error('request timed out with secret'), { name: 'TimeoutError' }),
    new Error('connection reset after upload'),
  ])('marks thrown network result ambiguous and never retries', async (upstreamError) => {
    h.fetchWithTimeout.mockRejectedValue(upstreamError);

    let error;
    try {
      await sendCallRailMessage(env, command);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CallRailMessagingError);
    expect(error).toMatchObject({
      code: 'CALLRAIL_SEND_AMBIGUOUS',
      message: 'CallRail did not return a conclusive response.',
      retryable: false,
      ambiguous: true,
      reconciliationRequired: true,
    });
    expect(error.message).not.toContain(upstreamError.message);
    expect(h.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it.each([
    [200, { unexpected: true }],
    [201, { id: '   ' }],
    [201, { id: { nested: 'not a provider identity' } }],
  ])('marks malformed accepted response %i ambiguous', async (status, body) => {
    h.fetchWithTimeout.mockResolvedValue(response(status, body));

    await expectCode(
      sendCallRailMessage(env, command),
      'CALLRAIL_SEND_AMBIGUOUS',
      { status, ambiguous: true, reconciliationRequired: true },
    );
  });

  it.each([202, 204])(
    'does not accept unsupported successful response %i',
    async (status) => {
      h.fetchWithTimeout.mockResolvedValue(response(status, {
        id: 'conversation-unsupported-status',
      }));

      await expectCode(
        sendCallRailMessage(env, command),
        'CALLRAIL_SEND_AMBIGUOUS',
        { status, ambiguous: true, reconciliationRequired: true },
      );
    },
  );
});
