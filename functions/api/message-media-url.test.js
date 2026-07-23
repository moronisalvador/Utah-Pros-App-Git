import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/messaging-auth.js', () => ({
  requireMessagingAccess: (...args) => h.auth(...args),
}));

import { onRequestPost, ownedCallrailStoragePath } from './message-media-url.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REF = 'upr-storage://message-attachments/callrail/COM/CONV/MSG/0-hash.jpg';

function request(body) {
  return { json: async () => body };
}

beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: 'employee-1' } }));
  h.db = {
    select: vi.fn(async () => [{ id: ID, media_urls: JSON.stringify([REF]) }]),
    signStorage: vi.fn(async () => 'https://db.test/storage/v1/object/sign/test?token=x'),
  };
});

describe('private message media URL route', () => {
  it('rejects unauthorized callers before reading a message', async () => {
    h.auth.mockResolvedValue({ error: 'Unauthorized', status: 401 });
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(401);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('signs only the private reference bound to the requested message index', async () => {
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(200);
    expect(h.db.signStorage).toHaveBeenCalledWith(
      'message-attachments',
      'callrail/COM/CONV/MSG/0-hash.jpg',
      600,
    );
  });

  it('does not become a general bucket/path signer', async () => {
    h.db.select.mockResolvedValueOnce([{
      id: ID,
      media_urls: JSON.stringify(['https://provider.test/private', '../secret']),
    }]);
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(404);
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });

  it('rejects traversal and wrong buckets', () => {
    expect(ownedCallrailStoragePath(
      'upr-storage://message-attachments/callrail/../secret.jpg',
    )).toBeNull();
    expect(ownedCallrailStoragePath(
      'upr-storage://job-files/callrail/photo.jpg',
    )).toBeNull();
  });
});
