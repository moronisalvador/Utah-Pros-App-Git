#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════
 * FILE: delete-orphaned-esign-objects.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Finds signed PDFs left behind in the public `job-files` bucket that nothing
 *   in the app points at any more — no document row, no signing record — and,
 *   when told to, deletes them. These are leftovers from jobs that were deleted
 *   after the document was signed. They are the last signed documents sitting
 *   somewhere a stranger could read.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only (global fetch, Node 18+)
 *   Data:      reads  → Storage `job-files`, public.job_documents,
 *                       public.sign_requests
 *              writes → deletes Storage objects, and ONLY with --apply
 *
 * USAGE:
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<the production service-role key>
 *   node scripts/delete-orphaned-esign-objects.mjs            # list only
 *   node scripts/delete-orphaned-esign-objects.mjs --apply    # delete them
 *
 * NOTES / GOTCHAS:
 *   - DELETION IS NOT REVERSIBLE. Unlike the bucket move, there is no copy left
 *     anywhere afterwards. That is why the default lists and does nothing, and
 *     why every candidate is re-checked against the database immediately before
 *     its delete rather than trusting the list built at the start.
 *   - "ORPHAN" IS DERIVED, NEVER TYPED IN. The candidates are recomputed from
 *     live data on every run. Three were found on 2026-08-19; that number is not
 *     written down here, because a hardcoded path list is how you delete the
 *     wrong file after the data moves underneath you.
 *   - IT REFUSES ANY OBJECT A ROW REFERENCES, in either direction: a
 *     job_documents.file_path match (bare OR `job-files/`-prefixed — the column
 *     holds both shapes) or a sign_requests.signed_file_path match. Both must be
 *     absent. A single reference anywhere means the app can still surface it and
 *     this is the wrong tool.
 *   - IT ONLY EVER LOOKS UNDER `<job>/esign/`. Job photos live in the same
 *     bucket and are Phase 2; nothing here can reach them.
 *   - It never prints the service-role key.
 * ════════════════════════════════════════════════
 */

const BUCKET = 'job-files';
const ESIGN_SEGMENT = 'esign';

const APPLY = process.argv.includes('--apply');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function die(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) die('SUPABASE_URL is not set.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set.');

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function req(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

async function list(prefix) {
  const res = await req('POST', `/storage/v1/object/list/${BUCKET}`, {
    prefix,
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (!res.ok) throw new Error(`list ${prefix || '/'}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/** A folder entry from Storage list has no id; a real object has one. */
const isFolder = (row) => !row?.id;

/**
 * Is this object referenced by anything in the app? Checked live, immediately
 * before deletion — not from the sweep that built the candidate list.
 */
async function isReferenced(key) {
  const both = `("${key}","job-files/${key}")`;
  const docs = await req(
    'GET',
    `/rest/v1/job_documents?file_path=in.${encodeURIComponent(both)}&select=id&limit=1`,
  );
  if (!docs.ok) throw new Error(`job_documents check ${key}: ${docs.status}`);
  if ((await docs.json()).length) return 'job_documents';

  const signs = await req(
    'GET',
    `/rest/v1/sign_requests?signed_file_path=in.${encodeURIComponent(both)}&select=id&limit=1`,
  );
  if (!signs.ok) throw new Error(`sign_requests check ${key}: ${signs.status}`);
  if ((await signs.json()).length) return 'sign_requests';

  return null;
}

async function main() {
  console.log(`\n  Orphaned e-sign object sweep — ${APPLY ? 'APPLY (deletes)' : 'LIST ONLY'}`);
  console.log(`  ${SUPABASE_URL}  bucket ${BUCKET}\n`);

  // Walk <job>/esign/ only. Job photos share this bucket and are out of scope.
  const jobFolders = (await list('')).filter(isFolder);
  const candidates = [];
  for (const folder of jobFolders) {
    let entries;
    try {
      entries = await list(`${folder.name}/${ESIGN_SEGMENT}`);
    } catch {
      continue; // no esign/ folder under this job
    }
    for (const entry of entries) {
      if (isFolder(entry)) continue;
      candidates.push({
        key: `${folder.name}/${ESIGN_SEGMENT}/${entry.name}`,
        bytes: entry?.metadata?.size ?? null,
      });
    }
  }

  console.log(`  ${candidates.length} e-sign object(s) still in the PUBLIC bucket.`);

  const orphans = [];
  for (const c of candidates) {
    const ref = await isReferenced(c.key);
    if (ref) continue;
    orphans.push(c);
  }

  const referenced = candidates.length - orphans.length;
  console.log(`  ${referenced} referenced by a row (left alone).`);
  console.log(`  ${orphans.length} orphaned — nothing in the app points at these.\n`);

  if (!orphans.length) {
    console.log('  Nothing to delete.\n');
    return;
  }

  for (const o of orphans) {
    console.log(`    ${o.bytes === null ? '?' : String(o.bytes).padStart(7)} B  ${o.key}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('  Listed only. Re-run with --apply to DELETE these permanently.\n');
    return;
  }

  let deleted = 0;
  for (const o of orphans) {
    // Re-check immediately before deleting. The sweep above may have taken a
    // while, and this is the irreversible step.
    const ref = await isReferenced(o.key);
    if (ref) {
      console.log(`    skipped ${o.key} — now referenced by ${ref}`);
      continue;
    }
    const res = await req('DELETE', `/storage/v1/object/${BUCKET}/${encodeURI(o.key)}`);
    if (!res.ok && res.status !== 404) {
      console.error(`\n    ✖ ${o.key}: ${res.status} ${await res.text()}`);
      die('Stopped at the first failure. Everything before this point is already deleted.');
    }
    deleted += 1;
    console.log(`    deleted ${o.key}`);
  }

  console.log(`\n  Done. deleted=${deleted}`);
  console.log('  Re-run without --apply; it should report 0 orphaned.\n');
}

main().catch((error) => die(error.message));
