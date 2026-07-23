/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/worker-runs.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One shared way for the scheduled/webhook workers to write a "this ran" record
 *   into the worker_runs table — when it started, when it finished, whether it
 *   succeeded, how many things it processed, and any error. Before this, ~31
 *   workers each hand-wrote that insert slightly differently; this replaces those
 *   copies with one helper so the log rows are consistent and telemetry never
 *   crashes a worker (the write is best-effort).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none. Callers pass in their own supabase() service-role client.
 *   Data:      writes → worker_runs (best-effort insert; a failure is swallowed)
 *
 * EXPORTS:
 *   recordWorkerRun(db, { workerName, status, recordsProcessed, errorMessage,
 *                         startedAt, completedAt, meta, payload }) → Promise<void>
 *   withRunRecording(db, workerName, fn) → Promise<any>
 *     Runs fn(); on success records a 'completed' row (fn may return
 *     { recordsProcessed, meta } to enrich it); on throw records an 'error' row
 *     and re-throws.
 *   startWorkerRun(db, workerName) → Promise<string|null>
 *   finishWorkerRun(db, runId, patch) → Promise<void>
 *
 * NOTES / GOTCHAS:
 *   - The insert is wrapped in try/catch and never throws — telemetry must not
 *     take down the work it is recording.
 *   - `meta` / `payload` are optional jsonb columns; omit them for the common case.
 *   - error_message is truncated to 500 chars to match the hand-rolled inserts.
 * ════════════════════════════════════════════════
 */

/**
 * Insert one worker_runs row. Best-effort — never throws.
 * @param {object} db - supabase() service-role client (db.insert).
 * @param {{
 *   workerName: string, status: string, recordsProcessed?: number,
 *   errorMessage?: string|null, startedAt?: string, completedAt?: string,
 *   meta?: object, payload?: object
 * }} opts
 */
export async function recordWorkerRun(db, {
  workerName,
  status,
  recordsProcessed = 0,
  errorMessage = null,
  startedAt = new Date().toISOString(),
  completedAt = new Date().toISOString(),
  meta,
  payload,
} = {}) {
  try {
    const row = {
      worker_name: workerName,
      status,
      records_processed: recordsProcessed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt,
      completed_at: completedAt,
    };
    if (meta !== undefined) row.meta = meta;
    if (payload !== undefined) row.payload = payload;
    await db.insert('worker_runs', row);
  } catch {
    /* telemetry is best-effort — a logging failure must not fail the worker */
  }
}

export async function startWorkerRun(db, workerName) {
  try {
    const rows = await db.insert('worker_runs', {
      worker_name: workerName,
      status: 'started',
      started_at: new Date().toISOString(),
    });
    return rows?.[0]?.id || null;
  } catch {
    return null;
  }
}

export async function finishWorkerRun(db, runId, patch) {
  if (!runId) return;
  try {
    await db.update('worker_runs', `id=eq.${runId}`, patch);
  } catch {
    /* telemetry is best-effort — a logging failure must not fail the worker */
  }
}

/**
 * Wrap a unit of work so start/finish are recorded automatically. Records a
 * 'completed' row on success and an 'error' row (then re-throws) on failure.
 * The wrapped fn may return `{ recordsProcessed, meta }` to enrich the row.
 * @param {object} db
 * @param {string} workerName
 * @param {() => Promise<{recordsProcessed?:number, meta?:object}|any>} fn
 * @returns {Promise<any>} whatever fn returned
 */
export async function withRunRecording(db, workerName, fn) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    await recordWorkerRun(db, {
      workerName,
      status: 'completed',
      recordsProcessed: result?.recordsProcessed ?? 0,
      meta: result?.meta,
      startedAt,
    });
    return result;
  } catch (err) {
    await recordWorkerRun(db, {
      workerName,
      status: 'error',
      errorMessage: err?.message || String(err),
      startedAt,
    });
    throw err;
  }
}
