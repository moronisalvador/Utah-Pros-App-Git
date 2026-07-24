import { describe, expect, it, vi } from 'vitest';
import {
  CALLRAIL_MMS_BUCKET,
  CALLRAIL_MMS_FETCH_TIMEOUT_MS,
  CALLRAIL_MMS_MAX_ITEMS,
  ingestCallrailMms,
  ingestVerifiedCallrailEventMms,
  validateCallrailMediaEndpoint,
  validateCallrailMmsCount,
} from './callrail-mms.js';

vi.mock('./callrail-messaging.js', () => ({
  resolveCallRailApiKey: vi.fn(async () => 'server-secret'),
}));
vi.mock('./callrail-api.js', () => ({
  resolveCallRailAccountId: vi.fn(async () => 'ACC123'),
  resolveCallRailAccountAliases: vi.fn(async () => ['ACC123', '635117922']),
}));
import {
  resolveCallRailAccountAliases,
  resolveCallRailAccountId,
} from './callrail-api.js';

const MEDIA_URL =
  'https://api.callrail.com/v3/a/ACC123/text-messages/SCIabc/media/0';
const LIVE_APP_MEDIA_URL =
  'https://app.callrail.com/msg/a/635117922/messages/SCIabc/media/0';
const SIGNED_ASSET_URL =
  'https://calltrk-mms-media-prod1.s3.amazonaws.com/object-key' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
  '&X-Amz-Date=20260724T145146Z' +
  '&X-Amz-Expires=300' +
  '&X-Amz-SignedHeaders=host' +
  '&X-Amz-Signature=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INPUT = {
  apiKey: 'server-secret',
  accountId: 'ACC123',
  companyResourceId: 'COM456',
  providerConversationId: 'conv789',
  providerMessageId: 'SCIabc',
  mediaCount: 1,
  ephemeralMediaUrls: [MEDIA_URL],
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const GIF87A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01]);
const GIF89A = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01]);

function mediaResponse(bytes, contentType, extraHeaders = {}) {
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
    fetchImpl: vi.fn(async () => mediaResponse(JPEG, 'image/jpeg')),
  };
}

