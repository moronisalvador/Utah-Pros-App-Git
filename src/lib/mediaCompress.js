/**
 * ════════════════════════════════════════════════
 * FILE: mediaCompress.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The toolbox behind feedback photo/video attachments. It shrinks big photos
 *   down to a reasonable size before they upload (so a 12 MB phone photo
 *   becomes a small web-friendly one), reads how long a video is, checks that
 *   files aren't too big or too many, and builds the safe storage path each
 *   file is saved under.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (pure helpers — the caller does the uploading)
 *
 * NOTES / GOTCHAS:
 *   - Everything ABOVE the "Browser-only" section marker is a pure function
 *     with no DOM/browser APIs, unit-tested in mediaCompress.test.js under
 *     plain node. Keep it that way — put anything touching document/canvas/
 *     createImageBitmap BELOW the marker.
 *   - buildStoragePath returns a bucket-LESS path ("feedback/{emp}/{ts}-{name}").
 *     The job-files bucket is the uploader's concern; stripBucketPrefix
 *     normalizes legacy values that still carry "job-files/".
 *   - compressImage never returns a blob larger than the original, and falls
 *     back to the untouched original (≤ FALLBACK_MAX_BYTES) when the browser
 *     can't decode the format (e.g. HEIC on non-Safari).
 *   - probeVideo never rejects — a 5s timeout or decode failure resolves with
 *     null metadata, and checkVideoDuration tolerates null (we'd rather accept
 *     an unprobeable video than block a field tech's upload).
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Caps (exported constants — the composer and tests share these) ───

export const MAX_FILES = 5;                        // total attachments per feedback
export const MAX_VIDEOS = 1;                       // videos per feedback
export const MAX_VIDEO_SECONDS = 90;               // max video duration
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;   // max image INPUT size (pre-compression)
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;   // max video size (uploaded as-is)
export const MAX_IMAGE_EDGE = 1920;                // long-edge cap after compression
export const JPEG_QUALITY = 0.8;
export const FALLBACK_MAX_BYTES = 10 * 1024 * 1024; // undecodable originals pass through up to this

// ─── SECTION: Pure helpers (node-testable — no DOM below this line until the marker) ───

/** Is this MIME type an image? */
export function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

/** Is this MIME type a video? */
export function isVideo(mime) {
  return typeof mime === 'string' && mime.startsWith('video/');
}

/**
 * Fit width×height inside a maxEdge-long bounding box, preserving aspect
 * ratio. NEVER upscales — smaller inputs come back unchanged. Unknown or
 * invalid dimensions come back unchanged too (caller decides what to do).
 */
export function fitWithin(width, height, maxEdge = MAX_IMAGE_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width, height };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Make a filename safe for a storage path: basename only (no traversal),
 * whitespace and URL-hostile characters collapsed to '-', length-capped
 * while keeping the extension. Never returns an empty string.
 */
export function sanitizeFilename(name) {
  const base = String(name || '')
    .split(/[/\\]/).pop()                 // basename — drops any path/traversal segments
    .replace(/[^a-zA-Z0-9._-]+/g, '-')    // anything URL-hostile → '-'
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');       // no leading/trailing dots or dashes
  if (!base) return 'file';
  if (base.length <= 80) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).slice(0, 12) : '';
  return base.slice(0, 80 - ext.length) + ext;
}

/**
 * Storage path for a feedback attachment — bucket-LESS by design (the
 * job-files bucket is prepended by whoever talks to /storage/v1/object/).
 * Shape: feedback/{employeeId}/{ts}-{sanitized-filename}
 */
export function buildStoragePath(employeeId, filename, ts = Date.now()) {
  return `feedback/${employeeId}/${ts}-${sanitizeFilename(filename)}`;
}

