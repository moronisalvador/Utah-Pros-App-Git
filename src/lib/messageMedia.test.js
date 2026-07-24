/**
 * ════════════════════════════════════════════════
 * FILE: messageMedia.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that conversation photo attachments accept only supported files,
 *   upload with the signed-in user's access, and return private references.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./messageMedia.js
 *   Data:      reads  → none
 *              writes → none (network calls are mocked)
 *
 * NOTES / GOTCHAS:
 *   - Small provider-safe images must upload without browser image decoding.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MESSAGE_ATTACHMENTS,
  uploadConversationMedia,
  validateMessageFile,
} from './messageMedia.js';

const CONVERSATION = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('message media browser helper', () => {
  it('keeps the current CallRail-compatible one-image envelope', () => {
    expect(MAX_MESSAGE_ATTACHMENTS).toBe(1);
    expect(validateMessageFile(
      new File(['GIF89a'], 'photo.gif', { type: 'image/gif' }),
    )).toEqual({ ok: true });
    expect(validateMessageFile(
      new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
    ).ok).toBe(false);
  });

  it('uploads GIF bytes through the authenticated worker and returns only a private reference', async () => {
    const reference =
      `upr-storage://message-attachments/outbound/${CONVERSATION}/photo.gif`;
    const fetchMock = vi.fn(async (_url, options) => {
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('conversation_id')).toBe(CONVERSATION);
      return new Response(JSON.stringify({
        reference,
        mime_type: 'image/gif',
        byte_size: 6,
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadConversationMedia(
      { apiKey: 'user-token' },
      CONVERSATION,
      new File(['GIF89a'], 'photo.gif', { type: 'image/gif' }),
    )).resolves.toEqual({
      url: reference,
      reference,
      mimeType: 'image/gif',
      byteSize: 6,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/message-media-upload',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer user-token' },
      }),
    );
  });

  it('uploads an already-provider-safe PNG without requiring browser image decoding', async () => {
    const reference =
      `upr-storage://message-attachments/outbound/${CONVERSATION}/photo.png`;
    const createImageBitmapMock = vi.fn(() => {
      throw new Error('small provider-safe images must not be decoded');
    });
    const fetchMock = vi.fn(async (_url, options) => {
      const uploaded = options.body.get('file');
      expect(uploaded).toBeInstanceOf(File);
      expect(uploaded.name).toBe('photo.png');
      expect(uploaded.type).toBe('image/png');
      return new Response(JSON.stringify({
        reference,
        mime_type: 'image/png',
        byte_size: uploaded.size,
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadConversationMedia(
      { apiKey: 'fresh-user-token' },
      CONVERSATION,
      new File([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ], 'photo.png', { type: 'image/png' }),
    )).resolves.toEqual({
      url: reference,
      reference,
      mimeType: 'image/png',
      byteSize: 9,
    });
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

});
