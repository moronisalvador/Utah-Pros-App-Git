/**
 * Securely copies CallRail MMS objects into UPR-owned private Storage.
 *
 * Provider URLs from webhooks are deliberately not accepted. The media endpoint
 * is derived from server-resolved account/message identity and fixed to
 * api.callrail.com. Returned metadata contains only the private UPR reference.
 */

import { fetchWithTimeout } from './http.js';
import { resolveCallRailAccountId } from './callrail-api.js';
import { resolveCallRailApiKey } from './callrail-messaging.js';

export const CALLRAIL_MMS_BUCKET = 'message-attachments';
export const CALLRAIL_MMS_MAX_ITEMS = 5;
export const CALLRAIL_MMS_MAX_OBJECT_BYTES = 5_000_000;
export const CALLRAIL_MMS_MAX_TOTAL_BYTES = 15_000_000;
export const CALLRAIL_MMS_FETCH_TIMEOUT_MS = 15_000;

const MEDIA_TYPES = Object.freeze({
  'image/jpeg': {
    extension: 'jpg',
    matches(bytes) {
      return bytes.length >= 3
        && bytes[0] === 0xff
        && bytes[1] === 0xd8
        && bytes[2] === 0xff;
    },
  },
  'image/png': {
    extension: 'png',
    matches(bytes) {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return bytes.length >= signature.length
        && signature.every((value, index) => bytes[index] === value);
    },
  },
  'image/gif': {
    extension: 'gif',
    matches(bytes) {
      const gif87a = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
      const gif89a = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
      return bytes.length >= gif87a.length
        && (
          gif87a.every((value, index) => bytes[index] === value)
          || gif89a.every((value, index) => bytes[index] === value)
        );
    },
  },
});

export class CallrailMmsError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'CallrailMmsError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function fail(code, message, details) {
  throw new CallrailMmsError(code, message, details);
}

function requireIdentifier(value, label) {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    fail('CALLRAIL_MMS_IDENTITY_INVALID', `A valid ${label} is required.`);
  }
  return normalized;
}

function requireApiKey(value) {
  const apiKey = value == null ? '' : String(value).trim();
  if (!apiKey) {
    fail('CALLRAIL_MMS_API_KEY_MISSING', 'CallRail MMS is not configured.');
  }
  return apiKey;
}

function normalizeLimits(limits = {}) {
  const requested = {
    maxItems: limits.maxItems ?? CALLRAIL_MMS_MAX_ITEMS,
    maxObjectBytes: limits.maxObjectBytes ?? CALLRAIL_MMS_MAX_OBJECT_BYTES,
    maxTotalBytes: limits.maxTotalBytes ?? CALLRAIL_MMS_MAX_TOTAL_BYTES,
  };
  const hard = {
    maxItems: CALLRAIL_MMS_MAX_ITEMS,
    maxObjectBytes: CALLRAIL_MMS_MAX_OBJECT_BYTES,
    maxTotalBytes: CALLRAIL_MMS_MAX_TOTAL_BYTES,
  };
  for (const key of Object.keys(requested)) {
    if (
      !Number.isSafeInteger(requested[key])
      || requested[key] <= 0
      || requested[key] > hard[key]
    ) {
      fail('CALLRAIL_MMS_LIMIT_INVALID', 'CallRail MMS limits may only be reduced.');
    }
  }
  return requested;
}

export function validateCallrailMmsCount(mediaCount, limits = {}) {
  const { maxItems } = normalizeLimits(limits);
  if (!Number.isSafeInteger(mediaCount) || mediaCount <= 0 || mediaCount > maxItems) {
    fail(
      'CALLRAIL_MMS_COUNT_UNSUPPORTED',
      `CallRail MMS must contain between 1 and ${maxItems} media items.`,
    );
  }
  return mediaCount;
}

export function buildCallrailMediaEndpoint({ accountId, providerMessageId, index }) {
  const account = requireIdentifier(accountId, 'CallRail account identity');
  const message = requireIdentifier(providerMessageId, 'CallRail message identity');
  if (!Number.isSafeInteger(index) || index < 0 || index >= CALLRAIL_MMS_MAX_ITEMS) {
    fail('CALLRAIL_MMS_INDEX_INVALID', 'CallRail MMS media index is invalid.');
  }
  return `https://api.callrail.com/v3/a/${encodeURIComponent(account)}` +
    `/text-messages/${encodeURIComponent(message)}/media/${index}`;
}

