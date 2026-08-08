/**
 * ════════════════════════════════════════════════
 * FILE: ops-health.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether anything in the messaging/automation plumbing is currently
 *   broken enough to be worth waking a human for. You hand it plain lists of
 *   rows (failed provider events, stuck retries, recent worker errors,
 *   unfinished automation claims, the QBO payment sweep's recent runs) plus
 *   "what time is it", and it hands back a short list of problems, each already
 *   written as a sentence a person can act on — including WHO the message was
 *   from, because the first question anyone asks during triage is "is this a
 *   real customer or our own test number?".
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
 *   OPS_HEALTH_CONDITIONS          — the seven stable condition keys
 *   DEFAULT_OPS_HEALTH_THRESHOLDS  — tunable minute/count thresholds
 *   describeParty(row)             — "385-314-5700 → 385-360-4121" identity line
 *   summarizeWorkerError(raw)      — readable one-liner from a JSON/plain error
 *   evaluateOpsHealth(input)       — → { checkedAt, conditions: [...] }
 *   buildDedupeKey(conditionKey, denverDate, fingerprint?) — daily dedupe key
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
 *   - Each condition carries a `fingerprint` over its DISTINCT failure CLASSES
 *     (error codes / worker names / automation keys) — never over raw error
 *     text, which contains UUIDs and would make every run look novel. The
 *     dedupe key mixes it in so a genuinely new failure later the same day is
 *     not swallowed by the day's first alert.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Constants ──────────────

export const OPS_HEALTH_CONDITIONS = Object.freeze({
  PROVIDER_EVENTS_FAILED: 'provider_events_failed',
  PROVIDER_EVENTS_STUCK: 'provider_events_stuck',
  WORKER_ERRORS: 'worker_errors',
  UNFINALIZED_CLAIMS: 'unfinalized_claims',
  QBO_SYNC_FAILING: 'qbo_sync_failing',
  QBO_WEBHOOK_DOWN: 'qbo_webhook_down',
  QBO_SYNC_STALE: 'qbo_sync_stale',
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
  // An unresolved failed-event backlog older than this escalates from high to
  // critical. Failures are terminal, so without this the alert would repeat at
  // the same volume forever and be tuned out; ignoring it should get LOUDER,
  // not quieter. Pairs with resolved_at — acknowledge and it stops entirely.
  failedBacklogEscalateDays: 3,
  // qbo-payments-sync failing this many runs IN A ROW means payments are not
  // being swept. One failure is a blip; a streak is the Aug 3–5 outage
  // signature, when the payment pipeline was broken for two days and the only
  // symptom was missing money.
  qboSyncErrorStreakRuns: 2,
  // The payment sweep is hourly, so silence this long means at least two
  // consecutive wakes never happened — the cron itself died, the one failure
  // class no per-run status row can ever report.
  qboSyncStaleMinutes: 180,
});

// Cap how many individual rows are named in a notification body.
const DETAIL_CAP = 5;

// Cap a single worker's error summary AFTER the useful part is extracted.
const ERROR_SUMMARY_CAP = 120;

// Hard bound on what we hand to JSON.parse, independent of who wrote the row.
const PARSE_INPUT_CAP = 2000;

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

/**
 * Turn a worker's raw `error_message` into something a human can read at a
 * glance. Workers frequently store a JSON array or object rather than a
 * sentence, and blindly slicing that produced bodies cut mid-token — the live
 * 2026-07-26 alert read "…returned an empt", because the first 80 characters
 * were spent on a UUID and a JSON envelope.
 *
 * So: extract FIRST, truncate AFTER. Anything unparseable falls back to the old
 * behavior rather than throwing — an ugly alert beats a missing one.
 */
