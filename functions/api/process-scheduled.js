/**
 * ════════════════════════════════════════════════
 * FILE: process-scheduled.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends the texts that staff scheduled for later. It runs on a timer (via the
 *   server-side scheduler), looks for scheduled messages whose send time has
 *   arrived, checks the recipient still consents, sends each one through the
 *   central automated-message safety gate, and records the result. Phase A
 *   hardened it:
 *     1. The public trigger endpoint now requires the scheduler secret (or the
 *        exact internal DevTools owner with Conversations access) — it used to
 *        be open to anyone.
 *     2. Two copies of the job running at once can no longer both grab the same
 *        text and send it twice — each message is claimed atomically in the
 *        database; only one worker wins.
 *     3. Outside legal texting hours (before 8am / after 9pm) it holds the whole
 *        batch and tries again later, instead of texting people overnight.
 *     4. Every run writes a worker_runs row so we can see it ran.
 *     5. Scheduled sends use the same global SMS kill-switch, consent, DND,
 *        quiet-hours, retry, and thread-recording path as every automation.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: GET/POST /api/process-scheduled  (authenticated — scheduler secret
 *             or the active internal Dev Tools owner)
 *             Also exports scheduled() for a Cloudflare Cron Trigger (no HTTP).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/cors.js,
 *              ../lib/automated-send.js (sendAutomatedMessage,
 *              isWithinQuietHours, DEFAULT_SMS_TIMEZONE),
 *              ../lib/auth.js (checkCronSecret, requireOwner),
 *              ../lib/http.js (bounded Auth/database transport),
 *              ../lib/worker-runs.js (shared run telemetry)
 *   Data:      reads  → scheduled_messages, conversations,
 *                       conversation_participants, contacts, employees,
 *                       integration_config
 *              writes → scheduled_messages (token-fenced RPCs),
 *                       message_send_attempts (one durable provider reservation),
 *                       messages, conversations, sms_consent_log, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - The HTTP trigger accepts the scheduler secret or the exact owner identity
 *     allowed into Dev Tools, and a manual caller must still have Messages access.
 *   - Every claim has a random fencing token. Release/failure writes match that
 *     token, so an old worker cannot clear or finish a newer worker's claim.
 *   - At-most-once provider boundary: after every consent gate passes, one
 *     message_send_attempt is atomically linked to the scheduled row. Scheduled
 *     mode authorizes one provider invocation and never automatically replays a
 *     linked submitting/accepted/ambiguous attempt. An unknown crash outcome is
 *     failed for owner review rather than risking a duplicate customer text.
 *   - Quiet-hours uses the business-default timezone (America/Denver). Per-recipient
 *     timezone is Phase D; here the whole due batch defers together outside the
 *     window, which is the correct TCPA-safe default.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import {
  sendAutomatedMessage,
  isWithinQuietHours,
  DEFAULT_SMS_TIMEZONE,
} from '../lib/automated-send.js';
import { checkCronSecret, requireOwner } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { SCHEDULED_ACCEPTED_CONSENT_CODES, isAcceptedConsent } from '../lib/sms-consent.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const WORKER_NAME = 'process-scheduled';
const BATCH_LIMIT = 20;
const DELIVERY_RPC_NAMES = [
  'claim_scheduled_message_v2',
  'release_scheduled_message_claim',
  'fail_scheduled_message_claim',
  'reserve_scheduled_message_delivery',
  'reconcile_scheduled_message_delivery',
];

function isMissingDeliverySchema(error) {
  const message = String(error?.message || '');
  return message.includes('PGRST202')
    && DELIVERY_RPC_NAMES.some((name) => message.includes(name));
}

// ─── SECTION: Auth ──────────────
export { checkCronSecret };

export async function authorizeRequest(
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
) {
  if (await checkCronSecret(request, db)) {
    return { authorized: true, actor: 'scheduler' };
  }

  const auth = await requireOwner(request, env, db, fetchImpl);
  if (auth.error) {
    return {
      authorized: false,
      error: auth.error,
      status: auth.status || 403,
    };
  }
  if (auth.employee?.is_external !== false) {
    return {
      authorized: false,
      error: 'Insufficient role',
      status: 403,
    };
  }
  let hasMessagingCapability = false;
  try {
    hasMessagingCapability = await db.rpc(
      'messaging_employee_has_conversations_capability',
      { p_employee_id: auth.employee.id },
    );
  } catch {
    return {
      authorized: false,
      error: 'Messaging authorization lookup failed',
      status: 500,
    };
  }
  if (hasMessagingCapability !== true) {
    return {
      authorized: false,
      error: 'Messaging access is not granted',
      status: 403,
    };
  }
  return { authorized: true, actor: auth.employee };
}

// ─── SECTION: worker_runs ──────────────
async function recordRun(db, { status, processed, errorMessage, startedAt }) {
  return recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status,
    recordsProcessed: processed,
    errorMessage,
    startedAt,
  });
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function releaseClaim(db, scheduledId, claimToken, reason) {
  return db.rpc('release_scheduled_message_claim', {
    p_id: scheduledId,
    p_claim_token: claimToken,
    p_error_message: reason ? String(reason).slice(0, 500) : null,
  });
}

async function failClaim(db, scheduledId, claimToken, reason) {
  return db.rpc('fail_scheduled_message_claim', {
    p_id: scheduledId,
    p_claim_token: claimToken,
    p_error_message: String(reason || 'Scheduled message failed').slice(0, 500),
  });
}

async function reconcileDelivery(db, scheduledId) {
  return firstRow(await db.rpc('reconcile_scheduled_message_delivery', {
    p_id: scheduledId,
  }));
}

function reconciliationWasSent(result) {
  return result?.status === 'sent' || result?.outcome === 'sent';
}

function reconciliationIsInFlight(result) {
  return result?.status === 'in_flight' || result?.outcome === 'in_flight';
}

function parseMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

// ─── SECTION: Queue processing ──────────────
export async function processQueue(
  db,
  env,
  { now = new Date(), clock = () => new Date() } = {},
) {
  const startedAt = new Date().toISOString();
  const nowIso = now.toISOString();
  const processed = [];
  const errors = [];
  let schemaPending = false;

  try {
    // ── TCPA quiet-hours guard: defer the whole due batch outside 8am–9pm ──
    // (business-default TZ; per-recipient tz is Phase D). Holding rather than
    // sending means a text queued for 2am simply goes out after 8am.
    const tz = env?.SMS_QUIET_HOURS_TZ || DEFAULT_SMS_TIMEZONE;
    if (isWithinQuietHours(now, tz)) {
      await recordRun(db, { status: 'completed', processed: 0, startedAt });
      return { success: true, processed: 0, deferred: true, reason: 'quiet_hours' };
    }

    // Fetch due messages (limited per run to avoid timeouts).
    const pending = await db.select(
      'scheduled_messages',
      `status=eq.pending&send_at=lte.${encodeURIComponent(nowIso)}&order=send_at.asc&limit=${BATCH_LIMIT}`
    );

    if (pending.length === 0) {
      await recordRun(db, { status: 'completed', processed: 0, startedAt });
      return { success: true, processed: 0, message: 'No scheduled messages due' };
    }

    for (const scheduled of pending) {
      let claimToken = null;
      try {
        // A linked provider reservation is irreversible. Reconcile its durable
        // state without claiming or calling the provider again.
        if (scheduled.delivery_attempt_id) {
          const reconciled = await reconcileDelivery(db, scheduled.id);
          if (reconciliationWasSent(reconciled)) {
            processed.push({
              id: scheduled.id,
              message_id: reconciled.message_id || null,
              recovered: true,
            });
          } else if (!reconciliationIsInFlight(reconciled)) {
            errors.push({
              id: scheduled.id,
              error: reconciled?.error || 'Reserved provider outcome requires review',
            });
          }
          continue;
        }

        // ── Atomic token-fenced claim — exactly one current worker wins ──
        claimToken = crypto.randomUUID();
        const claimed = await db.rpc('claim_scheduled_message_v2', {
          p_id: scheduled.id,
          p_claim_token: claimToken,
        });
        if (claimed !== true) continue; // another worker took it, or it is no longer pending

        // Load conversation
        const [conversation] = await db.select('conversations', `id=eq.${scheduled.conversation_id}`);
        if (!conversation) {
          await failClaim(db, scheduled.id, claimToken, 'Conversation not found');
          errors.push({ id: scheduled.id, error: 'Conversation not found' });
          continue;
        }

        // Scheduled traffic is intentionally one-customer-only. The legacy path
        // silently picked participants[0], which made a group send ambiguous.
        const participantRows = await db.select(
          'conversation_participants',
          `conversation_id=eq.${scheduled.conversation_id}` +
            '&is_active=eq.true&removed_at=is.null&contact_id=not.is.null' +
            '&phone=not.is.null' +
            '&select=contact_id,phone'
        );
        const participants = participantRows.filter(
          (participant) => typeof participant.phone === 'string'
            && participant.phone.trim().length > 0,
        );
        if (participants.length !== 1) {
          const reason = participants.length === 0
            ? 'No active customer participant'
            : 'Scheduled messages require exactly one active customer participant';
          await failClaim(db, scheduled.id, claimToken, reason);
          errors.push({ id: scheduled.id, error: reason });
          continue;
        }

        // ── Compliance checks ──
        const primaryParticipant = participants[0];
        const [contact] = await db.select('contacts', `id=eq.${primaryParticipant.contact_id}`);

        // Fail CLOSED if the contact can't be resolved — never send unguarded
        // (mirrors send-message.js's CONTACT_NOT_FOUND guard; a missing contact
        // means the DND/opt-in checks below can't run, so we refuse the send).
        if (!contact) {
          await failClaim(
            db,
            scheduled.id,
            claimToken,
            'Blocked: could not resolve contact for compliance check',
          );
          errors.push({ id: scheduled.id, error: 'Contact not found' });
          continue;
        }

        // Participant removal, account deactivation, a Messages override, or a
        // force-disable all take effect at dequeue. The reservation RPC repeats
        // both predicates atomically at the final pre-provider boundary.
        if (!scheduled.created_by) {
          await failClaim(db, scheduled.id, claimToken, 'Creator identity is missing');
          errors.push({ id: scheduled.id, error: 'Creator identity is missing' });
          continue;
        }
        const [creatorHasCapability, creatorCanAccess] = await Promise.all([
          db.rpc('messaging_employee_has_conversations_capability', {
            p_employee_id: scheduled.created_by,
          }),
          db.rpc('messaging_employee_can_access_conversation', {
            p_employee_id: scheduled.created_by,
            p_conversation_id: scheduled.conversation_id,
          }),
        ]);
        if (creatorHasCapability !== true || creatorCanAccess !== true) {
          await failClaim(
            db,
            scheduled.id,
            claimToken,
            'Creator no longer has access to this conversation',
          );
          errors.push({
            id: scheduled.id,
            error: 'Creator no longer has access to this conversation',
          });
          continue;
        }

        const rawConsentStatus = await db.rpc('get_service_sms_consent_status', {
          p_contact_id: contact.id,
          p_destination_phone: primaryParticipant.phone,
        });
        const consentStatus = Array.isArray(rawConsentStatus)
          ? rawConsentStatus[0]
          : rawConsentStatus;

        if (consentStatus?.code === 'DND_ACTIVE') {
          await failClaim(db, scheduled.id, claimToken, 'Blocked: contact has DND enabled');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: primaryParticipant.phone,
            event_type: 'send_blocked_dnd',
            source: 'system',
            details: `Scheduled message ${scheduled.id} blocked: DND active.`,
            performed_by: scheduled.created_by,
          });
          errors.push({ id: scheduled.id, error: 'DND active' });
          continue;
        }

        // Scheduled traffic consumes GLOBAL_OPT_IN only. Purpose-scoped
        // SERVICE_CONSENT and IMPLIED_CONSENT are staff P2P-only.
        if (!isAcceptedConsent(consentStatus, SCHEDULED_ACCEPTED_CONSENT_CODES)) {
          await failClaim(db, scheduled.id, claimToken, 'Blocked: no consent for this contact');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: primaryParticipant.phone,
            event_type: 'send_blocked_no_consent',
            source: 'system',
            details: `Scheduled message ${scheduled.id} blocked: ${consentStatus?.code || 'consent status unavailable'}.`,
            performed_by: scheduled.created_by,
          });
          errors.push({ id: scheduled.id, error: 'No consent for this contact' });
          continue;
        }

        // ── Build & send ──
        let senderPrefix = '';
        const [employee] = await db.select('employees', `id=eq.${scheduled.created_by}`);
        if (employee?.full_name) senderPrefix = `${employee.full_name}: `;

        const clientBody = senderPrefix + scheduled.body.trim();

        const mediaUrls = parseMediaUrls(scheduled.media_urls);
        const reserveDelivery = async () => {
          const reservation = firstRow(await db.rpc(
            'reserve_scheduled_message_delivery',
            {
              p_id: scheduled.id,
              p_claim_token: claimToken,
              p_recipient_contact_id: contact.id,
              p_recipient_address: primaryParticipant.phone,
              p_submitted_body: clientBody,
              p_canonical_body: scheduled.body.trim(),
              p_media_urls: mediaUrls,
            },
          ));
          const expectedDenials = new Set([
            'sms_disabled',
            'dnd',
            'no_consent',
            'quiet_hours',
          ]);
          if (
            expectedDenials.has(reservation?.outcome)
            && !reservation?.attempt_id
          ) {
            return {
              shouldSubmit: false,
              attemptId: null,
              reason: reservation.outcome,
            };
          }
          if (!reservation?.attempt_id) {
            throw new Error('Scheduled delivery reservation was refused');
          }
          return {
            shouldSubmit: reservation.outcome === 'reserved',
            attemptId: reservation.attempt_id,
            reason: reservation.outcome === 'reserved'
              ? null
              : 'delivery_reserved',
          };
        };
        // Do not freeze the batch-start timestamp here. The central send gate
        // samples this clock after its async kill-switch/consent reads and
        // immediately before the database reservation/provider boundary.
        const gatedResult = await sendAutomatedMessage('sms', contact.id, null, {}, env, {
          body: clientBody,
          clock,
          destinationPhone: primaryParticipant.phone,
          mediaUrls,
          conversationId: scheduled.conversation_id,
          sentBy: scheduled.created_by,
          recordBody: scheduled.body.trim(),
          markWaitingOnClient: true,
          reserveDelivery,
          maxProviderAttempts: 1,
        });

        if (
          gatedResult?.skipped
          && ['sms_disabled', 'quiet_hours'].includes(gatedResult.reason)
        ) {
          await releaseClaim(
            db,
            scheduled.id,
            claimToken,
            `Deferred: ${gatedResult.reason}`,
          );
          continue;
        }

        if (gatedResult?.deliveryAttemptId) {
          const reconciled = await reconcileDelivery(db, scheduled.id);
          if (reconciliationWasSent(reconciled)) {
            processed.push({
              id: scheduled.id,
              message_id: reconciled.message_id || gatedResult.messageId || null,
            });
          } else if (!reconciliationIsInFlight(reconciled)) {
            errors.push({
              id: scheduled.id,
              error: reconciled?.error
                || gatedResult.error
                || 'Reserved provider outcome requires review',
            });
          }
          continue;
        }

        const reason = gatedResult?.reason
          || gatedResult?.error
          || 'Scheduled delivery was not reserved';
        await failClaim(db, scheduled.id, claimToken, `Blocked: ${reason}`);
        errors.push({ id: scheduled.id, error: reason });

      } catch (err) {
        if (isMissingDeliverySchema(err)) {
          // The source deploy intentionally may precede the serialized database
          // window. Keep the queue pending and return a healthy deferral; never
          // fall back to the legacy claim/send path. If a partial schema-cache
          // refresh failed after a claim, make one provider-free release attempt.
          if (
            claimToken
            && !String(err?.message || '').includes('claim_scheduled_message_v2')
          ) {
            try {
              await releaseClaim(
                db,
                scheduled.id,
                claimToken,
                'Deferred: delivery_schema_pending',
              );
            } catch { /* the token lease expires without any provider attempt */ }
          }
          schemaPending = true;
          break;
        }
        console.error(`Error processing scheduled ${scheduled.id}:`, err);
        // If a reservation was linked before an unexpected error, reconcile its
        // ledger state and never submit again. Without a reservation, only the
        // current fencing token may fail the row.
        let reconciled = null;
        try {
          reconciled = await reconcileDelivery(db, scheduled.id);
        } catch { /* fall through to token-bound failure */ }
        if (reconciliationWasSent(reconciled)) {
          processed.push({
            id: scheduled.id,
            message_id: reconciled.message_id || null,
            recovered: true,
          });
          continue;
        }
        if (reconciliationIsInFlight(reconciled)) {
          continue;
        }
        if (claimToken) {
          await failClaim(db, scheduled.id, claimToken, err.message);
        }
        errors.push({ id: scheduled.id, error: err.message });
      }
    }

  } catch (err) {
    console.error('process-scheduled error:', err);
    await recordRun(db, { status: 'error', processed: processed.length, errorMessage: err.message, startedAt });
    return { success: false, error: err.message };
  }

  if (schemaPending) {
    await recordRun(db, {
      status: 'completed',
      processed: processed.length,
      startedAt,
    });
    return {
      success: true,
      processed: processed.length,
      failed: errors.length,
      deferred: true,
      reason: 'delivery_schema_pending',
    };
  }

  await recordRun(db, { status: errors.length && !processed.length ? 'error' : 'completed', processed: processed.length, startedAt });
  return {
    success: true,
    processed: processed.length,
    failed: errors.length,
    details: { processed, errors },
  };
}

// ─── SECTION: HTTP + cron wrappers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  return runAuthenticated(context);
}

export async function onRequestPost(context) {
  return runAuthenticated(context);
}

// Cloudflare invokes this directly for a scheduled Cron Trigger — no HTTP, no
// auth check needed (it never reaches the public request path).
export async function scheduled(event, env) {
  const db = supabase(env, fetchWithTimeout);
  const result = await processQueue(db, env);
  console.log('process-scheduled cron:', JSON.stringify(result));
}

async function runAuthenticated(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeRequest(request, env, db, fetchWithTimeout);
  if (!auth.authorized) {
    return jsonResponse(
      { error: auth.error || 'Unauthorized' },
      auth.status || 401,
      request,
      env,
    );
  }
  const result = await processQueue(db, env);
  return jsonResponse(result, result.success === false ? 500 : 200, request, env);
}
