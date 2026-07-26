/**
 * ════════════════════════════════════════════════
 * FILE: ops-health.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The watchman. Every few minutes the scheduler calls this, and it looks at
 *   four places where this system quietly breaks: message events that failed,
 *   message events stuck waiting for a retry that never comes, workers that
 *   errored in the last hour, and automation claims that were started but never
 *   finished. If any of those look wrong it raises an in-app alert to the
 *   admins — once per problem per day, so it warns without nagging.
 *
 *   It exists because nothing in this system told anyone when it broke: 121
 *   worker failures went unnoticed in a week, and an inbound STOP failed every
 *   five minutes for 45 minutes with nobody the wiser.
 *
 * ENDPOINT:
 *   POST /api/ops-health   (scheduler only — x-webhook-secret)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/auth.js (checkCronSecret), ../lib/supabase.js,
 *              ../lib/worker-runs.js, ../lib/ops-health.js (pure thresholds),
 *              ../lib/date-mt.js (Denver day for dedupe), ./notify.js
 *   Data:      reads  → message_provider_events, worker_runs,
 *                       fixed_automation_claims, system_events (dedupe),
 *                       integration_config (cron secret)
 *              writes → system_events (one dedupe marker per alert raised),
 *                       worker_runs (telemetry), notifications (via notify.js)
 *
 * NOTES / GOTCHAS:
 *   - READ-ONLY over the things it monitors. It never repairs, re-drives, or
 *     re-claims anything — it only reports. Auto-healing a claim would defeat
 *     the write-once marker it is checking.
 *   - It CANNOT send a customer message. It emits through dispatchEvent, the
 *     existing internal staff notification path, so no consent surface is
 *     touched and no provider is called.
 *   - Dedupe is per condition per Denver day, recorded in system_events. If the
 *     notification type is disabled the marker is still NOT written, so turning
 *     the type on later alerts immediately instead of staying silent all day.
 *   - The alert type ships `enabled` and bell-only by default; per-employee
 *     preferences still apply on top (notify.js).
 * ════════════════════════════════════════════════
 */

import { checkCronSecret } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { mountainToday } from '../lib/date-mt.js';
import {
  evaluateOpsHealth,
  buildDedupeKey,
  DEFAULT_OPS_HEALTH_THRESHOLDS,
} from '../lib/ops-health.js';
import { dispatchEvent } from './notify.js';

const WORKER_NAME = 'ops-health';
const NOTIFICATION_TYPE = 'ops.health';
const DEDUPE_EVENT_TYPE = 'ops_health_alert';
// system_events.entity_id is NOT NULL; a system-wide event has no entity.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
// Bound every probe so a runaway table cannot blow the worker's memory.
const ROW_LIMIT = 200;