describe('CallRail MMS private ingestion', () => {
  it('downloads the signed-webhook URL only after exact CallRail account validation', async () => {
    const h = harness();
    const result = await ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl, timeoutMs: 3210 },
    );

    expect(h.fetchImpl).toHaveBeenCalledWith(
      MEDIA_URL,
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({
          Authorization: 'Token token="server-secret"',
        }),
      }),
      3210,
    );
    expect(h.db.uploadStorage).toHaveBeenCalledWith(
      CALLRAIL_MMS_BUCKET,
      expect.stringMatching(
        /^callrail\/COM456\/conv789\/SCIabc\/0-[a-f0-9]{16}\.jpg$/,
      ),
      expect.any(Uint8Array),
      'image/jpeg',
    );
    expect(result.media[0]).toMatchObject({
      bucket: 'message-attachments',
      contentType: 'image/jpeg',
      byteSize: JPEG.byteLength,
      storageRef: expect.stringMatching(
        /^upr-storage:\/\/message-attachments\/callrail\/COM456\/conv789\/SCIabc\//,
      ),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain('api.callrail.com');
    expect(JSON.stringify(result)).not.toContain('server-secret');
  });

  it('accepts the captured CallRail app endpoint only for a proven account alias', async () => {
    const h = harness();
    h.fetchImpl
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: SIGNED_ASSET_URL },
      }))
      .mockResolvedValueOnce(mediaResponse(JPEG, 'image/jpeg'));

    const result = await ingestCallrailMms({
      ...INPUT,
      db: h.db,
      accountAliases: ['635117922'],
      ephemeralMediaUrls: [LIVE_APP_MEDIA_URL],
    }, { fetchImpl: h.fetchImpl });

    expect(result.itemCount).toBe(1);
    expect(h.fetchImpl).toHaveBeenNthCalledWith(
      1,
      LIVE_APP_MEDIA_URL,
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({
          Authorization: 'Token token="server-secret"',
        }),
      }),
      CALLRAIL_MMS_FETCH_TIMEOUT_MS,
    );
    expect(h.fetchImpl).toHaveBeenNthCalledWith(
      2,
      SIGNED_ASSET_URL,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'image/jpeg, image/png, image/gif',
        },
      }),
      CALLRAIL_MMS_FETCH_TIMEOUT_MS,
    );
  });

  it.each([
    ['image/png; charset=binary', PNG, '.png'],
    ['image/gif', GIF87A, '.gif'],
    ['image/gif; charset=binary', GIF89A, '.gif'],
  ])('accepts verified %s media', async (contentType, bytes, extension) => {
    const h = harness();
    h.fetchImpl.mockResolvedValue(mediaResponse(bytes, contentType));
    const result = await ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    );
    expect(result.media[0].storagePath.endsWith(extension)).toBe(true);
  });

  it('rejects media URLs outside the resolved CallRail account', () => {
    expect(() => validateCallrailMediaEndpoint({
      accountId: 'ACC123',
      providerMessageId: 'SCIabc',
      index: 0,
      mediaUrl: 'https://attacker.test/v3/a/ACC123/private',
    })).toThrowError(expect.objectContaining({ code: 'CALLRAIL_MMS_URL_INVALID' }));
    expect(() => validateCallrailMediaEndpoint({
      accountId: 'ACC123',
      providerMessageId: 'SCIabc',
      index: 0,
      mediaUrl: 'https://api.callrail.com/v3/a/OTHER/private',
    })).toThrowError(expect.objectContaining({ code: 'CALLRAIL_MMS_URL_INVALID' }));
    expect(() => validateCallrailMediaEndpoint({
      accountId: 'ACC123',
      providerMessageId: 'SCIother',
      index: 0,
      mediaUrl: MEDIA_URL,
    })).toThrowError(expect.objectContaining({ code: 'CALLRAIL_MMS_URL_INVALID' }));
    expect(() => validateCallrailMediaEndpoint({
      accountId: 'ACC123',
      providerMessageId: 'SCIabc',
      index: 1,
      mediaUrl: MEDIA_URL,
    })).toThrowError(expect.objectContaining({ code: 'CALLRAIL_MMS_URL_INVALID' }));
  });

  it('refuses redirects outside CallRail MMS storage without uploading', async () => {
    const h = harness();
    h.fetchImpl.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.test/file' },
    }));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    )).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_REDIRECT_REJECTED',
      retryable: false,
    });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared object before reading or uploading', async () => {
    const h = harness();
    h.fetchImpl.mockResolvedValue(mediaResponse(JPEG, 'image/jpeg', {
      'Content-Length': '5000001',
    }));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    )).rejects.toMatchObject({ code: 'CALLRAIL_MMS_SIZE_UNSUPPORTED' });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('enforces the stream cap when Content-Length is absent or dishonest', async () => {
    const h = harness();
    const oversized = new Uint8Array(5_000_001);
    oversized.set(JPEG);
    h.fetchImpl.mockResolvedValue(new Response(oversized, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    )).rejects.toMatchObject({ code: 'CALLRAIL_MMS_SIZE_UNSUPPORTED' });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('rejects a MIME claim whose bytes have the wrong magic signature', async () => {
    const h = harness();
    h.fetchImpl.mockResolvedValue(mediaResponse(
      new TextEncoder().encode('<html>not an image</html>'),
      'image/jpeg',
    ));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    )).rejects.toMatchObject({ code: 'CALLRAIL_MMS_SIGNATURE_INVALID' });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('rejects a declared GIF without a GIF87a or GIF89a signature', async () => {
    const h = harness();
    h.fetchImpl.mockResolvedValue(mediaResponse(
      new TextEncoder().encode('GIF00a-not-supported'),
      'image/gif',
    ));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    )).rejects.toMatchObject({ code: 'CALLRAIL_MMS_SIGNATURE_INVALID' });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('enforces caller-visible count and aggregate limits', async () => {
    expect(() => validateCallrailMmsCount(CALLRAIL_MMS_MAX_ITEMS + 1))
      .toThrowError(expect.objectContaining({ code: 'CALLRAIL_MMS_COUNT_UNSUPPORTED' }));

    const h = harness();
    h.fetchImpl.mockResolvedValue(mediaResponse(JPEG, 'image/jpeg'));
    await expect(ingestCallrailMms(
      {
        ...INPUT,
        db: h.db,
        mediaCount: 2,
        ephemeralMediaUrls: [MEDIA_URL, `${MEDIA_URL.slice(0, -1)}1`],
      },
      {
        fetchImpl: h.fetchImpl,
        limits: { maxItems: 2, maxObjectBytes: 6, maxTotalBytes: 10 },
      },
    )).rejects.toMatchObject({ code: 'CALLRAIL_MMS_SIZE_UNSUPPORTED' });
    expect(h.db.uploadStorage).toHaveBeenCalledTimes(1);
  });

  it('makes download and private-storage failures retryable without leaking details', async () => {
    const h = harness();
    h.fetchImpl.mockRejectedValue(new Error('network secret detail'));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h.db },
      { fetchImpl: h.fetchImpl },
    )).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_DOWNLOAD_FAILED',
      retryable: true,
      message: 'CallRail MMS media could not be downloaded.',
    });

    const h2 = harness();
    h2.db.uploadStorage.mockRejectedValue(new Error('storage internal detail'));
    await expect(ingestCallrailMms(
      { ...INPUT, db: h2.db },
      { fetchImpl: h2.fetchImpl },
    )).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_STORAGE_FAILED',
      retryable: true,
      message: 'CallRail MMS media could not be stored.',
    });
  });

  it.each([404, 410])(
    'retains an expired media endpoint returning %s for bounded URL refresh',
    async (status) => {
      const h = harness();
      h.fetchImpl.mockResolvedValue(new Response(null, { status }));

      await expect(ingestCallrailMms(
        { ...INPUT, db: h.db },
        { fetchImpl: h.fetchImpl },
      )).rejects.toMatchObject({
        code: 'CALLRAIL_MMS_DOWNLOAD_REJECTED',
        retryable: true,
        status,
      });
      expect(h.db.uploadStorage).not.toHaveBeenCalled();
    },
  );

  it('uses the signed webhook media endpoint immediately without conversation refresh', async () => {
    const h = harness();
    const event = {
      providerConversationId: 'conv789',
      providerMessageId: 'SCIabc',
      companyResourceId: 'COM456',
      mediaCount: 1,
      ephemeralMediaUrls: [MEDIA_URL],
      direction: 'inbound',
      messageType: 'mms',
      body: '',
    };

    await ingestVerifiedCallrailEventMms(
      { db: h.db, env: {}, event },
      { fetchImpl: h.fetchImpl },
    );

    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.fetchImpl).toHaveBeenCalledWith(
      MEDIA_URL,
      expect.any(Object),
      CALLRAIL_MMS_FETCH_TIMEOUT_MS,
    );
  });

  it('accepts a masked media account only after CallRail proves its numeric alias', async () => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockResolvedValueOnce(['635117922', 'ACC123']);
    const event = {
      providerConversationId: 'conv789',
      providerMessageId: 'SCIabc',
      companyResourceId: 'COM456',
      mediaCount: 1,
      ephemeralMediaUrls: [MEDIA_URL],
      direction: 'inbound',
      messageType: 'mms',
      body: '',
    };

    const result = await ingestVerifiedCallrailEventMms(
      { db: h.db, env: {}, event },
      { fetchImpl: h.fetchImpl },
    );

    expect(resolveCallRailAccountAliases).toHaveBeenCalledWith(
      'server-secret',
      '635117922',
      { fetcher: h.fetchImpl },
    );
    expect(result.itemCount).toBe(1);
    expect(h.db.uploadStorage).toHaveBeenCalledTimes(1);
  });

  it('fails closed when CallRail cannot prove a mismatched media account', async () => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockResolvedValueOnce(null);

    await expect(ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ephemeralMediaUrls: [MEDIA_URL],
        direction: 'inbound',
        messageType: 'mms',
        body: '',
      },
    }, { fetchImpl: h.fetchImpl })).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_URL_INVALID',
      retryable: false,
    });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('retains a mismatched-account MMS for retry when alias discovery is unavailable', async () => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ephemeralMediaUrls: [MEDIA_URL],
        direction: 'inbound',
        messageType: 'mms',
        body: '',
      },
    }, { fetchImpl: h.fetchImpl })).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_ACCOUNT_ALIAS_UNAVAILABLE',
      retryable: true,
    });
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('does not retry a mismatched-account MMS when CallRail rejects the credential', async () => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockRejectedValueOnce({
      code: 'CALLRAIL_CREDENTIAL_REJECTED',
    });

    await expect(ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ephemeralMediaUrls: [MEDIA_URL],
        direction: 'inbound',
        messageType: 'mms',
        body: '',
      },
    }, { fetchImpl: h.fetchImpl })).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_ACCOUNT_ALIAS_REJECTED',
      retryable: false,
    });
  });

  it('retains rate-limited account discovery for bounded retry', async () => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockRejectedValueOnce({
      code: 'CALLRAIL_DISCOVERY_RATE_LIMITED',
    });

    await expect(ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ephemeralMediaUrls: [MEDIA_URL],
        direction: 'inbound',
        messageType: 'mms',
        body: '',
      },
    }, { fetchImpl: h.fetchImpl })).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_ACCOUNT_ALIAS_UNAVAILABLE',
      retryable: true,
    });
  });

  it('refreshes a queue retry from the matching conversation media path', async () => {
    const h = harness();
    h.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        messages: [{
          id: 12345,
          content: 'Photo',
          direction: 'incoming',
          type: 'MMS',
          media_urls: [MEDIA_URL],
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(mediaResponse(JPEG, 'image/jpeg'));

    const result = await ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ownedMedia: [],
        direction: 'inbound',
        messageType: 'mms',
        body: 'Photo',
      },
    }, { fetchImpl: h.fetchImpl });

    expect(result.itemCount).toBe(1);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    expect(h.fetchImpl.mock.calls[0][0]).toContain(
      '/text-messages/conv789.json?per_page=250',
    );
    expect(h.fetchImpl.mock.calls[1][0]).toBe(MEDIA_URL);
  });

  it('refreshes a queue retry across the proven numeric-to-masked account alias', async () => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockResolvedValueOnce(['635117922', 'ACC123']);
    h.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        messages: [{
          id: 12345,
          content: 'Photo',
          direction: 'incoming',
          type: 'MMS',
          media_urls: [MEDIA_URL],
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(mediaResponse(JPEG, 'image/jpeg'));

    const result = await ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ownedMedia: [],
        direction: 'inbound',
        messageType: 'mms',
        body: 'Photo',
      },
    }, { fetchImpl: h.fetchImpl });

    expect(resolveCallRailAccountAliases).toHaveBeenCalledWith(
      'server-secret',
      '635117922',
      { fetcher: h.fetchImpl },
    );
    expect(result.itemCount).toBe(1);
    expect(h.fetchImpl.mock.calls[1][0]).toBe(MEDIA_URL);
  });

  it.each([
    ['numeric first', [
      'https://api.callrail.com/v3/a/635117922/text-messages/SCIabc/media/0',
      MEDIA_URL,
    ]],
    ['masked first', [
      MEDIA_URL,
      'https://api.callrail.com/v3/a/635117922/text-messages/SCIabc/media/0',
    ]],
  ])('keeps mixed-account-alias history ambiguous with %s', async (_label, mediaUrls) => {
    const h = harness();
    resolveCallRailAccountId.mockResolvedValueOnce('635117922');
    resolveCallRailAccountAliases.mockResolvedValueOnce(['635117922', 'ACC123']);
    h.fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      messages: mediaUrls.map((mediaUrl, index) => ({
        id: index + 1,
        content: 'Photo',
        direction: 'incoming',
        type: 'MMS',
        media_urls: [mediaUrl],
      })),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(ingestVerifiedCallrailEventMms({
      db: h.db,
      env: {},
      event: {
        providerConversationId: 'conv789',
        providerMessageId: 'SCIabc',
        companyResourceId: 'COM456',
        mediaCount: 1,
        ownedMedia: [],
        direction: 'inbound',
        messageType: 'mms',
        body: 'Photo',
      },
    }, { fetchImpl: h.fetchImpl })).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_URL_REFRESH_AMBIGUOUS',
      retryable: false,
    });
  });

  it('fails closed when refreshed conversation media is absent or ambiguous', async () => {
    const event = {
      providerConversationId: 'conv789',
      providerMessageId: 'SCIabc',
      companyResourceId: 'COM456',
      mediaCount: 1,
      ownedMedia: [],
      direction: 'inbound',
      messageType: 'mms',
      body: 'Photo',
    };
    const none = harness();
    none.fetchImpl.mockResolvedValue(new Response(JSON.stringify({ messages: [] }), {
      status: 200,
    }));
    await expect(ingestVerifiedCallrailEventMms(
      { db: none.db, env: {}, event },
      { fetchImpl: none.fetchImpl },
    )).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_URLS_UNAVAILABLE',
      retryable: true,
    });

    const duplicate = {
      id: 1,
      content: 'Photo',
      direction: 'incoming',
      type: 'mms',
      media_urls: [MEDIA_URL],
    };
    const ambiguous = harness();
    ambiguous.fetchImpl.mockResolvedValue(new Response(JSON.stringify({
      messages: [duplicate, { ...duplicate, id: 2 }],
    }), { status: 200 }));
    await expect(ingestVerifiedCallrailEventMms(
      { db: ambiguous.db, env: {}, event },
      { fetchImpl: ambiguous.fetchImpl },
    )).rejects.toMatchObject({
      code: 'CALLRAIL_MMS_URL_REFRESH_AMBIGUOUS',
      retryable: false,
    });
  });
});
