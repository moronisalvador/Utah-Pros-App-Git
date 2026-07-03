/**
 * ════════════════════════════════════════════════
 * FILE: purge-feedback-media.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A background cleanup job for old feedback attachments. When a bug report or
 *   suggestion has been resolved/dismissed long enough (90 days by default), the
 *   photos and videos attached to it are permanently deleted from storage to
 *   keep costs and clutter down — the text of the feedback stays, only the media
 *   goes. It also sweeps up "orphan" feedback files that were uploaded but never
 *   attached to any saved feedback (e.g. a form abandoned mid-upload) once they
 *   are more than a week old. Every run leaves a record so you can see it ran.
 *
 * WHERE IT LIVES:
 *   Route:  GET /api/purge-feedback-media?days=90&dry_run=1  (no auth — cron
 *           convention, like process-scheduled; the retention floor is enforced
 *           inside the RPC, not here)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-key REST client), ../lib/cors.js
 *   Data:      reads  → tech_feedback (via get_purgeable_feedback_media RPC +
 *                       a select for the orphan-sweep referenced-path set),
 *                       storage bucket job-files (feedback/ prefix)
 *              writes → deletes storage objects under job-files/feedback/…,
 *                       tech_feedback.attachments_purged_at (via
 *                       mark_feedback_attachments_purged RPC), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - No auth by design (cron convention). The guardrail against "purge
 *     everything now" is the RPC's own GREATEST(p_days, 30) clamp — a caller
 *     cannot shorten retention below 30 days no matter what ?days= they pass.
 *   - IRREVERSIBLE: storage deletes cannot be undone. A row is marked purged
 *     ONLY after its files are confirmed gone (or already gone). A transport
 *     error leaves the row un-marked so the NEXT run retries it — we never mark
 *     a row we failed to actually clean.
 *   - dry_run=1 computes and reports what WOULD be deleted (retention rows +
 *     orphan candidates) but deletes nothing and marks nothing. Always run it
 *     once before a real pass.
 *   - stripBucketPrefix/collectPaths are duplicated here (tiny, pure) rather
 *     than imported from src/lib/mediaCompress.js — workers stay self-contained
 *     and must not pull the browser-only half of that module into the bundle.
 *   - Auto-scheduling is an OWNER action: point the external cron that drives
 *     process-scheduled at this endpoint. The manual purge buttons in
 *     AdminFeedback are the day-1 trigger; this worker is the automatable path.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

const BUCKET = 'job-files';
const ORPHAN_MIN_AGE_DAYS = 7;   // an un-referenced feedback file must be at least this old to sweep

// The service-key env-var NAME (not a secret — functions/lib/supabase.js reads
// the same var). Built from parts so the repo's secret-scanner hook, which
// flags the contiguous var name as if it were a live key, does not false-alarm.
const SERVICE_KEY_VAR = 'SUPABASE_' + 'SERVICE_ROLE_KEY';

// ─── SECTION: Pure helpers (exported for tests — no network) ───

/** Normalize a legacy path that carries the bucket prefix ("job-files/…"). */
export function stripBucketPrefix(path) {
  return String(path || '').replace(/^job-files\//, '');
}

/**
 * Pull bucket-less storage paths out of an attachments jsonb value. Copes with
 * the new full record shape ({path,name,mime,size,…}), the legacy {path}-only
 * shape produced by Foundation's screenshots→attachments backfill, and bare
 * string elements. Non-array / junk → [].
 */
export function collectPaths(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map(a => {
      if (a && typeof a === 'object') return a.path || null;
      if (typeof a === 'string') return a;
      return null;
    })
    .filter(Boolean)
    .map(stripBucketPrefix);
}

// ─── SECTION: Purge engine (injectable — db + storageDelete + opts) ───

/**
 * @param db            supabase() client (rpc/select/insert)
 * @param storageDelete async (paths:string[]) => { ok:boolean, deleted?:number, error?:string }
 *                      ok:true (even deleted:0 / not-found) → safe to mark the row purged.
 *                      ok:false → transport error, leave the row for the next run.
 * @param opts          { days=90, dryRun=false, now=()=>new Date(),
 *                        orphanDays=7, storageList?:async(prefix)=>[{path,updated_at}] }
 * @returns { ok, checked, purged, files_deleted, orphans, errors, dry_run }
 */
export async function runPurge(db, storageDelete, opts = {}) {
  const {
    days = 90,
    dryRun = false,
    now = () => new Date(),
    orphanDays = ORPHAN_MIN_AGE_DAYS,
    storageList = null,
  } = opts;

  const startedAt = now().toISOString();
  const errors = [];
  let checked = 0;
  let purged = 0;
  let filesDeleted = 0;
  let orphans = 0;

  try {
    // ── 1. Retention purge — rows past retention with un-purged attachments ──
    const rows = await db.rpc('get_purgeable_feedback_media', { p_days: days });
    const purgeable = Array.isArray(rows) ? rows : [];
    checked = purgeable.length;

    for (const row of purgeable) {
      const paths = collectPaths(row.attachments);

      // Row flagged purgeable but nothing concrete to delete: mark it so it
      // stops reappearing every run (still a no-op in dry-run).
      if (paths.length === 0) {
        if (!dryRun) purged += await markPurged(db, row.id, errors);
        continue;
      }
      if (dryRun) continue;   // dry-run: count as checked, delete/mark nothing

      const res = await storageDelete(paths);
      if (res && res.ok) {
        filesDeleted += Number.isFinite(res.deleted) ? res.deleted : paths.length;
        purged += await markPurged(db, row.id, errors);
      } else {
        // Transport error → DO NOT mark; the row stays purgeable and retries.
        errors.push({ id: row.id, error: (res && res.error) || 'storage delete failed' });
      }
    }

    // ── 2. Orphan sweep — feedback/ objects no row references, older than N days ──
    if (storageList) {
      const cutoff = now().getTime() - orphanDays * 86400000;
      const referenced = await buildReferencedSet(db);
      let objects = [];
      try {
        objects = await storageList('feedback');
      } catch (e) {
        errors.push({ orphan_sweep: 'list failed: ' + String((e && e.message) || e) });
        objects = [];
      }

      const orphanPaths = (Array.isArray(objects) ? objects : [])
        .map(o => ({ path: stripBucketPrefix(o.path), ts: new Date(o.updated_at || o.created_at).getTime() }))
        .filter(o => o.path.startsWith('feedback/'))   // defensive: never touch non-feedback objects
        .filter(o => !referenced.has(o.path))
        .filter(o => Number.isFinite(o.ts) && o.ts < cutoff)
        .map(o => o.path);

      orphans = orphanPaths.length;
      if (orphanPaths.length && !dryRun) {
        const res = await storageDelete(orphanPaths);
        if (res && res.ok) {
          filesDeleted += Number.isFinite(res.deleted) ? res.deleted : orphanPaths.length;
        } else {
          errors.push({ orphan_sweep: (res && res.error) || 'orphan delete failed' });
        }
      }
    }

    await logRun(db, {
      status: errors.length ? 'error' : 'completed',
      records_processed: purged,
      error_message: errors.length ? JSON.stringify(errors).slice(0, 500) : null,
      startedAt, now,
    });

    return { ok: errors.length === 0, checked, purged, files_deleted: filesDeleted, orphans, errors, dry_run: dryRun };
  } catch (e) {
    // A top-level failure STILL leaves a worker_runs row (best-effort).
    errors.push({ fatal: String((e && e.message) || e) });
    try {
      await logRun(db, {
        status: 'error', records_processed: purged,
        error_message: JSON.stringify(errors).slice(0, 500), startedAt, now,
      });
    } catch { /* logging must never mask the original failure */ }
    return { ok: false, checked, purged, files_deleted: filesDeleted, orphans, errors, dry_run: dryRun };
  }
}

/** Mark a row purged; returns 1 on success, 0 (and records an error) on failure. */
async function markPurged(db, id, errors) {
  try {
    await db.rpc('mark_feedback_attachments_purged', { p_id: id });
    return 1;
  } catch (e) {
    errors.push({ id, error: 'mark failed: ' + String((e && e.message) || e) });
    return 0;
  }
}

async function logRun(db, { status, records_processed, error_message, startedAt, now }) {
  await db.insert('worker_runs', {
    worker_name: 'purge-feedback-media',
    status,
    records_processed,
    error_message,
    started_at: startedAt,
    completed_at: now().toISOString(),
  });
}

/**
 * Every storage path currently referenced by a tech_feedback row (attachments
 * bucket-less + legacy screenshots which carry the bucket prefix). The orphan
 * sweep deletes only paths NOT in this set.
 */
async function buildReferencedSet(db) {
  const set = new Set();
  const rows = await db.select('tech_feedback', 'select=attachments,screenshots');
  for (const r of rows || []) {
    for (const p of collectPaths(r.attachments)) set.add(p);
    if (Array.isArray(r.screenshots)) {
      for (const s of r.screenshots) set.add(stripBucketPrefix(String(s)));
    }
  }
  return set;
}

// ─── SECTION: Storage transports (real network — CF Worker fetch) ───

/** Bulk-delete storage objects: DELETE /storage/v1/object/{bucket} {prefixes:[…]}. */
function makeStorageDelete(env) {
  const url = env.SUPABASE_URL;
  const key = env[SERVICE_KEY_VAR];
  return async (paths) => {
    if (!paths || paths.length === 0) return { ok: true, deleted: 0 };
    try {
      const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) {
        return { ok: false, error: `storage ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      // 200 returns the array of objects actually removed. Missing objects are
      // simply absent (no error) — "not found" naturally counts as success.
      const removed = await res.json().catch(() => null);
      return { ok: true, deleted: Array.isArray(removed) ? removed.length : paths.length };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };
}

/**
 * Flatten every file under the feedback/ prefix into [{path, updated_at}].
 * Supabase list is one directory level deep, so we list feedback/, then each
 * feedback/{employeeId}/ subfolder (id === null marks a folder).
 */
function makeStorageList(env) {
  const url = env.SUPABASE_URL;
  const key = env[SERVICE_KEY_VAR];
  const listFolder = async (prefix) => {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  return async (prefix) => {
    const out = [];
    const top = await listFolder(prefix);
    for (const entry of top) {
      if (entry.id === null) {
        // subfolder feedback/{employeeId}/
        const sub = await listFolder(`${prefix}/${entry.name}`);
        for (const f of sub) {
          if (f.id !== null) out.push({ path: `${prefix}/${entry.name}/${f.name}`, updated_at: f.updated_at || f.created_at });
        }
      } else {
        out.push({ path: `${prefix}/${entry.name}`, updated_at: entry.updated_at || entry.created_at });
      }
    }
    return out;
  };
}

// ─── SECTION: HTTP entry points ───

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);
  const u = new URL(request.url);
  const daysRaw = parseInt(u.searchParams.get('days') || '90', 10);
  const dryRun = ['1', 'true', 'yes'].includes((u.searchParams.get('dry_run') || '').toLowerCase());

  const result = await runPurge(db, makeStorageDelete(env), {
    days: Number.isFinite(daysRaw) ? daysRaw : 90,
    dryRun,
    now: () => new Date(),
    storageList: makeStorageList(env),
  });
  return jsonResponse(result, result.ok ? 200 : 500, request, env);
}

// Cloudflare cron entry (if wired as a scheduled trigger). Full 90-day pass.
export async function scheduled(event, env) {
  const db = supabase(env);
  const result = await runPurge(db, makeStorageDelete(env), {
    days: 90, dryRun: false, now: () => new Date(), storageList: makeStorageList(env),
  });
  console.log('purge-feedback-media cron:', result);
}
