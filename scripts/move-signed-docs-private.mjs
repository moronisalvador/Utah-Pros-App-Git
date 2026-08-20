#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════
 * FILE: move-signed-docs-private.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Moves the signed customer authorization PDFs out of the public `job-files`
 *   bucket, where anyone holding the path can read them, into the private
 *   `job-documents-private` bucket, where only a signed-in UPR employee can.
 *   It does one document at a time and records the new home for each one before
 *   moving on, so the Files and Documents screens keep working the whole way
 *   through — and so a run that stops halfway can simply be run again.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only (global fetch, Node 18+)
 *   Internal:  nothing — it talks to Supabase over HTTP so it can be run from
 *              anywhere, including a machine that has never checked out this repo
 *   Data:      reads  → public.job_documents, Storage `job-files`
 *              writes → Storage `job-documents-private` (copy), then
 *                       public.job_documents.storage_bucket, then
 *                       Storage `job-files` (delete of the now-unreferenced copy)
 *
 * USAGE:
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<the production service-role key>
 *   node scripts/move-signed-docs-private.mjs            # dry run — plan only
 *   node scripts/move-signed-docs-private.mjs --apply    # do it
 *   node scripts/move-signed-docs-private.mjs --verify   # report state, change nothing
 *
 * NOTES / GOTCHAS:
 *   - IT NEVER PRINTS THE KEY, and it never writes it anywhere. Pass it by
 *     environment variable only; do not put it on the command line, where it
 *     lands in your shell history.
 *   - DRY RUN IS THE DEFAULT. Nothing mutates without --apply.
 *   - THE ORDER PER DOCUMENT IS LOAD-BEARING: copy → verify → flip the row →
 *     delete the public copy. `storage_bucket` is what tells the app which
 *     bucket to read (src/lib/storageUrl.js `bucketFor`), so at every single
 *     intermediate point the row and the object agree and the document opens.
 *     Deleting before flipping the row would 404 the document; flipping before
 *     copying would 404 it too. Roadmap R6 requires per-object sequencing for
 *     exactly this reason; this goes one step further than the `move` it
 *     describes, because `move` leaves a brief window where the row still says
 *     `job-files` and the object is already gone.
 *   - IT IS RESUMABLE AND IDEMPOTENT. Each document is classified from live
 *     state, not from a checkpoint file, so an interrupted run — or a second run
 *     for peace of mind — converges instead of double-acting.
 *   - AN INTERRUPTED RUN CAN LEAVE A PUBLIC ORPHAN: a row already flipped to
 *     private whose public copy was not deleted yet. That file is still publicly
 *     readable, which is the whole thing we are closing, so the classifier looks
 *     for it explicitly and a later run sweeps it. This is why "it looked like it
 *     finished" is not good enough — run --verify until it reports zero.
 *   - SCOPE IS THE E-SIGN SET ONLY (`sign_request_id IS NOT NULL`). Job photos
 *     are Phase 2 and a different argument; this refuses to touch them.
 *   - It reads the move set from a live query every time. Do not turn the count
 *     into a constant — the roadmap's §1.1 exists because those numbers drift.
 * ════════════════════════════════════════════════
 */

const PUBLIC_BUCKET = 'job-files';
const PRIVATE_BUCKET = 'job-documents-private';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERIFY_ONLY = args.has('--verify');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ─── SECTION: Helpers ──────────────

function die(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) die('SUPABASE_URL is not set.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set.');
if (APPLY && VERIFY_ONLY) die('Pass --apply or --verify, not both.');

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

