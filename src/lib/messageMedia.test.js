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

});
