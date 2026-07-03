/**
 * ════════════════════════════════════════════════
 * FILE: process-sequences.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the drip / nurture sequences on a schedule. Every few minutes it looks
 *   at everyone currently enrolled in an active sequence whose next message is
 *   due, and for each one it: (1) checks whether they've already written back or
 *   booked — if so it quietly stops dripping them; (2) otherwise sends the next
 *   step (an email now, or a text once the company's SMS switch is turned on)
 *   through the one consent-checked send door; then (3) schedules the following
 *   step, or marks them finished. A text step is never sent while the SMS switch
 *   is OFF — it is simply held and retried later, never forced through. Every
 *   run writes one audit row so you can see it ran.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: GET/POST /api/process-sequences   (authenticated — manual trigger)
 *             Also exports scheduled() for Cloudflare's Cron Trigger
 *             (dashboard-configured, no wrangler.toml — per CLAUDE.md).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/cors.js, ../lib/automated-send.js
 *              (sendAutomatedMessage — the ONLY send path), ../lib/google-drive.js
 *              (getActorEmployee, for the manual-trigger auth check)
 *   Data:      reads  → crm_sequences, crm_sequence_steps,
 *                       crm_sequence_enrollments, messages (reply signal),
 *                       system_events (conversion signal), message_templates,
 *                       crm_orgs
 *              writes → crm_sequence_enrollments (advance / hold / exit / complete),
 *                       system_events (one row per step outcome + exits),
 *                       worker_runs (one row per run); sms sends also write
 *                       sms_consent_log inside automated-send.js
 *
 * NOTES / GOTCHAS:
 *   - Every send routes through sendAutomatedMessage(); this file NEVER calls
 *     twilio.js / send-message.js / sendEmail directly and NEVER passes
 *     skip_compliance (crm-wave-ownership.md frozen-file rule + TCPA). An SMS
 *     step returns { skipped, reason:'sms_disabled' } while the global
 *     kill-switch (automation_settings.sms_sending_enabled, default OFF) is off;
 *     we HOLD it (don't advance, retry in HOLD_RETRY_HOURS) so it sends once
 *     Phase 4b flips the switch after A2P 10DLC approval — it is never bypassed.
 *   - A durable consent skip (dnd / suppressed / no address) is terminal for
 *     that step: we advance past it (don't keep pestering) and record the reason
 *     to system_events; the consent gate itself also records to sms_consent_log.
 *   - Timing: delay_hours → next_run_at is a fixed-hour epoch offset (UTC), which
 *     is timezone-invariant — a "48h later" step lands 48h later regardless of a
 *     DST change — so date-mt.js (a day-boundary/MT-calendar helper) does NOT
 *     apply here, same reasoning run-automations.js documents for its windows.
 *   - Exit signals: a reply is an inbound SMS in `messages` since enrollment; a
 *     conversion is one of CONVERSION_EVENT_TYPES in `system_events` for the
 *     contact since enrollment. Each is honored only when the sequence opts in
 *     (exit_on_reply / exit_on_conversion, both default true).
 *   - Personalization: {{name}} in a step body/subject is rendered by the frozen
 *     gate's renderTemplate() from the `variables` we pass — the worker threads
 *     the contact's name (embedded on the due-enrollment read) through so a
 *     "Hi {{name}}" step isn't blank.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { sendAutomatedMessage, renderTemplate } from '../lib/automated-send.js';
import { getActorEmployee } from '../lib/google-drive.js';

export const WORKER_NAME = 'process-sequences';

// A held SMS step (kill-switch OFF) is retried this many hours out so it doesn't
// hot-loop every cron tick while still resending promptly once the switch flips.
export const HOLD_RETRY_HOURS = 6;

// The system_events types that mean "the human converted" (checked against the
// contact_id in the event payload). A reply, by contrast, is read straight from
// the `messages` table (an inbound SMS) — it has no system_events row — so there
// is no reply-event constant to mirror this one.
export const CONVERSION_EVENT_TYPES = ['crm_lead_promoted'];

const CANDIDATE_LIMIT = 500;

// ─── SECTION: Pure helpers (unit tested) ──────────────

// Fixed-hour offset from a base instant. Timezone-invariant on purpose: a
// delay is "N hours after the previous step", not "N calendar days in MT".
export function computeNextRunAt(base, delayHours) {
  const baseMs = base instanceof Date ? base.getTime() : new Date(base).getTime();
  const h = Number(delayHours);
  const safe = Number.isFinite(h) ? h : 0;
  return new Date(baseMs + safe * 3600000).toISOString();
}

// The first send time for a fresh enrollment: enrolled_at + the earliest step's
// delay. Null when the sequence has no steps (nothing to schedule).
export function firstRunAt(enrolledAt, steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const first = [...steps].sort((a, b) => a.step_order - b.step_order)[0];
  return computeNextRunAt(enrolledAt, first.delay_hours);
}

// Post-send transition: move to the next step (scheduled by ITS delay), or
// complete the enrollment when the final step has been sent. current_step is a
// position into the ordered step list.
export function advanceEnrollment(enrollment, steps, now) {
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const nextIndex = (enrollment.current_step ?? 0) + 1;
  if (nextIndex >= ordered.length) {
    return { current_step: nextIndex, status: 'completed', next_run_at: null, completed_at: new Date(now).toISOString() };
  }
  return {
    current_step: nextIndex,
    status: 'active',
    next_run_at: computeNextRunAt(now, ordered[nextIndex].delay_hours),
    completed_at: null,
  };
}

// Which exit (if any) fires, honoring the sequence's opt-in toggles. Reply is
// checked first so it wins when both are present.
export function evaluateExit(sequence, { hasReply, hasConversion } = {}) {
  if (sequence?.exit_on_reply && hasReply) return 'reply';
  if (sequence?.exit_on_conversion && hasConversion) return 'conversion';
  return null;
}

// Decide what to do after a send attempt returns. Pure — the caller applies the
// patch and writes the event. `action` ∈ sent | held | skipped | retry.
export function planStepOutcome(enrollment, steps, sendResult, now, opts = {}) {
  const holdRetryHours = opts.holdRetryHours ?? HOLD_RETRY_HOURS;

  if (sendResult?.ok) {
    return {
      action: 'sent',
      patch: advanceEnrollment(enrollment, steps, now),
      event: { event_type: 'crm_sequence_step_sent', reason: null },
    };
  }

  if (sendResult?.skipped) {
    // Hold-and-retry (do NOT advance): the SMS kill-switch is OFF, or we're inside
    // TCPA quiet-hours (8am–9pm recipient-local). Either way the text is still
    // owed — retry later so it goes out once the switch flips / the window opens.
    // Never bypassed, never dropped.
    if (sendResult.reason === 'sms_disabled' || sendResult.reason === 'quiet_hours') {
      return {
        action: 'held',
        patch: { next_run_at: computeNextRunAt(now, holdRetryHours) },
        event: { event_type: 'crm_sequence_step_held', reason: sendResult.reason },
      };
    }
    // A durable consent skip (dnd / suppressed / no address / no consent) — this
    // channel can't reach them; advance past the step rather than pester.
    return {
      action: 'skipped',
      patch: advanceEnrollment(enrollment, steps, now),
      event: { event_type: 'crm_sequence_step_skipped', reason: sendResult.reason || 'skipped' },
    };
  }

  // Transient failure — leave the enrollment untouched so the next run retries.
  return { action: 'retry', patch: null, event: null };
}

// ─── SECTION: Data helpers ──────────────
async function resolveOrgId(db) {
  const rows = await db.select('crm_orgs', 'is_test=eq.false&select=id&order=created_at.asc&limit=1');
  return rows[0]?.id || null;
}

// Fill a step's body from its linked template when the step carries no inline
// body (template_id is an optional copy source; inline subject/body win).
async function resolveStepBodies(db, steps) {
  const needing = steps.filter((s) => s.template_id && !s.body);
  if (needing.length === 0) return steps;
  const ids = [...new Set(needing.map((s) => s.template_id))];
  let map = {};
  try {
    const tpls = await db.select('message_templates', `id=in.(${ids.join(',')})&select=id,body`);
    map = Object.fromEntries(tpls.map((t) => [t.id, t.body]));
  } catch { /* fall back to whatever inline body exists */ }
  return steps.map((s) => (s.template_id && !s.body ? { ...s, body: map[s.template_id] || s.body } : s));
}

