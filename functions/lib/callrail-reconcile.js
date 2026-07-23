/**
 * ════════════════════════════════════════════════
 * FILE: callrail-reconcile.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads CallRail's conversation history to resolve an ambiguous outbound
 *   attempt without ever sending the message again. A match requires the same
 *   customer, tracking number, body, direction, and a tightly bounded time.
 *
 * DEPENDS ON:
 *   Internal:     ./http.js, ./callrail-api.js, ./callrail-messaging.js
 *   External API: CallRail REST API v3 (GET only)
 *   Data:         callers supply message_send_attempts and messages rows
 *
 * NOTES / GOTCHAS:
 *   - Every URL is built from the fixed CallRail API origin.
 *   - Multiple or partial matches fail closed. This deliberately does not guess
 *     when CallRail has appended text (for example first-message opt-out copy).
 *   - This helper performs no database writes and no provider sends.
 * ════════════════════════════════════════════════
 */

import { resolveCallRailAccountId } from './callrail-api.js';
import { resolveCallRailApiKey } from './callrail-messaging.js';
import { fetchWithTimeout } from './http.js';

const API_ORIGIN = 'https://api.callrail.com';
const MATCH_BEFORE_MS = 2 * 60 * 1000;
const MATCH_AFTER_MS = 10 * 60 * 1000;
const MAX_RECONCILE_AGE_MS = 24 * 60 * 60 * 1000;

export class CallrailReconcileError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'CallrailReconcileError';
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code, message, options) {
  throw new CallrailReconcileError(code, message, options);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function normalizePhone(value) {
  const digits = clean(value)?.replace(/\D/g, '') || '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function authHeaders(apiKey) {
  return { Authorization: `Token token="${apiKey}"` };
}

async function getJson(url, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: authHeaders(apiKey) });
  } catch {
    fail(
      'CALLRAIL_RECONCILE_FETCH_FAILED',
      'CallRail conversation lookup did not return a conclusive response',
      { retryable: true },
    );
  }
  if (!response?.ok) {
    fail(
      'CALLRAIL_RECONCILE_FETCH_FAILED',
      `CallRail conversation lookup failed with status ${response?.status || 0}`,
      { retryable: response?.status === 429 || response?.status >= 500 },
    );
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('CALLRAIL_RECONCILE_INVALID_RESPONSE', 'CallRail returned an invalid conversation response');
  }
  return data;
}

function assertAttemptShape(attempt, message, now) {
  if (
    attempt?.provider !== 'callrail'
    || !['accepted', 'ambiguous'].includes(attempt?.state)
  ) {
    fail(
      'CALLRAIL_RECONCILE_ATTEMPT_INELIGIBLE',
      'Only accepted or ambiguous CallRail attempts can be reconciled',
    );
  }
  if (
    !attempt.id
    || (message && (!attempt.message_id || message.id !== attempt.message_id))
    || (attempt.message_id && !message)
  ) {
    fail(
      'CALLRAIL_RECONCILE_MESSAGE_REQUIRED',
      'The attempt message identity is inconsistent',
    );
  }
  if (
    (message && (
      message.provider !== 'callrail'
      || typeof message.body !== 'string'
    ))
    || (!message && typeof attempt.canonical_body !== 'string')
    || typeof attempt.submitted_body !== 'string'
    || !attempt.submitted_body
  ) {
    fail(
      'CALLRAIL_RECONCILE_MESSAGE_INVALID',
      'The linked canonical CallRail message or submitted body is incomplete',
    );
  }
  const recipient = normalizePhone(attempt.recipient_address);
  const messageRecipient = message ? normalizePhone(message.recipient_address) : recipient;
  const startedAt = validDate(attempt.started_at);
  if (!recipient || recipient !== messageRecipient || !startedAt) {
    fail(
      'CALLRAIL_RECONCILE_IDENTITY_INCOMPLETE',
      'Recipient or attempt time is unavailable for safe reconciliation',
    );
  }
  if (now.getTime() - startedAt.getTime() > MAX_RECONCILE_AGE_MS) {
    fail(
      'CALLRAIL_RECONCILE_WINDOW_EXPIRED',
      'The automatic reconciliation window expired; manual provider review is required',
    );
  }
  return { recipient, startedAt };
}

function validateConversation(value, config, recipient) {
  if (
    !value
    || typeof value !== 'object'
    || !clean(value.id)
    || clean(value.company_id) !== config.companyId
    || normalizePhone(value.customer_phone_number) !== recipient
    || normalizePhone(value.current_tracking_number) !== config.trackingNumber
  ) {
    fail(
      'CALLRAIL_RECONCILE_CONVERSATION_MISMATCH',
      'CallRail conversation identity did not match the configured company and phone numbers',
    );
  }
  return value;
}

