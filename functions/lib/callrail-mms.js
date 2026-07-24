/**
 * Securely copies CallRail MMS objects into UPR-owned private Storage.
 *
 * Signed webhooks provide short-lived authenticated media endpoints. They are
 * accepted only after strict CallRail account/host validation, downloaded
 * immediately, and never persisted. Queue retries refresh current media URLs
 * through the documented text-conversation API. Returned metadata contains
 * only the private UPR reference.
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

export function validateCallrailMediaEndpoint({
  accountId,
  providerMessageId,
  index,
  mediaUrl,
}) {
  const account = requireIdentifier(accountId, 'CallRail account identity');
  const message = requireIdentifier(providerMessageId, 'CallRail message identity');
  if (!Number.isSafeInteger(index) || index < 0 || index >= CALLRAIL_MMS_MAX_ITEMS) {
    fail('CALLRAIL_MMS_INDEX_INVALID', 'CallRail MMS media index is invalid.');
  }
  let parsed;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    fail('CALLRAIL_MMS_URL_INVALID', 'CallRail MMS media URL is invalid.');
  }
  const exactPath =
    `/v3/a/${encodeURIComponent(account)}/text-messages/` +
    `${encodeURIComponent(message)}/media/${index}`;
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'api.callrail.com'
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.pathname !== exactPath
    || parsed.href.length > 2_048
  ) {
    fail('CALLRAIL_MMS_URL_INVALID', 'CallRail MMS media URL is outside the expected account.');
  }
  return parsed.href;
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
  mediaUrl,
  maximumBytes,
  fetchImpl,
  timeoutMs,
}) {
  const endpoint = validateCallrailMediaEndpoint({
    accountId,
    providerMessageId,
    index,
    mediaUrl,
  });
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
  ephemeralMediaUrls,
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
  if (
    !Array.isArray(ephemeralMediaUrls)
    || ephemeralMediaUrls.length !== mediaCount
  ) {
    fail(
      'CALLRAIL_MMS_URLS_UNAVAILABLE',
      'Current CallRail MMS media URLs are unavailable.',
      { retryable: true },
    );
  }

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
      mediaUrl: ephemeralMediaUrls[index],
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
  const fetchImpl = options?.fetchImpl || fetchWithTimeout;
  let ephemeralMediaUrls = event.ephemeralMediaUrls;
  if (!Array.isArray(ephemeralMediaUrls) || ephemeralMediaUrls.length === 0) {
    const conversation = requireIdentifier(
      event.providerConversationId,
      'CallRail conversation identity',
    );
    const message = requireIdentifier(event.providerMessageId, 'CallRail message identity');
    const endpoint =
      `https://api.callrail.com/v3/a/${encodeURIComponent(accountId)}` +
      `/text-messages/${encodeURIComponent(conversation)}.json?per_page=250`;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: `Token token="${apiKey}"`,
          Accept: 'application/json',
        },
      }, options?.timeoutMs || CALLRAIL_MMS_FETCH_TIMEOUT_MS);
    } catch {
      fail(
        'CALLRAIL_MMS_URL_REFRESH_FAILED',
        'Current CallRail MMS media URLs could not be refreshed.',
        { retryable: true },
      );
    }
    if (!response?.ok) throw providerFailure(response || { status: 0 });
    const payloadBytes = await readBoundedBytes(response, 1_000_000);
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
      fail(
        'CALLRAIL_MMS_URL_REFRESH_INVALID',
        'CallRail returned an invalid text conversation.',
        { retryable: true },
      );
    }
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const expectedDirection = event.direction === 'inbound' ? 'incoming' : 'outgoing';
    const matches = messages.filter((candidate) => {
      if (
        candidate?.direction !== expectedDirection
        || String(candidate?.type || '').toLowerCase() !== 'mms'
        || String(candidate?.content || '') !== String(event.body || '')
        || !Array.isArray(candidate?.media_urls)
        || candidate.media_urls.length !== event.mediaCount
      ) {
        return false;
      }
      try {
        candidate.media_urls.forEach((mediaUrl, index) => {
          validateCallrailMediaEndpoint({
            accountId,
            providerMessageId: message,
            index,
            mediaUrl,
          });
        });
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length > 1) {
      fail(
        'CALLRAIL_MMS_URL_REFRESH_AMBIGUOUS',
        'More than one CallRail message matches this MMS event.',
      );
    }
    ephemeralMediaUrls = matches[0]?.media_urls;
    if (!Array.isArray(ephemeralMediaUrls) || ephemeralMediaUrls.length === 0) {
      fail(
        'CALLRAIL_MMS_URLS_UNAVAILABLE',
        'Current CallRail MMS media URLs are unavailable.',
        { retryable: true },
      );
    }
  }
  return ingestCallrailMms({
    db,
    apiKey,
    accountId,
    companyResourceId: event.companyResourceId,
    providerConversationId: event.providerConversationId,
    providerMessageId: event.providerMessageId,
    mediaCount: event.mediaCount,
    ephemeralMediaUrls,
  }, options);
}