// Has the human engaged since they were enrolled? Reply = an inbound SMS;
// conversion = a crm_lead_promoted event tied to this contact. Errors resolve to
// "no signal" so a transient read never wrongly exits (or blocks) a send.
async function gatherExitSignals(db, enrollment) {
  const since = enrollment.enrolled_at;
  let hasReply = false;
  let hasConversion = false;
  try {
    const replies = await db.select(
      'messages',
      `sender_contact_id=eq.${enrollment.contact_id}&type=eq.sms_inbound&created_at=gt.${since}&select=id&limit=1`
    );
    hasReply = replies.length > 0;
  } catch { /* no signal */ }
  try {
    const conv = await db.select(
      'system_events',
      `event_type=in.(${CONVERSION_EVENT_TYPES.join(',')})&payload->>contact_id=eq.${enrollment.contact_id}` +
      `&created_at=gt.${since}&select=id&limit=1`
    );
    hasConversion = conv.length > 0;
  } catch { /* no signal */ }
  return { hasReply, hasConversion };
}

async function writeEvent(db, eventType, enrollment, extra = {}) {
  try {
    await db.insert('system_events', {
      event_type: eventType,
      entity_type: 'crm_sequence_enrollment',
      entity_id: enrollment.id,
      payload: { sequence_id: enrollment.sequence_id, contact_id: enrollment.contact_id, ...extra },
    });
  } catch { /* audit is best-effort — the enrollment patch already carries state */ }
}

