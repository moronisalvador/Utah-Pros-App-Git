/**
 * ════════════════════════════════════════════════
 * FILE: usePhotoUpload.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one shared way to (a) upload a job photo the right way and (b) build the
 *   web address for showing a photo. Uploading always shrinks a big phone photo
 *   first (so a 12 MB original becomes web-friendly) before it's stored, then
 *   records it against the job. Showing a photo in a grid uses a small THUMBNAIL
 *   address, not the full-resolution original — the audit found grids loading
 *   ~300 MB of full-size originals over cellular for a 100-photo job. Keeping both
 *   in one file means a later switch to private/signed photo URLs is a one-place
 *   change (db-foundation P8's swap seam).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared hook + URL helpers)
 *   Rendered by:  photo capture buttons + photo grids (import from '@/hooks/usePhotoUpload')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db + employee); @/lib/mediaCompress
 *              (compressImage, validateFile, sanitizeFilename, stripBucketPrefix, isImage)
 *   Data:      writes → job-files Storage bucket + job_documents (via insert_job_document RPC)
 *
 * NOTES / GOTCHAS:
 *   - thumbUrl(filePath, {width, quality}) → Supabase storage/v1/render/image URL for
 *     grids/lists; publicUrl(filePath) → the full-resolution original for a lightbox or
 *     download ONLY (perf-budget.md §2). Both live HERE — do not re-build these URLs
 *     inline anywhere (that fragmentation is what P8's signed-URL swap must avoid).
 *   - The upload flow mirrors photoDispatcher.js exactly (Storage POST with bearer +
 *     Content-Type, then insert_job_document) so online + offline paths agree — plus the
 *     mediaCompress step this hook adds for images.
 *   - Grid <img> pairs thumbUrl() with loading="lazy" + decoding="async" (the call site's
 *     job; this helper only builds the URL).
 * ════════════════════════════════════════════════
 */

import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { compressImage, validateFile, sanitizeFilename, stripBucketPrefix, isImage } from '@/lib/mediaCompress';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const BUCKET = 'job-files';

// ─── SECTION: URL helpers (pure — the single media-URL construction point) ───

/** Full-resolution public URL — lightbox / explicit download ONLY (not grids). */
export function publicUrl(filePath, baseUrl = SUPABASE_URL) {
  if (!filePath) return '';
  const path = stripBucketPrefix(filePath);
  return `${baseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Thumbnail URL via Supabase's image render transform — for grids/lists.
 * @param filePath storage path (with or without the "job-files/" prefix)
 * @param opts { width=400, quality=60, resize='cover' }
 */
export function thumbUrl(filePath, { width = 400, quality = 60, resize = 'cover', baseUrl = SUPABASE_URL } = {}) {
  if (!filePath) return '';
  const path = stripBucketPrefix(filePath);
  const params = new URLSearchParams({ width: String(width), quality: String(quality), resize });
  return `${baseUrl}/storage/v1/render/image/public/${BUCKET}/${path}?${params.toString()}`;
}

// ─── SECTION: Upload hook ──────────────

export function usePhotoUpload() {
  const { db, employee } = useAuth();

  /**
   * Compress (images) → upload to Storage → record via insert_job_document.
   * @param file  a File/Blob picked from the camera or library
   * @param opts  { jobId (required), appointmentId, roomId, description, category='photo', name }
   * @returns the inserted job_documents row
   */
  const uploadPhoto = useCallback(async (file, opts = {}) => {
    if (!file) throw new Error('usePhotoUpload: no file provided');
    if (!opts.jobId) throw new Error('usePhotoUpload: jobId is required');

    const check = validateFile(file);
    if (!check.ok) throw new Error(check.reason);

    // Shrink images before upload; non-images (already-validated video) pass through.
    let blob = file;
    let mime = file.type || 'application/octet-stream';
    if (isImage(mime)) {
      const out = await compressImage(file);
      blob = out.blob;
      mime = blob.type || 'image/jpeg';
    }

    const name = sanitizeFilename(opts.name || file.name || 'photo.jpg');
    const filePath = `${opts.jobId}/${Date.now()}-${name}`;

    const res = await fetch(`${db.baseUrl}/storage/v1/object/${BUCKET}/${filePath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${db.apiKey}`, 'Content-Type': mime },
      body: blob,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Storage upload failed: ${res.status} ${text}`);
    }

    const doc = await db.rpc('insert_job_document', {
      p_job_id: opts.jobId,
      p_name: name,
      p_file_path: `${BUCKET}/${filePath}`,
      p_mime_type: mime,
      p_category: opts.category || 'photo',
      p_uploaded_by: employee?.id || null,
      p_appointment_id: opts.appointmentId || null,
      p_description: opts.description || null,
      p_room_id: opts.roomId || null,
    });
    return Array.isArray(doc) ? doc[0] : doc;
  }, [db, employee]);

  return { uploadPhoto, thumbUrl, publicUrl };
}

export default usePhotoUpload;
