# Staging Database Runbook — the `qa-staging` Supabase branch

**Last verified:** 2026-07-31 · Status: **SEEDED AND LIVE** (ref `uizgwvkvzyldystqrcsk`,
~$0.01344/hr). Owner ran the §2 Path B schema-only seed 2026-07-29; initial parity was verified
exact against production at that point (141 public tables / 400 functions / 219 policies), grants
transferred, and PostgREST cache reloaded. Counts now drift as migrations are qualified/applied, so
derive them for each window. The CI db lane runs against the branch on every PR. **Known tail:**
the schema-only seed initially had no `auth.users`; three fixture identities are now seeded
(2026-07-29, `scripts/qa/seed-branch-fixtures.sql`), but remaining anon-era suites still fail or
self-skip until converted. They are gated by the shrink-only baseline in
`scripts/qa/db-lane-baseline.json` (21 failed / 204 skipped of 357 at first light; the current
count must be derived from CI). The standing fixtures are three
standing QA people — `qa-admin@` / `qa-office@` / `qa-tech@upr-qa.test` (admin / office /
field_tech), each bound to an active `employees` row, plus one active
demo-sheet schema. The current fixture source also contains a minimal CRM status phase/stage and
the five notification catalog rows required for the containment rehearsal; those additions remain
repository-only until their branch-only seed window is authorized. Verified end-to-end: password
grant → JWT → `get_my_employee_profile()`
resolves the fixture employee. Tests authenticate via
`supabase/tests/helpers/qaFixtures.mjs` (`signInFixture('admin').rpc(...)`) — reference
conversion: `settings_f_demo_schema_delete.test.js` (3/3 green against the branch). Path to full
green: convert the remaining anon-era suites with that pattern, add their reference rows to the
seed script, ratchet the baseline down each time, delete it at zero. The branch's seeded schema is
real and usable, but the dashboard `MIGRATIONS_FAILED` badge is **not merely cosmetic**: its
migration ledger was never baselined after the manual schema restore, so automated rebase still
replays old history and fails (§1). Do not use rebase as the parity mechanism until that ledger
gap is deliberately repaired.

## 1. What happened and what we learned (2026-07-29)

A persistent Supabase branch (`qa-staging`) was created from the shared production project
(`glsmljpabrwonfiltiqm`) to serve as the staging database — the place where migrations are
iterated and the `supabase/tests/` db lane finally runs.

**It failed to seed, and the failure is a load-bearing finding:** branch creation replays the
parent project's migration ledger, and the replay died at entry **4 of 419**. The production
schema was partly built via dashboard/direct DDL before schema-as-code discipline existed
(`db/baseline/README.md` records ~73 tables and ~101 functions with no CREATE in any migration),
so **the production schema is not reproducible from its own migration history**. Neither branch
creation, nor `supabase start` + local replay, nor a fresh project can reconstruct it. The broken
branch was deleted so it would not bill for nothing.

This is also the disaster-recovery gap in miniature: if the project were lost, the schema could
not be rebuilt from the repo. Fixing it once fixes staging, CI, and DR together.

## 2. The one-time owner action (≈10 minutes, needs credentials only the owner has)

**Path A — dashboard data branch — was found gated (2026-07-29):** "Include data" requires
7-day PITR (**$100/month**) plus a production compute upgrade Nano → Small (~$15/month), because
data branches clone via point-in-time restore. That is not worth paying for a test target;
schema-only (Path B, below) covers everything the db lane and migration iteration need. Decide
PITR separately, on its own merits as production disaster-recovery insurance — not as a branching
prerequisite.

**Path B — schema-only seed (the plan of record).** The plain branch already exists
(ref `uizgwvkvzyldystqrcsk`). From any machine with `psql`/`pg_dump` (or the Supabase CLI):

```bash
# Connection strings: Dashboard → Connect (top bar) → select the branch or production.
# Use the "Session pooler" URI if your network blocks direct :5432.

# 1. Dump the production public schema (read-only against prod).
pg_dump "$PROD_DB_URL" --schema-only --schema=public --no-owner > schema.sql

# 2. Clear the branch's partial public schema (the failed ledger replay left 4
#    migrations' worth of objects) and restore baseline grants.
psql "$BRANCH_DB_URL" -c 'drop schema public cascade; create schema public;'
psql "$BRANCH_DB_URL" -c 'grant usage, create on schema public to postgres, anon, authenticated, service_role;'

# 3. Load the schema. Pre-existing extension/type notices are fine; real errors are not.
psql "$BRANCH_DB_URL" -f schema.sql
```

