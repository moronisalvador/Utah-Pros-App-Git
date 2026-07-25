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

export async function collectOpsHealthInputs(db, now) {
  const sinceIso = new Date(
    now.getTime() - DEFAULT_OPS_HEALTH_THRESHOLDS.workerErrorWindowMinutes * 60_000,
  ).toISOString();

  const eventCols = 'id,direction,message_type,error_code,error_message,sender_address,'
    + 'recipient_address,provider_message_id,media_count,owned_media,processing_attempts,'
    + 'next_attempt_at,received_at';

  const [failedEvents, retryableEvents, workerErrors, claims] = await Promise.all([
    safeSelect(db, 'message_provider_events',
      `processing_state=eq.failed&select=${eventCols}&order=received_at.desc&limit=${ROW_LIMIT}`),
    safeSelect(db, 'message_provider_events',
      `processing_state=eq.retryable&select=${eventCols}&order=received_at.desc&limit=${ROW_LIMIT}`),
    safeSelect(db, 'worker_runs',
      `status=eq.error&started_at=gte.${encodeURIComponent(sinceIso)}`
      + `&select=worker_name,status,error_message,started_at`
      + `&order=started_at.desc&limit=${ROW_LIMIT}`),
    safeSelect(db, 'fixed_automation_claims',
      `finalized_at=is.null&select=id,automation_key,entity_type,entity_id,claimed_at,finalized_at`
      + `&order=claimed_at.asc&limit=${ROW_LIMIT}`),
  ]);

  const probeErrors = [
    failedEvents === null && 'message_provider_events(failed)',
    retryableEvents === null && 'message_provider_events(retryable)',
    workerErrors === null && 'worker_runs',
    claims === null && 'fixed_automation_claims',
  ].filter(Boolean);

  return {
    failedEvents: failedEvents || [],
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

  for (const condition of conditions) {
    const dedupeKey = buildDedupeKey(condition.key, denverDate);
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
          payload: {
            condition: condition.key,
            severity: condition.severity,
            count: condition.count,
            details: condition.details,
            ...condition.meta,
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
