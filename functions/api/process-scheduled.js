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
 *     1. The public trigger endpoint now requires the scheduler secret (or a
 *        logged-in employee) — it used to be open to anyone.
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
 *             or an active internal admin/office/project manager)
 *             Also exports scheduled() for a Cloudflare Cron Trigger (no HTTP).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/cors.js,
 *              ../lib/automated-send.js (sendAutomatedMessage,
 *              isWithinQuietHours, DEFAULT_SMS_TIMEZONE),
 *              ../lib/auth.js (checkCronSecret, requireRole)
 *   Data:      reads  → scheduled_messages, conversations,
 *                       conversation_participants, contacts, employees,
 *                       integration_config
 *              writes → scheduled_messages (claimed_at via RPC, terminal status),
 *                       messages, conversations, sms_consent_log, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - The HTTP trigger accepts the scheduler secret or an active, non-external
 *     admin/office/project manager. A valid session alone cannot trigger company
 *     messaging.
 *   - The claim is F-core's claim_scheduled_message(p_id): an atomic compare-and-set
 *     on scheduled_messages.claimed_at. The old worker wrote status='processing',
 *     which the scheduled_messages status CHECK (pending|sent|cancelled|failed)
 *     does not even allow — that write is RETIRED. The row moves straight from
 *     'pending' to a terminal 'sent'/'failed'.
 *   - At-least-once: a claim guarantees exactly-one-winner per claim window, not
 *     exactly-once end-to-end. We write the terminal status IMMEDIATELY after the
 *     provider send (before any later non-critical bookkeeping) to keep the
 *     crash-and-re-claim window as small as possible.
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
import { checkCronSecret, requireRole } from '../lib/auth.js';
import { SCHEDULED_ACCEPTED_CONSENT_CODES, isAcceptedConsent } from '../lib/sms-consent.js';

const WORKER_NAME = 'process-scheduled';
const BATCH_LIMIT = 20;
const MANUAL_TRIGGER_ROLES = ['admin', 'office', 'project_manager'];

// ─── SECTION: Auth ──────────────
export { checkCronSecret };

export async function authorizeRequest(request, env, db) {
  if (await checkCronSecret(request, db)) {
    return { authorized: true, actor: 'scheduler' };
  }

  const auth = await requireRole(request, env, db, MANUAL_TRIGGER_ROLES);
  if (auth.error) {
    return {
      authorized: false,
      error: auth.error,
      status: auth.status || 403,
    };
  }
  if (auth.employee?.is_external) {
    return {
      authorized: false,
      error: 'External employees cannot trigger scheduled messaging',
      status: 403,
    };
  }
  return { authorized: true, actor: auth.employee };
}

