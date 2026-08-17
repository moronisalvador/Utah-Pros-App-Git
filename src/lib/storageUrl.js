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

export function publicDocUrl(db, path, { bucket = LEGACY_JOB_FILES_BUCKET } = {}) {
  const key = documentStoragePath(path);
  if (!key) throw new Error('Document path is required');
  return `${db.baseUrl}/storage/v1/object/public/${bucket}/${key}`;
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
  if (/^https?:\/\//i.test(signedPath)) return signedPath;
  const storagePath = signedPath.startsWith('/storage/v1/')
    ? signedPath
    : `/storage/v1/${signedPath.replace(/^\//, '')}`;
  return new URL(storagePath, db.baseUrl).href;
}

export async function jobDocumentUrl(db, doc, { expiresIn = 600 } = {}) {
  const bucket = bucketFor(doc);
  if (bucket === LEGACY_JOB_FILES_BUCKET) return publicDocUrl(db, doc?.file_path);
  return signedDocUrl(db, doc?.file_path, { bucket, expiresIn });
}
