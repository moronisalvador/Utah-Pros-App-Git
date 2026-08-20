/**
 * ════════════════════════════════════════════════
 * FILE: db-local-bootstrap.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the single file that the local-only database loads when it starts.
 *   It takes the committed snapshot of the real schema, removes two lines that
 *   only the `psql` program understands, glues the fake test people onto the
 *   end, and writes the result where Supabase expects to find it. Then it starts
 *   the local stack if it is down, and loads that file — unless the database
 *   already has the schema, in which case it says so and loads nothing. Run it
 *   as often as you like; it touches nothing outside this laptop.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run db:local` and `npm run db:local:reset`, which run
 *                  this first and then start / reset the Supabase stack.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url
 *   Internal:  db/baseline/schema.sql       (the live-schema snapshot)
 *              db/baseline/non-public.sql   (storage buckets/policies + cron jobs)
 *              supabase/seeds/qa-fixtures.sql (synthetic fixture rows)
 *              scripts/check-baseline-age.mjs (staleness notice)
 *   Data:      reads  → those three SQL files
 *              writes → supabase/seeds/00-local-bootstrap.generated.sql (gitignored)
 *
 * NOTES / GOTCHAS:
 *   - IDEMPOTENCY IS A SKIP, NOT A REWRITE. The bundle itself is a plain
 *     `pg_dump` and can only ever run once: `CREATE TYPE` has no
 *     `IF NOT EXISTS` form, so a second run aborts on the first enum. Rather
 *     than rewrite ~1 MB of DDL into conditional DO blocks (which would also
 *     hide genuine errors and re-insert the fixtures), this script PROBES the
 *     database first and loads nothing when the schema is already there. That
 *     is why re-running is safe but does NOT pick up a refreshed baseline —
 *     `npm run db:local:reset` is the only path that reloads.
 *   - A PARTIAL database is refused, not "topped up". Some tables but not the
 *     full set means an interrupted load or hand-editing; the single
 *     transaction below cannot merge into that, so it stops and points at
 *     `db:local:reset` instead of failing later on a confusing DDL error.
 *   - WHY THIS EXISTS AT ALL: `pg_dump` 18.x wraps its output in `\restrict` /
 *     `\unrestrict`. Those are psql meta-commands, not SQL. Supabase's seeder
 *     sends the file as a raw SQL batch, so they fail with
 *     `syntax error at or near "\"` (SQLSTATE 42601) and the whole stack rolls
 *     back. Stripping them changes no DDL — `\restrict` is a client-side guard
 *     against executing untrusted dumps, nothing more.
 *   - The baseline is NOT hand-edited (db/baseline/README.md forbids it, and it
 *     is the drift-check reference). This generates a derived copy instead.
 *   - Schema and fixtures are emitted as ONE file on purpose. The fixture guard
 *     reads a session setting, and separate seed files are not guaranteed to
 *     share a session; concatenating makes the guard reliable.
 *   - The `upr.local_stack` SET is written here rather than committed as
 *     standalone SQL, so no file in the repo can flip that guard against a
 *     hosted project.
 * ════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { report as reportBaselineAge } from './check-baseline-age.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASELINE = path.join(ROOT, 'db/baseline/schema.sql');
const NON_PUBLIC = path.join(ROOT, 'db/baseline/non-public.sql');
const FIXTURES = path.join(ROOT, 'supabase/seeds/qa-fixtures.sql');
const OUT = path.join(ROOT, 'supabase/seeds/00-local-bootstrap.generated.sql');

// Must match `project_id` in supabase/config.toml — it names the Docker containers.
const PROJECT_ID = 'upr';

// What "loaded" means. Used BOTH by the pre-load probe (should we skip?) and by
// the post-load sanity check (did it work?) — deliberately one definition, so a
// state the probe calls healthy can never be one the final check calls wrong.
// The real baseline is ~141 tables; the floor is loose on purpose.
const MIN_TABLES = 100;
const MIN_FIXTURE_EMPLOYEES = 3;

// psql meta-commands: a backslash in column 1. pg_dump emits \restrict and
// \unrestrict; \connect and \. would be equally fatal in a raw batch.
const META_COMMAND = /^\\/;

// Supabase's own local bootstrap creates `public` (and the auth/storage schemas)
// before the seed runs, so the dump's bare CREATE SCHEMA aborts the batch with
// `schema "public" already exists` (SQLSTATE 42P06). Making it idempotent is the
// whole fix — the schema it wants already exists and is empty.
const CREATE_SCHEMA = /^CREATE SCHEMA (?!IF NOT EXISTS)([A-Za-z_][\w$]*|"[^"]+");/gm;

// `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` fails locally with
// `permission denied to change default privileges` (SQLSTATE 42501): the local
// seeding role is `postgres`, which is not a member of `supabase_admin`.
//
// Dropping these is correct rather than merely expedient. They set privileges for
// objects that role creates IN FUTURE — on the hosted project, where Supabase's
// managed tooling owns them. Nothing in a local stack ever creates an object as
// `supabase_admin`, so they would never fire. Every GRANT/REVOKE on the objects
// that actually exist is preserved untouched, so the local permission model still
// matches production for everything the app can observe.
const ADP_FOREIGN_ROLE = /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\b[^;]*;\s*$/gm;

function sanitize(sql, label) {
  const kept = [];
  const dropped = [];
  for (const line of sql.split('\n')) {
    if (META_COMMAND.test(line)) dropped.push(line.split(' ')[0]);
    else kept.push(line);
  }
  if (dropped.length) {
    console.log(`  ${label}: stripped ${dropped.length} psql meta-command(s): ${[...new Set(dropped)].join(', ')}`);
  }

  let out = kept.join('\n');
  const schemas = [...out.matchAll(CREATE_SCHEMA)].map((m) => m[1]);
  if (schemas.length) {
    out = out.replace(CREATE_SCHEMA, 'CREATE SCHEMA IF NOT EXISTS $1;');
    console.log(`  ${label}: made ${schemas.length} CREATE SCHEMA idempotent: ${schemas.join(', ')}`);
  }

  const adp = (out.match(ADP_FOREIGN_ROLE) || []).length;
  if (adp) {
    out = out.replace(ADP_FOREIGN_ROLE, '');
    console.log(`  ${label}: dropped ${adp} ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin (not grantable locally)`);
  }
  return out;
}

for (const [file, label] of [[BASELINE, 'db/baseline/schema.sql'], [NON_PUBLIC, 'db/baseline/non-public.sql'], [FIXTURES, 'supabase/seeds/qa-fixtures.sql']]) {
  if (!existsSync(file)) {
    console.error(`db-local-bootstrap: missing required input ${label}`);
    process.exit(1);
  }
}

console.log('db-local-bootstrap: building local seed bundle');
try { reportBaselineAge(); } catch (e) { console.warn(`  (baseline age unavailable: ${e.message})`); }

const schema = sanitize(readFileSync(BASELINE, 'utf8'), 'db/baseline/schema.sql');
const nonPublic = sanitize(readFileSync(NON_PUBLIC, 'utf8'), 'db/baseline/non-public.sql');
const fixtures = sanitize(readFileSync(FIXTURES, 'utf8'), 'supabase/seeds/qa-fixtures.sql');

const header = `-- GENERATED FILE — DO NOT EDIT, DO NOT COMMIT.
-- Produced by scripts/db-local-bootstrap.mjs from db/baseline/schema.sql
-- plus supabase/seeds/qa-fixtures.sql. Regenerate with \`npm run db:local\`.
--
-- This file is loaded ONLY by the local Supabase stack. The setting below is
-- what the fixture guard checks; it is generated here, never committed, so no
-- file in this repository can satisfy that guard against a hosted project.

SET upr.local_stack = 'on';
`;

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${header}\n${schema}\n\n${nonPublic}\n\n${fixtures}\n`, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`  wrote ${path.relative(ROOT, OUT)} (${kb(Buffer.byteLength(readFileSync(OUT)))})`);

// ─── SECTION: stack ──────────────
// `--generate-only` writes the bundle and stops, for inspecting the SQL.
if (process.argv.includes('--generate-only')) process.exit(0);

const DB_CONTAINER = `supabase_db_${PROJECT_ID}`;
const docker = (args, opts = {}) => execFileSync('docker', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts });

const running = () => {
  try {
    return docker(['ps', '--filter', `name=^${DB_CONTAINER}$`, '--format', '{{.Names}}']).trim() === DB_CONTAINER;
  } catch { return false; }
};

if (!running()) {
  console.log('\n  local stack is down — starting it (seeding is disabled; this script loads the schema)');
  execFileSync('npx', ['supabase', 'start'], { cwd: ROOT, stdio: 'inherit' });
}

const q = (sql) => docker(['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
  'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql]).trim();

// ─── SECTION: probe ──────────────
// Is the schema already here? Both queries are catalog lookups, so they answer
// on an empty database instead of erroring — `select count(*) from employees`
// would abort before we ever learn the table is missing.
function probe() {
  const tables = Number(q(
    "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"));
  if (tables === 0) return { state: 'empty', tables, employees: 0 };

  const employees = q("select to_regclass('public.employees') is not null") === 't'
    ? Number(q('select count(*) from public.employees'))
    : 0;

  const loaded = tables >= MIN_TABLES && employees >= MIN_FIXTURE_EMPLOYEES;
  return { state: loaded ? 'loaded' : 'partial', tables, employees };
}

const before = probe();

if (before.state === 'partial') {
  console.error('\ndb-local-bootstrap: the local database is PARTIALLY loaded — refusing to touch it.');
  console.error(`  found ${before.tables} table(s) and ${before.employees} fixture employee(s); expected 0 (fresh) or ≥${MIN_TABLES} and ≥${MIN_FIXTURE_EMPLOYEES} (loaded).`);
  console.error('  The bundle is one transaction against a clean schema; it cannot merge into a half-loaded one.');
  console.error('  Wipe and reload:  npm run db:local:reset');
  process.exit(1);
}

// ─── SECTION: load ──────────────
if (before.state === 'loaded') {
  // Deliberately a no-op, not a reload: the bundle is a raw pg_dump and would
  // abort on the first `CREATE TYPE`. Re-running this command to make sure the
  // stack is up is the common case and must not cost a 2-minute reset.
  console.log('\n  schema already loaded — nothing to do (no SQL was run)');
  console.log('  To pick up a refreshed db/baseline/schema.sql:  npm run db:local:reset');
} else {
  // db/baseline/non-public.sql needs two things `postgres` does not have on a
  // fresh stack: the pg_cron extension (superuser-only CREATE) and membership
  // in supabase_storage_admin, which OWNS storage.objects — without it,
  // CREATE POLICY there fails. Both proven by qualify-job-files-private-local.
  // The grant is revoked right after the load; pg_cron stays installed.
  const admin = (sql) => docker(['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]);
  console.log('\n  preparing extensions and load-time role grants (as supabase_admin)');
  admin('CREATE EXTENSION IF NOT EXISTS pg_cron; GRANT supabase_storage_admin TO postgres;');

  console.log('  loading bundle into the local database (single psql session)');
  docker(['cp', OUT, `${DB_CONTAINER}:/tmp/upr-local-bootstrap.sql`]);

  let out;
  try {
    out = docker(['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q',
      '-f', '/tmp/upr-local-bootstrap.sql'], { stdio: 'pipe' });
  } catch (e) {
    console.error('\ndb-local-bootstrap: load FAILED — the database was left untouched (single transaction).');
    console.error(String(e.stderr || e.stdout || e.message).trim().split('\n').slice(-15).join('\n'));
    console.error('\n  Recover with:  npm run db:local:reset');
    try { admin('REVOKE supabase_storage_admin FROM postgres;'); } catch { /* keep the primary failure */ }
    process.exit(1);
  }
  if (out && out.trim()) console.log(out.trim());
  admin('REVOKE supabase_storage_admin FROM postgres;');

  // Hard verification of the non-public catalog — ONLY on a load this run
  // performed. non-public.sql's cron section skips with a WARNING when pg_cron
  // is missing; this is what stops that skip passing silently through
  // `npm run db:local`. All-inactive is the deliberate divergence: an active
  // job here would call production endpoints from this machine.
  const nonPublicCounts = {
    buckets: Number(q('select count(*) from storage.buckets')),
    storagePolicies: Number(q("select count(*) from pg_policies where schemaname='storage'")),
    cronJobs: Number(q('select count(*) from cron.job')),
    activeCronJobs: Number(q('select count(*) from cron.job where active')),
  };
  if (nonPublicCounts.buckets < 4 || nonPublicCounts.storagePolicies < 6 || nonPublicCounts.cronJobs < 15) {
    console.error('\ndb-local-bootstrap: the non-public catalog did not load fully:');
    console.error(`  buckets ${nonPublicCounts.buckets} (expected ≥4) · storage policies ${nonPublicCounts.storagePolicies} (≥6) · cron jobs ${nonPublicCounts.cronJobs} (≥15)`);
    console.error('  Wipe and reload:  npm run db:local:reset');
    process.exit(1);
  }
  if (nonPublicCounts.activeCronJobs !== 0) {
    console.error(`\ndb-local-bootstrap: ${nonPublicCounts.activeCronJobs} cron job(s) are ACTIVE on a local stack — they would call production endpoints. Refusing.`);
    console.error('  Wipe and reload:  npm run db:local:reset');
    process.exit(1);
  }
}

