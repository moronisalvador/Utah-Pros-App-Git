/**
 * ════════════════════════════════════════════════
 * FILE: callrail-messaging.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends one staff-written text or picture message through CallRail. It rejects
 *   every automated or multi-recipient use before looking up credentials or
 *   contacting CallRail, and reports provider failures without exposing secrets
 *   or customer message content.
 *
 * DEPENDS ON:
 *   Packages:     none
 *   Internal:     ./supabase.js, ./callrail-api.js, ./http.js
 *   External API: CallRail REST API v3
 *   Data:         reads  → integration_credentials, integration_config
 *                 writes → integration_config (only if the existing account-id
 *                          resolver discovers and caches a missing account id)
 *
 * NOTES / GOTCHAS:
 *   - This adapter is registered only behind explicit `callrail` server mode.
 *   - CALLRAIL_COMPANY_ID and CALLRAIL_TRACKING_NUMBER are server-only bindings.
 *     Account/company/tracking identifiers are never accepted from the command.
 *   - A thrown network/timeout error is ambiguous: CallRail may have accepted the
 *     message. The caller must reconcile it and must not automatically resubmit.
 *   - Only one HTTPS media URL with complete type/size metadata is supported.
 * ════════════════════════════════════════════════
 */

import { resolveCallRailAccountId } from './callrail-api.js';
import { fetchWithTimeout } from './http.js';
import { supabase } from './supabase.js';

const CALLRAIL_API_BASE = 'https://api.callrail.com/v3/a';
const MAX_CONTENT_CHARACTERS = 140;
const MAX_MEDIA_BYTES = 5_000_000;
const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

export class CallRailMessagingError extends Error {
  constructor(code, message, {
    status = null,
    retryable = false,
    ambiguous = false,
    reconciliationRequired = false,
  } = {}) {
    super(message);
    this.name = 'CallRailMessagingError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.ambiguous = ambiguous;
    this.reconciliationRequired = reconciliationRequired;
  }
}

function fail(code, message, details) {
  throw new CallRailMessagingError(code, message, details);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function normalizeNorthAmericanNumber(value, code) {
  const raw = clean(value);
  if (!raw) fail(code, 'A valid US or Canadian phone number is required.');

  const digits = raw.replace(/\D/g, '');
  const normalized = digits.length === 10
    ? `+1${digits}`
    : digits.length === 11 && digits.startsWith('1')
      ? `+${digits}`
      : null;

  // NANP area codes and exchanges cannot begin with 0 or 1.
  if (!normalized || !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalized)) {
    fail(code, 'A valid US or Canadian phone number is required.');
  }
  return normalized;
}

