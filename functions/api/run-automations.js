/**
 * ════════════════════════════════════════════════
 * FILE: run-automations.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the four "fixed" CRM automations on a schedule. Every few minutes it
 *   looks for four things and, if the owner has turned that automation on,
 *   reaches out to the customer automatically:
 *     1. Speed-to-lead — text a brand-new lead within seconds of their call
 *        or form.
 *     2. Missed-call text-back — text back when a call to a tracking number
 *        goes unanswered.
 *     3. No-response follow-up — email a lead that has gone quiet for a few days.
 *     4. Review request — email a review ask when a job is marked complete.
 *   The two texting automations are built but stay completely dark until the
 *   global SMS switch is turned on (Phase 4b, after carrier approval); the two
 *   email ones are live. Every message goes through the one consent-checked
 *   send door, and every time an automation fires it writes an audit event so
 *   it never contacts the same person twice for the same reason.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: GET/POST /api/run-automations   (authenticated — manual trigger)
 *             Also exports scheduled() for Cloudflare's Cron Trigger
 *             (dashboard-configured, no wrangler.toml — per CLAUDE.md).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/cors.js, ../lib/automated-send.js
 *              (sendAutomatedMessage — the ONLY send path), ../lib/google-drive.js
 *              (getActorEmployee, for the manual-trigger auth check)
 *   Data:      reads  → automation_settings, crm_orgs, inbound_leads,
 *                       job_phase_history, jobs, contacts, system_events
 *              writes → system_events (one row per fired trigger + outcome),
 *                       worker_runs (one row per run); sms sends also write
 *                       sms_consent_log inside automated-send.js
 *
 * NOTES / GOTCHAS:
 *   - The SMS automations are gated TWICE. This worker skips them entirely
 *     unless automation_settings.sms_sending_enabled is ON, so while the
 *     kill-switch is OFF they are truly inert (no queries, no audit rows, no
 *     "burned" leads). Even if that worker-level guard were removed, the send
 *     itself is still refused inside automated-send.js — that is the structural
 *     guarantee; this guard is just so nothing is consumed while dark.
 *   - Every send routes through sendAutomatedMessage(); this file NEVER calls
 *     twilio.js / send-message.js directly and NEVER passes skip_compliance
 *     (crm-wave-ownership.md frozen-file rule + TCPA).
 *   - Idempotency: before acting we check system_events for a prior row of the
 *     same (event_type, entity_id). Only a TERMINAL outcome writes that row so it
 *     never repeats — a `sent`, a durable consent-skip (dnd/no_consent), or a
 *     PERMANENT send failure (invalid number). A DEFERRED skip (quiet_hours, or
 *     the SMS kill-switch being OFF) and a TRANSIENT failure (429/5xx) write NO
 *     row, so the lead stays a candidate and the next run retries it once the
 *     window lifts (F-10). The two SMS automations therefore use a wide overnight
 *     lookback so an after-hours lead is still found at 8am, not lost.
 *   - Message bodies prefer a matching message_templates row (by title) so an
 *     admin can override copy without a deploy; the hardcoded default is the
 *     fallback when no such template exists.
 *   - Times: predicates compare against `now` in UTC epoch millis — coarse
 *     lookback windows, not billing-grade day boundaries, so date-mt.js is not
 *     needed here.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { sendAutomatedMessage } from '../lib/automated-send.js';
import { getActorEmployee } from '../lib/google-drive.js';

const WORKER_NAME = 'run-automations';

// Automation → the system_events trigger type it emits when it fires. These are
// the substrate a future rule engine (Phase 5) would subscribe to.
export const AUTOMATION_EVENT_TYPES = {
  speed_to_lead: 'lead_created',
  missed_call_textback: 'call_missed',
  no_response_followup: 'lead_stale',
  review_request: 'job_completed',
};

// Automation → channel. Two SMS (dark until Phase 4b), two email (live).
export const AUTOMATION_CHANNELS = {
  speed_to_lead: 'sms',
  missed_call_textback: 'sms',
  no_response_followup: 'email',
  review_request: 'email',
};

// Tunables. Lookbacks are generous enough to survive a missed cron tick;
// idempotency (not the window) is what prevents repeats.
//
// The two SMS automations use a WIDE overnight window (F-10): a text due inside
// TCPA quiet-hours (9pm–8am recipient-local) is DEFERRED by the send gate — it
// returns reason 'quiet_hours', which fireAutomation no longer records as
// terminal — so its lead must stay a candidate until the window lifts. The
// continuous quiet block is at most ~11h (a 9:00pm lead waits until 8:00am);
// 13h gives margin for cron cadence + a recipient in a later US zone. Email has
// no quiet-hours defer, so its windows stay tight. Idempotency still prevents any
// repeat inside the wider window.
const OVERNIGHT_DEFER_LOOKBACK_MIN = 13 * 60; // covers the overnight quiet block + margin
const SPEED_TO_LEAD_LOOKBACK_MIN = OVERNIGHT_DEFER_LOOKBACK_MIN; // was 60 — widened for F-10 defer
const MISSED_CALL_LOOKBACK_MIN = OVERNIGHT_DEFER_LOOKBACK_MIN;   // was 60 — widened for F-10 defer
const NO_RESPONSE_STALE_DAYS = 3;   // quiet at least this long
const NO_RESPONSE_MAX_AGE_DAYS = 30; // …but don't chase ancient leads
const REVIEW_LOOKBACK_HOURS = 48;
const OPEN_LEAD_STATUSES = ['new'];  // a lead still worth following up on
const COMPLETED_PHASES = ['completed'];
const CANDIDATE_LIMIT = 200;

// MPS pacing: space out real Twilio sends so a burst of overnight-deferred texts
// firing at 8am stays under the messaging-service rate limit. Only applied
// between actual sends (skips/already-fired never hit Twilio). Injectable + 0 in
// tests via ctx.paceMs / ctx.sleep.
const DEFAULT_SMS_PACE_MS = 250;

const DAY_MS = 86400000;

// ─── SECTION: Trigger predicates (pure — unit tested) ──────────
function withinWindow(ts, now, windowMinutes) {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= windowMinutes * 60000;
}

// Speed-to-lead: a just-arrived inbound lead we can reach — an answered call or
// a form submission (a missed call is isMissedCall's job, not this one).
export function isFreshInboundLead(lead, now, windowMinutes) {
  if (!lead || !lead.contact_id) return false;
  if (lead.spam_flag) return false;
  if (lead.direction && lead.direction !== 'inbound') return false;
  const isForm = lead.source_type === 'form';
  const answeredCall = lead.source_type === 'call' && Number(lead.duration_sec) > 0;
  if (!isForm && !answeredCall) return false;
  return withinWindow(lead.occurred_at || lead.created_at, now, windowMinutes);
}

// Missed-call text-back: a recent inbound call that went unanswered
// (0 / null / non-positive duration).
export function isMissedCall(lead, now, windowMinutes) {
  if (!lead || !lead.contact_id) return false;
  if (lead.spam_flag) return false;
  if (lead.source_type !== 'call') return false;
  if (lead.direction && lead.direction !== 'inbound') return false;
  if (Number(lead.duration_sec) > 0) return false; // answered
  return withinWindow(lead.occurred_at || lead.created_at, now, windowMinutes);
}

// No-response follow-up: an open lead with no activity for a while, but not so
// old it isn't worth chasing.
export function isStale(lead, now, thresholdDays, maxAgeDays) {
  if (!lead || !lead.contact_id) return false;
  if (!OPEN_LEAD_STATUSES.includes(lead.lead_status)) return false;
  const last = new Date(lead.updated_at || lead.occurred_at || lead.created_at).getTime();
  if (!Number.isFinite(last)) return false;
  const age = now.getTime() - last;
  if (age < thresholdDays * DAY_MS) return false;
  if (maxAgeDays != null && age > maxAgeDays * DAY_MS) return false;
  return true;
}

// Review request: a job phase change that lands on a completed phase.
export function isJobCompletion(phaseRow, completedPhases) {
  if (!phaseRow) return false;
  return completedPhases.includes(phaseRow.to_phase);
}

// ─── SECTION: Helpers ──────────────
async function resolveOrgId(db) {
  const rows = await db.select('crm_orgs', 'is_test=eq.false&select=id&order=created_at.asc&limit=1');
  return rows[0]?.id || null;
}

async function contactName(db, contactId) {
  if (!contactId) return '';
  try {
    const [c] = await db.select('contacts', `id=eq.${contactId}&select=name&limit=1`);
    return c?.name || '';
  } catch { return ''; }
}

async function alreadyFired(db, eventType, entityId) {
  const rows = await db.select(
    'system_events',
    `event_type=eq.${eventType}&entity_id=eq.${entityId}&limit=1`
  );
  return rows.length > 0;
}

// MPS pacing between real SMS sends. `ctx.paceMs` (default DEFAULT_SMS_PACE_MS)
// and `ctx.sleep` are injectable so tests run with no delay (paceMs: 0).
async function paceSms(ctx) {
  const ms = ctx.paceMs ?? DEFAULT_SMS_PACE_MS;
  if (!ms) return;
  const sleep = ctx.sleep || ((n) => new Promise((r) => setTimeout(r, n)));
  await sleep(ms);
}

// Skip reasons that mean "not now, try again later" rather than "never" — the
// text is still owed, so we DON'T write a terminal event (F-10). 'quiet_hours'
// lifts at 8am; 'sms_disabled' lifts when Phase 4b flips the kill-switch. Every
// other skip reason (dnd / no_consent / no_phone / suppressed) is durable.
const DEFERRABLE_SKIP_REASONS = new Set(['quiet_hours', 'sms_disabled']);

// The single place an automation acts: consent-gated send + a durable audit
// event. Returns { outcome } where outcome ∈ sent | skipped | failed | already_fired.
async function fireAutomation(ctx, { key, entityType, entityId, jobId, contactId, templateKey, variables, extra }) {
  const { db, send } = ctx;
  const eventType = AUTOMATION_EVENT_TYPES[key];
  const channel = AUTOMATION_CHANNELS[key];

  if (await alreadyFired(db, eventType, entityId)) return { outcome: 'already_fired' };

  const result = await send(channel, contactId, templateKey, variables, extra);
  const outcome = result?.ok ? 'sent' : result?.skipped ? 'skipped' : 'failed';

  // Persist the trigger + outcome only on a TERMINAL result, so the idempotency
  // check can't permanently drop a text that was merely deferred (F-10):
  //   • sent                              → terminal (never repeat).
  //   • skipped, deferrable (quiet_hours) → NOT terminal → retried when it lifts.
  //   • skipped, durable (dnd/no_consent) → terminal (don't pester).
  //   • failed, transient (429 / 5xx)     → NOT terminal → retried next run.
  //   • failed, permanent (invalid number)→ terminal (stop infinite-retrying).
  const isDeferredSkip = outcome === 'skipped' && DEFERRABLE_SKIP_REASONS.has(result?.reason);
  const isTransientFail = outcome === 'failed' && !result?.permanent;
  const terminal = !isDeferredSkip && !isTransientFail;

  if (terminal) {
    await db.insert('system_events', {
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      job_id: jobId || null,
      payload: { automation: key, channel, outcome, reason: result?.reason || null },
    });
  }
  return { outcome, result };
}

// ─── SECTION: Message copy (defaults; message_templates overrides by title) ───
const TXT_OPT_OUT = ' Reply STOP to opt out.';
const speedToLeadBody = (name) =>
  `Hi ${name || 'there'}, thanks for reaching out to Utah Pros Restoration! We got your request and a team member will call you shortly.${TXT_OPT_OUT}`;
const missedCallBody = (name) =>
  `Hi ${name || 'there'}, sorry we missed your call to Utah Pros Restoration. Reply here and we'll get right back to you.${TXT_OPT_OUT}`;
const NO_RESPONSE_SUBJECT = 'Still here to help — Utah Pros Restoration';
const noResponseHtml = (name) =>
  `<p>Hi ${name || 'there'},</p><p>We reached out a little while ago about your restoration project and haven't heard back — no worries at all. If you're still weighing your options, we're happy to answer questions or set up a free assessment whenever it's convenient.</p><p>Just reply to this email and we'll take care of the rest.</p><p>— The team at Utah Pros Restoration</p>`;
const REVIEW_SUBJECT = 'How did we do? — Utah Pros Restoration';
const reviewRequestHtml = (name, env) => {
  const url = env?.GOOGLE_REVIEW_URL || 'https://utahpros.app';
  return `<p>Hi ${name || 'there'},</p><p>Thanks for trusting Utah Pros Restoration with your project — we hope everything turned out great.</p><p>If you have a moment, a quick review means the world to a local business and helps your neighbors find help when they need it:</p><p><a href="${url}">Leave us a review</a></p><p>Thank you!<br/>— The team at Utah Pros Restoration</p>`;
};

// ─── SECTION: The four automations ──────────────
export async function runSpeedToLead(ctx) {
  const { db, now, orgId } = ctx;
  const since = new Date(now.getTime() - SPEED_TO_LEAD_LOOKBACK_MIN * 60000).toISOString();
  const leads = await db.select(
    'inbound_leads',
    `org_id=eq.${orgId}&contact_id=not.is.null&created_at=gte.${since}&select=*&order=created_at.desc&limit=${CANDIDATE_LIMIT}`
  );
  let sent = 0;
  for (const lead of leads) {
    if (!isFreshInboundLead(lead, now, SPEED_TO_LEAD_LOOKBACK_MIN)) continue;
    const name = await contactName(db, lead.contact_id);
    const r = await fireAutomation(ctx, {
      key: 'speed_to_lead', entityType: 'inbound_lead', entityId: lead.id,
      contactId: lead.contact_id, templateKey: 'Speed to Lead',
      variables: { name }, extra: { orgId, body: speedToLeadBody(name) },
    });
    if (r.outcome === 'sent') { sent++; await paceSms(ctx); }
  }
  return sent;
}

export async function runMissedCallTextback(ctx) {
  const { db, now, orgId } = ctx;
  const since = new Date(now.getTime() - MISSED_CALL_LOOKBACK_MIN * 60000).toISOString();
  const leads = await db.select(
    'inbound_leads',
    `org_id=eq.${orgId}&contact_id=not.is.null&source_type=eq.call&created_at=gte.${since}&select=*&order=created_at.desc&limit=${CANDIDATE_LIMIT}`
  );
  let sent = 0;
  for (const lead of leads) {
    if (!isMissedCall(lead, now, MISSED_CALL_LOOKBACK_MIN)) continue;
    const name = await contactName(db, lead.contact_id);
    const r = await fireAutomation(ctx, {
      key: 'missed_call_textback', entityType: 'inbound_lead', entityId: lead.id,
      contactId: lead.contact_id, templateKey: 'Missed Call Text-Back',
      variables: { name }, extra: { orgId, body: missedCallBody(name) },
    });
    if (r.outcome === 'sent') { sent++; await paceSms(ctx); }
  }
  return sent;
}

export async function runNoResponseFollowup(ctx) {
  const { db, now, orgId } = ctx;
  const staleBefore = new Date(now.getTime() - NO_RESPONSE_STALE_DAYS * DAY_MS).toISOString();
  const oldestAllowed = new Date(now.getTime() - NO_RESPONSE_MAX_AGE_DAYS * DAY_MS).toISOString();
  const leads = await db.select(
    'inbound_leads',
    `org_id=eq.${orgId}&contact_id=not.is.null&lead_status=in.(${OPEN_LEAD_STATUSES.join(',')})` +
    `&updated_at=lte.${staleBefore}&updated_at=gte.${oldestAllowed}&select=*&order=updated_at.asc&limit=${CANDIDATE_LIMIT}`
  );
  let sent = 0;
  for (const lead of leads) {
    if (!isStale(lead, now, NO_RESPONSE_STALE_DAYS, NO_RESPONSE_MAX_AGE_DAYS)) continue;
    const name = await contactName(db, lead.contact_id);
    const r = await fireAutomation(ctx, {
      key: 'no_response_followup', entityType: 'inbound_lead', entityId: lead.id,
      contactId: lead.contact_id, templateKey: 'No-Response Follow-Up',
      variables: { name }, extra: { subject: NO_RESPONSE_SUBJECT, html: noResponseHtml(name) },
    });
    if (r.outcome === 'sent') sent++;
  }
  return sent;
}

export async function runReviewRequest(ctx) {
  const { db, env, now } = ctx;
  const since = new Date(now.getTime() - REVIEW_LOOKBACK_HOURS * 3600000).toISOString();
  const rows = await db.select(
    'job_phase_history',
    `to_phase=in.(${COMPLETED_PHASES.join(',')})&changed_at=gte.${since}&select=*&order=changed_at.desc&limit=${CANDIDATE_LIMIT}`
  );
  let sent = 0;
  for (const row of rows) {
    if (!isJobCompletion(row, COMPLETED_PHASES)) continue;
    const [job] = await db.select('jobs', `id=eq.${row.job_id}&select=id,primary_contact_id&limit=1`);
    if (!job?.primary_contact_id) continue;
    const name = await contactName(db, job.primary_contact_id);
    const r = await fireAutomation(ctx, {
      key: 'review_request', entityType: 'job', entityId: job.id, jobId: job.id,
      contactId: job.primary_contact_id, templateKey: 'Review Request',
      variables: { name }, extra: { subject: REVIEW_SUBJECT, html: reviewRequestHtml(name, env) },
    });
    if (r.outcome === 'sent') sent++;
  }
  return sent;
}

// ─── SECTION: Orchestrator ──────────────
export async function runAutomations(db, env, now = new Date()) {
  const startedAt = now.toISOString();
  const send = (channel, contactId, templateKey, variables, extra) =>
    sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra);

  let processed = 0;
  try {
    const orgId = await resolveOrgId(db);
    const paceMs = Number.isFinite(Number(env?.SMS_PACE_MS)) ? Number(env.SMS_PACE_MS) : DEFAULT_SMS_PACE_MS;
    const ctx = { db, env, now, send, orgId, paceMs };

    let settings = null;
    if (orgId) {
      const [s] = await db.select('automation_settings', `org_id=eq.${orgId}&select=*&limit=1`);
      settings = s || null;
    }

    const counts = {};
    // SMS automations only run while the global kill-switch is ON — otherwise
    // they stay fully dark (Phase 4b flips sms_sending_enabled after approval).
    const smsLive = !!settings?.sms_sending_enabled;
    if (settings?.speed_to_lead_enabled && smsLive) counts.speed_to_lead = await runSpeedToLead(ctx);
    if (settings?.missed_call_textback_enabled && smsLive) counts.missed_call_textback = await runMissedCallTextback(ctx);
    // Email automations are live regardless of the SMS switch.
    if (settings?.no_response_followup_enabled) counts.no_response_followup = await runNoResponseFollowup(ctx);
    if (settings?.review_request_enabled) counts.review_request = await runReviewRequest(ctx);

    processed = Object.values(counts).reduce((a, b) => a + b, 0);
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'completed', records_processed: processed,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: true, counts, processed, orgId, smsLive };
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
  const result = await runAutomations(db, env);
  console.log('run-automations cron:', JSON.stringify(result));
}

// A server-side scheduler (Supabase pg_cron + pg_net) authenticates with this
// header instead of a user session — same shape as weekly-crm-digest's
// crm_digest_secret and the CallRail/Encircle webhook secrets. Needed because
// Cloudflare PAGES projects expose no Cron Trigger UI; the schedule lives in
// pg_cron and calls this worker over HTTPS.
async function checkCronSecret(request, db) {
  const provided = request.headers.get('x-webhook-secret');
  if (!provided) return false;
  try {
    const [row] = await db.select('integration_config', 'key=eq.cron_worker_secret&select=value&limit=1');
    return !!row?.value && row.value === provided;
  } catch {
    return false;
  }
}

async function runAuthenticated(context) {
  const { request, env } = context;
  const db = supabase(env);
  // Either a logged-in employee (manual trigger) or the scheduler secret.
  const employee = await getActorEmployee(request, env, db);
  const authorized = employee || await checkCronSecret(request, db);
  if (!authorized) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  const result = await runAutomations(db, env);
  return jsonResponse(result, result.ok ? 200 : 500, request, env);
}
