/**
 * ════════════════════════════════════════════════
 * FILE: qualify-data-shaped-failure-local.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the seeded local database can now catch a whole class of mistakes
 *   it used to be blind to. Before the seed existed, the local database had
 *   zero rows, so a rule like "every contact must have a non-empty name"
 *   would pass instantly here and then fail against real data in production.
 *   This runs three such rules twice each: once against an empty copy of the
 *   table (they all pass — that is the old blind spot, demonstrated), and
 *   once against the seeded data (they all FAIL, caught by the deliberate
 *   edge-case rows the seed plants). Nothing is left behind: every failed
 *   change is rejected by Postgres itself, and the passing clones are
 *   temporary tables that vanish with the session.
 *
 * WHERE IT LIVES:
 *   Triggered by:  `npm run test:db:data-visibility:local`
 *
 * DEPENDS ON:
 *   Internal:  a running local stack, seeded (it runs scripts/db-local-seed.mjs
 *              itself when the sentinel row is absent)
 *   Data:      reads  → seeded public.contacts / public.claims
 *              writes → nothing durable (rejected DDL + pg_temp clones only)
 *
 * NOTES / GOTCHAS:
 *   - THIS IS A CAPABILITY DEMONSTRATION, NOT A MIGRATION PROOF — no receipt,
 *     no commit binding. It is cited by migration-apply-tier.mjs as evidence
 *     the failure CLASS is visible locally now. What it deliberately does NOT
 *     claim: that a data-touching migration passing locally is safe for
 *     production. Synthetic rows can prove the presence of a violation, never
 *     its absence in real data — which is why the data-touching entries stay
 *     in CAN_NOT_BE_AUTO even though this passes.
 *   - The three demonstrations map 1:1 to CAN_NOT_BE_AUTO entries:
 *     ADD CONSTRAINT (empty-name contact), CREATE UNIQUE INDEX (two contacts
 *     sharing an email), SET NOT NULL (claim with NULL date_of_loss).
 * ════════════════════════════════════════════════
 */
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_CONTAINER = 'supabase_db_upr';
const SENTINEL_CONTACT = '5eed0001-0000-4000-8000-00000000cafe';

function psql(sql) {
  return execFileSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
    'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

// ─── SECTION: preconditions ──────────────
let running = '';
try {
  running = execFileSync('docker', ['ps', '--filter', `name=^${DB_CONTAINER}$`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
} catch { /* fall through */ }
if (running !== DB_CONTAINER) {
  console.error('data-shaped-failure qualification refused: the local stack is not running (npm run db:local).');
  process.exit(2);
}

if (psql(`select count(*) from public.contacts where id = '${SENTINEL_CONTACT}'`).trim() !== '1') {
  console.log('local stack is not seeded — running scripts/db-local-seed.mjs first');
  const seeded = spawnSync('node', ['scripts/db-local-seed.mjs'], { cwd: ROOT, stdio: 'inherit' });
  if (seeded.status !== 0) process.exit(seeded.status ?? 2);
}

// ─── SECTION: the three demonstrations ──────────────
// Each block: the SAME DDL passes on an empty clone (the pre-seed blind
// spot, shown rather than asserted) and is REFUSED on seeded data with the
// exact SQLSTATE production would raise. A wrong outcome in either direction
// raises, which fails the psql call, which fails this script.
const DEMONSTRATION = `DO $$
BEGIN
  -- 1 · ADD CONSTRAINT ─ "every contact name is non-empty"
  CREATE TEMP TABLE clone_contacts (LIKE public.contacts);
  ALTER TABLE clone_contacts ADD CONSTRAINT demo_name_nonempty
    CHECK (name IS NULL OR length(btrim(name)) > 0);
  RAISE NOTICE 'blind spot: ADD CONSTRAINT passed in milliseconds on the empty table (what every pre-seed local proof measured)';
  BEGIN
    ALTER TABLE public.contacts ADD CONSTRAINT demo_name_nonempty
      CHECK (name IS NULL OR length(btrim(name)) > 0);
    RAISE EXCEPTION 'DEMONSTRATION FAILED: ADD CONSTRAINT was accepted over seeded data — the empty-name edge row is missing';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: ADD CONSTRAINT refused by a seeded row (SQLSTATE 23514) — the failure production would have thrown';
  END;

  -- 2 · CREATE UNIQUE INDEX ─ "contact emails are unique"
  CREATE TEMP TABLE clone_contacts2 (LIKE public.contacts);
  CREATE UNIQUE INDEX demo_email_unique_clone ON clone_contacts2 (email);
  RAISE NOTICE 'blind spot: CREATE UNIQUE INDEX passed on the empty table';
  BEGIN
    CREATE UNIQUE INDEX demo_email_unique ON public.contacts (email);
    RAISE EXCEPTION 'DEMONSTRATION FAILED: CREATE UNIQUE INDEX was accepted over seeded data — the shared-email pair is missing';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: CREATE UNIQUE INDEX refused by the seeded duplicate pair (SQLSTATE 23505)';
  END;

  -- 3 · SET NOT NULL ─ "every claim has a date of loss"
  CREATE TEMP TABLE clone_claims (LIKE public.claims);
  ALTER TABLE clone_claims ALTER COLUMN date_of_loss SET NOT NULL;
  RAISE NOTICE 'blind spot: SET NOT NULL passed on the empty table';
  BEGIN
    ALTER TABLE public.claims ALTER COLUMN date_of_loss SET NOT NULL;
    RAISE EXCEPTION 'DEMONSTRATION FAILED: SET NOT NULL was accepted over seeded data — the NULL date_of_loss claim is missing';
  EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'ok: SET NOT NULL refused by a seeded NULL (SQLSTATE 23502)';
  END;
END $$;`;

// spawnSync rather than execFileSync: the demonstration's narrative arrives
// as NOTICEs on stderr, and hiding it would make a pass unreadable.
const demo = spawnSync('docker', ['exec', '-e', 'PGPASSWORD=postgres', DB_CONTAINER,
  'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', DEMONSTRATION],
{ encoding: 'utf8' });
const notices = String(demo.stderr || '').split('\n').filter((l) => l.trim()).map((l) => `  ${l.replace(/^NOTICE:\s*/, '')}`);
if (notices.length) console.log(notices.join('\n'));
if (demo.status !== 0) {
  console.error('data-shaped-failure qualification FAILED (see the last message above).');
  process.exit(1);
}

// ─── SECTION: nothing-left-behind check ──────────────
const residue = psql(`select count(*) from pg_constraint where conname = 'demo_name_nonempty' and conrelid = 'public.contacts'::regclass`).trim();
const indexResidue = psql(`select count(*) from pg_indexes where schemaname='public' and indexname='demo_email_unique'`).trim();
const notNull = psql(`select is_nullable from information_schema.columns where table_schema='public' and table_name='claims' and column_name='date_of_loss'`).trim();
if (residue !== '0' || indexResidue !== '0' || notNull !== 'YES') {
  console.error(`data-shaped-failure qualification FAILED: residue left behind (constraint=${residue}, index=${indexResidue}, date_of_loss nullable=${notNull})`);
  process.exit(1);
}

console.log('\ndata-shaped-failure qualification PASSED:');
console.log('  all three DDL classes pass on an empty table and are caught by seeded data — the blind spot is closed for detection.');
console.log('  (Detection, not clearance: synthetic rows prove a violation CAN be seen, never that production rows hold none —');
console.log('   which is why the data-touching CAN_NOT_BE_AUTO entries remain owner-gated.)');