function contentTypeOf(response) {
  return (response.headers.get('Content-Type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function declaredLength(response) {
  const raw = response.headers.get('Content-Length');
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('CALLRAIL_MMS_LENGTH_INVALID', 'CallRail returned an invalid media length.');
  }
  return value;
}

async function readBoundedBytes(response, maximumBytes) {
  const length = declaredLength(response);
  if (length != null && length > maximumBytes) {
    fail('CALLRAIL_MMS_SIZE_UNSUPPORTED', 'CallRail MMS media exceeds the allowed size.');
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    fail(
      'CALLRAIL_MMS_RESPONSE_INVALID',
      'CallRail returned an unreadable media response.',
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
        fail('CALLRAIL_MMS_SIZE_UNSUPPORTED', 'CallRail MMS media exceeds the allowed size.');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CallrailMmsError) throw error;
    fail(
      'CALLRAIL_MMS_DOWNLOAD_FAILED',
      'CallRail MMS media could not be downloaded.',
      { retryable: true },
    );
  }

  if (total === 0) {
    fail('CALLRAIL_MMS_EMPTY', 'CallRail returned an empty media object.');
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
  const retryable = response.status === 429 || response.status >= 500;
  return new CallrailMmsError(
    'CALLRAIL_MMS_DOWNLOAD_REJECTED',
    'CallRail did not return the requested MMS media.',
    { retryable, status: response.status },
  );
}

async function downloadOne({
  apiKey,
  accountId,
  providerMessageId,
  index,
  maximumBytes,
  fetchImpl,
  timeoutMs,
}) {
  const endpoint = buildCallrailMediaEndpoint({ accountId, providerMessageId, index });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: `Token token="${apiKey}"`,
        Accept: 'image/jpeg, image/png, image/gif',
      },
    }, timeoutMs);
  } catch {
    fail(
      'CALLRAIL_MMS_DOWNLOAD_FAILED',
      'CallRail MMS media could not be downloaded.',
      { retryable: true },
    );
  }
  if (!response?.ok) throw providerFailure(response || { status: 0 });

  const contentType = contentTypeOf(response);
  const mediaType = MEDIA_TYPES[contentType];
  if (!mediaType) {
    fail(
      'CALLRAIL_MMS_TYPE_UNSUPPORTED',
      'CallRail MMS media must be JPEG, PNG, or GIF.',
    );
  }
  const bytes = await readBoundedBytes(response, maximumBytes);
  if (!mediaType.matches(bytes)) {
    fail(
      'CALLRAIL_MMS_SIGNATURE_INVALID',
      'CallRail MMS media content does not match its declared type.',
    );
  }
  return { bytes, contentType, extension: mediaType.extension };
}

/**
 * Download every media item for one verified CallRail event and copy it to the
 * private message-attachments bucket.
 */
export async function ingestCallrailMms({
  db,
  apiKey,
  accountId,
  companyResourceId,
  providerConversationId,
  providerMessageId,
  mediaCount,
}, {
  fetchImpl = fetchWithTimeout,
  timeoutMs = CALLRAIL_MMS_FETCH_TIMEOUT_MS,
  limits = {},
} = {}) {
  if (!db || typeof db.uploadStorage !== 'function') {
    fail('CALLRAIL_MMS_STORAGE_UNAVAILABLE', 'Private MMS storage is not configured.');
  }
  const token = requireApiKey(apiKey);
  const account = requireIdentifier(accountId, 'CallRail account identity');
  const company = requireIdentifier(companyResourceId, 'CallRail company identity');
  const conversation = requireIdentifier(
    providerConversationId,
    'CallRail conversation identity',
  );
  const message = requireIdentifier(providerMessageId, 'CallRail message identity');
  const normalizedLimits = normalizeLimits(limits);
  validateCallrailMmsCount(mediaCount, normalizedLimits);

  const ownedMedia = [];
  let totalBytes = 0;
  for (let index = 0; index < mediaCount; index += 1) {
    const remaining = normalizedLimits.maxTotalBytes - totalBytes;
    if (remaining <= 0) {
      fail('CALLRAIL_MMS_TOTAL_SIZE_UNSUPPORTED', 'CallRail MMS exceeds the total size limit.');
    }
    const maximumBytes = Math.min(normalizedLimits.maxObjectBytes, remaining);
    const downloaded = await downloadOne({
      apiKey: token,
      accountId: account,
      providerMessageId: message,
      index,
      maximumBytes,
      fetchImpl,
      timeoutMs,
    });
    totalBytes += downloaded.bytes.byteLength;

    const sha256 = await sha256Hex(downloaded.bytes);
    const storagePath =
      `callrail/${company}/${conversation}/${message}/` +
      `${index}-${sha256.slice(0, 16)}.${downloaded.extension}`;
    try {
      await db.uploadStorage(
        CALLRAIL_MMS_BUCKET,
        storagePath,
        downloaded.bytes,
        downloaded.contentType,
      );
    } catch {
      fail(
        'CALLRAIL_MMS_STORAGE_FAILED',
        'CallRail MMS media could not be stored.',
        { retryable: true },
      );
    }

    ownedMedia.push(Object.freeze({
      index,
      bucket: CALLRAIL_MMS_BUCKET,
      storagePath,
      storageRef: `upr-storage://${CALLRAIL_MMS_BUCKET}/${storagePath}`,
      contentType: downloaded.contentType,
      byteSize: downloaded.bytes.byteLength,
      sha256,
    }));
  }
  return Object.freeze({
    media: Object.freeze(ownedMedia),
    itemCount: ownedMedia.length,
    totalBytes,
  });
}

export async function ingestVerifiedCallrailEventMms({ db, env, event }, options) {
  const apiKey = await resolveCallRailApiKey(env, db);
  const accountId = await resolveCallRailAccountId(db, apiKey, env);
  if (!accountId) {
    fail('CALLRAIL_MMS_ACCOUNT_MISSING', 'CallRail MMS is not configured.');
  }
  return ingestCallrailMms({
    db,
    apiKey,
    accountId,
    companyResourceId: event.companyResourceId,
    providerConversationId: event.providerConversationId,
    providerMessageId: event.providerMessageId,
    mediaCount: event.mediaCount,
  }, options);
}