Known limitation: a `--schema=public` dump omits objects living in other schemas (e.g. a trigger
ON `auth.users` such as a handle-new-user hook). If a db test fails on such an object, dump that
schema's object individually and apply it — do not dump `auth`/`storage` wholesale onto the
branch (they already exist there).

The same limitation surfaced during the 2026-07-31 transcribe-cron hardening qualification:
the schema-only seed omitted the `pg_net` and `pg_cron` extension objects. The first migration
attempt failed transactionally before changing anything. Staging parity was then restored by
installing the available extensions, loading the committed original transcribe cron baseline, and
applying the exact reviewed hardening source. Its separate post-apply proof passed. The schema-only
branch intentionally has no production cron secret row, so the new functions fail closed/no-op
there and no outbound worker request was used as staging evidence.

**Then wire it up (owner, ~5 more minutes):**

1. ~~Commit the branch's project ref into `tests/qa/lib/target-policy.mjs`~~ **DONE 2026-07-29**
   (`QA_BRANCH_PROJECT_REF = 'uizgwvkvzyldystqrcsk'`).
2. ~~Add the three branch-connection GitHub Actions repository secrets~~ **DONE 2026-07-29**
   (verified live: the CI db-lane authenticated against the seeded branch and is active under the
   shrink-only baseline described at the top of this runbook). For reference the secrets are
   `UPR_QA_SUPABASE_URL`, `UPR_QA_SUPABASE_ANON_KEY`, `UPR_QA_SUPABASE_SERVICE_KEY` (**the
   branch's keys, never production's**; the runner maps the last one to the canonical env name
   the tests read — deliberately not spelled here because `.claude/hooks/block-secrets.sh`
   guards the literal). The 2026-07-31 fixture-hardening source adds a fourth,
   `UPR_QA_FIXTURE_PASSWORD`, so the usable password is no longer committed. Rotate the three
   branch fixture identities and configure that GitHub secret in the same owner-authorized window;
   until then the hardened runner intentionally refuses rather than falling back to a literal.
3. The hosted lane is live, so `tests/qa/unit/db-lane-coverage.test.js` is now stale: it still says
   no governed target exists and counts every database guard as dark. Replace or retire it after
   the active fixture-conversion batch lands; the successor must report hosted JavaScript coverage
   separately from the SQL/pgTAP files that remain local-only.

## 3. How agents use the branch once it exists

- **Iterate freely.** The branch is isolated: `execute_sql` / `apply_migration` against the
  branch ref is the sanctioned way to develop and debug a migration before it is ever proposed
  for the shared project. Production apply remains a separate owner-authorized act (AGENTS.md §13
  / `database-standard.md` §0 unchanged).
- **Run the db lane hosted:** `npm run test:db:branch` (refuses unless the committed ref, the
  URL, and the sentinel line up; refuses production always; SQL/pgTAP proofs stay in the local
  lane).
- **Run the db lane locally** (pgTAP proofs included): `npm run test:db:local` against a local
  `supabase start` stack — unchanged.
- The branch drifts from production as production migrations apply. **Do not currently use MCP
  `rebase_branch` to reconcile it.** A fresh 2026-07-31 attempt again started at historical
  `20260312194505_001_phase_conversion_and_costing.sql` and failed because `rv_jobs` depends on
  `jobs.phase`; the manual schema seed did not baseline the migration ledger. Qualify a reviewed
  migration directly on the branch, then reconcile production parity through an explicit
  baseline/ledger-repair initiative. Never mark old migrations applied ad hoc merely to clear the
  badge.

## 4. The longer-term fix this exposes (recommended follow-up)

The full public-schema capture now exists at `db/baseline/schema.sql` (commit `8e1cf9cc`). Remaining
work is to wire a governed local bootstrap that loads that capture before post-baseline migrations,
verify it reproduces the required extension/auth-adjacent contracts, and establish a reviewed
refresh cadence. That gives real disaster recovery and a fully local, credential-free CI database
lane—the end state where the hosted branch is a convenience, not a dependency.
