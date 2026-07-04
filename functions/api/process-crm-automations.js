/**
 * ════════════════════════════════════════════════
 * FILE: process-crm-automations.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the staff-built automation "recipes" on a schedule — the configurable
 *   cousin of the four fixed automations. Every few minutes it does two things:
 *   (1) MATCH — it looks at what just happened in the business (new leads, jobs
 *   changing status, payments, …, recorded on the shared event log) and, for each
 *   enabled recipe whose trigger matches and whose optional "only if…" conditions
 *   all hold, it opens exactly one run for that event (never two — the event log
 *   has no bookmark, so it dedups on a unique key). (2) ADVANCE — for every run
 *   that's due, it does the recipe's next step in order (send an email, send a
 *   text, enroll the person in a drip sequence, or make a task), then schedules
 *   the step after that, or finishes. Every message goes through the one
 *   consent-checked send door; a text while the SMS switch is OFF (or inside
 *   quiet-hours) is held and retried later, never forced through and never
 *   skipped. Each run of the worker writes one audit row.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: GET/POST /api/process-crm-automations  (authenticated — manual trigger)
 *             Also exports scheduled() for Cloudflare's Cron Trigger
 *             (dashboard-configured, no wrangler.toml — per CLAUDE.md).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/cors.js, ../lib/automated-send.js
 *              (sendAutomatedMessage — the ONLY send path), ../lib/google-drive.js
 *              (getActorEmployee, manual-trigger auth), ./process-sequences.js
 *              (computeNextRunAt / planStepOutcome / HOLD_RETRY_HOURS — imported
 *              READ-ONLY; that file is Phase-8-owned and never edited here)
 *   Data:      reads  → crm_orgs, automation_settings, crm_automations,
 *                       crm_automation_runs, system_events, contacts, and the
 *                       trigger entity (inbound_leads / jobs / …)
 *              writes → crm_automation_runs (via enqueue_automation_run + advance),
 *                       system_events (one row per action outcome), worker_runs
 *                       (one row per cron run), crm_tasks / crm_sequence_enrollments
 *                       (via RPCs); sms/email sends also write sms_consent_log
 *                       inside automated-send.js
 *
 * NOTES / GOTCHAS:
 *   - Every send routes through sendAutomatedMessage(); this file NEVER calls
 *     twilio.js / send-message.js / sendEmail directly and NEVER passes
 *     skip_compliance (crm-wave-ownership.md frozen-file rule + TCPA). An SMS
 *     action returns { skipped, reason:'sms_disabled'|'quiet_hours' } while the
 *     kill-switch is OFF / inside quiet-hours; we HOLD it (status 'held', retried
 *     in HOLD_RETRY_HOURS, cursor NOT advanced) so it sends once the switch flips
 *     / the window opens — never bypassed, never dropped. A durable consent skip
 *     (dnd / suppressed / no contact) advances past the action. This decision is
 *     delegated to Phase 8's planStepOutcome so both engines share one rulebook.
 *   - S1 double-send guard: the fixed engine (run-automations.js) and this one
 *     keep dedup markers in namespaces that can't see each other. A rule whose
 *     trigger duplicates an ENABLED fixed automation is refused at save time
 *     (upsert_crm_automation) AND skipped here at fire time (isTriggerBlocked) —
 *     FIXED_AUTOMATION_TRIGGERS below MUST mirror crm_fixed_automation_conflict()
 *     in the migration. TCPA penalties are per message.
 *   - Idempotency: system_events is RPC-fed with no cursor, so run-creation dedups
 *     on UNIQUE(automation_id, triggering_event_id) via enqueue_automation_run
 *     (INSERT … ON CONFLICT DO NOTHING). Re-scanning the same lookback window is a
 *     no-op. Held runs stay in the due query (status in active,held).
 *   - Single-tenant: system_events has no org_id, so every run is scoped to the
 *     one real org (resolveOrgId), and conditions evaluate against the event
 *     payload merged over the trigger entity (payload wins on key collision).
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { sendAutomatedMessage } from '../lib/automated-send.js';
import { getActorEmployee } from '../lib/google-drive.js';
// Read-only import of Phase 8's frozen helpers — the shared timing + hold/skip
// rulebook. This file NEVER edits process-sequences.js (Phase-8-owned).
import { computeNextRunAt, planStepOutcome, HOLD_RETRY_HOURS } from './process-sequences.js';

export const WORKER_NAME = 'process-crm-automations';
export { HOLD_RETRY_HOURS };

// How far back the MATCH phase scans the (cursorless) event bus. Generous enough
// to survive a missed cron tick; the UNIQUE dedup key makes the overlap a no-op.
const MATCH_LOOKBACK_MIN = 180;
const CANDIDATE_LIMIT = 500;

// ─── SECTION: S1 trigger-collision map (mirror of crm_fixed_automation_conflict) ─
// Each fixed automation → the system_events.event_type(s) a configurable rule
// would use to duplicate it. Grounded in the real event vocabulary. Keep in sync
// with the SQL predicate. no_response_followup is a time-window scan with no
// discrete triggering event, so it collides with nothing.
export const FIXED_AUTOMATION_TRIGGERS = {
  speed_to_lead: ['crm_lead_created', 'crm_lead_created_manual'],
  missed_call_textback: ['crm_lead_created', 'crm_lead_created_manual'],
  no_response_followup: [],
  review_request: ['job.phase_changed', 'job.status_changed'],
};

const SETTING_FLAG = {
  speed_to_lead: 'speed_to_lead_enabled',
  missed_call_textback: 'missed_call_textback_enabled',
  no_response_followup: 'no_response_followup_enabled',
  review_request: 'review_request_enabled',
};

// The set of trigger event types currently owned by an ENABLED fixed automation.
export function blockedTriggers(settings) {
  const s = settings || {};
  const blocked = new Set();
  for (const [key, triggers] of Object.entries(FIXED_AUTOMATION_TRIGGERS)) {
    if (s[SETTING_FLAG[key]]) triggers.forEach((t) => blocked.add(t));
  }
  return [...blocked];
}

export function isTriggerBlocked(settings, trigger) {
  return blockedTriggers(settings).includes(trigger);
}

// ─── SECTION: AND-condition evaluator (pure, typed, null-safe) ────────────────
export function getFieldValue(ctx, field) {
  if (ctx == null || field == null) return undefined;
  return String(field).split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}

function isEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

// A value is "numeric" only if it's a finite number or a non-blank numeric string.
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

// Loose equality: two empties are equal; two numerics compare numerically; else
// string-compare. So missing == null == '' but missing != 'call'.
function looseEq(a, b) {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  const na = toNum(a), nb = toNum(b);
  if (na !== null && nb !== null) return na === nb;
  return String(a) === String(b);
}

// Ordering comparison, or null when `actual` is empty (an absent field is never
// ordered — gt/lt against it are false, not throwy).
function order(actual, value) {
  if (isEmpty(actual)) return null;
  const na = toNum(actual), nb = toNum(value);
  if (na !== null && nb !== null) return na - nb;
  const sa = String(actual), sb = value == null ? '' : String(value);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function evaluateCondition(cond, ctx) {
  if (!cond || typeof cond !== 'object') return false;
  const { field, op } = cond;
  const value = cond.value;
  if (!field || !op) return false;
  const actual = getFieldValue(ctx, field);
  switch (op) {
    case 'eq':  return looseEq(actual, value);
    case 'ne':  return !looseEq(actual, value);
    case 'gt':  { const c = order(actual, value); return c !== null && c > 0; }
    case 'gte': { const c = order(actual, value); return c !== null && c >= 0; }
    case 'lt':  { const c = order(actual, value); return c !== null && c < 0; }
    case 'lte': { const c = order(actual, value); return c !== null && c <= 0; }
    case 'contains':
      if (isEmpty(actual)) return false;
      if (Array.isArray(actual)) return actual.map(String).includes(String(value));
      return String(actual).toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'not_contains':
      if (isEmpty(actual)) return true;
      if (Array.isArray(actual)) return !actual.map(String).includes(String(value));
      return !String(actual).toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'in': {
      const list = Array.isArray(value) ? value : [value];
      if (isEmpty(actual)) return list.some(isEmpty);
      return list.map(String).includes(String(actual));
    }
    case 'not_in': {
      const list = Array.isArray(value) ? value : [value];
      if (isEmpty(actual)) return !list.some(isEmpty);
      return !list.map(String).includes(String(actual));
    }
    case 'is_empty':     return isEmpty(actual);
    case 'is_not_empty': return !isEmpty(actual);
    default:             return false; // unknown/malformed op → fail closed (never fire)
  }
}

// AND semantics: every condition must hold. An empty set always matches.
export function evaluateConditions(conditions, ctx) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(c, ctx));
}

// ─── SECTION: Event → evaluation context ──────────────────────────────────────
// Merge the trigger entity (base) under the event payload (override), and expose
// the event's own fields. Conditions reference any of these by name (dotted paths
// supported via getFieldValue).
export function buildEventContext(event, entity) {
  const payload = (event && event.payload) || {};
  return {
    event_type: event?.event_type,
    entity_type: event?.entity_type,
    entity_id: event?.entity_id,
    ...(entity || {}),
    ...payload,
  };
}

// Which table an event's entity lives in. Unknown types resolve to no entity
// (conditions can still match on the payload).
const ENTITY_TABLES = {
  inbound_lead: 'inbound_leads',
  lead: 'inbound_leads',
  job: 'jobs',
  contact: 'contacts',
  claim: 'claims',
  crm_sequence_enrollment: 'crm_sequence_enrollments',
};

async function resolveEntity(db, event, cache) {
  const table = ENTITY_TABLES[event?.entity_type];
  if (!table || !event?.entity_id) return null;
  const key = `${table}:${event.entity_id}`;
  if (cache.has(key)) return cache.get(key);
  let row = null;
  try {
    const rows = await db.select(table, `id=eq.${event.entity_id}&select=*&limit=1`);
    row = rows[0] || null;
  } catch { row = null; }
  cache.set(key, row);
  return row;
}

// Best-effort contact resolution for the run + its send actions.
function resolveContactId(event, entity) {
  return event?.payload?.contact_id
    || entity?.contact_id
    || entity?.primary_contact_id
    || (event?.entity_type === 'contact' ? event?.entity_id : null)
    || null;
}

// The first run's due time = now + the first action's delay.
export function firstActionRunAt(actions, now) {
  const first = Array.isArray(actions) && actions.length ? actions[0] : null;
  return computeNextRunAt(now, first?.delay_hours || 0);
}

// ─── SECTION: planRunOutcome — translate the send outcome onto the run cursor ──
// Delegates the sent|held|skipped|retry DECISION to Phase 8's planStepOutcome
// (one shared rulebook for the consent-critical hold/skip semantics), then maps
// it onto crm_automation_runs (current_action instead of current_step, plus the
// 'held' status so a held run stays in the due query and is retried, never lost).
export function planRunOutcome(run, actions, sendResult, now, opts = {}) {
  const holdRetryHours = opts.holdRetryHours ?? HOLD_RETRY_HOURS;
  const shape = (actions || []).map((a, i) => ({ step_order: i, delay_hours: Number(a?.delay_hours) || 0 }));
  const plan = planStepOutcome({ current_step: run.current_action }, shape, sendResult, now, { holdRetryHours });

  if (plan.action === 'held') {
    // Cursor unchanged — the message is still owed. Retried at plan.patch.next_run_at.
    return {
      action: 'held',
      patch: { status: 'held', next_run_at: plan.patch.next_run_at, last_error: `held:${sendResult.reason}` },
    };
  }
  if (plan.action === 'retry') {
    // Transient failure — leave the run untouched so the next cron retries it.
    return { action: 'retry', patch: null };
  }
  // sent | skipped → advance the cursor (skipped = don't keep pestering).
  const adv = plan.patch; // { current_step, status, next_run_at, completed_at }
  return {
    action: plan.action,
    patch: {
      current_action: adv.current_step,
      status: adv.status === 'completed' ? 'completed' : 'active',
      next_run_at: adv.next_run_at,
      last_error: plan.action === 'skipped' ? `skipped:${sendResult.reason || 'skipped'}` : null,
    },
  };
}

// ─── SECTION: MATCH — open one idempotent run per (rule, event) ───────────────
async function enqueueRun(db, spec) {
  const res = await db.rpc('enqueue_automation_run', {
    p_automation_id: spec.automation_id,
    p_org_id: spec.org_id,
    p_triggering_event_id: spec.triggering_event_id,
    p_contact_id: spec.contact_id,
    p_entity_type: spec.entity_type,
    p_entity_id: spec.entity_id,
    p_next_run_at: spec.next_run_at,
  });
  const id = Array.isArray(res) ? res[0] : res; // uuid on insert, null on conflict
  return id || null;
}

// Given the enabled rules + a batch of events, evaluate conditions and enqueue a
// run for each match. Returns how many NEW runs were created (dedup makes a
// re-scan return 0). S1-blocked rules are filtered out here (fire-time guard).
export async function matchAutomations(ctx, events) {
  const { db, now, orgId, settings, automations } = ctx;
  const cache = new Map();
  let created = 0;
  for (const event of events || []) {
    const matching = (automations || []).filter(
      (a) => a.trigger_event_type === event.event_type && !isTriggerBlocked(settings, a.trigger_event_type)
    );
    if (matching.length === 0) continue;
    const entity = await resolveEntity(db, event, cache);
    const merged = buildEventContext(event, entity);
    const contactId = resolveContactId(event, entity);
    for (const a of matching) {
      if (!evaluateConditions(a.conditions, merged)) continue;
      const runId = await enqueueRun(db, {
        automation_id: a.id,
        org_id: orgId,
        triggering_event_id: event.id,
        contact_id: contactId,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        next_run_at: firstActionRunAt(a.actions, now),
      });
      if (runId) created++;
    }
  }
  return created;
}

// ─── SECTION: ADVANCE — execute the due action + move the cursor ──────────────
async function contactVariables(db, contactId) {
  let name = '';
  try {
    const [c] = await db.select('contacts', `id=eq.${contactId}&select=name&limit=1`);
    name = c?.name || '';
  } catch { name = ''; }
  return { name, first_name: name.split(' ')[0] || '' };
}

// Execute one action. Returns a send-result-shaped object ({ ok } | { skipped,
// reason } | { error }) so planRunOutcome can classify it uniformly. Sends go
// ONLY through the frozen gate; enroll/task go through their RPCs.
async function executeAction(ctx, run, action) {
  const { db, now, send, orgId } = ctx;
  const type = action?.type;
  const config = action?.config || {};
  const contactId = run.contact_id;

  if (type === 'send_email' || type === 'send_sms') {
    if (!contactId) return { ok: false, skipped: true, reason: 'no_contact' };
    const channel = type === 'send_sms' ? 'sms' : 'email';
    const variables = await contactVariables(db, contactId);
    const extra = channel === 'sms'
      ? { orgId, body: config.body || '', now }
      : { subject: config.subject || '', html: config.body || '' };
    return send(channel, contactId, null, variables, extra);
  }

  if (type === 'enroll_sequence') {
    if (!config.sequence_id) return { ok: false, skipped: true, reason: 'no_sequence' };
    if (!contactId) return { ok: false, skipped: true, reason: 'no_contact' };
    try {
      await db.rpc('enroll_in_sequence', { p_sequence_id: config.sequence_id, p_contact_id: contactId, p_org_id: orgId });
      return { ok: true };
    } catch (e) { return { ok: false, skipped: false, error: e.message }; }
  }

  if (type === 'create_task') {
    try {
      const dueAt = config.due_hours != null ? computeNextRunAt(now, config.due_hours) : null;
      await db.rpc('upsert_crm_task', {
        p_title: config.title || 'Automation follow-up',
        p_notes: config.notes || null,
        p_due_at: dueAt,
        p_assignee_id: config.assignee_id || null,
        p_contact_id: contactId || null,
        p_lead_id: run.entity_type === 'inbound_lead' ? run.entity_id : null,
        p_org_id: orgId,
      });
      return { ok: true };
    } catch (e) { return { ok: false, skipped: false, error: e.message }; }
  }

  // Unknown action type — durable skip so the run advances rather than looping.
  return { ok: false, skipped: true, reason: 'unknown_action' };
}

async function writeRunEvent(db, run, automation, action, outcomeAction, result) {
  try {
    await db.insert('system_events', {
      event_type: `crm_automation_${outcomeAction}`, // sent | held | skipped
      entity_type: 'crm_automation_run',
      entity_id: run.id,
      payload: {
        automation_id: automation.id,
        action_index: run.current_action,
        action_type: action?.type || null,
        reason: result?.reason || null,
      },
    });
  } catch { /* audit best-effort — the run patch already carries state */ }
}

