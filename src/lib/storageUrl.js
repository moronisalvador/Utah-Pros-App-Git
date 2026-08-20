/**
 * ════════════════════════════════════════════════
 * FILE: storageUrl.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds links for job documents. Existing files keep their public links,
 *   while protected files receive a short-lived link created for the signed-in
 *   employee who asks to open them.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/mediaCompress (stripBucketPrefix)
 *   Data:      reads  → Supabase Storage objects through the signed-in browser
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - db.apiKey is the current user's access token when supplied by useAuth.
 *     Replacing it with the anonymous project key would make private signing fail.
 *   - Signed URLs are returned to the caller only. Never persist or log them.
 * ════════════════════════════════════════════════
 */
import { stripBucketPrefix } from '@/lib/mediaCompress';

export const PRIVATE_JOB_DOCUMENTS_BUCKET = 'job-documents-private';
export const LEGACY_JOB_FILES_BUCKET = 'job-files';

export const bucketFor = (doc) => doc?.storage_bucket || LEGACY_JOB_FILES_BUCKET;

export const documentStoragePath = (path) => stripBucketPrefix(path);

export function documentForPath(documents, path) {
  const key = documentStoragePath(path);
  return (documents || []).find((doc) => documentStoragePath(doc?.file_path) === key) || null;
}

export async function signedDocUrl(
  db,
  path,
  { bucket = PRIVATE_JOB_DOCUMENTS_BUCKET, expiresIn = 600 } = {},
) {
  const key = documentStoragePath(path);
  if (!key) throw new Error('Document path is required');
  const response = await fetch(`${db.baseUrl}/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${db.apiKey}`,
      apikey: db.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) throw new Error(`sign ${bucket}/${key}: ${response.status}`);
  const body = await response.json();
  const signedPath = body.signedURL || body.signedUrl;
  if (!signedPath) throw new Error(`sign ${bucket}/${key}: missing signed URL`);
  return absoluteStorageUrl(db, signedPath);
}

/**
 * The one way to open a job document, whichever bucket it lives in.
 *
 * Phase 1 returned a PUBLIC url for anything still in `job-files`. Phase 2
 * signs both buckets, so this keeps working unchanged the moment `job-files`
 * stops being public — and stops handing out permanent links before then.
 */
export async function jobDocumentUrl(db, doc, { expiresIn = 600 } = {}) {
  return signedDocUrl(db, doc?.file_path, { bucket: bucketFor(doc), expiresIn });
}

// ─── SECTION: Signed URLs for the legacy job-files bucket (Phase 2) ──────────
//
// Phase 1 moved signed customer documents to a private bucket one object at a
// time. Phase 2 does the opposite: nothing moves, and `job-files` itself stops
// being public. So every reader below must stop building
// `/object/public/job-files/…` and start asking Storage to mint a short-lived
// URL for the signed-in employee.
//
// These helpers work while the bucket is STILL PUBLIC — `/object/sign` does not
// care about the `public` flag, only about the caller's SELECT permission — so
// the readers can be migrated, deployed and verified BEFORE the flip. That
// ordering is the whole safety argument: the flip becomes a no-op for anything
// already on this path, and anything still on the public path is visibly broken
// in `dev` first rather than in production.

/** Batch limit for one sign request. Supabase accepts more; this bounds the
 *  URL/response size and keeps one slow grid from blocking the page. */
export const SIGN_BATCH_MAX = 100;

/**
 * Mint signed URLs for many paths in ONE request.
 *
 * `POST /object/sign/{bucket}` takes `{ expiresIn, paths[] }` and answers an
 * array of `{ path, signedURL, error }`. A path that fails comes back with
 * `error` set and `signedURL` null — it must NOT reject the whole batch, or one
 * deleted object empties a whole photo grid.
 *
 * @returns {Promise<Map<string,string>>} keyed by the ORIGINAL path passed in
 *   (not the normalized key), so callers can look up by `doc.file_path`.
 */
export async function signedDocUrls(
  db,
  paths,
  { bucket = LEGACY_JOB_FILES_BUCKET, expiresIn = 600 } = {},
) {
  const out = new Map();
  const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
  if (list.length === 0) return out;

  // Original → normalized, de-duplicated. A grid routinely shows the same
  // object twice (a cover image that is also the first tile).
  const keyByOriginal = new Map();
  const originalsByKey = new Map();
  for (const original of list) {
    const key = documentStoragePath(original);
    if (!key) continue;
    keyByOriginal.set(original, key);
    if (!originalsByKey.has(key)) originalsByKey.set(key, []);
    originalsByKey.get(key).push(original);
  }
  const keys = [...originalsByKey.keys()];

  for (let i = 0; i < keys.length; i += SIGN_BATCH_MAX) {
    const chunk = keys.slice(i, i + SIGN_BATCH_MAX);
    const response = await fetch(`${db.baseUrl}/storage/v1/object/sign/${bucket}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${db.apiKey}`,
        apikey: db.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn, paths: chunk }),
    });
    if (!response.ok) throw new Error(`sign ${bucket} (${chunk.length} paths): ${response.status}`);
    const rows = await response.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      const signedPath = row?.signedURL || row?.signedUrl;
      if (!signedPath || row?.error) continue;   // per-path failure stays per-path
      const url = absoluteStorageUrl(db, signedPath);
      for (const original of originalsByKey.get(row.path) || []) out.set(original, url);
    }
  }
  return out;
}

/**
 * A signed URL that ALSO carries the image transform, so a grid tile downloads
 * a 400px thumbnail instead of the 3 MB original.
 *
 * ⚠ This is the one mechanism in Phase 2 with no precedent in this repository,
 * and it is the direct analogue of the Phase-1 R1 spike. The single-path sign
 * endpoint accepts `transform`; the PLURAL one does not, so transforms and
 * batching cannot be had at once. `SIGNED_THUMBNAILS` below is the switch, and
 * it must not be turned on before the spike in the roadmap has passed.
 *
 * Falling back to a full-size signed URL is CORRECT but slower — never wrong,
 * so a grid renders either way.
 */
export async function signedThumbUrl(
  db,
  path,
  { bucket = LEGACY_JOB_FILES_BUCKET, expiresIn = 600, width = 400, quality = 60, resize = 'cover' } = {},
) {
  const key = documentStoragePath(path);
  if (!key) throw new Error('Document path is required');
  const response = await fetch(`${db.baseUrl}/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${db.apiKey}`,
      apikey: db.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn, transform: { width, quality, resize } }),
  });
  if (!response.ok) throw new Error(`sign+transform ${bucket}/${key}: ${response.status}`);
  const body = await response.json();
  const signedPath = body.signedURL || body.signedUrl;
  if (!signedPath) throw new Error(`sign+transform ${bucket}/${key}: missing signed URL`);
  return absoluteStorageUrl(db, signedPath);
}

/** Storage answers a root-relative path on some versions and an absolute URL on
 *  others; both are normalized here so no call site has to know which. */
export function absoluteStorageUrl(db, signedPath) {
  if (/^https?:\/\//i.test(signedPath)) return signedPath;
  const storagePath = signedPath.startsWith('/storage/v1/')
    ? signedPath
    : `/storage/v1/${signedPath.replace(/^\//, '')}`;
  return new URL(storagePath, db.baseUrl).href;
}
