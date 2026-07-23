/**
 * Projects a claimed CallRail text event into UPR's canonical messaging domain.
 *
 * This module never calls a provider. In particular, compliance replies are not
 * sent through CallRail because its API is restricted to person-to-person use.
 * Inbound projection is one service-role database transaction keyed by the
 * durable provider-event ID. An immediate webhook without that ID defers to the
 * retained-event worker instead of falling back to a partial multi-write path.
 */

export class CallrailMessageProcessingError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'CallrailMessageProcessingError';
    this.code = code;
    this.retryable = retryable;
  }
}

const MAX_PROCESSING_ATTEMPTS = 8;
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

export function buildCallrailRetryPatch({
  previousAttempts = 0,
  error,
  now = new Date(),
}) {
  const processingAttempts = Math.max(0, Number(previousAttempts) || 0) + 1;
  const retryable = error?.retryable !== false && processingAttempts < MAX_PROCESSING_ATTEMPTS;
  const delayMs = Math.min(
    RETRY_BASE_MS * (2 ** Math.max(0, processingAttempts - 1)),
    RETRY_MAX_MS,
  );
  return {
    processing_state: retryable ? 'retryable' : 'failed',
    processing_attempts: processingAttempts,
    next_attempt_at: retryable
      ? new Date(now.getTime() + delayMs).toISOString()
      : null,
    outcome: retryable ? 'processing_deferred' : 'processing_blocked',
    error_code: error?.code || 'CALLRAIL_PROCESSING_FAILED',
    error_message: String(error?.message || error).slice(0, 500),
    updated_at: now.toISOString(),
  };
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function isExactOutboundAttempt(attempt, event) {
  const startedAt = new Date(attempt.started_at).getTime();
  const occurredAt = new Date(event.occurredAt).getTime();
  return attempt.provider_conversation_id === event.providerConversationId
    && attempt.submitted_body === event.body
    && normalizedPhone(attempt.recipient_address) === normalizedPhone(event.to)
    && Number.isFinite(startedAt)
    && Number.isFinite(occurredAt)
    && occurredAt >= startedAt - (2 * 60 * 1000)
    && occurredAt <= startedAt + (10 * 60 * 1000);
}

async function findOutboundAttempt(db, event) {
  const [byMessageId] = await db.select(
    'message_send_attempts',
    `provider=eq.callrail&provider_message_id=eq.${encodeURIComponent(event.providerMessageId)}&limit=1`,
  );
  if (byMessageId) return byMessageId;

  const candidates = await db.select(
    'message_send_attempts',
    `provider=eq.callrail&provider_conversation_id=eq.${encodeURIComponent(event.providerConversationId)}&state=in.(accepted,ambiguous)&order=started_at.asc&limit=20`,
  );
  const matches = candidates.filter((attempt) => isExactOutboundAttempt(attempt, event));
  if (matches.length > 1) {
    throw new CallrailMessageProcessingError(
      'CALLRAIL_OUTBOUND_AMBIGUOUS',
      'More than one CallRail send attempt matches the sent event',
    );
  }
  return matches[0] || null;
}

export function normalizeStoredCallrailEvent(row) {
  if (!row || row.provider !== 'callrail') {
    throw new CallrailMessageProcessingError(
      'INVALID_STORED_PROVIDER_EVENT',
      'A stored CallRail provider event is required',
    );
  }
  const required = [
    row.id,
    row.provider_message_id,
    row.provider_conversation_id,
    row.occurred_at,
    row.direction,
    row.message_type,
    row.sender_address,
    row.recipient_address,
  ];
  if (required.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new CallrailMessageProcessingError(
      'INVALID_STORED_PROVIDER_EVENT',
      'Stored CallRail event is missing required normalized fields',
    );
  }
  return {
    eventId: row.id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    providerConversationId: row.provider_conversation_id,
    occurredAt: row.occurred_at,
    direction: row.direction,
    messageType: row.message_type,
    from: row.sender_address,
    to: row.recipient_address,
    body: row.content || '',
    ownedMedia: Array.isArray(row.owned_media) ? row.owned_media : [],
    companyResourceId: row.company_resource_id,
    mediaCount: row.media_count,
  };
}

async function loadProjectionEntities(db, projection) {
  if (!projection.inserted) {
    return { conversation: null, contact: null };
  }
  const [conversation] = projection.conversation_id
    ? await db.select('conversations', `id=eq.${projection.conversation_id}&limit=1`)
    : [];
  const [contact] = projection.contact_id
    ? await db.select('contacts', `id=eq.${projection.contact_id}&limit=1`)
    : [];
  return {
    conversation: conversation || null,
    contact: contact || null,
  };
}

export async function processCallrailTextEvent({ db, event, consentOnly = false }) {
  if (event.provider !== 'callrail') {
    throw new CallrailMessageProcessingError(
      'UNSUPPORTED_PROVIDER_EVENT',
      'Only CallRail events are accepted',
    );
  }
  if (!consentOnly && event.messageType === 'mms' && !event.ownedMedia?.length) {
    throw new CallrailMessageProcessingError(
      'CALLRAIL_MMS_NOT_ENABLED',
      'CallRail MMS ingestion is disabled until private media capture is available',
    );
  }

  if (event.direction === 'outbound') {
    if (!event.eventId) {
      throw new CallrailMessageProcessingError(
        'CALLRAIL_EVENT_ID_REQUIRED',
        'Outbound projection requires a durable provider event and will be retried from the event queue',
        { retryable: true },
      );
    }
    const attempt = await findOutboundAttempt(db, event);
    const rows = await db.rpc('project_callrail_outbound_event', {
      p_event_id: event.eventId,
      p_attempt_id: attempt?.id || null,
    });
    const projection = Array.isArray(rows) ? rows[0] : rows;
    if (!projection?.outcome) {
      throw new CallrailMessageProcessingError(
        'CALLRAIL_ATOMIC_PROJECTION_FAILED',
        'Atomic CallRail outbound projection returned no outcome',
        { retryable: true },
      );
    }
    if (projection.outcome === 'outbound_unmatched') {
      throw new CallrailMessageProcessingError(
        'CALLRAIL_OUTBOUND_UNMATCHED',
        'CallRail sent event needs provider-conversation reconciliation',
        { retryable: true },
      );
    }
    return {
      outcome: projection.outcome,
      messageId: projection.message_id || null,
      attemptId: projection.send_attempt_id || attempt?.id || null,
    };
  }

  if (event.direction !== 'inbound') {
    throw new CallrailMessageProcessingError(
      'UNSUPPORTED_EVENT_DIRECTION',
      'CallRail text event direction is unsupported',
    );
  }

  if (!event.eventId) {
    throw new CallrailMessageProcessingError(
      'CALLRAIL_EVENT_ID_REQUIRED',
      'Inbound projection requires a durable provider event and will be retried from the event queue',
      { retryable: true },
    );
  }

  const rows = await db.rpc('project_callrail_inbound_event', {
    p_event_id: event.eventId,
    p_consent_only: consentOnly,
  });
  const projection = Array.isArray(rows) ? rows[0] : rows;
  if (!projection?.outcome) {
    throw new CallrailMessageProcessingError(
      'CALLRAIL_ATOMIC_PROJECTION_FAILED',
      'Atomic CallRail inbound projection returned no outcome',
      { retryable: true },
    );
  }
  const entities = await loadProjectionEntities(db, projection);
  return {
    outcome: projection.outcome,
    messageId: projection.message_id || null,
    conversation: entities.conversation,
    contact: entities.contact,
    inserted: projection.inserted === true,
    requiresStaffReply: projection.requires_staff_reply === true,
  };
}
