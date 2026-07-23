/**
 * ════════════════════════════════════════════════
 * FILE: messaging-attempts.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Claims one stable client request before a provider submission so retries or
 *   concurrent requests cannot silently send the same customer message twice.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Data:      reads/writes → message_send_attempts
 *
 * EXPORTS:
 *   findMessageAttempt(db, command)
 *   claimMessageAttempt(db, command)
 *   claimChildMessageAttempt(db, parentAttemptId, command)
 *   completeMessageAttempt(db, attemptId, patch)
 * ════════════════════════════════════════════════
 */

function orderedRequest(command) {
  return JSON.stringify({
    conversationId: command.conversationId,
    actorEmployeeId: command.actorEmployeeId,
    recipientAddress: command.recipientAddress,
    body: command.body,
    mediaUrls: command.mediaUrls || [],
    provider: command.provider,
    requestedChannel: command.requestedChannel,
  });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findAttempt(db, clientRequestId) {
  const [attempt] = await db.select(
    'message_send_attempts',
    `client_request_id=eq.${clientRequestId}&select=*&limit=1`,
  );
  return attempt || null;
}

function assertSameRequest(attempt, command, fingerprint) {
  if (
    attempt.request_fingerprint !== fingerprint
    || attempt.conversation_id !== command.conversationId
    || attempt.actor_employee_id !== command.actorEmployeeId
    || attempt.recipient_address !== command.recipientAddress
    || attempt.provider !== command.provider
  ) {
    const error = new Error('client_request_id was already used for a different message');
    error.code = 'CLIENT_REQUEST_CONFLICT';
    throw error;
  }
}

export async function claimMessageAttempt(db, command) {
  if (!command.clientRequestId && !command.foundationSchema) {
    return { claimed: true, attempt: null };
  }

  const fingerprint = await sha256(orderedRequest(command));
  if (command.clientRequestId) {
    const existing = await findAttempt(db, command.clientRequestId);
    if (existing) {
      assertSameRequest(existing, command, fingerprint);
      return { claimed: false, attempt: existing };
    }
  }

  try {
    const [attempt] = await db.insert('message_send_attempts', {
      conversation_id: command.conversationId,
      actor_employee_id: command.actorEmployeeId,
      attempt_number: 1,
      client_request_id: command.clientRequestId,
      provider: command.provider,
      request_fingerprint: fingerprint,
      recipient_address: command.recipientAddress,
      submitted_body: command.body,
      canonical_body: command.canonicalBody ?? null,
      media_urls: command.mediaUrls || [],
      recipient_contact_id: command.recipientContactId || null,
      requested_channel: command.requestedChannel,
      state: 'submitting',
    });
    return { claimed: true, attempt };
  } catch (error) {
    if (!command.clientRequestId) throw error;
    // A concurrent request may have won the unique client_request_id claim.
    const winner = await findAttempt(db, command.clientRequestId);
    if (!winner) throw error;
    assertSameRequest(winner, command, fingerprint);
    return { claimed: false, attempt: winner };
  }
}

export async function claimChildMessageAttempt(db, parentAttemptId, command) {
  if (!parentAttemptId) {
    throw new Error('parentAttemptId is required for a recipient attempt');
  }
  const recipientContactId = command.recipientContactId || null;
  const fingerprint = await sha256(orderedRequest(command));
  const filter = recipientContactId
    ? `parent_attempt_id=eq.${parentAttemptId}&recipient_contact_id=eq.${recipientContactId}&select=*&limit=1`
    : `parent_attempt_id=eq.${parentAttemptId}&recipient_address=eq.${encodeURIComponent(command.recipientAddress)}&select=*&limit=1`;
  const [existing] = await db.select('message_send_attempts', filter);
  if (existing) {
    assertSameRequest(existing, command, fingerprint);
    return { claimed: false, attempt: existing };
  }

  const payload = {
    parent_attempt_id: parentAttemptId,
    conversation_id: command.conversationId,
    actor_employee_id: command.actorEmployeeId,
    attempt_number: 1,
    client_request_id: null,
    provider: command.provider,
    request_fingerprint: fingerprint,
    recipient_contact_id: recipientContactId,
    recipient_address: command.recipientAddress,
    submitted_body: command.body,
    canonical_body: command.canonicalBody ?? null,
    media_urls: command.mediaUrls || [],
    requested_channel: command.requestedChannel,
    state: command.initialState || 'submitting',
  };
  try {
    const [attempt] = await db.insert('message_send_attempts', payload);
    return { claimed: true, attempt };
  } catch (error) {
    const [winner] = await db.select('message_send_attempts', filter);
    if (!winner) throw error;
    assertSameRequest(winner, command, fingerprint);
    return { claimed: false, attempt: winner };
  }
}

export async function findMessageAttempt(db, command) {
  if (!command.clientRequestId) return null;
  const fingerprint = await sha256(orderedRequest(command));
  const attempt = await findAttempt(db, command.clientRequestId);
  if (!attempt) return null;
  assertSameRequest(attempt, command, fingerprint);
  return attempt;
}

export async function completeMessageAttempt(db, attemptId, patch) {
  if (!attemptId) return;
  await db.update(
    'message_send_attempts',
    `id=eq.${attemptId}`,
    { ...patch, updated_at: new Date().toISOString() },
  );
}
