import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/messaging-auth.js', () => ({
  requireMessagingAccess: (...args) => h.auth(...args),
}));

import { onRequestPost } from './message-media-upload.js';

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);

function uploadRequest(file = new File([JPEG], 'photo.jpg', { type: 'image/jpeg' })) {
  const form = new FormData();
  form.append('conversation_id', CONVERSATION);
  form.append('file', file);
  return { formData: async () => form };
}

beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: 'employee-1' } }));
  h.db = {
    select: vi.fn(async () => [{ id: CONVERSATION }]),
    uploadStorage: vi.fn(async () => true),
  };
});

describe('message media upload route', () => {
  it('authorizes, verifies, and stores one private image', async () => {
    const res = await onRequestPost({ request: uploadRequest(), env: {} });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload).toMatchObject({
      reference: expect.stringMatching(
        new RegExp(`^upr-storage://message-attachments/outbound/${CONVERSATION}/`),
      ),
      mime_type: 'image/jpeg',
      byte_size: JPEG.byteLength,
    });
    expect(h.db.uploadStorage).toHaveBeenCalledWith(
      'message-attachments',
      expect.stringMatching(new RegExp(`^outbound/${CONVERSATION}/.+\\.jpg$`)),
      expect.any(Uint8Array),
      'image/jpeg',
    );
  });

  it('rejects unauthorized and disguised uploads before storage', async () => {
    h.auth.mockResolvedValueOnce({ error: 'Unauthorized', status: 401 });
    expect((await onRequestPost({ request: uploadRequest(), env: {} })).status).toBe(401);

    const disguised = new File(['<html>'], 'photo.jpg', { type: 'image/jpeg' });
    const res = await onRequestPost({ request: uploadRequest(disguised), env: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MESSAGE_MEDIA_SIGNATURE_INVALID');
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

});
