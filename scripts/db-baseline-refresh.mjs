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
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'db/baseline/schema.sql');
const TMP = `${TARGET}.tmp`;

// The shared production project (AGENTS.md §13).
const PROJECT_REF = process.env.UPR_BASELINE_PROJECT_REF || 'glsmljpabrwonfiltiqm';

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

console.log(`db-baseline-refresh: dumping SCHEMA ONLY from ${PROJECT_REF} (read-only)`);

let dump;
try {
  dump = sh('npx', ['supabase', 'db', 'dump', '--project-ref', PROJECT_REF, '--schema', 'public']);
} catch (e) {
  console.error('\ndb-baseline-refresh: dump failed.');
  console.error('Most likely cause: not logged in. Run `npx supabase login` and retry.');
  console.error(String(e.stderr || e.message).trim().split('\n').slice(-5).join('\n'));
  process.exit(1);
}

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

writeFileSync(TMP, dump, 'utf8');
renameSync(TMP, TARGET);
if (existsSync(TMP)) unlinkSync(TMP);

const before = { t: count(prev, /^CREATE TABLE/gm), f: count(prev, /^CREATE (OR REPLACE )?FUNCTION/gm), p: count(prev, /^CREATE POLICY/gm) };
const after = { t: count(dump, /^CREATE TABLE/gm), f: count(dump, /^CREATE (OR REPLACE )?FUNCTION/gm), p: count(dump, /^CREATE POLICY/gm) };
const delta = (a, b) => `${a} → ${b}${b === a ? '' : ` (${b > a ? '+' : ''}${b - a})`}`;

console.log(`  tables    ${delta(before.t, after.t)}`);
console.log(`  functions ${delta(before.f, after.f)}`);
console.log(`  policies  ${delta(before.p, after.p)}`);
console.log('\n  Rebuild the local database from it with:  npm run db:local:reset');
console.log('  Commit db/baseline/schema.sql so the refresh is shared.');
