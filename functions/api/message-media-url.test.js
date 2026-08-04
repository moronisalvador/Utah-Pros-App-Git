import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null, supabase: null }));
vi.mock('../lib/supabase.js', () => ({
  supabase: (...args) => h.supabase(...args),
}));
vi.mock('../lib/messaging-auth.js', () => ({
  requireMessagingAccess: (...args) => h.auth(...args),
}));

import { onRequestPost } from './message-media-url.js';
import { fetchWithTimeout } from '../lib/http.js';
import { ownedMessageMediaPath } from '../lib/message-media.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REF = 'upr-storage://message-attachments/callrail/COM/CONV/MSG/0-hash.jpg';

function request(body) {
  return { json: async () => body };
}

beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: 'employee-1' } }));
  h.db = {
    select: vi.fn(),
    rpc: vi.fn(async () => [{
      id: ID,
      conversation_id: 'CONV',
      media_urls: JSON.stringify([REF]),
    }]),
    signStorage: vi.fn(async () => 'https://db.test/storage/v1/object/sign/test?token=x'),
  };
  h.supabase = vi.fn(() => h.db);
});

describe('private message media URL route', () => {
  it('rejects unauthorized callers before reading a message', async () => {
    h.auth.mockResolvedValue({ error: 'Unauthorized', status: 401 });
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(401);
    expect(h.db.rpc).not.toHaveBeenCalled();
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('signs only the private reference bound to the requested message index', async () => {
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(200);
    expect(h.supabase).toHaveBeenCalledWith({}, fetchWithTimeout);
    expect(h.auth).toHaveBeenCalledWith(
      expect.anything(),
      {},
      h.db,
      fetchWithTimeout,
    );
    expect(h.db.rpc).toHaveBeenCalledWith(
      'messaging_get_authorized_message_media',
      {
        p_employee_id: 'employee-1',
        p_message_id: ID,
      },
    );
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.signStorage).toHaveBeenCalledWith(
      'message-attachments',
      'callrail/COM/CONV/MSG/0-hash.jpg',
      600,
    );
  });

  it('does not become a general bucket/path signer', async () => {
    h.db.rpc.mockResolvedValueOnce([{
      id: ID,
      conversation_id: 'CONV',
      media_urls: JSON.stringify(['https://provider.test/private', '../secret']),
    }]);
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(404);
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });

  it('hides attachments from a Conversations-capable non-participant', async () => {
    h.auth.mockResolvedValueOnce({
      employee: { id: 'crm-partner-1', role: 'crm_partner' },
    });
    h.db.rpc.mockResolvedValueOnce([]);

    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Attachment not found' });
    expect(h.db.rpc).toHaveBeenCalledWith(
      'messaging_get_authorized_message_media',
      {
        p_employee_id: 'crm-partner-1',
        p_message_id: ID,
      },
    );
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });

  it('fails closed when conversation membership cannot be verified', async () => {
    h.db.rpc.mockRejectedValueOnce(new Error('RPC unavailable'));

    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Attachment is temporarily unavailable',
    });
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });

  it('uses the existing scoped-access RPC only when the new media RPC is exactly absent', async () => {
    h.db.rpc
      .mockRejectedValueOnce(new Error(
        'Supabase RPC messaging_get_authorized_message_media: 404 '
          + '{"code":"PGRST202","message":"Could not find the function"}',
      ))
      .mockResolvedValueOnce(true);
    h.db.select.mockResolvedValueOnce([{
      id: ID,
      conversation_id: 'CONV',
      media_urls: JSON.stringify([REF]),
    }]);

    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });

    expect(res.status).toBe(200);
    expect(h.db.select).toHaveBeenCalledWith(
      'messages',
      `id=eq.${ID}&select=id,conversation_id,media_urls&limit=1`,
    );
    expect(h.db.rpc).toHaveBeenNthCalledWith(
      2,
      'messaging_employee_can_view_conversation',
      {
        p_employee_id: 'employee-1',
        p_conversation_id: 'CONV',
      },
    );
    expect(h.db.signStorage).toHaveBeenCalledOnce();
  });

  it('keeps the missing-RPC compatibility path closed to a non-participant', async () => {
    h.db.rpc
      .mockRejectedValueOnce(new Error(
        'Supabase RPC messaging_get_authorized_message_media: 404 PGRST202',
      ))
      .mockResolvedValueOnce(false);
    h.db.select.mockResolvedValueOnce([{
      id: ID,
      conversation_id: 'CONV',
      media_urls: JSON.stringify([REF]),
    }]);

    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Attachment not found' });
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });

  it('does not treat a generic RPC outage as permission to use compatibility reads', async () => {
    h.db.rpc.mockRejectedValueOnce(
      new Error('Supabase RPC messaging_get_authorized_message_media: 503 upstream timeout'),
    );

    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });

    expect(res.status).toBe(503);
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });

  it('rejects traversal and wrong buckets', () => {
    expect(ownedMessageMediaPath(
      'upr-storage://message-attachments/callrail/../secret.jpg',
    )).toBeNull();
    expect(ownedMessageMediaPath(
      'upr-storage://job-files/callrail/photo.jpg',
    )).toBeNull();
  });

  it('also signs a canonical outbound private reference bound to a message', async () => {
    const outbound = 'upr-storage://message-attachments/outbound/CONV/photo.jpg';
    h.db.rpc.mockResolvedValueOnce([{
      id: ID,
      conversation_id: 'CONV',
      media_urls: JSON.stringify([outbound]),
    }]);
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(200);
    expect(h.db.signStorage).toHaveBeenCalledWith(
      'message-attachments',
      'outbound/CONV/photo.jpg',
      600,
    );
  });

  it('rejects an outbound path for a different conversation', async () => {
    h.db.rpc.mockResolvedValueOnce([{
      id: ID,
      conversation_id: 'OTHER',
      media_urls: JSON.stringify([
        'upr-storage://message-attachments/outbound/CONV/photo.jpg',
      ]),
    }]);
    const res = await onRequestPost({
      request: request({ message_id: ID, index: 0 }),
      env: {},
    });
    expect(res.status).toBe(404);
    expect(h.db.signStorage).not.toHaveBeenCalled();
  });
});
