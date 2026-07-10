/**
 * ════════════════════════════════════════════════
 * FILE: mediaUpload.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The ONE place the tech messaging pane turns a picked photo into a link it can send.
 *   It shrinks the photo (so a big phone photo becomes web-sized), uploads it to the
 *   shared file storage under the conversation's folder, and hands back the web address
 *   of the uploaded photo. Every attachment the tech sends flows through here.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by useComposerAttachments (Phase B2)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/mediaCompress (compressImage / isImage / sanitizeFilename)
 *   Data:      writes → Supabase Storage bucket `job-files` (path conversations/{id}/…)
 *
 * NOTES / GOTCHAS:
 *   - P8 COORDINATION (db-foundation): this module is the NAMED job-files bucket
 *     privacy-flip swap target (.claude/rules/tech-messages-v2-wave-ownership.md §4).
 *     URL construction lives in exactly ONE function (`publicMediaUrl`) so P8 swaps a
 *     single line to signed URLs — the upload path and every caller stay untouched.
 *   - Copy-in of Conversations.jsx:687-700 (the legacy MMS upload path), re-homed here
 *     so the pane never edits the shared desktop screen (manifest §1/§3).
 *   - The upload uses the caller's authenticated db client (Bearer = the user JWT), the
 *     same request legacy makes; job-files currently has a public read policy (pre-P8).
 * ════════════════════════════════════════════════
 */
import { compressImage, isImage, sanitizeFilename } from '@/lib/mediaCompress';

/**
 * Public URL for an uploaded object path in the job-files bucket. THE single P8 swap
 * target — when the bucket flips to private, this returns a signed URL instead.
 * @param {object} db authenticated client (exposes baseUrl)
 * @param {string} path bucket-less object path (e.g. "conversations/{id}/{ts}-name.jpg")
 */
export function publicMediaUrl(db, path) {
  return `${db.baseUrl}/storage/v1/object/public/job-files/${path}`;
}

/**
 * Compress (if an image) and upload one file to job-files under the conversation folder,
 * returning its public URL. Throws on a non-OK upload so the caller can flag the tile.
 * @param {object} db authenticated client (baseUrl + apiKey)
 * @param {string} convId conversation id (folder)
 * @param {File} file the picked file
 * @param {number} [ts] timestamp (injectable for tests; defaults to now at call time)
 * @returns {Promise<{ url:string, path:string }>}
 */
export async function uploadConversationMedia(db, convId, file, ts = Date.now()) {
  let blob = file;
  let uploadName = file.name;
  if (isImage(file.type)) {
    const c = await compressImage(file);
    blob = c.blob;
    if (c.didCompress) uploadName = uploadName.replace(/\.\w+$/, '') + '.jpg';
  }
  const path = `conversations/${convId}/${ts}-${sanitizeFilename(uploadName)}`;
  const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${db.apiKey}`,
      'Content-Type': blob.type || 'application/octet-stream',
    },
    body: blob,
  });
  if (!res.ok) throw new Error('Upload failed');
  return { url: publicMediaUrl(db, path), path };
}