// ─── SECTION: Per-enrollment handler ──────────────
// Returns the action taken: exited | completed | sent | held | skipped | retry.
export async function processEnrollment(ctx, enrollment) {
  const { db, send, now } = ctx;
  const seq = ctx.sequences[enrollment.sequence_id];
  const steps = ctx.steps[enrollment.sequence_id] || [];
  const nowIso = new Date(now).toISOString();

  // 1. Exit on reply / conversion before spending a send.
  const exitReason = evaluateExit(seq, await gatherExitSignals(db, enrollment));
  if (exitReason) {
    await db.update('crm_sequence_enrollments', `id=eq.${enrollment.id}`, {
      status: 'exited', exit_reason: exitReason, next_run_at: null,
      completed_at: nowIso, updated_at: nowIso,
    });
    await writeEvent(db, 'crm_sequence_exited', enrollment, { reason: exitReason });
    return 'exited';
  }

  // 2. Nothing left to send → complete.
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const step = ordered[enrollment.current_step];
  if (!step) {
    await db.update('crm_sequence_enrollments', `id=eq.${enrollment.id}`, {
      status: 'completed', next_run_at: null, completed_at: nowIso, updated_at: nowIso,
    });
    return 'completed';
  }

  // 3. Send through the one consent-gated door. SMS is held by the gate while the
  //    kill-switch is OFF; email is live. {{name}} tokens render from `variables`.
  const name = enrollment.contacts?.name || '';
  const variables = { name, first_name: name.split(' ')[0] || '' };
  // The gate renders the body from `variables`; the subject it does not, so we
  // pre-render it here for token parity.
  const extra = step.channel === 'sms'
    ? { orgId: seq.org_id, body: step.body || '', now }
    : { subject: renderTemplate(step.subject || '', variables), html: step.body || '' };
  const result = await send(step.channel, enrollment.contact_id, null, variables, extra);

  // 4. Apply the outcome plan.
  const plan = planStepOutcome(enrollment, ordered, result, now, { holdRetryHours: HOLD_RETRY_HOURS });
  if (plan.patch) {
    await db.update('crm_sequence_enrollments', `id=eq.${enrollment.id}`, { ...plan.patch, updated_at: nowIso });
  }
  if (plan.event) {
    await writeEvent(db, plan.event.event_type, enrollment, {
      step_order: step.step_order, channel: step.channel, reason: plan.event.reason,
    });
  }
  return plan.action;
}

// ─── SECTION: Orchestrator ──────────────
export async function processSequences(db, env, now = new Date()) {
  const startedAt = new Date(now).toISOString();
  const send = (channel, contactId, templateKey, variables, extra) =>
    sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra);

  let processed = 0;
  try {
    const orgId = await resolveOrgId(db);
    const sequencesList = orgId
      ? await db.select('crm_sequences', `org_id=eq.${orgId}&status=eq.active&select=*`)
      : [];

    if (sequencesList.length === 0) {
      await db.insert('worker_runs', {
        worker_name: WORKER_NAME, status: 'completed', records_processed: 0,
        started_at: startedAt, completed_at: new Date().toISOString(),
      });
      return { ok: true, counts: {}, processed: 0, orgId };
    }

    const sequences = {};
    const steps = {};
    for (const s of sequencesList) sequences[s.id] = s;
    for (const s of sequencesList) {
      const st = await db.select('crm_sequence_steps', `sequence_id=eq.${s.id}&select=*&order=step_order.asc`);
      steps[s.id] = await resolveStepBodies(db, st);
    }

    const seqIds = sequencesList.map((s) => s.id);
    const due = await db.select(
      'crm_sequence_enrollments',
      `status=eq.active&sequence_id=in.(${seqIds.join(',')})&next_run_at=lte.${startedAt}` +
      `&select=*,contacts(name)&order=next_run_at.asc&limit=${CANDIDATE_LIMIT}`
    );

    const ctx = { db, env, now, send, sequences, steps };
    const counts = { sent: 0, held: 0, skipped: 0, exited: 0, completed: 0, retry: 0 };
    for (const enr of due) {
      if (!sequences[enr.sequence_id]) continue;
      const action = await processEnrollment(ctx, enr);
      counts[action] = (counts[action] || 0) + 1;
    }

    // A retry is not "processed work" — it will be tried again next run.
    processed = counts.sent + counts.held + counts.skipped + counts.exited + counts.completed;
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'completed', records_processed: processed,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: true, counts, processed, orgId };
  } catch (e) {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'error', records_processed: processed,
      error_message: String(e.message || e).slice(0, 500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: false, error: e.message };
  }
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

// Cloudflare invokes this directly for the scheduled Cron Trigger — no HTTP,
// no auth check needed (it never reaches the public request path).
export async function scheduled(event, env) {
  const db = supabase(env);
  const result = await processSequences(db, env);
  console.log('process-sequences cron:', JSON.stringify(result));
}

async function runAuthenticated(context) {
  const { request, env } = context;
  const db = supabase(env);
  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  const result = await processSequences(db, env);
  return jsonResponse(result, result.ok ? 200 : 500, request, env);
}