async function resolveConversation(config, attempt, recipient, fetchImpl) {
  if (clean(attempt.provider_conversation_id)) {
    const id = encodeURIComponent(attempt.provider_conversation_id);
    const url = new URL(
      `/v3/a/${encodeURIComponent(config.accountId)}/text-messages/${id}.json`,
      API_ORIGIN,
    );
    url.searchParams.set('page', '1');
    url.searchParams.set('per_page', '100');
    return validateConversation(await getJson(url.href, config.apiKey, fetchImpl), config, recipient);
  }

  const url = new URL(
    `/v3/a/${encodeURIComponent(config.accountId)}/text-messages.json`,
    API_ORIGIN,
  );
  url.searchParams.set('company_id', config.companyId);
  url.searchParams.set('search', recipient);
  url.searchParams.set('per_page', '100');
  const data = await getJson(url.href, config.apiKey, fetchImpl);
  if (!Array.isArray(data.conversations)) {
    fail('CALLRAIL_RECONCILE_INVALID_RESPONSE', 'CallRail returned no conversation list');
  }
  const matches = data.conversations.filter((conversation) => (
    clean(conversation?.company_id) === config.companyId
    && normalizePhone(conversation?.customer_phone_number) === recipient
    && normalizePhone(conversation?.current_tracking_number) === config.trackingNumber
  ));
  if (matches.length !== 1) {
    fail(
      matches.length
        ? 'CALLRAIL_RECONCILE_CONVERSATION_AMBIGUOUS'
        : 'CALLRAIL_RECONCILE_CONVERSATION_NOT_FOUND',
      matches.length
        ? 'More than one CallRail conversation could match the attempt'
        : 'No exact CallRail conversation matched the attempt',
      { retryable: matches.length === 0 },
    );
  }

  const id = encodeURIComponent(matches[0].id);
  const detailUrl = new URL(
    `/v3/a/${encodeURIComponent(config.accountId)}/text-messages/${id}.json`,
    API_ORIGIN,
  );
  detailUrl.searchParams.set('page', '1');
  detailUrl.searchParams.set('per_page', '100');
  return validateConversation(
    await getJson(detailUrl.href, config.apiKey, fetchImpl),
    config,
    recipient,
  );
}

export async function resolveCallrailReconcileConfig(env, db) {
  const companyId = clean(env?.CALLRAIL_COMPANY_ID);
  const trackingNumber = normalizePhone(env?.CALLRAIL_TRACKING_NUMBER);
  if (!companyId || !trackingNumber) {
    fail('CALLRAIL_RECONCILE_NOT_CONFIGURED', 'CallRail reconciliation is not configured');
  }
  const apiKey = await resolveCallRailApiKey(env, db);
  if (!apiKey) {
    fail('CALLRAIL_RECONCILE_NOT_CONFIGURED', 'CallRail reconciliation is not configured');
  }
  const accountId = clean(await resolveCallRailAccountId(db, apiKey, env));
  if (!accountId) {
    fail('CALLRAIL_RECONCILE_NOT_CONFIGURED', 'CallRail reconciliation is not configured');
  }
  return { accountId, apiKey, companyId, trackingNumber };
}

export async function findCallrailAttemptOutcome({
  attempt,
  message,
  config,
  now = new Date(),
  fetchImpl = fetchWithTimeout,
}) {
  const { recipient, startedAt } = assertAttemptShape(attempt, message, now);
  const conversation = await resolveConversation(config, attempt, recipient, fetchImpl);
  if (!Array.isArray(conversation.messages)) {
    fail('CALLRAIL_RECONCILE_INVALID_RESPONSE', 'CallRail returned no message history');
  }

  const lowerBound = startedAt.getTime() - MATCH_BEFORE_MS;
  const upperBound = startedAt.getTime() + MATCH_AFTER_MS;
  const matches = conversation.messages.filter((providerMessage) => {
    const occurredAt = validDate(providerMessage?.created_at);
    return clean(providerMessage?.id)
      && providerMessage?.direction === 'outgoing'
      && providerMessage?.content === attempt.submitted_body
      && occurredAt
      && occurredAt.getTime() >= lowerBound
      && occurredAt.getTime() <= upperBound;
  });
  if (matches.length !== 1) {
    fail(
      matches.length
        ? 'CALLRAIL_RECONCILE_MESSAGE_AMBIGUOUS'
        : 'CALLRAIL_RECONCILE_MESSAGE_NOT_FOUND',
      matches.length
        ? 'More than one CallRail message could match the attempt'
        : 'No exact CallRail message matched the attempt',
      { retryable: matches.length === 0 },
    );
  }

  const match = matches[0];
  // CallRail's documented conversation history identifies sent messages by
  // direction/content/time but does not expose a Twilio-style delivery
  // lifecycle. An exact outgoing observation confirms provider submission, not
  // handset delivery. Preserve an explicit failure if CallRail adds one.
  const observedStatus = clean(match.status)?.toLowerCase();
  const providerStatus = ['failed', 'error'].includes(observedStatus)
    ? observedStatus
    : 'sent';
  return {
    attemptId: attempt.id,
    messageId: message?.id || null,
    providerMessageId: String(match.id),
    providerConversationId: String(conversation.id),
    companyResourceId: config.companyId,
    senderAddress: config.trackingNumber,
    recipientAddress: recipient,
    providerStatus,
    occurredAt: new Date(match.created_at).toISOString(),
    confirmed: providerStatus === 'sent',
  };
}