/** Normalize a legacy path that carries the bucket prefix ("job-files/…"). */
export function stripBucketPrefix(path) {
  return String(path || '').replace(/^job-files\//, '');
}

/**
 * Validate a single picked file (type + size caps).
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateFile(file) {
  if (!file) return { ok: false, reason: 'No file' };
  if (isImage(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: `${file.name || 'Photo'} is too large (max 25 MB)` };
    }
    return { ok: true };
  }
  if (isVideo(file.type)) {
    if (file.size > MAX_VIDEO_BYTES) {
      return { ok: false, reason: `${file.name || 'Video'} is too large (max 50 MB)` };
    }
    return { ok: true };
  }
  return { ok: false, reason: `${file.name || 'File'} isn't a photo or video` };
}

/**
 * Validate a multi-pick against what's already attached.
 * @param existing array of current items with a `mime` field (records or tiles)
 * @param incoming array of picked File-likes ({ name, type, size })
 * @param caps     optional { maxFiles, maxVideos } overrides
 * @returns {{ accepted: File[], rejected: { file: File, reason: string }[] }}
 */
export function validateSelection(existing, incoming, caps = {}) {
  const maxFiles = caps.maxFiles ?? MAX_FILES;
  const maxVideos = caps.maxVideos ?? MAX_VIDEOS;
  const accepted = [];
  const rejected = [];
  let total = (existing || []).length;
  let videos = (existing || []).filter(x => isVideo(x?.mime)).length;

  for (const file of incoming || []) {
    const check = validateFile(file);
    if (!check.ok) { rejected.push({ file, reason: check.reason }); continue; }
    if (total >= maxFiles) {
      rejected.push({ file, reason: `Maximum ${maxFiles} attachments` });
      continue;
    }
    if (isVideo(file.type) && videos >= maxVideos) {
      rejected.push({ file, reason: `Only ${maxVideos} video per feedback` });
      continue;
    }
    accepted.push(file);
    total += 1;
    if (isVideo(file.type)) videos += 1;
  }
  return { accepted, rejected };
}

/**
 * Duration gate for videos. Tolerates null/unknown durations (metadata probe
 * failed) — we accept rather than block the upload.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkVideoDuration(duration, maxSeconds = MAX_VIDEO_SECONDS) {
  if (duration == null || !Number.isFinite(duration)) return { ok: true };
  if (duration > maxSeconds) {
    return { ok: false, reason: `Video is too long (max ${maxSeconds} seconds)` };
  }
  return { ok: true };
}

/** "10.4 MB", "812 KB", "302 B" — display formatter (admin view + tiles). */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1:32" from 92s — display formatter (video chips). Null-safe like probeVideo. */
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ─── SECTION: Browser-only (DOM/canvas APIs — NOT unit-tested, keep pure logic above) ───

/**
 * Compress an image file to a JPEG capped at MAX_IMAGE_EDGE on the long side.
 * - Decode failure (HEIC on non-Safari, corrupt file): falls back to the
 *   untouched original when it's ≤ FALLBACK_MAX_BYTES, otherwise throws.
 * - Never returns a blob larger than the original — if the JPEG comes out
 *   bigger (already-optimized small images), the original wins.
 * @param {{ forceJpeg?: boolean }} options `forceJpeg` is for provider paths
 *   that cannot accept the picked image's original encoding.
 * @returns {Promise<{ blob: Blob, width: number|null, height: number|null, didCompress: boolean }>}
 */
export async function compressImage(file, { forceJpeg = false } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (!forceJpeg && file.size <= FALLBACK_MAX_BYTES) {
      return { blob: file, width: null, height: null, didCompress: false };
    }
    throw new Error(`Couldn't convert ${file.name || 'that photo'} — try a JPG or PNG under 5 MB`);
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));

    if (!blob || (!forceJpeg && blob.size >= file.size)) {
      return { blob: file, width: bitmap.width, height: bitmap.height, didCompress: false };
    }
    return { blob, width, height, didCompress: true };
  } finally {
    bitmap.close();
  }
}

/**
 * Read a video's metadata (duration/dimensions) without downloading or
 * playing it. NEVER rejects: decode errors or a 5s timeout resolve with
 * all-null metadata (checkVideoDuration tolerates that).
 * @returns {Promise<{ duration: number|null, width: number|null, height: number|null }>}
 */
export function probeVideo(file) {
  return new Promise(resolve => {
    const NULLS = { duration: null, width: null, height: null };
    let url = null;
    let settled = false;
    const finish = (meta) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = setTimeout(() => finish(NULLS), 5000);

    try {
      url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = () => finish({
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
      video.onerror = () => finish(NULLS);
      video.src = url;
    } catch {
      finish(NULLS);
    }
  });
}
