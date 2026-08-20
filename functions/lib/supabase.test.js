import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabase.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker Supabase Storage signing', () => {
  it('accepts a route-scoped timeout fetch implementation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const db = supabase({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
    }, fetchImpl);

    await expect(db.rpc('safe_probe', { p_id: 'probe-1' }))
      .resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/rest/v1/rpc/safe_probe',
      expect.objectContaining({ method: 'POST' }),
    );
  });

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

describe('worker Supabase RPC — void-returning functions', () => {
  const db = (fetchImpl) => supabase({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, fetchImpl);

  it('treats 204 No Content as success, not a failure', async () => {
    // A `RETURNS void` function answers 204 with an EMPTY body. res.json()
    // throws on that AFTER the function has committed, so the caller's catch
    // reported failure for work that had already succeeded. Observed live on
    // 2026-08-20: pausing a contractor request wrote the row and returned 503.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(db(fetchImpl).rpc('contractor_compliance_mutate_request', { p_action: 'pause' }))
      .resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('still parses a real JSON body', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'abc', review_state: 'accepted' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(db(fetchImpl).rpc('contractor_compliance_review_document', {}))
      .resolves.toEqual({ id: 'abc', review_state: 'accepted' });
  });

  it('still throws on a genuine error response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"NOT_AUTHORIZED"}', { status: 403 }));
    await expect(db(fetchImpl).rpc('contractor_compliance_review_document', {})).rejects.toThrow(/403/);
  });
});
