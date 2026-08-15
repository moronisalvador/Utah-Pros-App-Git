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
 *   - Requires `supabase login` first — that is the whole reason the login
 *     matters for local development.
 *   - The dump is written to a temp path and only moved into place after the
 *     sanity checks below pass, so a failed or truncated dump cannot destroy a
 *     working baseline.
 * ════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
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
// So: use the CLI's own `--file` flag and inherit all three stdio streams.
// Nothing is intercepted, any prompt or retry notice is visible, and the schema
// is read back from disk afterwards.
if (!process.stdin.isTTY) {
  console.error('\ndb-baseline-refresh: needs an interactive terminal.');
  console.error('\n`supabase db dump` may prompt for the database password, which cannot be');
  console.error('answered without a TTY. Run this yourself, in a normal Terminal window:\n');
  console.error('  cd ~/Developer/upr && npm run db:baseline:refresh\n');
  console.error('An agent cannot type that password for you.');
  process.exit(1);
}

console.log('db-baseline-refresh: dumping SCHEMA ONLY from the linked project (read-only)');
console.log('  If it asks for your database password, type it here — the prompt is live.\n');

if (existsSync(TMP)) unlinkSync(TMP);

try {
  sh('npx', ['supabase', 'db', 'dump', '--linked', '--schema', 'public', '--file', TMP], {
    stdio: 'inherit', // prompt visible; schema goes to --file, not stdout
  });
} catch (e) {
  if (existsSync(TMP)) unlinkSync(TMP);
  console.error('\ndb-baseline-refresh: dump failed. Baseline left untouched.');
  console.error(String(e.stderr || e.message).trim().split('\n').slice(-6).join('\n'));
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
console.log('\n  Rebuild the local database from it with:  npm run db:local:reset');
console.log('  Commit db/baseline/schema.sql so the refresh is shared.');