export function summarizeWorkerError(raw) {
  if (raw === null || raw === undefined) return null;
  // Bound the input before parsing. recordWorkerRun caps error_message at 500
  // chars, but some workers still hand-roll their worker_runs insert and skip
  // that, so this function cannot assume a bounded writer.
  const text = String(raw).slice(0, PARSE_INPUT_CAP);
  if (!text.trim()) return null;

  let extracted = null;
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const messages = list
      .map((entry) => {
        if (entry === null || entry === undefined) return null;
        if (typeof entry === 'string') return entry;
        if (typeof entry !== 'object') return String(entry);
        return entry.error || entry.message || entry.detail || null;
      })
      .map((m) => (m === null || m === undefined ? null : String(m).trim()))
      .filter((m) => m);

    if (messages.length) {
      const extra = messages.length - 1;
      extracted = extra > 0 ? `${messages[0]} (+${extra} more)` : messages[0];
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }

  return (extracted ?? text).slice(0, ERROR_SUMMARY_CAP);
}

/**
 * Stable 32-bit FNV-1a over a sorted set of low-cardinality class identifiers
 * (worker names, error codes, automation keys). Deliberately NOT hashed over
 * raw error text: those carry UUIDs and timestamps, so every occurrence would
 * look distinct and the bell would ring every single run.
 */
