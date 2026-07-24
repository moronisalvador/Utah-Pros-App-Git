/**
 * Browser-side private upload helper for conversation images.
 *
 * The browser never receives a public object URL. The worker validates the
 * final bytes and returns an opaque private reference used by /api/send-message.
 */

import {
  MAX_IMAGE_BYTES,
  compressImage,
  isImage,
  sanitizeFilename,
} from '@/lib/mediaCompress';

export const MAX_MESSAGE_ATTACHMENTS = 1;
export const MAX_MESSAGE_IMAGE_BYTES = 5_000_000;
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

export function validateMessageFile(file) {
  if (!file || !isImage(file.type)) {
    return { ok: false, reason: `${file?.name || 'File'} isn't a photo` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `${file.name || 'Photo'} is too large (max 25 MB before compression)` };
  }
  if (file.type === 'image/gif' && file.size > MAX_MESSAGE_IMAGE_BYTES) {
    return { ok: false, reason: `${file.name || 'GIF'} is too large (max 5 MB)` };
  }
  return { ok: true };
}

async function finalUpload(file) {
  // Preserve GIF animation. Other phone images may be converted to a smaller
  // JPEG by the existing, battle-tested compressor. Unsupported browser image
  // encodings (for example WebP/HEIC when decodable) must become JPEG even when
  // the JPEG is slightly larger than the original.
  if (file.type === 'image/gif') return { blob: file, name: file.name };
  const compressed = await compressImage(file, {
    forceJpeg: !SUPPORTED_TYPES.has(file.type),
  });
  return {
    blob: compressed.blob,
    name: compressed.didCompress
      ? file.name.replace(/\.\w+$/, '') + '.jpg'
      : file.name,
  };
}

export async function uploadConversationMedia(db, conversationId, file) {
  const check = validateMessageFile(file);
  if (!check.ok) throw new Error(check.reason);
  const { blob, name } = await finalUpload(file);
  if (!SUPPORTED_TYPES.has(blob.type) || blob.size > MAX_MESSAGE_IMAGE_BYTES) {
    throw new Error('Use a JPEG, PNG, or GIF image no larger than 5 MB');
  }

  const form = new FormData();
  form.append('conversation_id', conversationId);
  form.append('file', blob, sanitizeFilename(name));
  const res = await fetch('/api/message-media-upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${db.apiKey}` },
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.reference) {
    throw new Error(payload.error || 'Upload failed');
  }
  return {
    url: payload.reference,
    reference: payload.reference,
    mimeType: payload.mime_type,
    byteSize: payload.byte_size,
  };
}
