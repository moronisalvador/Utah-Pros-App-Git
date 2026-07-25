/**
 * ════════════════════════════════════════════════
 * FILE: ops-health.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether anything in the messaging/automation plumbing is currently
 *   broken enough to be worth waking a human for. You hand it plain lists of
 *   rows (failed provider events, stuck retries, recent worker errors,
 *   unfinished automation claims) plus "what time is it", and it hands back a
 *   short list of problems, each already written as a sentence a person can act
 *   on — including WHO the message was from, because the first question anyone
 *   asks during triage is "is this a real customer or our own test number?".
 *
 *   This file makes no decisions about how anyone is told. It never touches the
 *   database, the network, or a customer. It is pure arithmetic on the rows it
 *   is given, so it can be unit-tested with fixtures.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (deliberately dependency-free and side-effect-free)
 *   Data:      reads  → none (rows are passed in)
 *              writes → none
 *
 * EXPORTS:
 *   OPS_HEALTH_CONDITIONS          — the four stable condition keys
 *   DEFAULT_OPS_HEALTH_THRESHOLDS  — tunable minute/count thresholds
 *   describeParty(row)             — "385-314-5700 → 385-360-4121" identity line
 *   evaluateOpsHealth(input)       — → { checkedAt, conditions: [...] }
 *   buildDedupeKey(conditionKey, denverDate) — per-condition daily dedupe key
 *
 * NOTES / GOTCHAS:
 *   - Severity is advisory ordering only; it is NOT a paging tier.
 *   - `unfinalizedClaims` has NO stale-recovery by design (a claim is a
 *     write-once marker), so an old unfinalized claim means a worker died
 *     mid-run. That is exactly why it is surfaced rather than auto-healed.
 *   - Detail lists are capped (DETAIL_CAP) so one bad hour cannot produce a
 *     notification body too large for a bell row or a push payload.
 *   - Every timestamp comparison is done in UTC milliseconds. The Denver day is
 *     only used for the dedupe key, supplied by the caller.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Constants ──────────────

export const OPS_HEALTH_CONDITIONS = Object.freeze({
  PROVIDER_EVENTS_FAILED: 'provider_events_failed',
  PROVIDER_EVENTS_STUCK: 'provider_events_stuck',
  WORKER_ERRORS: 'worker_errors',
  UNFINALIZED_CLAIMS: 'unfinalized_claims',
});

export const DEFAULT_OPS_HEALTH_THRESHOLDS = Object.freeze({
  // An event still 'retryable' this long past next_attempt_at means nothing is
  // draining the queue — the exact signature of the 45-minute STOP outage.
  stuckRetryableMinutes: 15,
  // Worker errors are grouped over this trailing window.
  workerErrorWindowMinutes: 60,
  // Fire on the first error in the window; noise is controlled by daily dedupe,
  // not by tolerating failures.
  workerErrorMinCount: 1,
  // A claim with no finalized_at older than this means a worker died mid-run.
  claimUnfinalizedMinutes: 30,
});

// Cap how many individual rows are named in a notification body.
const DETAIL_CAP = 5;

// ─── SECTION: Helpers ──────────────

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function minutesBetween(laterMs, earlierMs) {
  if (laterMs === null || earlierMs === null) return null;
  return (laterMs - earlierMs) / 60_000;
}

/**
 * The identity line that makes triage instant: who sent it, to what number,
 * and which way it was going. Falls back to the provider message id so a row
 * is never described as an anonymous "1 event".
 */
export function describeParty(row = {}) {
  const from = row.sender_address || null;
  const to = row.recipient_address || null;
  const arrow = row.direction === 'outbound' ? '→' : '←';
  if (from && to) return `${from} ${arrow} ${to}`;
  if (from) return `from ${from}`;
  if (to) return `to ${to}`;
  return row.provider_message_id || row.id || 'unknown party';
}

function capDetails(lines) {
  if (lines.length <= DETAIL_CAP) return lines;
  const shown = lines.slice(0, DETAIL_CAP);
  shown.push(`…and ${lines.length - DETAIL_CAP} more`);
  return shown;
}

function condition({ key, severity, count, title, details, meta }) {
  return {
    key,
    severity,
    count,
    title,
    details: capDetails(details),
    body: capDetails(details).join('\n'),
    meta: meta || {},
  };
}

export function buildDedupeKey(conditionKey, denverDate) {
  return `${conditionKey}:${denverDate}`;
}

// ─── SECTION: The four checks ──────────────

function checkFailedProviderEvents(rows) {
  if (!rows.length) return null;
  const details = rows.map((row) => {
    const media = row.media_count > 0 && (!row.owned_media || row.owned_media.length === 0)
      ? ' [media LOST]'
      : '';
    return `${row.error_code || 'unknown error'} · ${describeParty(row)}`
      + ` · ${row.message_type || 'message'}${media}`;
  });
  return condition({
    key: OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED,
    severity: 'high',
    count: rows.length,
    title: `${rows.length} inbound/outbound message event${rows.length === 1 ? '' : 's'} failed`,
    details,
    meta: { ids: rows.map((r) => r.id).filter(Boolean) },
  });
}