// ─── SECTION: verify ──────────────
const counts = {
  tables: q("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"),
  functions: q("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
  policies: q("select count(*) from pg_policies where schemaname='public'"),
  employees: q('select count(*) from public.employees'),
  buckets: q('select count(*) from storage.buckets'),
};

console.log('\n  local database ready:');
console.log(`    tables ${counts.tables} · functions ${counts.functions} · policies ${counts.policies} · fixture employees ${counts.employees} · buckets ${counts.buckets}`);

if (before.state === 'loaded' && Number(counts.buckets) === 0) {
  // A stack loaded before the non-public capture existed. Not an error — the
  // public schema is intact — but storage/cron proofs would run against
  // nothing, which is the blind spot this capture closes.
  console.warn('\n  ⚠ this stack predates db/baseline/non-public.sql (no storage buckets loaded).');
  console.warn('    Pick it up with:  npm run db:local:reset');
}

if (Number(counts.tables) < MIN_TABLES || Number(counts.employees) < MIN_FIXTURE_EMPLOYEES) {
  console.error('\ndb-local-bootstrap: the result looks wrong (too few tables or fixtures).');
  console.error(`  expected ≥${MIN_TABLES} tables and ≥${MIN_FIXTURE_EMPLOYEES} fixture employees.`);
  console.error('  Wipe and reload:  npm run db:local:reset');
  process.exit(1);
}

console.log('\n  Studio:  http://127.0.0.1:54323');
console.log('  Sign in as qa-admin@upr-qa.test / qa-office@ / qa-tech@  (password: qa-local-password)');
