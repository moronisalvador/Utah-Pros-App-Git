#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════
 * FILE: scripts/db-drift-check.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Catches "schema drift" — database objects that exist live but aren't in our
 *   migrations, or migrations describing objects no longer live. It does two things:
 *     1. If you pass a fresh live snapshot (--current <file>, produced by running
 *        scripts/db-drift-check.sql), it diffs that against the committed baseline
 *        (db/baseline/live-schema-snapshot.json) and prints added/removed tables
 *        and functions.
 *     2. Always: scans supabase/migrations/*.sql and reports which baseline objects
 *        have NO CREATE statement in any migration (i.e. are only in the live DB) —
 *        the "untracked" list that this Phase F drift-captured (system_events,
 *        get_dashboard_stats) was found from.
 *
 * USAGE:
 *   node scripts/db-drift-check.mjs                       # untracked-in-migrations report
 *   node scripts/db-drift-check.mjs --current live.json   # + live-vs-baseline diff
 *   Exit code: 1 if the --current diff shows drift, else 0. The untracked report is
 *   advisory (heuristic name-scan) and never fails the process on its own.
 *
 * DEPENDS ON: node stdlib only (fs, path, url). No external packages, no DB creds.
 * ════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE = join(ROOT, 'db/baseline/live-schema-snapshot.json');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

// Objects known to be created outside plain `CREATE TABLE/FUNCTION name` DDL, or
// that are intentionally not defined as top-level migration objects. Keeps the
// advisory report signal-to-noise high. (This Phase F captured system_events +
// get_dashboard_stats, so they are now tracked and NOT listed here.)
const KNOWN_OK = new Set([]);

function load(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function migrationText() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n')
    .toLowerCase();
}

// Heuristic: does any migration CREATE this object by name?
function isTrackedTable(name, sql) {
  const n = name.toLowerCase();
  return new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?"?${n}"?[\\s(]`).test(sql);
}
function isTrackedFunction(name, sql) {
  const n = name.toLowerCase();
  return new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?"?${n}"?\\s*\\(`).test(sql);
}

function diffArrays(baseArr, curArr) {
  const base = new Set(baseArr);
  const cur = new Set(curArr);
  return {
    added: curArr.filter((x) => !base.has(x)),   // live has, baseline doesn't
    removed: baseArr.filter((x) => !cur.has(x)),  // baseline has, live doesn't
  };
}

const baseline = load(BASELINE);
const sql = migrationText();

// ── 1. Untracked-in-migrations report (always) ──────────────────────────────
const untrackedTables = baseline.tables.filter((t) => !KNOWN_OK.has(t) && !isTrackedTable(t, sql));
const untrackedFns = baseline.functions.filter((f) => !KNOWN_OK.has(f) && !isTrackedFunction(f, sql));

console.log('── DB drift check ─────────────────────────────────────────────');
console.log(`baseline: ${baseline.table_count} tables, ${baseline.function_count} functions (captured ${baseline.captured_at})`);
console.log('');
console.log(`Tables with no CREATE in migrations (${untrackedTables.length}):`);
console.log(untrackedTables.length ? '  ' + untrackedTables.join(', ') : '  (none)');
console.log('');
console.log(`Functions with no CREATE in migrations (${untrackedFns.length}):`);
console.log(untrackedFns.length ? '  ' + untrackedFns.join(', ') : '  (none)');
console.log('  (advisory — name-scan heuristic; trigger/util functions may be defined inline)');

// ── 2. Live-vs-baseline diff (only with --current) ──────────────────────────
const idx = process.argv.indexOf('--current');
if (idx === -1) {
  console.log('\nNo --current snapshot supplied; skipping live-vs-baseline diff.');
  process.exit(0);
}

const current = load(process.argv[idx + 1]);
const t = diffArrays(baseline.tables, current.tables || []);
const f = diffArrays(baseline.functions, current.functions || []);
const drift = t.added.length + t.removed.length + f.added.length + f.removed.length;

console.log('\n── Live vs. baseline ──────────────────────────────────────────');
console.log(`tables  + live-only: [${t.added.join(', ')}]   - missing-live: [${t.removed.join(', ')}]`);
console.log(`funcs   + live-only: [${f.added.join(', ')}]   - missing-live: [${f.removed.join(', ')}]`);
if (drift) {
  console.log(`\nDRIFT: ${drift} object(s) differ. Update migrations + regenerate the baseline.`);
  process.exit(1);
}
console.log('\nNo drift: live matches baseline.');
process.exit(0);