function checkStuckProviderEvents(rows, nowMs, thresholdMinutes) {
  const stuck = rows.filter((row) => {
    const due = toMs(row.next_attempt_at);
    if (due === null) return false;
    const overdue = minutesBetween(nowMs, due);
    return overdue !== null && overdue > thresholdMinutes;
  });
  if (!stuck.length) return null;
  const details = stuck.map((row) => {
    const overdue = Math.round(minutesBetween(nowMs, toMs(row.next_attempt_at)));
    return `${overdue} min overdue · ${describeParty(row)}`
      + ` · attempt ${row.processing_attempts ?? '?'}`;
  });
  return condition({
    key: OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK,
    severity: 'critical',
    count: stuck.length,
    title: `${stuck.length} message event${stuck.length === 1 ? '' : 's'} stuck past retry time`,
    details,
    meta: { ids: stuck.map((r) => r.id).filter(Boolean) },
  });
}

function checkWorkerErrors(rows, nowMs, { windowMinutes, minCount }) {
  const recent = rows.filter((row) => {
    const started = toMs(row.started_at);
    if (started === null) return false;
    const age = minutesBetween(nowMs, started);
    return age !== null && age >= 0 && age <= windowMinutes;
  });
  if (recent.length < minCount || !recent.length) return null;

  const byWorker = new Map();
  for (const row of recent) {
    const name = row.worker_name || 'unknown worker';
    const entry = byWorker.get(name) || { count: 0, sample: null };
    entry.count += 1;
    if (!entry.sample && row.error_message) entry.sample = row.error_message;
    byWorker.set(name, entry);
  }

  const details = Array.from(byWorker.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, entry]) => `${name} ×${entry.count}`
      + (entry.sample ? ` · ${String(entry.sample).slice(0, 80)}` : ''));

  return condition({
    key: OPS_HEALTH_CONDITIONS.WORKER_ERRORS,
    severity: 'medium',
    count: recent.length,
    title: `${recent.length} worker error${recent.length === 1 ? '' : 's'} in the last ${windowMinutes} min`,
    details,
    meta: { workers: Object.fromEntries(Array.from(byWorker, ([k, v]) => [k, v.count])) },
  });
}

function checkUnfinalizedClaims(rows, nowMs, thresholdMinutes) {
  const stale = rows.filter((row) => {
    if (row.finalized_at) return false;
    const claimed = toMs(row.claimed_at);
    if (claimed === null) return false;
    const age = minutesBetween(nowMs, claimed);
    return age !== null && age > thresholdMinutes;
  });
  if (!stale.length) return null;
  const details = stale.map((row) => {
    const age = Math.round(minutesBetween(nowMs, toMs(row.claimed_at)));
    return `${row.automation_key || 'unknown automation'} · ${age} min unfinalized`
      + ` · ${row.entity_type || 'entity'} ${row.entity_id || '?'}`;
  });
  return condition({
    key: OPS_HEALTH_CONDITIONS.UNFINALIZED_CLAIMS,
    severity: 'high',
    count: stale.length,
    title: `${stale.length} automation claim${stale.length === 1 ? '' : 's'} never finalized`,
    details,
    meta: { ids: stale.map((r) => r.id).filter(Boolean) },
  });
}

// ─── SECTION: Entry point ──────────────

/**
 * Evaluate all four conditions against supplied fixtures.
 * Pure: no I/O, no clock read (caller supplies `now`).
 *
 * @param {{
 *   now: string|number|Date,
 *   failedEvents?: object[],
 *   retryableEvents?: object[],
 *   workerErrors?: object[],
 *   claims?: object[],
 *   thresholds?: object,
 * }} input
 * @returns {{ checkedAt: string, conditions: object[] }}
 */
export function evaluateOpsHealth({
  now,
  failedEvents = [],
  retryableEvents = [],
  workerErrors = [],
  claims = [],
  thresholds = {},
} = {}) {
  const t = { ...DEFAULT_OPS_HEALTH_THRESHOLDS, ...thresholds };
  const nowMs = toMs(now) ?? Date.now();

  const conditions = [
    checkFailedProviderEvents(failedEvents || []),
    checkStuckProviderEvents(retryableEvents || [], nowMs, t.stuckRetryableMinutes),
    checkWorkerErrors(workerErrors || [], nowMs, {
      windowMinutes: t.workerErrorWindowMinutes,
      minCount: t.workerErrorMinCount,
    }),
    checkUnfinalizedClaims(claims || [], nowMs, t.claimUnfinalizedMinutes),
  ].filter(Boolean);

  return { checkedAt: new Date(nowMs).toISOString(), conditions };
}
