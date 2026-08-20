/**
 * ════════════════════════════════════════════════
 * FILE: storageUrl.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves old document paths keep working and protected document links are
 *   requested with the signed-in employee's credentials.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./storageUrl.js
 *   Data:      none (all network responses are local fakes)
 *
 * NOTES / GOTCHAS:
 *   - Both response spellings have existed in Supabase and remain supported.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bucketFor,
  documentForPath,
  jobDocumentUrl,
  signedDocUrl,
  signedDocUrls,
  signedThumbUrl,
  SIGN_BATCH_MAX,
} from './storageUrl';

const db = { baseUrl: 'https://project.supabase.co', apiKey: 'user-jwt' };

afterEach(() => vi.unstubAllGlobals());

describe('signedDocUrl', () => {
  it.each([
    ['signedURL', 'job-files/job-1/esign/file.pdf'],
    ['signedUrl', 'job-1/esign/file.pdf'],
  ])('accepts %s and normalizes prefixed or bare paths', async (field, path) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      [field]: '/object/sign/job-documents-private/tokenized-path',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signedDocUrl(db, path)).resolves.toBe(
      'https://project.supabase.co/storage/v1/object/sign/job-documents-private/tokenized-path',
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/storage/v1/object/sign/job-documents-private/job-1/esign/file.pdf');
    expect(new URL(url).search).toBe('');
    expect(options.headers.Authorization).toBe('Bearer user-jwt');
    expect(JSON.parse(options.body)).toEqual({ expiresIn: 600 });
  });

  it('throws on a non-success response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(signedDocUrl(db, 'job-1/esign/file.pdf')).rejects.toThrow('403');
  });
});

describe('job document routing', () => {
  // Phase 2 changed this: a NULL storage_bucket still resolves to `job-files`,
  // but it is now SIGNED rather than handed out as a permanent public URL.
  // That is what lets the bucket flip to private without touching a caller.
  it('signs a NULL-metadata document against the legacy bucket', async () => {
    const doc = { file_path: 'job-files/job-1/report.pdf', storage_bucket: null };
    expect(bucketFor(doc)).toBe('job-files');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      signedURL: '/object/sign/job-files/job-1/report.pdf?token=t',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(jobDocumentUrl(db, doc)).resolves.toBe(
      'https://project.supabase.co/storage/v1/object/sign/job-files/job-1/report.pdf?token=t',
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://project.supabase.co/storage/v1/object/sign/job-files/job-1/report.pdf',
    );
  });

  it('signs a private-bucket document against the private bucket', async () => {
    const doc = { file_path: 'job-1/esign/file.pdf', storage_bucket: 'job-documents-private' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      signedURL: '/object/sign/job-documents-private/job-1/esign/file.pdf?token=t',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await jobDocumentUrl(db, doc);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://project.supabase.co/storage/v1/object/sign/job-documents-private/job-1/esign/file.pdf',
    );
  });

  it('has no public-URL builder left to reach for', async () => {
    const mod = await import('./storageUrl');
    expect(mod.publicDocUrl).toBeUndefined();
  });

  it('matches prefixed and bare forms of the same path', () => {
    const doc = { file_path: 'job-files/job-1/esign/file.pdf' };
    expect(documentForPath([doc], 'job-1/esign/file.pdf')).toBe(doc);
  });
});

// ─── SECTION: Phase 2 — signing against the legacy job-files bucket ──────────
// These pin the two decisions that make the bucket flip survivable: one
// request for a whole grid, and a per-path failure that stays per-path.

describe('signedDocUrls (batch)', () => {
  const rows = (paths) => paths.map((path) => ({
    path,
    signedURL: `/object/sign/job-files/${path}?token=t`,
    error: null,
  }));

  it('signs a whole grid in ONE request and keys the map by the ORIGINAL path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      rows(['job-1/a.jpg', 'job-1/b.jpg']),
    ), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // Mixed prefixed/bare, exactly as job_documents stores them.
    const map = await signedDocUrls(db, ['job-files/job-1/a.jpg', 'job-1/b.jpg']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/storage/v1/object/sign/job-files');
    expect(options.headers.Authorization).toBe('Bearer user-jwt');
    // Normalized on the wire; the caller still looks up by what it passed in.
    expect(JSON.parse(options.body)).toEqual({ expiresIn: 600, paths: ['job-1/a.jpg', 'job-1/b.jpg'] });
    expect(map.get('job-files/job-1/a.jpg')).toBe('https://project.supabase.co/storage/v1/object/sign/job-files/job-1/a.jpg?token=t');
    expect(map.get('job-1/b.jpg')).toBe('https://project.supabase.co/storage/v1/object/sign/job-files/job-1/b.jpg?token=t');
  });

  it('de-duplicates: the same object shown twice costs one path, and BOTH keys resolve', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      rows(['job-1/a.jpg']),
    ), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const map = await signedDocUrls(db, ['job-files/job-1/a.jpg', 'job-1/a.jpg']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).paths).toEqual(['job-1/a.jpg']);
    expect(map.get('job-files/job-1/a.jpg')).toBe(map.get('job-1/a.jpg'));
  });

  it('drops ONLY the failed path — one deleted object must not empty a grid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { path: 'job-1/gone.jpg', signedURL: null, error: 'Object not found' },
      { path: 'job-1/ok.jpg', signedURL: '/object/sign/job-files/job-1/ok.jpg?token=t', error: null },
    ]), { status: 200 })));

    const map = await signedDocUrls(db, ['job-1/gone.jpg', 'job-1/ok.jpg']);
    expect(map.has('job-1/gone.jpg')).toBe(false);
    expect(map.get('job-1/ok.jpg')).toContain('token=t');
  });

  it('chunks past the batch limit rather than sending one unbounded request', async () => {
    const paths = Array.from({ length: SIGN_BATCH_MAX + 3 }, (_, i) => `job-1/p${i}.jpg`);
    const fetchMock = vi.fn().mockImplementation((_url, options) => Promise.resolve(
      new Response(JSON.stringify(rows(JSON.parse(options.body).paths)), { status: 200 }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    const map = await signedDocUrls(db, paths);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).paths).toHaveLength(SIGN_BATCH_MAX);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).paths).toHaveLength(3);
    expect(map.size).toBe(paths.length);
  });

  it('makes no request at all for an empty list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(signedDocUrls(db, [])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the whole batch is rejected, so a broken policy is loud', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(signedDocUrls(db, ['job-1/a.jpg'])).rejects.toThrow('403');
  });
});

describe('signedThumbUrl', () => {
  it('sends the transform on the SINGLE-path endpoint (the plural one cannot carry it)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      signedURL: '/render/image/sign/job-files/job-1/a.jpg?token=t&width=400',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signedThumbUrl(db, 'job-files/job-1/a.jpg', { width: 400 })).resolves.toBe(
      'https://project.supabase.co/storage/v1/render/image/sign/job-files/job-1/a.jpg?token=t&width=400',
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/storage/v1/object/sign/job-files/job-1/a.jpg');
    expect(JSON.parse(options.body)).toEqual({
      expiresIn: 600,
      transform: { width: 400, quality: 60, resize: 'cover' },
    });
  });
});
