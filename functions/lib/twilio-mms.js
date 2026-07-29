/**
 * ════════════════════════════════════════════════
 * FILE: twilio-mms.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Downloads pictures attached to a verified Twilio text, checks that each
 *   picture belongs to that account and message, and saves safe copies privately
 *   for UPR. Temporary provider links and credentials are never saved.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./http.js, ./message-media.js
 *   Data:      reads  → authenticated Twilio Media resources
 *              writes → private message-attachments Storage objects
 *
 * NOTES / GOTCHAS:
 *   - Redirects, foreign paths, unsupported bytes, type changes, and size/count
 *     overflow fail closed.
 *   - Deterministic paths make a retained-event retry overwrite the same object.
 * ════════════════════════════════════════════════
 */

import { fetchWithTimeout } from './http.js';
import { validateMessageImage } from './message-media.js';

export const TWILIO_MMS_BUCKET = 'message-attachments';
export const TWILIO_MMS_FETCH_TIMEOUT_MS = 15_000;
export const TWILIO_MMS_MAX_ITEMS = 10;
export const TWILIO_MMS_MAX_OBJECT_BYTES = 5_000_000;
export const TWILIO_MMS_MAX_TOTAL_BYTES = 15_000_000;

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const MESSAGE_SID = /^(?:SM|MM)[0-9a-f]{32}$/i;
const MEDIA_SID = /^ME[0-9a-f]{32}$/i;

export class TwilioMmsError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'TwilioMmsError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function fail(code, message, details) {
  throw new TwilioMmsError(code, message, details);
}

function requireSid(value, pattern, label) {
  const sid = String(value || '').trim();
  if (!pattern.test(sid)) {
    fail('TWILIO_MMS_IDENTITY_INVALID', `A valid Twilio ${label} is required.`);
  }
  return sid;
}

export function validateTwilioMediaUrl({
  accountSid,
  messageSid,
  mediaUrl,
}) {
  const account = requireSid(accountSid, ACCOUNT_SID, 'account SID');
  const message = requireSid(messageSid, MESSAGE_SID, 'message SID');
  let parsed;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    fail('TWILIO_MMS_URL_INVALID', 'Twilio MMS media URL is invalid.');
  }
  const prefix =
    `/2010-04-01/Accounts/${account}/Messages/${message}/Media/`;
  const mediaSid = parsed.pathname.startsWith(prefix)
    ? parsed.pathname.slice(prefix.length)
    : '';
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'api.twilio.com'
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !MEDIA_SID.test(mediaSid)
    || parsed.href.length > 2_048
  ) {
    fail(
      'TWILIO_MMS_URL_INVALID',
      'Twilio MMS media URL is outside the signed account and message.',
    );
  }
  return { url: parsed.href, mediaSid };
}

async function readBoundedBytes(response, maximumBytes) {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    fail('TWILIO_MMS_SIZE_UNSUPPORTED', 'Twilio MMS media exceeds the allowed size.');
  }
  if (!response.body?.getReader) {
    fail(
      'TWILIO_MMS_RESPONSE_INVALID',
      'Twilio returned an unreadable media response.',
      { retryable: true },
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        fail('TWILIO_MMS_SIZE_UNSUPPORTED', 'Twilio MMS media exceeds the allowed size.');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof TwilioMmsError) throw error;
    fail(
      'TWILIO_MMS_DOWNLOAD_FAILED',
      'Twilio MMS media could not be downloaded.',
      { retryable: true },
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function providerFailure(response) {
  return new TwilioMmsError(
    'TWILIO_MMS_DOWNLOAD_REJECTED',
    'Twilio did not return the requested MMS media.',
    {
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    },
  );
}

export async function ingestTwilioMms({
  db,
  accountSid,
  authToken,
  messageSid,
  media,
}, {
  fetchImpl = fetchWithTimeout,
  timeoutMs = TWILIO_MMS_FETCH_TIMEOUT_MS,
} = {}) {
  if (!db?.uploadStorage) {
    fail('TWILIO_MMS_STORAGE_UNAVAILABLE', 'Private MMS storage is not configured.');
  }
  const account = requireSid(accountSid, ACCOUNT_SID, 'account SID');
  const message = requireSid(messageSid, MESSAGE_SID, 'message SID');
  if (!authToken) fail('TWILIO_MMS_AUTH_MISSING', 'Twilio MMS authentication is unavailable.');
  if (
    !Array.isArray(media)
    || media.length < 1
    || media.length > TWILIO_MMS_MAX_ITEMS
  ) {
    fail('TWILIO_MMS_COUNT_UNSUPPORTED', 'Twilio MMS media count is unsupported.');
  }

  const ownedMedia = [];
  let totalBytes = 0;
  for (const item of media) {
    if (!Number.isSafeInteger(item?.index) || item.index !== ownedMedia.length) {
      fail('TWILIO_MMS_INDEX_INVALID', 'Twilio MMS media indexes must be contiguous.');
    }
    const validated = validateTwilioMediaUrl({
      accountSid: account,
      messageSid: message,
      mediaUrl: item.url,
    });
    let response;
    try {
      response = await fetchImpl(validated.url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Authorization: `Basic ${btoa(`${account}:${authToken}`)}`,
          Accept: 'image/jpeg, image/png, image/gif',
        },
      }, timeoutMs);
    } catch {
      fail(
        'TWILIO_MMS_DOWNLOAD_FAILED',
        'Twilio MMS media could not be downloaded.',
        { retryable: true },
      );
    }
    if (!response?.ok) throw providerFailure(response || { status: 0 });
    const contentType = (response.headers.get('Content-Type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== item.contentType) {
      fail(
        'TWILIO_MMS_CONTENT_TYPE_MISMATCH',
        'Twilio MMS media content type changed after the signed webhook.',
      );
    }
    const remaining = TWILIO_MMS_MAX_TOTAL_BYTES - totalBytes;
    if (remaining <= 0) {
      fail('TWILIO_MMS_TOTAL_SIZE_UNSUPPORTED', 'Twilio MMS exceeds the total size limit.');
    }
    const bytes = await readBoundedBytes(
      response,
      Math.min(TWILIO_MMS_MAX_OBJECT_BYTES, remaining),
    );
    let checked;
    try {
      checked = validateMessageImage(bytes, contentType);
    } catch {
      fail(
        'TWILIO_MMS_CONTENT_INVALID',
        'Twilio MMS media must be a valid JPEG, PNG, or GIF image.',
      );
    }
    totalBytes += checked.byteSize;
    const sha256 = await sha256Hex(checked.bytes);
    const storagePath =
      `twilio/${account}/${message}/` +
      `${item.index}-${validated.mediaSid}-${sha256.slice(0, 16)}.${checked.extension}`;
    try {
      await db.uploadStorage(
        TWILIO_MMS_BUCKET,
        storagePath,
        checked.bytes,
        checked.mimeType,
      );
    } catch {
      fail(
        'TWILIO_MMS_STORAGE_FAILED',
        'Twilio MMS media could not be stored.',
        { retryable: true },
      );
    }
    ownedMedia.push(Object.freeze({
      index: item.index,
      bucket: TWILIO_MMS_BUCKET,
      storagePath,
      storageRef: `upr-storage://${TWILIO_MMS_BUCKET}/${storagePath}`,
      contentType: checked.mimeType,
      byteSize: checked.byteSize,
      sha256,
    }));
  }

  return Object.freeze({
    media: Object.freeze(ownedMedia),
    itemCount: ownedMedia.length,
    totalBytes,
  });
}
