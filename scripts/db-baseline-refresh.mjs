/**
 * ════════════════════════════════════════════════
 * FILE: db-baseline-refresh.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Takes a fresh copy of the real database's STRUCTURE — the list of tables,
 *   columns and rules, with none of the actual customer data — and saves it as
 *   the file the local database is built from. Run it when the local copy has
 *   fallen behind the real one. It only ever reads; it cannot change anything
 *   in production.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run db:baseline:refresh`
 *
 * DEPENDS ON:
 *   Packages:  node:child_process, node:fs, node:path, node:url
 *   Tools:     supabase CLI, authenticated (`supabase login`)
 *   Data:      reads  → the live project's schema catalog, via `supabase db dump`
 *              writes → db/baseline/schema.sql
 *
 * NOTES / GOTCHAS:
 *   - READ-ONLY against production. `db dump` issues no DDL and no DML. It is
 *     the same class of action as the read-only catalog inspection that
 *     database-standard.md §0 permits.
 *   - `--data-only` is never passed and is refused below. This file must never
 *     contain customer rows: it is committed to a public repository.
 *   - Runs NON-INTERACTIVELY when the machine is linked (`supabase link`
 *     stores the database password in the CLI's own config, so no prompt is
 *     needed). stdin is closed, so a genuinely-needed prompt fails fast with
 *     instructions instead of hanging; an agent never handles the password.
 *   - The dump is written to a temp path and only moved into place after the
 *     sanity checks below pass, so a failed or truncated dump cannot destroy a
 *     working baseline. On success the capture date in
 *     db/baseline/captured.json is stamped, which is what keeps the staleness
 *     warning honest.
 * ════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'db/baseline/schema.sql');
const TMP = `${TARGET}.tmp`;

// The shared production project (AGENTS.md §13).
const PROJECT_REF = process.env.UPR_BASELINE_PROJECT_REF || 'glsmljpabrwonfiltiqm';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

// `supabase db dump` has NO --project-ref flag. It connects straight to Postgres
// and takes its target from --linked, --local or --db-url. Linking is a one-time
// step that stores the database password in the CLI's own config; an agent must
// not handle that password, so this script requires the link to already exist
// rather than trying to create it.
const LINK_REF_FILE = path.join(ROOT, 'supabase/.temp/project-ref');
if (!existsSync(LINK_REF_FILE)) {
  console.error('\ndb-baseline-refresh: this project is not linked, so there is nothing to dump from.');
  console.error('\nRun this once — it will prompt for your database password:\n');
  console.error(`  npx supabase link --project-ref ${PROJECT_REF}\n`);
  console.error('Then re-run `npm run db:baseline:refresh`. The password is stored by the');
  console.error('Supabase CLI itself and is never read, echoed or committed by this script.');
  process.exit(1);
}

// NEVER capture this command's stdout. `db dump` writes its progress and its
// error recovery there, and swallowing that stream turns a working-but-slow run
// into something indistinguishable from a hang.
//
// Measured on this machine 2026-08-15: the first attempt resolves
// db.<ref>.supabase.co, which is IPv6-only. On a network without IPv6 that fails
// with "could not translate host name", and the CLI then prints a warning and
// RETRIES through the IPv4 pooler, which succeeds but is slower. All of that is
// stdout. With stdout piped, the terminal showed a bare cursor for minutes and
// looked frozen — it was actually working the whole time.
//
// So: use the CLI's own `--file` flag and inherit stdout/stderr. The schema
// goes to --file, never through a pipe.
//
// NON-INTERACTIVE FIRST (2026-08-20, owner asked why this was not automatic):
// `supabase link` stores the database password in the CLI's own config, so on a
// linked machine the dump normally needs NO prompt — verified by running it
// with stdin closed. So: always run with stdin closed. If the CLI genuinely
// needs input (an unlinked or cleared credential store), it fails fast instead
// of hanging, and the error below tells the human to run it in a terminal.
// An agent still never sees or types a password either way.
console.log('db-baseline-refresh: dumping SCHEMA ONLY from the linked project (read-only)');

if (existsSync(TMP)) unlinkSync(TMP);

try {
  sh('npx', ['supabase', 'db', 'dump', '--linked', '--schema', 'public', '--file', TMP], {
    stdio: ['ignore', 'inherit', 'inherit'], // stdin closed: no prompt can hang; progress stays visible
  });
} catch (e) {
  if (existsSync(TMP)) unlinkSync(TMP);
  console.error('\ndb-baseline-refresh: dump failed. Baseline left untouched.');
  console.error(String(e.stderr || e.message).trim().split('\n').slice(-6).join('\n'));
  console.error('\nIf the failure mentions a password or authentication: the stored link');
  console.error('credential is missing, so this once needs a human terminal:');
  console.error('  cd ~/Developer/upr && npx supabase link --project-ref ' + PROJECT_REF);
  console.error('then re-run `npm run db:baseline:refresh`. An agent must never type that password.');
  process.exit(1);
}

if (!existsSync(TMP)) {
  console.error('\ndb-baseline-refresh: the CLI reported success but wrote no file. Baseline left untouched.');
  process.exit(1);
}

const dump = readFileSync(TMP, 'utf8');

// ─── SECTION: sanity checks ──────────────
// A truncated or wrong-shaped dump must never overwrite a working baseline.
const problems = [];
if (!/CREATE TABLE/.test(dump)) problems.push('no CREATE TABLE found — dump looks empty or wrong');
if (dump.length < 200_000) problems.push(`suspiciously small (${dump.length} bytes; expected >200KB)`);
if (/^COPY .* FROM stdin;/m.test(dump)) problems.push('contains COPY data blocks — this must be SCHEMA ONLY, never customer rows');
if (/^INSERT INTO/m.test(dump)) problems.push('contains INSERT statements — this must be SCHEMA ONLY, never customer rows');

if (problems.length) {
  console.error('\ndb-baseline-refresh: REFUSING to write. Baseline left untouched:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const prev = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
const count = (s, re) => (s.match(re) || []).length;

renameSync(TMP, TARGET);

const before = { t: count(prev, /^CREATE TABLE/gm), f: count(prev, /^CREATE (OR REPLACE )?FUNCTION/gm), p: count(prev, /^CREATE POLICY/gm) };
const after = { t: count(dump, /^CREATE TABLE/gm), f: count(dump, /^CREATE (OR REPLACE )?FUNCTION/gm), p: count(dump, /^CREATE POLICY/gm) };
const delta = (a, b) => `${a} → ${b}${b === a ? '' : ` (${b > a ? '+' : ''}${b - a})`}`;

console.log(`  tables    ${delta(before.t, after.t)}`);
console.log(`  functions ${delta(before.f, after.f)}`);
console.log(`  policies  ${delta(before.p, after.p)}`);

// Stamp the capture date so `npm run db:baseline:age` stays honest.
const CAPTURED = path.join(ROOT, 'db/baseline/captured.json');
try {
  const meta = JSON.parse(readFileSync(CAPTURED, 'utf8'));
  meta.schema.captured_at = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  writeFileSync(CAPTURED, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.log(`  stamped db/baseline/captured.json schema.captured_at = ${meta.schema.captured_at}`);
} catch (e) {
  console.warn(`  (could not stamp captured.json: ${e.message} — update it by hand)`);
}

console.log('\n  Rebuild the local database from it with:  npm run db:local:reset');
console.log('  Commit db/baseline/schema.sql AND captured.json so the refresh is shared.');
