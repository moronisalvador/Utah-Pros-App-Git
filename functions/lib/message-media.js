/**
 * Provider-neutral private media validation and resolution for staff messages.
 *
 * Customer images remain in UPR's private `message-attachments` bucket. Clients
 * carry only opaque `upr-storage://` references; provider adapters receive
 * verified bytes or a short-lived provider-fetch URL at dispatch time.
 */

export const MESSAGE_MEDIA_BUCKET = 'message-attachments';
export const MESSAGE_MEDIA_PREFIX = `upr-storage://${MESSAGE_MEDIA_BUCKET}/`;
export const OUTBOUND_MESSAGE_MEDIA_PREFIX = `${MESSAGE_MEDIA_PREFIX}outbound/`;
export const MESSAGE_MEDIA_MAX_BYTES = 5_000_000;
export const MESSAGE_MEDIA_MAX_ITEMS = 1;

const TYPES = Object.freeze({
  'image/jpeg': {
    extension: 'jpg',
    matches: (bytes) => bytes.length >= 3
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/png': {
    extension: 'png',
    matches: (bytes) => {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return bytes.length >= signature.length
        && signature.every((value, index) => bytes[index] === value);
    },
  },
  'image/gif': {
    extension: 'gif',
    matches: (bytes) => {
      const header = String.fromCharCode(...bytes.slice(0, 6));
      return header === 'GIF87a' || header === 'GIF89a';
    },
  },
});

export class MessageMediaError extends Error {
  constructor(code, message, { status = 400 } = {}) {
    super(message);
    this.name = 'MessageMediaError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, details) {
  throw new MessageMediaError(code, message, details);
}

function normalizedType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

export function validateMessageImage(bytesLike, declaredType) {
  const bytes = bytesLike instanceof Uint8Array
    ? bytesLike
    : new Uint8Array(bytesLike || []);
  const mimeType = normalizedType(declaredType);
  const type = TYPES[mimeType];
  if (!type) {
    fail(
      'MESSAGE_MEDIA_TYPE_UNSUPPORTED',
      'Messages support JPEG, PNG, or GIF images only.',
    );
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MESSAGE_MEDIA_MAX_BYTES) {
    fail(
      'MESSAGE_MEDIA_SIZE_UNSUPPORTED',
      'Message images must be no larger than 5 MB.',
    );
  }
  if (!type.matches(bytes)) {
    fail(
      'MESSAGE_MEDIA_SIGNATURE_INVALID',
      'The image content does not match its declared file type.',
    );
  }
  return {
    bytes,
    mimeType,
    byteSize: bytes.byteLength,
    extension: type.extension,
  };
}

export function ownedMessageMediaPath(reference, { outboundOnly = false } = {}) {
  if (typeof reference !== 'string' || !reference.startsWith(MESSAGE_MEDIA_PREFIX)) {
    return null;
  }
  const path = reference.slice(MESSAGE_MEDIA_PREFIX.length);
  if (
    !path
    || path.includes('..')
    || path.includes('\\')
    || path.startsWith('/')
    || !/^[A-Za-z0-9_./-]+$/.test(path)
    || (outboundOnly && !path.startsWith('outbound/'))
    || (!path.startsWith('outbound/') && !path.startsWith('callrail/'))
  ) {
    return null;
  }
  return path;
}

export function outboundMessageMediaPath(reference, conversationId) {
  const path = ownedMessageMediaPath(reference, { outboundOnly: true });
  const prefix = `outbound/${conversationId}/`;
  return path?.startsWith(prefix) ? path : null;
}

function legacyPublicStoragePath(reference, conversationId, baseUrl) {
  if (!baseUrl || typeof reference !== 'string') return null;
  let parsed;
  let expected;
  try {
    parsed = new URL(reference);
    expected = new URL(baseUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.origin !== expected.origin
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    return null;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const prefix = `/storage/v1/object/public/job-files/conversations/${conversationId}/`;
  if (
    !pathname.startsWith(prefix)
    || pathname.includes('..')
    || pathname.includes('\\')
    || !/^[/A-Za-z0-9_.-]+$/.test(pathname)
  ) {
    return null;
  }
  return {
    url: parsed.href,
    storagePath: pathname.slice('/storage/v1/object/public/job-files/'.length),
  };
}

export async function resolveMessageMedia(
  db,
  references,
  conversationId,
  { allowLegacyPublic = false, legacyPublicBaseUrl = null } = {},
) {
  if (!Array.isArray(references) || references.length === 0) return [];
  if (references.length > MESSAGE_MEDIA_MAX_ITEMS) {
    fail(
      'MESSAGE_MEDIA_COUNT_UNSUPPORTED',
      'Only one image can be attached to a message while CallRail is active.',
    );
  }

  const resolved = [];
  for (const reference of references) {
    const storagePath = outboundMessageMediaPath(reference, conversationId);
    if (!storagePath) {
      // One narrow compatibility path exists for already-deployed clients that
      // still upload to UPR's old public conversation folder. It is Twilio-only
      // and still downloaded and byte-verified below; arbitrary HTTPS is denied.
      const legacy = allowLegacyPublic
        ? legacyPublicStoragePath(reference, conversationId, legacyPublicBaseUrl)
        : null;
      if (!legacy) {
        fail('MESSAGE_MEDIA_REFERENCE_INVALID', 'The message image reference is invalid.');
      }
      let stored;
      try {
        stored = await db.downloadStorage(
          'job-files',
          legacy.storagePath,
          MESSAGE_MEDIA_MAX_BYTES,
        );
      } catch {
        fail(
          'MESSAGE_MEDIA_UNAVAILABLE',
          'The message image is temporarily unavailable.',
          { status: 503 },
        );
      }
      const checked = validateMessageImage(stored.bytes, stored.contentType);
      resolved.push({
        url: legacy.url,
        legacyPublic: true,
        verified: true,
        ...checked,
      });
      continue;
    }
    let stored;
    try {
      stored = await db.downloadStorage(
        MESSAGE_MEDIA_BUCKET,
        storagePath,
        MESSAGE_MEDIA_MAX_BYTES,
      );
    } catch {
      fail(
        'MESSAGE_MEDIA_UNAVAILABLE',
        'The message image is temporarily unavailable.',
        { status: 503 },
      );
    }
    const checked = validateMessageImage(stored.bytes, stored.contentType);
    resolved.push({
      storageRef: reference,
      storagePath,
      fileName: storagePath.split('/').pop(),
      verified: true,
      ...checked,
    });
  }
  return resolved;
}