/** The storage key, tolerating the legacy `job-files/`-prefixed shape. */
const storageKey = (filePath) => String(filePath || '').replace(/^job-files\//, '');

async function req(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      ...authHeaders,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

/**
 * Does the object exist in this bucket? Returns its size in bytes, or null.
 *
 * Uses the LIST endpoint rather than a HEAD on the download path. The repo's
 * own downloadStorage() proves GET works there, but nothing proves HEAD is
 * routed, and an unrouted HEAD would look exactly like a missing file — which
 * would silently reclassify every document as "missing" and halt the run for
 * the wrong reason. list is the documented metadata call and returns the size
 * without transferring the PDF.
 */
async function objectSize(bucket, key) {
  const slash = key.lastIndexOf('/');
  const prefix = slash === -1 ? '' : key.slice(0, slash);
  const base = slash === -1 ? key : key.slice(slash + 1);
  const res = await req('POST', `/storage/v1/object/list/${bucket}`, {
    body: { prefix, search: base, limit: 100 },
  });
  if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  // `search` is a substring filter, so match the name exactly.
  const hit = (Array.isArray(rows) ? rows : []).find((r) => r?.name === base);
  if (!hit) return null;
  const size = hit?.metadata?.size;
  return Number.isFinite(size) ? size : -1;
}

async function copyObject(key) {
  const res = await req('POST', '/storage/v1/object/copy', {
    body: {
      bucketId: PUBLIC_BUCKET,
      sourceKey: key,
      destinationBucket: PRIVATE_BUCKET,
      destinationKey: key,
    },
  });
  if (!res.ok) throw new Error(`copy ${key}: ${res.status} ${await res.text()}`);
}

async function deleteObject(bucket, key) {
  const res = await req('DELETE', `/storage/v1/object/${bucket}/${encodeURI(key)}`);
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete ${bucket}/${key}: ${res.status} ${await res.text()}`);
  }
}

async function setRowBucket(id) {
  const res = await req('PATCH', `/rest/v1/job_documents?id=eq.${id}`, {
    body: { storage_bucket: PRIVATE_BUCKET },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) throw new Error(`patch ${id}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!rows?.[0] || rows[0].storage_bucket !== PRIVATE_BUCKET) {
    throw new Error(`patch ${id}: row did not come back marked private`);
  }
}

async function loadMoveSet() {
  const res = await req(
    'GET',
    '/rest/v1/job_documents' +
      '?sign_request_id=not.is.null' +
      '&select=id,file_path,storage_bucket,name' +
      '&order=created_at.asc',
  );
  if (!res.ok) throw new Error(`load move set: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── SECTION: Per-document state ──────────────

/**
 * Classify one document from LIVE state. Every branch is derived, never
 * remembered, which is what makes an interrupted run safe to repeat.
 */
async function classify(doc) {
  const key = storageKey(doc.file_path);
  const [pub, priv] = await Promise.all([
    objectSize(PUBLIC_BUCKET, key),
    objectSize(PRIVATE_BUCKET, key),
  ]);
  const isPrivate = doc.storage_bucket === PRIVATE_BUCKET;

  if (isPrivate && pub === null && priv !== null) return { key, state: 'done', pub, priv };
  if (isPrivate && pub !== null) return { key, state: 'orphan-public', pub, priv };
  if (!isPrivate && priv !== null && pub !== null) return { key, state: 'copied-not-flipped', pub, priv };
  if (!isPrivate && priv === null && pub !== null) return { key, state: 'todo', pub, priv };
  if (!isPrivate && priv !== null && pub === null) return { key, state: 'moved-not-flipped', pub, priv };
  return { key, state: 'missing', pub, priv };
}

const LABEL = {
  done: 'already private, public copy gone',
  'orphan-public': 'row is private but a PUBLIC COPY REMAINS — needs sweeping',
  'copied-not-flipped': 'copied, row not yet flipped',
  'moved-not-flipped': 'object private but row still says public — WILL 404 until flipped',
  todo: 'public only — to move',
  missing: 'NOT FOUND IN EITHER BUCKET — investigate, do not guess',
};

// ─── SECTION: Main ──────────────

async function main() {
  const mode = APPLY ? 'APPLY' : VERIFY_ONLY ? 'VERIFY' : 'DRY RUN';
  console.log(`\n  Signed-document privacy move — ${mode}`);
  console.log(`  ${SUPABASE_URL}`);
  console.log(`  ${PUBLIC_BUCKET} (public)  →  ${PRIVATE_BUCKET} (private)\n`);

  const docs = await loadMoveSet();
  if (!docs.length) die('The move set is empty. That is unexpected — check the query, not the data.');

  const classified = [];
  for (const doc of docs) classified.push({ doc, ...(await classify(doc)) });

  const byState = {};
  for (const c of classified) (byState[c.state] ||= []).push(c);

  console.log(`  ${docs.length} e-sign document(s) in scope:\n`);
  for (const [state, list] of Object.entries(byState)) {
    console.log(`    ${String(list.length).padStart(4)}  ${state.padEnd(20)} ${LABEL[state]}`);
  }
  console.log('');

  if (byState.missing?.length) {
    for (const c of byState.missing) console.error(`    missing: ${c.doc.id}  ${c.key}`);
    die(
      `${byState.missing.length} document(s) are in neither bucket. Stopping before ANY change — ` +
        'a mover is the wrong tool for a file that is already gone.',
    );
  }

  const actionable = classified.filter((c) => c.state !== 'done');
  if (!actionable.length) {
    console.log('  Nothing to do — every signed document is private and no public copy remains.\n');
    return;
  }

  if (!APPLY) {
    console.log(`  ${actionable.length} document(s) would be acted on. Re-run with --apply to do it.\n`);
    if (VERIFY_ONLY) process.exitCode = 1; // so a CI/cron check can notice
    return;
  }

  let moved = 0;
  let swept = 0;
  let flipped = 0;
  for (const c of actionable) {
    const { doc, key, state } = c;
    try {
      if (state === 'todo') {
        await copyObject(key);
        const size = await objectSize(PRIVATE_BUCKET, key);
        if (size === null) throw new Error('copy reported success but the object is not there');
        if (c.pub >= 0 && size >= 0 && size !== c.pub) {
          throw new Error(`size mismatch: public ${c.pub} vs private ${size}`);
        }
        await setRowBucket(doc.id);
        await deleteObject(PUBLIC_BUCKET, key);
        moved += 1;
        console.log(`    moved   ${key}`);
      } else if (state === 'copied-not-flipped' || state === 'moved-not-flipped') {
        await setRowBucket(doc.id);
        if (c.pub !== null) await deleteObject(PUBLIC_BUCKET, key);
        flipped += 1;
        console.log(`    flipped ${key}`);
      } else if (state === 'orphan-public') {
        await deleteObject(PUBLIC_BUCKET, key);
        swept += 1;
        console.log(`    swept   ${key}`);
      }
    } catch (error) {
      console.error(`\n    ✖ ${key}: ${error.message}`);
      die(
        'Stopped at the first failure, deliberately. Everything before this point is complete and ' +
          'consistent; re-run to continue from here once the cause is understood.',
      );
    }
  }

  console.log(`\n  Done. moved=${moved} flipped=${flipped} swept=${swept}`);
  console.log('  Re-run with --verify; it must report every document as "done" before you');
  console.log(`  make ${PUBLIC_BUCKET} private.\n`);
}

main().catch((error) => die(error.message));