// ─── SECTION: worker_runs ──────────────
async function recordRun(db, { status, processed, errorMessage, startedAt }) {
  try {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME,
      status,
      records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch { /* telemetry is best-effort */ }
}

async function releaseClaim(db, scheduledId, reason) {
  await db.update('scheduled_messages', `id=eq.${scheduledId}`, {
    claimed_at: null,
    error_message: reason ? String(reason).slice(0, 500) : null,
  });
}

function parseMediaUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

// ─── SECTION: Queue processing ──────────────
export async function processQueue(db, env, { now = new Date() } = {}) {
  const startedAt = new Date().toISOString();
  const nowIso = now.toISOString();
  const processed = [];
  const errors = [];

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
      try {
        // ── Atomic claim (F-core RPC) — exactly one worker wins a pending row ──
        const claimed = await db.rpc('claim_scheduled_message', { p_id: scheduled.id });
        if (claimed !== true) continue; // another worker took it, or it is no longer pending

        // Load conversation
        const [conversation] = await db.select('conversations', `id=eq.${scheduled.conversation_id}`);
        if (!conversation) {
          await markFailed(db, scheduled.id, 'Conversation not found');
          errors.push({ id: scheduled.id, error: 'Conversation not found' });
          continue;
        }

        // Load participants
        const participants = await db.select(
          'conversation_participants',
          `conversation_id=eq.${scheduled.conversation_id}&is_active=eq.true`
        );
        if (participants.length === 0) {
          await markFailed(db, scheduled.id, 'No active participants');
          errors.push({ id: scheduled.id, error: 'No active participants' });
          continue;
        }

        // ── Compliance checks ──
        const primaryParticipant = participants[0];
        const [contact] = await db.select('contacts', `id=eq.${primaryParticipant.contact_id}`);

        // Fail CLOSED if the contact can't be resolved — never send unguarded
        // (mirrors send-message.js's CONTACT_NOT_FOUND guard; a missing contact
        // means the DND/opt-in checks below can't run, so we refuse the send).
        if (!contact) {
          await markFailed(db, scheduled.id, 'Blocked: could not resolve contact for compliance check');
          errors.push({ id: scheduled.id, error: 'Contact not found' });
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
          await markFailed(db, scheduled.id, 'Blocked: contact has DND enabled');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
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
          await markFailed(db, scheduled.id, 'Blocked: no consent for this contact');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
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
        if (scheduled.created_by) {
          const [employee] = await db.select('employees', `id=eq.${scheduled.created_by}`);
          if (employee?.full_name) senderPrefix = `${employee.full_name}: `;
        }

        const clientBody = senderPrefix + scheduled.body.trim();

        const mediaUrls = parseMediaUrls(scheduled.media_urls);
        const gatedResult = await sendAutomatedMessage('sms', contact.id, null, {}, env, {
          body: clientBody,
          now,
          destinationPhone: primaryParticipant.phone,
          mediaUrls,
          conversationId: scheduled.conversation_id,
          sentBy: scheduled.created_by,
          recordBody: scheduled.body.trim(),
          markWaitingOnClient: true,
        });

        if (
          gatedResult?.skipped
          && ['sms_disabled', 'quiet_hours'].includes(gatedResult.reason)
        ) {
          await releaseClaim(db, scheduled.id, `Deferred: ${gatedResult.reason}`);
          continue;
        }

        if (!gatedResult?.ok) {
          const reason = gatedResult?.ambiguous
            ? `Ambiguous provider outcome; reconcile before retry: ${gatedResult.error || 'unknown'}`
            : gatedResult?.reason || gatedResult?.error || 'Scheduled send failed';
          await markFailed(db, scheduled.id, `Blocked: ${reason}`);
          errors.push({ id: scheduled.id, error: reason });
          continue;
        }

        // Terminal status FIRST (closes the crash/re-claim double-send window),
        // then the non-critical conversation bookkeeping.
        await db.update('scheduled_messages', `id=eq.${scheduled.id}`, {
          status: 'sent',
          sent_message_id: gatedResult.messageId || null,
          error_message: null,
        });

        processed.push({
          id: scheduled.id,
          message_id: gatedResult.messageId || null,
        });

      } catch (err) {
        console.error(`Error processing scheduled ${scheduled.id}:`, err);
        await markFailed(db, scheduled.id, err.message);
        errors.push({ id: scheduled.id, error: err.message });
      }
    }

  } catch (err) {
    console.error('process-scheduled error:', err);
    await recordRun(db, { status: 'error', processed: processed.length, errorMessage: err.message, startedAt });
    return { success: false, error: err.message };
  }

  await recordRun(db, { status: errors.length && !processed.length ? 'error' : 'completed', processed: processed.length, startedAt });
  return {
    success: true,
    processed: processed.length,
    failed: errors.length,
    details: { processed, errors },
  };
}

async function markFailed(db, scheduledId, errorMessage) {
  await db.update('scheduled_messages', `id=eq.${scheduledId}`, {
    status: 'failed',
    error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
  });
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
  const db = supabase(env);
  const result = await processQueue(db, env);
  console.log('process-scheduled cron:', JSON.stringify(result));
}

async function runAuthenticated(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await authorizeRequest(request, env, db);
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