function validateMedia(mediaItems) {
  if (mediaItems === undefined || mediaItems === null) return null;
  if (!Array.isArray(mediaItems)) {
    fail('CALLRAIL_MEDIA_INVALID', 'CallRail media must be supplied as a list.');
  }
  if (mediaItems.length === 0) return null;
  if (mediaItems.length > 1) {
    fail('CALLRAIL_MEDIA_COUNT_UNSUPPORTED', 'CallRail supports one media item per message.');
  }

  const media = mediaItems[0] || {};
  const mimeType = clean(media.mimeType)?.toLowerCase();
  const byteSize = Number(media.byteSize);
  const mediaUrl = clean(media.url);

  if (!SUPPORTED_MEDIA_TYPES.has(mimeType)) {
    fail('CALLRAIL_MEDIA_TYPE_UNSUPPORTED', 'CallRail supports JPEG, PNG, or GIF media only.');
  }
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_MEDIA_BYTES) {
    fail('CALLRAIL_MEDIA_SIZE_UNSUPPORTED', 'CallRail media must be no larger than 5 MB.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(mediaUrl);
  } catch {
    fail('CALLRAIL_MEDIA_URL_INVALID', 'CallRail media requires a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    fail('CALLRAIL_MEDIA_URL_INVALID', 'CallRail media requires a valid HTTPS URL.');
  }
  return parsedUrl.href;
}

export async function resolveCallRailApiKey(env, db) {
  let apiKey = null;
  if (db || env?.SUPABASE_URL) {
    try {
      const client = db || supabase(env);
      const rows = await client.select(
        'integration_credentials',
        'provider=eq.callrail&select=access_token'
      );
      apiKey = clean(rows?.[0]?.access_token);
    } catch {
      // Preserve the existing CallRail convention: DB failure may use the
      // server-only environment fallback, but never a request-supplied key.
    }
  }
  return apiKey || clean(env?.CALLRAIL_API_KEY);
}

function classifyProviderFailure(status) {
  if (status === 429) {
    return new CallRailMessagingError(
      'CALLRAIL_RATE_LIMITED',
      'CallRail temporarily rejected the message.',
      { status, retryable: true }
    );
  }
  if (status >= 500) {
    return new CallRailMessagingError(
      'CALLRAIL_SEND_AMBIGUOUS',
      'CallRail did not return a conclusive response.',
      {
        status,
        ambiguous: true,
        reconciliationRequired: true,
      }
    );
  }
  if (status >= 400 && status < 500) {
    return new CallRailMessagingError(
      'CALLRAIL_REJECTED',
      'CallRail rejected the message.',
      { status }
    );
  }
  return new CallRailMessagingError(
    'CALLRAIL_UNEXPECTED_RESPONSE',
    'CallRail returned an unexpected response.',
    { status }
  );
}

/**
 * Submit one server-authorized staff-to-customer message to CallRail.
 *
 * The command uses the provider-neutral transport shape from the messaging
 * roadmap. Provider account, company, tracking number, and API key are always
 * resolved server-side.
 */
export async function sendCallRailMessage(env, command, { db = null } = {}) {
  if (command?.purpose !== 'staff_p2p') {
    fail(
      'CALLRAIL_PURPOSE_UNSUPPORTED',
      'CallRail is available only for staff person-to-person messages.'
    );
  }

  const recipient = normalizeNorthAmericanNumber(
    command?.recipient?.address,
    'CALLRAIL_DESTINATION_INVALID'
  );
  const body = typeof command?.content?.body === 'string'
    ? command.content.body
    : '';
  if (!body.trim()) {
    fail('CALLRAIL_CONTENT_REQUIRED', 'CallRail requires message content.');
  }
  if (Array.from(body).length > MAX_CONTENT_CHARACTERS) {
    fail(
      'CALLRAIL_CONTENT_TOO_LONG',
      `CallRail message content cannot exceed ${MAX_CONTENT_CHARACTERS} characters.`
    );
  }
  const mediaUrl = validateMedia(command?.content?.media);

  const companyId = clean(env?.CALLRAIL_COMPANY_ID);
  const trackingNumber = normalizeNorthAmericanNumber(
    env?.CALLRAIL_TRACKING_NUMBER,
    'CALLRAIL_TRACKING_NUMBER_INVALID'
  );
  if (!companyId) {
    fail('CALLRAIL_COMPANY_ID_MISSING', 'CallRail messaging is not configured.');
  }

  const apiKey = await resolveCallRailApiKey(env, db);
  if (!apiKey) {
    fail('CALLRAIL_API_KEY_MISSING', 'CallRail messaging is not configured.');
  }

  const accountId = clean(await resolveCallRailAccountId(db || supabase(env), apiKey, env));
  if (!accountId) {
    fail('CALLRAIL_ACCOUNT_ID_MISSING', 'CallRail messaging is not configured.');
  }

  const requestBody = {
    company_id: companyId,
    customer_phone_number: recipient,
    tracking_number: trackingNumber,
    content: body,
  };
  if (mediaUrl) requestBody.media_url = mediaUrl;

  let response;
  try {
    response = await fetchWithTimeout(
      `${CALLRAIL_API_BASE}/${encodeURIComponent(accountId)}/text-messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token token="${apiKey}"`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );
  } catch {
    throw new CallRailMessagingError(
      'CALLRAIL_SEND_AMBIGUOUS',
      'CallRail did not return a conclusive response.',
      {
        ambiguous: true,
        reconciliationRequired: true,
      }
    );
  }

  if (response.status !== 201) {
    throw classifyProviderFailure(response.status);
  }

  const data = await response.json().catch(() => ({}));
  const providerConversationId = clean(data?.id);
  if (!providerConversationId) {
    throw new CallRailMessagingError(
      'CALLRAIL_SEND_AMBIGUOUS',
      'CallRail accepted the request without a usable conversation identity.',
      {
        status: 201,
        ambiguous: true,
        reconciliationRequired: true,
      },
    );
  }
  return {
    provider: 'callrail',
    providerMessageId: null,
    providerConversationId,
    accepted: true,
    status: 'queued',
    providerStatus: 'accepted',
    providerHttpStatus: 201,
    sentAt: null,
    from: trackingNumber,
    to: recipient,
    rawReference: null,
  };
}