// Advance a single due run by one action. Returns the action taken:
// completed | sent | held | skipped | retry | paused | blocked.
export async function processRun(ctx, run) {
  const { db, now } = ctx;
  const nowIso = new Date(now).toISOString();
  const automation = ctx.automationsById[run.automation_id];

  // A disabled rule never fires; a now-S1-blocked rule never fires (defense in
  // depth). Leave the run as-is so it resumes if the rule is re-enabled.
  if (!automation || !automation.enabled) return 'paused';
  if (isTriggerBlocked(ctx.settings, automation.trigger_event_type)) return 'blocked';

  const actions = Array.isArray(automation.actions) ? automation.actions : [];
  const action = actions[run.current_action];
  if (!action) {
    await db.update('crm_automation_runs', `id=eq.${run.id}`, { status: 'completed', next_run_at: null, updated_at: nowIso });
    return 'completed';
  }

  const result = await executeAction(ctx, run, action);
  const plan = planRunOutcome(run, actions, result, now, { holdRetryHours: HOLD_RETRY_HOURS });
  if (plan.patch) {
    await db.update('crm_automation_runs', `id=eq.${run.id}`, { ...plan.patch, updated_at: nowIso });
  }
  if (plan.action !== 'retry') {
    await writeRunEvent(db, run, automation, action, plan.action, result);
  }
  return plan.action;
}

