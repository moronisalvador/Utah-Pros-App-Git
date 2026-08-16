/**
 * ════════════════════════════════════════════════
 * FILE: db-local-bootstrap.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the single file that the local-only database loads when it starts.
 *   It takes the committed snapshot of the real schema, removes two lines that
 *   only the `psql` program understands, glues the fake test people onto the
 *   end, and writes the result where Supabase expects to find it. Run it before
 *   starting the local stack; it touches nothing outside this laptop.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run db:local` and `npm run db:local:reset`, which run
 *                  this first and then start / reset the Supabase stack.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url
 *   Internal:  db/baseline/schema.sql       (the live-schema snapshot)
 *              supabase/seeds/qa-fixtures.sql (synthetic fixture rows)
 *   Data:      reads  → those two files
 *              writes → supabase/seeds/00-local-bootstrap.generated.sql (gitignored)
 *
 * NOTES / GOTCHAS:
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASELINE = path.join(ROOT, 'db/baseline/schema.sql');
const FIXTURES = path.join(ROOT, 'supabase/seeds/qa-fixtures.sql');
const OUT = path.join(ROOT, 'supabase/seeds/00-local-bootstrap.generated.sql');

// Must match `project_id` in supabase/config.toml — it names the Docker containers.
const PROJECT_ID = 'upr';

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

for (const [file, label] of [[BASELINE, 'db/baseline/schema.sql'], [FIXTURES, 'supabase/seeds/qa-fixtures.sql']]) {
  if (!existsSync(file)) {
    console.error(`db-local-bootstrap: missing required input ${label}`);
    process.exit(1);
  }
}

console.log('db-local-bootstrap: building local seed bundle');

const schema = sanitize(readFileSync(BASELINE, 'utf8'), 'db/baseline/schema.sql');
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
writeFileSync(OUT, `${header}\n${schema}\n\n${fixtures}\n`, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`  wrote ${path.relative(ROOT, OUT)} (${kb(Buffer.byteLength(readFileSync(OUT)))})`);

// ─── SECTION: load ──────────────
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

console.log('\n  loading bundle into the local database (single psql session)');
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
  process.exit(1);
}
if (out && out.trim()) console.log(out.trim());

// ─── SECTION: verify ──────────────
const q = (sql) => docker(['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
  'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql]).trim();

const counts = {
  tables: q("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"),
  functions: q("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"),
  policies: q("select count(*) from pg_policies where schemaname='public'"),
  employees: q('select count(*) from public.employees'),
};

console.log('\n  local database ready:');
console.log(`    tables ${counts.tables} · functions ${counts.functions} · policies ${counts.policies} · fixture employees ${counts.employees}`);

if (Number(counts.tables) < 100 || Number(counts.employees) < 3) {
  console.error('\ndb-local-bootstrap: loaded, but the result looks wrong (too few tables or fixtures).');
  process.exit(1);
}

console.log('\n  Studio:  http://127.0.0.1:54323');
console.log('  Sign in as qa-admin@upr-qa.test / qa-office@ / qa-tech@  (password: qa-local-password)');
