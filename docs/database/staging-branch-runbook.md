# Staging Database Runbook — the `qa-staging` Supabase branch

**Last verified:** 2026-07-29 · Status: branch **created** (ref `uizgwvkvzyldystqrcsk`,
~$0.01344/hr) — **pending the owner seeding action in §2**. The branch's `MIGRATIONS_FAILED`
status is expected (see §1) and harmless: the seed in §2 replaces the schema wholesale.

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

**Then wire it up (owner, ~5 more minutes):**

1. ~~Commit the branch's project ref into `tests/qa/lib/target-policy.mjs`~~ **DONE 2026-07-29**
   (`QA_BRANCH_PROJECT_REF = 'uizgwvkvzyldystqrcsk'`).
2. ~~Add three GitHub Actions repository secrets~~ **DONE 2026-07-29** (verified live: the CI
   db-lane job authenticated against the branch and ran; it now reports `SEED PENDING` until
   step 1's seed lands, then goes fully live). For reference the secrets are
   `UPR_QA_SUPABASE_URL`, `UPR_QA_SUPABASE_ANON_KEY`, `UPR_QA_SUPABASE_SERVICE_KEY` (**the
   branch's keys, never production's**; the runner maps the last one to the canonical env name
   the tests read — deliberately not spelled here because `.claude/hooks/block-secrets.sh`
   guards the literal).
3. After the first green CI db-lane run, delete `tests/qa/unit/db-lane-coverage.test.js` — that
   file exists only to make the dark lane loud, and its own header says to delete it then.

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
- The branch drifts from production as production migrations apply. Periodically rebase
  (MCP `rebase_branch`) — after the seed, rebase only replays NEW ledger entries, which are
  post-discipline and replayable.

## 4. The longer-term fix this exposes (recommended follow-up)

Capture a full schema baseline into the repo (`pg_dump --schema-only` committed as
`db/baseline/schema.sql`, refreshed on a cadence), so the schema is reproducible without a live
clone. That converts this runbook's Path B into a committed artifact, gives real
disaster-recovery, and lets `supabase start` + baseline + post-baseline migrations power a fully
local, credential-free CI db lane — the end state where the hosted branch is a convenience, not a
dependency.
