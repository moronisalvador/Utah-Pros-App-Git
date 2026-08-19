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
  it('keeps NULL metadata on the legacy public bucket', async () => {
    const doc = { file_path: 'job-files/job-1/report.pdf', storage_bucket: null };
    expect(bucketFor(doc)).toBe('job-files');
    await expect(jobDocumentUrl(db, doc)).resolves.toBe(
      'https://project.supabase.co/storage/v1/object/public/job-files/job-1/report.pdf',
    );
  });

  it('matches prefixed and bare forms of the same path', () => {
    const doc = { file_path: 'job-files/job-1/esign/file.pdf' };
    expect(documentForPath([doc], 'job-1/esign/file.pdf')).toBe(doc);
  });
});