function fingerprintOf(values) {
  const distinct = Array.from(
    new Set((values || []).map((v) => (v === null || v === undefined ? '' : String(v))).filter(Boolean)),
  ).sort();
  if (!distinct.length) return 'none';
  const joined = distinct.join(' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function condition({ key, severity, count, title, details, meta, classes }) {
  return {
    key,
    severity,
    count,
    title,
    details: capDetails(details),
    body: capDetails(details).join('\n'),
    meta: meta || {},
    fingerprint: fingerprintOf(classes),
  };
}

/**
 * Per-condition daily dedupe key.
 *
 * `fingerprint` identifies WHICH distinct failures are in play. Without it the
 * key was `condition:date`, so the first alert of a Denver day claimed the slot
 * and a genuinely NEW failure later the same day was silently swallowed
 * (verified: transcribe-call errored at 06:20 MT on 2026-07-26, after the 00:30
 * alert had already taken the key).
 *
 * Omitting `fingerprint` preserves the original key shape.
 */
export function buildDedupeKey(conditionKey, denverDate, fingerprint) {
  const base = `${conditionKey}:${denverDate}`;
  return fingerprint ? `${base}:${fingerprint}` : base;
}

// ─── SECTION: The messaging/automation checks ──────────────

function checkFailedProviderEvents(rows, nowMs, escalateAfterDays) {
  if (!rows.length) return null;
  const details = rows.map((row) => {
    const media = row.media_count > 0 && (!row.owned_media || row.owned_media.length === 0)
      ? ' [media LOST]'
      : '';
    return `${row.error_code || 'unknown error'} · ${describeParty(row)}`
      + ` · ${row.message_type || 'message'}${media}`;
  });

  // Oldest unresolved failure drives escalation. A failed event is terminal, so
  // this backlog only shrinks when a human resolves it or a retry succeeds.
  const ages = rows
    .map((r) => minutesBetween(nowMs, toMs(r.received_at)))
    .filter((m) => m !== null && m >= 0);
  const oldestDays = ages.length ? Math.floor(Math.max(...ages) / 1440) : 0;
  const escalated = escalateAfterDays !== null
    && escalateAfterDays !== undefined
    && oldestDays >= escalateAfterDays;

  const noun = `message event${rows.length === 1 ? '' : 's'}`;
  return condition({
    key: OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED,
    severity: escalated ? 'critical' : 'high',
    count: rows.length,
    title: escalated
      ? `${rows.length} ${noun} failed and unresolved for ${oldestDays} day${oldestDays === 1 ? '' : 's'}`
      : `${rows.length} inbound/outbound ${noun} failed`,
    details,
    meta: { ids: rows.map((r) => r.id).filter(Boolean), oldest_days: oldestDays, escalated },
    // Escalation is part of the identity: crossing the threshold is genuinely
    // new information, so it must re-alert rather than be suppressed as a repeat.
    classes: [...rows.map((r) => r.error_code || 'unknown'), escalated ? 'escalated' : 'normal'],
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
    classes: stuck.map((r) => r.error_code || r.message_type || 'stuck'),
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
    .map(([name, entry]) => {
      const summary = summarizeWorkerError(entry.sample);
      return `${name} ×${entry.count}` + (summary ? ` · ${summary}` : '');
    });

  return condition({
    key: OPS_HEALTH_CONDITIONS.WORKER_ERRORS,
    severity: 'medium',
    count: recent.length,
    title: `${recent.length} worker error${recent.length === 1 ? '' : 's'} in the last ${windowMinutes} min`,
    details,
    meta: { workers: Object.fromEntries(Array.from(byWorker, ([k, v]) => [k, v.count])) },
    classes: Array.from(byWorker.keys()),
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
    classes: stale.map((r) => r.automation_key || 'unknown automation'),
  });
}

// ─── SECTION: The QBO payment pipeline checks ──────────────

/**
 * Watch the watcher of the money path. qbo-payments-sync is the hourly sweep
 * that catches QuickBooks payments the webhook failed to deliver — and its
 * worker_runs rows are honest telemetry, but the Aug 3–5 outage proved that
 * telemetry nobody reads is invisibility with extra steps. Three signals:
 * the sweep failing run after run, the sweep catching payments the webhook
 * missed (webhook down), and the sweep not running at all (cron dead).
 *
 * `runs` is that one worker's run history, newest first (re-sorted here so a
 * mis-ordered caller cannot make the streak read the oldest runs). Pass null —
 * not [] — when the probe could not run: an EMPTY history legitimately means
 * "the sweep has never fired", which is itself the third alert.
 */
function checkQboPaymentPipeline(runs, nowMs, { streakRuns, staleMinutes }) {
  if (!Array.isArray(runs)) return [];
  const ordered = [...runs].sort(
    (a, b) => (toMs(b.started_at) ?? -1) - (toMs(a.started_at) ?? -1),
  );
  const conditions = [];

  // 1. Every recent sweep errored. One failure is a blip; a streak means
  //    QuickBooks payments are not being swept at all.
  let streak = 0;
  for (const run of ordered) {
    if (run.status !== 'error') break;
    streak += 1;
  }
  if (streak >= streakRuns) {
    // Reviewed content boundary: qbo-payments-sync error strings are built from
    // fixed receipt RPC error codes (ALLOCATION_SUM_MISMATCH, …), static
    // receiptSyncError() sentences, and "payment <id>: <message>" prefixes —
    // never the raw payment/customer snapshot — and ops.health reaches the
    // admin-only audience. A change to that worker's error paths must preserve
    // this invariant before this summary may keep flowing into alert copy.
    const latestError = summarizeWorkerError(ordered[0].error_message);
    conditions.push(condition({
      key: OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING,
      severity: 'high',
      count: streak,
      title: `QuickBooks payment sync is failing (${streak} runs in a row)`,
      details: [
        `QuickBooks payments may not be syncing — the safety-net sweep has failed ${streak} runs in a row.`,
        ...(latestError ? [`Latest error: ${latestError}`] : []),
      ],
      meta: { streak, latest_error: latestError },
      // Escalation is part of the identity: a longer streak is a NEW incident
      // and must re-alert rather than be suppressed as a same-day repeat. The
      // streak is a low-cardinality integer, safe to fingerprint; the error
      // TEXT deliberately stays out so wording changes never re-page.
      classes: ['error_streak', String(streak)],
    }));
  }

  // 2. The sweep succeeded but had to record payments itself — payments the
  //    webhook should have delivered instantly and did not. webhook_missed
  //    counts only what THAT sweep newly wrote (webhook-delivered payments
  //    come back as already-synced), so any positive number means the webhook
  //    is dropping deliveries.
  const lastCompleted = ordered.find((run) => run.status === 'completed');
  const missed = Number(lastCompleted?.meta?.webhook_missed) || 0;
  if (missed > 0) {
    conditions.push(condition({
      key: OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN,
      severity: 'high',
      count: missed,
      title: 'QuickBooks webhook appears down',
      details: [
        `The hourly safety net caught ${missed} QuickBooks payment${missed === 1 ? '' : 's'} the webhook never delivered.`,
        'The money is recorded, but payments are arriving up to an hour late — the QuickBooks webhook needs attention.',
      ],
      meta: { webhook_missed: missed, completed_run_at: lastCompleted.started_at || null },
      // A different missed count is a different incident (1 at 8am, then 5 at
      // 2pm must both page) — magnitude belongs in the fingerprint.
      classes: ['webhook_missed', String(missed)],
    }));
  }

  // 3. No run at all — the hourly schedule died, so nobody is even checking
  //    for missed payments anymore. The silent-failure class: a stopped cron
  //    writes no error row anywhere, which is exactly why this check exists.
  const quietFor = minutesBetween(nowMs, ordered.length ? toMs(ordered[0].started_at) : null);
  if (!ordered.length || quietFor === null || quietFor > staleMinutes) {
    const hours = quietFor === null ? null : Math.round(quietFor / 60);
    conditions.push(condition({
      key: OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE,
      severity: 'critical',
      count: 1,
      title: 'QuickBooks payment sweep has stopped running',
      details: [
        hours === null
          ? 'The hourly QuickBooks payment sweep has no run on record at all.'
          : `The hourly QuickBooks payment sweep last ran about ${hours} hour${hours === 1 ? '' : 's'} ago.`,
        'Until it runs again, a payment the webhook misses will go unnoticed.',
      ],
      meta: {
        last_run_at: ordered[0]?.started_at || null,
        quiet_minutes: quietFor === null ? null : Math.round(quietFor),
      },
      // Deliberately constant: staleness grows continuously, so folding the
      // age in would re-page every run. A dead cron pages once per day.
      classes: ['stale'],
    }));
  }

  return conditions;
}

// ─── SECTION: Entry point ──────────────

/**
 * Evaluate every condition against supplied fixtures.
 * Pure: no I/O, no clock read (caller supplies `now`).
 *
 * @param {{
 *   now: string|number|Date,
 *   failedEvents?: object[],
 *   retryableEvents?: object[],
 *   workerErrors?: object[],
 *   claims?: object[],
 *   qboSyncRuns?: object[]|null,
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
  // null (the default) means "no runs feed supplied / probe failed" and skips
  // the pipeline checks entirely; [] means "the sweep has never run", which is
  // itself an alert. The two must never be conflated.
  qboSyncRuns = null,
  thresholds = {},
} = {}) {
  const t = { ...DEFAULT_OPS_HEALTH_THRESHOLDS, ...thresholds };
  const nowMs = toMs(now) ?? Date.now();

  const conditions = [
    checkFailedProviderEvents(failedEvents || [], nowMs, t.failedBacklogEscalateDays),
    checkStuckProviderEvents(retryableEvents || [], nowMs, t.stuckRetryableMinutes),
    checkWorkerErrors(workerErrors || [], nowMs, {
      windowMinutes: t.workerErrorWindowMinutes,
      minCount: t.workerErrorMinCount,
    }),
    checkUnfinalizedClaims(claims || [], nowMs, t.claimUnfinalizedMinutes),
    ...checkQboPaymentPipeline(qboSyncRuns, nowMs, {
      streakRuns: t.qboSyncErrorStreakRuns,
      staleMinutes: t.qboSyncStaleMinutes,
    }),
  ].filter(Boolean);

  return { checkedAt: new Date(nowMs).toISOString(), conditions };
}
