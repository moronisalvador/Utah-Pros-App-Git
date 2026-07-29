# Staging Database Runbook — the `qa-staging` Supabase branch

**Last verified:** 2026-07-29 · Status: **pending one owner seeding action** (see §2).

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

## 2. The one-time owner action (≈5 minutes, needs credentials only the owner has)

Either path produces a working staging branch:

**Path A — dashboard data branch (preferred).** Supabase Dashboard → project → Branches →
Create branch → name it `qa-staging` → enable **“Include data”** (a data branch clones the live
schema AND data via point-in-time restore, sidestepping the ledger entirely). Cost is the same
~$0.014/hour (~$10/month) compute as any branch.

**Path B — schema-only seed.** Create a plain branch (dashboard or MCP `create_branch`), then
from any machine with `pg_dump`/`psql` and the two database passwords:

```bash
pg_dump  "$PROD_DB_URL"   --schema-only --no-owner > schema.sql
psql     "$BRANCH_DB_URL" -f schema.sql
```

**Then wire it up (owner, ~5 more minutes):**

1. Commit the branch's project ref into `tests/qa/lib/target-policy.mjs`
   (`QA_BRANCH_PROJECT_REF` — currently `null`, which makes every hosted-QA runner refuse).
2. Add three GitHub Actions repository secrets so the CI db lane goes live:
   - `UPR_QA_SUPABASE_URL` — `https://<branch-ref>.supabase.co`
   - `UPR_QA_SUPABASE_ANON_KEY` — the branch's anon key
   - `UPR_QA_SUPABASE_SERVICE_KEY` — the branch's privileged server key (**the branch's, never
     production's**; the runner maps this to the canonical env name the tests read — that name is
     deliberately not spelled here because `.claude/hooks/block-secrets.sh` guards the literal)
3. Update `.claude/rules/initiative-status.md` (staging line) and, after the first green CI
   db-lane run, delete `tests/qa/unit/db-lane-coverage.test.js` — that file exists only to make
   the dark lane loud, and its own header says to delete it then.

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
