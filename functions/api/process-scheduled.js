/**
 * ════════════════════════════════════════════════
 * FILE: process-scheduled.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends the texts that staff scheduled for later. It runs on a timer (via the
 *   server-side scheduler), looks for scheduled messages whose send time has
 *   arrived, checks the recipient still consents, sends each one through Twilio,
 *   and records the result. Phase A hardened it:
 *     1. The public trigger endpoint now requires the scheduler secret (or a
 *        logged-in employee) — it used to be open to anyone.
 *     2. Two copies of the job running at once can no longer both grab the same
 *        text and send it twice — each message is claimed atomically in the
 *        database; only one worker wins.
 *     3. Outside legal texting hours (before 8am / after 9pm) it holds the whole
 *        batch and tries again later, instead of texting people overnight.
 *     4. Every run writes a worker_runs row so we can see it ran.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: GET/POST /api/process-scheduled  (authenticated — scheduler secret
 *             or a logged-in employee for a manual trigger)
 *             Also exports scheduled() for a Cloudflare Cron Trigger (no HTTP).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/twilio.js (sendMessage),
 *              ../lib/cors.js, ../lib/automated-send.js (isWithinQuietHours,
 *              DEFAULT_SMS_TIMEZONE), ../lib/google-drive.js (getActorEmployee)
 *   Data:      reads  → scheduled_messages, conversations,
 *                       conversation_participants, contacts, employees,
 *                       integration_config
 *              writes → scheduled_messages (claimed_at via RPC, terminal status),
 *                       messages, conversations, sms_consent_log, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - The claim is F-core's claim_scheduled_message(p_id): an atomic compare-and-set
 *     on scheduled_messages.claimed_at. The old worker wrote status='processing',
 *     which the scheduled_messages status CHECK (pending|sent|cancelled|failed)
 *     does not even allow — that write is RETIRED. The row moves straight from
 *     'pending' to a terminal 'sent'/'failed'.
 *   - At-least-once: a claim guarantees exactly-one-winner per claim window, not
 *     exactly-once end-to-end. We write the terminal status IMMEDIATELY after the
 *     Twilio send (before the non-critical conversation bookkeeping) to keep the
 *     crash-and-re-claim window as small as possible.
 *   - Quiet-hours uses the business-default timezone (America/Denver). Per-recipient
 *     timezone is Phase D; here the whole due batch defers together outside the
 *     window, which is the correct TCPA-safe default.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { sendMessage } from '../lib/twilio.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { isWithinQuietHours, DEFAULT_SMS_TIMEZONE } from '../lib/automated-send.js';
import { getActorEmployee } from '../lib/google-drive.js';

const WORKER_NAME = 'process-scheduled';
const BATCH_LIMIT = 20;

// ─── SECTION: Auth ──────────────
// A server-side scheduler (Supabase pg_cron + pg_net) authenticates with this
// header instead of a user session — same shape as run-automations. Needed
// because Cloudflare PAGES projects expose no Cron Trigger UI.
export async function checkCronSecret(request, db) {
  const provided = request.headers.get('x-webhook-secret');
  if (!provided) return false;
  try {
    const [row] = await db.select('integration_config', 'key=eq.cron_worker_secret&select=value&limit=1');
    return !!row?.value && row.value === provided;
  } catch {
    return false;
  }
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

        if (contact?.dnd) {
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

        if (contact && !contact.opt_in_status) {
          await markFailed(db, scheduled.id, 'Blocked: contact not opted in');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
            event_type: 'send_blocked_no_consent',
            source: 'system',
            details: `Scheduled message ${scheduled.id} blocked: no opt-in consent.`,
            performed_by: scheduled.created_by,
          });
          errors.push({ id: scheduled.id, error: 'No opt-in consent' });
          continue;
        }

        // ── Build & send ──
        let senderPrefix = '';
        if (scheduled.created_by) {
          const [employee] = await db.select('employees', `id=eq.${scheduled.created_by}`);
          if (employee?.full_name) senderPrefix = `${employee.full_name}: `;
        }

        const clientBody = senderPrefix + scheduled.body.trim();

        const baseUrl = env.PAGES_URL || env.APP_URL || 'https://dev.utahpros.app';
        const statusCallback = `${baseUrl}/api/twilio-status`;

        const twilioResult = await sendMessage(env, {
          to: participants[0].phone,
          body: clientBody,
          mediaUrls: scheduled.media_urls ? JSON.parse(scheduled.media_urls) : undefined,
          statusCallback,
        });

        // Insert the actual message record (statusCallback → twilio-status will
        // carry it to delivered/failed + capture segments/price).
        const [message] = await db.insert('messages', {
          conversation_id: scheduled.conversation_id,
          type: 'sms_outbound',
          channel: 'sms',
          body: scheduled.body.trim(),
          status: twilioResult.sid ? 'queued' : 'failed',
          twilio_sid: twilioResult.sid || null,
          sent_by: scheduled.created_by,
          media_urls: scheduled.media_urls,
          error_message: twilioResult.error || null,
        });

        // Terminal status FIRST (closes the crash/re-claim double-send window),
        // then the non-critical conversation bookkeeping.
        await db.update('scheduled_messages', `id=eq.${scheduled.id}`, {
          status: 'sent',
          sent_message_id: message.id,
        });

        await db.update('conversations', `id=eq.${scheduled.conversation_id}`, {
          last_message_at: new Date().toISOString(),
          last_message_preview: scheduled.body.trim().substring(0, 100),
          status: 'waiting_on_client',
          status_changed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        processed.push({ id: scheduled.id, message_id: message.id });

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
  // Either a logged-in employee (manual trigger) or the scheduler secret.
  const employee = await getActorEmployee(request, env, db);
  const authorized = employee || await checkCronSecret(request, db);
  if (!authorized) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  const result = await processQueue(db, env);
  return jsonResponse(result, result.success === false ? 500 : 200, request, env);
}