// ─── SECTION: Data helpers ────────────────────────────────────────────────────
async function resolveOrgId(db) {
  const rows = await db.select('crm_orgs', 'is_test=eq.false&select=id&order=created_at.asc&limit=1');
  return rows[0]?.id || null;
}

async function loadSettings(db, orgId) {
  try {
    const [s] = await db.select('automation_settings', `org_id=eq.${orgId}&select=*&limit=1`);
    return s || {};
  } catch { return {}; }
}

async function writeWorkerRun(db, processed, status, startedAt, errorMessage) {
  try {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME,
      status,
      records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch { /* audit best-effort */ }
}

// ─── SECTION: Orchestrator ────────────────────────────────────────────────────
export async function processCrmAutomations(db, env, now = new Date()) {
  const startedAt = new Date(now).toISOString();
  const send = (channel, contactId, templateKey, variables, extra) =>
    sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra);

  let processed = 0;
  try {
    const orgId = await resolveOrgId(db);
    if (!orgId) {
      await writeWorkerRun(db, 0, 'completed', startedAt);
      return { ok: true, counts: {}, processed: 0, orgId: null };
    }

    const settings = await loadSettings(db, orgId);
    const automations = await db.select('crm_automations', `org_id=eq.${orgId}&select=*`);
    const enabled = automations.filter((a) => a.enabled);
    const automationsById = Object.fromEntries(automations.map((a) => [a.id, a]));

    // ① MATCH — scan the recent event bus for enabled, non-blocked triggers.
    let created = 0;
    const activeTriggers = [...new Set(
      enabled.filter((a) => !isTriggerBlocked(settings, a.trigger_event_type)).map((a) => a.trigger_event_type)
    )];
    if (activeTriggers.length) {
      const since = new Date(new Date(now).getTime() - MATCH_LOOKBACK_MIN * 60000).toISOString();
      const inList = activeTriggers.map((t) => encodeURIComponent(t)).join(',');
      const events = await db.select(
        'system_events',
        `event_type=in.(${inList})&created_at=gte.${since}&select=*&order=created_at.desc&limit=${CANDIDATE_LIMIT}`
      );
      created = await matchAutomations({ db, now, orgId, settings, automations: enabled }, events);
    }

    // ② ADVANCE — run every due run's next action (held runs stay due).
    const due = await db.select(
      'crm_automation_runs',
      `status=in.(active,held)&next_run_at=lte.${startedAt}&select=*&order=next_run_at.asc&limit=${CANDIDATE_LIMIT}`
    );
    const ctx = { db, env, now, send, orgId, settings, automationsById };
    const counts = { created, sent: 0, held: 0, skipped: 0, completed: 0, retry: 0, paused: 0, blocked: 0 };
    for (const run of due) {
      const action = await processRun(ctx, run);
      counts[action] = (counts[action] || 0) + 1;
    }

    // A retry/paused/blocked run is not "processed work" — it comes back next run.
    processed = created + counts.sent + counts.held + counts.skipped + counts.completed;
    await writeWorkerRun(db, processed, 'completed', startedAt);
    return { ok: true, counts, processed, orgId };
  } catch (e) {
    await writeWorkerRun(db, processed, 'error', startedAt, e.message);
    return { ok: false, error: e.message };
  }
}

// ─── SECTION: HTTP + cron wrappers ────────────────────────────────────────────
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
  const result = await processCrmAutomations(db, env);
  console.log('process-crm-automations cron:', JSON.stringify(result));
}

// A server-side scheduler (Supabase pg_cron + pg_net) authenticates with this
// header instead of a user session — same shape as weekly-crm-digest's
// crm_digest_secret. Needed because Cloudflare PAGES projects expose no Cron
// Trigger UI; the schedule lives in pg_cron and calls this worker over HTTPS.
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
  const result = await processCrmAutomations(db, env);
  return jsonResponse(result, result.ok ? 200 : 500, request, env);
}