function response(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── SECTION: Data fetching (each probe fails soft and independently) ───

async function safeSelect(db, table, query) {
  try {
    return (await db.select(table, query)) || [];
  } catch {
    return null; // null = "this probe could not run", distinct from "nothing wrong"
  }
}

/**
 * Failed events that nobody has acknowledged yet.
 *
 * A failed event is terminal, so without an acknowledgement column this alert
 * repeats every single day forever and gets tuned out. `resolved_at` gives the
 * state an exit.
 *
 * Deliberately tolerant of the column not existing. `safeSelect` turns a 400
 * into null, which the caller reads as "probe could not run" — so if this Worker
 * deployed before the migration applied, the failed-event alert would silently
 * go quiet. Falling back to the unfiltered query keeps alerting through that
 * window, in either deploy order, and reports that it ran degraded.
 */
async function selectUnresolvedFailures(db, cols) {
  const base = `processing_state=eq.failed&select=${cols}&order=received_at.asc&limit=${ROW_LIMIT}`;

  const unresolvedOnly = await safeSelect(
    db,
    'message_provider_events',
    `processing_state=eq.failed&resolved_at=is.null&select=${cols}`
    + `&order=received_at.asc&limit=${ROW_LIMIT}`,
  );
  if (unresolvedOnly !== null) return { rows: unresolvedOnly, degraded: false };

  const all = await safeSelect(db, 'message_provider_events', base);
  return { rows: all, degraded: all !== null };
}

export async function collectOpsHealthInputs(db, now) {
  const sinceIso = new Date(
    now.getTime() - DEFAULT_OPS_HEALTH_THRESHOLDS.workerErrorWindowMinutes * 60_000,
  ).toISOString();

  const eventCols = 'id,direction,message_type,error_code,error_message,sender_address,'
    + 'recipient_address,provider_message_id,media_count,owned_media,processing_attempts,'
    + 'next_attempt_at,received_at';

  const [failed, retryableEvents, workerErrors, claims] = await Promise.all([
    selectUnresolvedFailures(db, eventCols),
    // OLDEST-first, deliberately. Every probe here is capped at ROW_LIMIT, and
    // the conditions care about the STALEST rows — most overdue, past the
    // escalation threshold. Newest-first would drop exactly those over the cap,
    // so a backlog larger than the limit could read as healthy. Matches the
    // fixed_automation_claims probe below, which had it right already.
    safeSelect(db, 'message_provider_events',
      `processing_state=eq.retryable&select=${eventCols}&order=received_at.asc&limit=${ROW_LIMIT}`),
    safeSelect(db, 'worker_runs',
      `status=eq.error&started_at=gte.${encodeURIComponent(sinceIso)}`
      + `&select=worker_name,status,error_message,started_at`
      + `&order=started_at.desc&limit=${ROW_LIMIT}`),
    safeSelect(db, 'fixed_automation_claims',
      `finalized_at=is.null&select=id,automation_key,entity_type,entity_id,claimed_at,finalized_at`
      + `&order=claimed_at.asc&limit=${ROW_LIMIT}`),
  ]);

  const probeErrors = [
    failed.rows === null && 'message_provider_events(failed)',
    retryableEvents === null && 'message_provider_events(retryable)',
    workerErrors === null && 'worker_runs',
    claims === null && 'fixed_automation_claims',
    // Not an error — alerting still works, but it is counting resolved rows too,
    // so the acknowledgement column is missing or unreadable.
    failed.degraded && 'message_provider_events(failed): resolved_at unavailable',
  ].filter(Boolean);

  return {
    failedEvents: failed.rows || [],
    retryableEvents: retryableEvents || [],
    workerErrors: workerErrors || [],
    claims: claims || [],
    probeErrors,
  };
}

// ─── SECTION: Per-condition daily dedupe ───

/**
 * ACCEPTED LIMITATION (reviewed 2026-07-25): this is a check-then-act with no
 * DB-level uniqueness, so two overlapping runs — a slow one still in flight when
 * the next 15-minute wake fires — can both pass the check and both alert. The
 * failure mode is ONE DUPLICATE BELL ROW, which for an alerting system is
 * strictly preferable to the alternative (a lock that could suppress a real
 * alert). Not worth a strong-lock CREATE INDEX on the hot shared system_events
 * table (database-standard.md §5). Revisit only if duplicates become frequent.
 *
 * Marker storage: system_events is RLS-enabled with ZERO policies (verified live
 * 2026-07-25), so browser roles read nothing — these markers reveal pipeline
 * health to service_role only.
 */
async function alreadyAlertedToday(db, dedupeKey, denverDate) {
  // Look back far enough to cover the whole Denver day from any UTC offset.
  const since = new Date(`${denverDate}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 1);
  try {
    const rows = await db.select(
      'system_events',
      `event_type=eq.${DEDUPE_EVENT_TYPE}&created_at=gte.${encodeURIComponent(since.toISOString())}`
      + `&select=payload&limit=200`,
    );
    return (rows || []).some((row) => row?.payload?.dedupe_key === dedupeKey);
  } catch {
    // Fail OPEN: if the dedupe check itself is broken we would rather alert
    // twice than stay silent through an outage.
    return false;
  }
}

/**
 * Who should be woken by an ops alert.
 *
 * These are internal plumbing failures, not business events — the owner asked
 * that they reach him alone rather than every admin, and an operational alarm
 * fanned out to people who cannot act on it is how alarms get muted.
 *
 * Configurable (not hardcoded) via the non-secret `integration_config` key
 * `ops_health_recipient_ids`: a JSON array or comma-separated list of employee
 * ids. `notify.js` re-filters whatever we pass through
 * `filterActiveInternalEmployeeIds`, so a stale or wrong id degrades to "fewer
 * recipients", never to a leak.
 *
 * Returns null when unset/unparseable, which leaves the existing role audience
 * in place. Failing OPEN is deliberate: losing ops alerts entirely is worse
 * than over-notifying.
 */
async function resolveOpsRecipients(db) {
  let raw = null;
  try {
    const rows = await db.select('integration_config', 'key=eq.ops_health_recipient_ids&select=value');
    raw = rows?.[0]?.value ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;

  let ids = [];
  if (Array.isArray(raw)) {
    ids = raw;
  } else {
    const text = String(raw).trim();
    if (text.startsWith('[')) {
      try { ids = JSON.parse(text); } catch { ids = []; }
    } else {
      ids = text.split(',');
    }
  }

  const cleaned = Array.from(new Set(
    (Array.isArray(ids) ? ids : [])
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter(Boolean),
  ));
  return cleaned.length ? cleaned : null;
}

async function recordAlertMarker(db, condition, dedupeKey, denverDate) {
  try {
    await db.insert('system_events', {
      event_type: DEDUPE_EVENT_TYPE,
      entity_type: 'system',
      entity_id: NIL_UUID,
      payload: {
        dedupe_key: dedupeKey,
        condition: condition.key,
        severity: condition.severity,
        count: condition.count,
        denver_date: denverDate,
      },
    });
  } catch {
    /* marker is best-effort — a failed write only risks a duplicate alert */
  }
}

// ─── SECTION: Run ───

export async function runOpsHealth(db, env, { now = new Date(), dispatchImpl = dispatchEvent } = {}) {
  const startedAt = now.toISOString();
  const denverDate = mountainToday(now);

  const inputs = await collectOpsHealthInputs(db, now);
  const { conditions } = evaluateOpsHealth({ now, ...inputs });

  const raised = [];
  const suppressed = [];
  const opsRecipients = await resolveOpsRecipients(db);

  for (const condition of conditions) {
    // Fingerprint keys the suppression to the distinct failure CLASSES in play,
    // so a new worker/error code later the same day still rings. One-time cost:
    // the first run after deploy re-alerts each live condition once, because
    // yesterday's markers carry the old un-fingerprinted key shape.
    const dedupeKey = buildDedupeKey(condition.key, denverDate, condition.fingerprint);
    if (await alreadyAlertedToday(db, dedupeKey, denverDate)) {
      suppressed.push(condition.key);
      continue;
    }

    let dispatched;
    try {
      dispatched = await dispatchImpl({
        db,
        env,
        typeKey: NOTIFICATION_TYPE,
        body: {
          title: `Ops alert · ${condition.title}`,
          body: condition.body,
          link: '/devtools',
          entity_type: 'system',
          // Omitted entirely when unset, so resolveAudience falls back to its
          // role audience rather than receiving an empty array.
          ...(opsRecipients ? { recipient_ids: opsRecipients } : {}),
          payload: {
            // meta spreads FIRST so the four fixed keys always win. Spreading
            // last would let a future meta field named condition/severity/
            // count/details silently shadow the real one.
            ...condition.meta,
            condition: condition.key,
            severity: condition.severity,
            count: condition.count,
            details: condition.details,
          },
        },
      });
    } catch {
      dispatched = { skipped: true, reason: 'dispatch_failed' };
    }

    // Only claim the day's dedupe slot once the alert actually went somewhere.
    if (dispatched?.skipped) {
      suppressed.push(`${condition.key}:${dispatched.reason || 'skipped'}`);
      continue;
    }
    await recordAlertMarker(db, condition, dedupeKey, denverDate);
    raised.push({ condition: condition.key, recipients: dispatched?.recipients ?? 0 });
  }

  const result = {
    success: inputs.probeErrors.length === 0,
    checked: denverDate,
    conditions: conditions.length,
    raised,
    suppressed,
    probeErrors: inputs.probeErrors,
  };

  await recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status: result.success ? 'completed' : 'error',
    recordsProcessed: raised.length,
    errorMessage: inputs.probeErrors.length
      ? `probe failed: ${inputs.probeErrors.join(', ')}`
      : null,
    startedAt,
    meta: {
      conditions: conditions.map((c) => c.key),
      raised: raised.map((r) => r.condition),
      suppressed,
    },
  });

  return result;
}

// ─── SECTION: Pages Function entry points ───

// The ONLY entry point. Scheduling goes pg_cron → wake_ops_health_worker() →
// HTTP POST with x-webhook-secret → here. There is deliberately NO `scheduled()`
// export: a Cloudflare Cron Trigger would be a second, UNAUTHENTICATED entry
// point that could also double-fire alongside the pg_cron path. If a Cron
// Trigger is ever wanted, it must carry its own guard.
export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  if (!(await checkCronSecret(request, db))) {
    return response({ error: 'Unauthorized' }, 401);
  }
  const result = await runOpsHealth(db, env);
  return response(result, result.success ? 200 : 500);
}
