import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabase.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker Supabase Storage signing', () => {
  it('uses the service role only on the server and returns an absolute signed URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      signedURL: '/object/sign/message-attachments/callrail/photo.jpg?token=signed',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const db = supabase({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    });

    const url = await db.signStorage(
      'message-attachments',
      'callrail/photo.jpg',
      600,
    );

    expect(url).toBe(
      'https://project.supabase.co/storage/v1/object/sign/' +
      'message-attachments/callrail/photo.jpg?token=signed',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/storage/v1/object/sign/' +
      'message-attachments/callrail/photo.jpg',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer server-secret',
          apikey: 'server-secret',
        }),
        body: JSON.stringify({ expiresIn: 600 }),
      }),
    );
  });

  it('fails closed when the signing response contains no URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const db = supabase({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    });
    await expect(db.signStorage('message-attachments', 'callrail/photo.jpg'))
      .rejects.toThrow('returned no URL');
  });
});

describe('worker private Storage bytes', () => {
  it('downloads private bytes with the service role and enforces the cap', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const fetchMock = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(bytes.byteLength),
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const db = supabase({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    });
    await expect(db.downloadStorage(
      'message-attachments',
      'outbound/c/photo.jpg',
      5_000_000,
    )).resolves.toMatchObject({
      contentType: 'image/jpeg',
      bytes,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/storage/v1/object/authenticated/' +
        'message-attachments/outbound/c/photo.jpg',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer server-secret',
        }),
      }),
    );
  });

});
