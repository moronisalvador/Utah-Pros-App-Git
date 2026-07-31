<!--
FILE: docs/handoff/db-lane-target-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for a fresh session that gives the `db` test lane a real
  isolated database, so the 77 database guards that never run in CI start running.
  This is backlog item 6.1.

DEPENDS ON:
  Internal: docs/upr-build-fix-backlog.md §6.1, tests/qa/unit/db-lane-coverage.test.js,
            scripts/qa/run-local-db-tests.mjs, scripts/qa/run-vitest-lane.mjs,
            vitest.config.js, .github/workflows/ci.yml
  Data:     reads → repository, read-only live catalog
            writes → CI config, lane runner, docs. Creates and destroys an EPHEMERAL
                     Supabase preview branch (never the shared production project)

NOTES / GOTCHAS:
  - Starts with a SPEND decision only the owner can make. Do not create a branch
    before that is given.
  - The goal is to DELETE tests/qa/unit/db-lane-coverage.test.js, not to rebaseline it.
-->

# Handoff — give the `db` test lane a real target (backlog 6.1)

> **SUPERSEDED 2026-07-31 — do not execute this handoff.** Persistent `qa-staging` is seeded and
> CI-wired. The old all-dark guard and failure baseline are retired; the hosted runner now permits
> zero failed assertions. Current receipt and remaining skip/local-runtime work live in
> `docs/database/staging-branch-runbook.md`.

Paste everything from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). Your job is backlog item
**6.1**: give the `db` test lane an isolated database so its guards actually run in CI.

## The problem, stated honestly

**77 test files under `supabase/tests/` never execute.** They belong to the `db` lane, that lane refuses
to run without an isolated target, and no such target exists. A whole lane not running looks exactly
like everything passing — it went unnoticed for weeks. `tests/qa/unit/db-lane-coverage.test.js` exists
only to make the number loud; it is a smoke alarm, not a fix.

Among the dark guards are behavioural proofs for consent, notification boundaries, anon closure and
ownership — the highest-consequence code in the repository.

## Constraints already established — do not re-litigate these

Read `docs/upr-build-fix-backlog.md` §6.1 for the full analysis. The load-bearing conclusions:

- **54 of the 77 files are write-capable.** Pointing the lane at the shared production project is
  therefore not an option, ever. `database-standard.md` §13 says the same thing as law.
- **Local Docker (`supabase db start`) is ruled out.** There are ~236 local migration files against
  ~398 live ledger entries. Replaying `supabase/migrations/` builds a schema that is *not* production's,
  so green tests would be false confidence — worse than no tests. Do not "fix" this by replaying
  migrations locally.
- **The chosen mechanism is an ephemeral Supabase preview branch.** It clones the live schema, which
  sidesteps the migration-history gap entirely. Branching is confirmed available on this project.
- It is **paid per branch per day**, which is why the lifecycle must be create → run → destroy in the
  same CI job rather than a long-lived branch.

## Task 0 — The spend decision (blocking, owner-only)

Supabase branching costs money per branch per day. Before creating anything, put the numbers to the
owner: the per-branch daily rate, how many CI runs per day the repo currently does (derive it from
recent workflow history, do not guess), and the resulting monthly estimate for a create-and-destroy
lifecycle. Offer the obvious cost controls as options rather than assuming one:

- run the db lane only on PRs into `main`, not every push
- run it nightly on `dev` instead of per-commit
- run it only when the diff touches `supabase/**`

**Do not create a branch until the owner has approved a specific shape.** Creating one is a live,
billable action on their account.

## Task 1 — Make the lane runnable against a branch

`scripts/qa/run-local-db-tests.mjs` currently refuses unless `UPR_QA_LOCAL_SENTINEL` matches a
local-stack sentinel and `SUPABASE_ANON_KEY` is the local key. That refusal is correct and protective —
extend it, do not weaken it.

What is needed:

1. A **second accepted target**: a Supabase preview branch, identified by its own sentinel and its own
   project ref. The runner must still **refuse the shared production ref** outright. That refusal is the
   single most important line of code in this task; test it explicitly.
2. The branch's URL, anon key and service-role key threaded in as CI secrets — never committed, never
   echoed into logs.
3. `vitest.config.js` already gates on `UPR_TEST_LANE`; confirm the `db` lane resolves correctly with
   the new target and that a wrong or missing sentinel still fails closed.

## Task 2 — Wire the CI lifecycle

In `.github/workflows/ci.yml`, on whichever trigger the owner approved:

create branch → wait for it to be ready → run the `db` lane against it → **destroy it, even if the
tests fail** (an `always()`-style teardown; a leaked branch bills daily). Then surface the real result.

Do not let a branch-creation failure silently pass the job as green. A lane that cannot run must fail
loudly — that is the entire lesson this item exists to encode.

## Task 3 — Retire the smoke alarm

Once the lane genuinely runs in CI, **delete `tests/qa/unit/db-lane-coverage.test.js`.** Its own header
says this explicitly: "When that lands, this file should be deleted, not rebaselined to zero." Do not
leave it asserting a stale premise, and do not set `DARK_BASELINE = 0` — a guard asserting nothing is
worse than no guard, because it reads as coverage.

Expect real failures on the first genuine run. Some of those 77 files have never executed; several were
written against a schema that has since moved. Triage them honestly: fix, or delete with a stated
reason, or mark clearly as expected-fail with a tracking item. **Do not make them pass by weakening an
assertion** — several assert consent and authorization boundaries where a weakened test is worse than a
deleted one.

## Task 4 — Report what changed about the risk

Update `docs/upr-build-fix-backlog.md` §6.1, and say plainly: how many of the 77 now pass, how many
fail, how many were deleted and why. The point of this work is honest coverage, so a report that reads
"lane is green" while ten guards were quietly removed would defeat it.

## Environment notes

- **Check whether you have Supabase MCP tools at all.** There is no project-scoped MCP config
  (`.mcp.json` absent), so those servers are configured per account. Without them you can still do the
  runner and CI work, but you cannot create or inspect a branch — hand those steps back explicitly.
- Free-form SQL is denied by policy; read-only catalog work goes through `upr_rpc` with
  `fn: "exec_read_sql"` and the parameter **`p_query`**.
- Tests run through the npm scripts; raw `npx vitest` fails with
  `UPR_TEST_LANE must be exactly unit, worker, qa, or db`.
- The main checkout may carry another session's uncommitted files — work in a worktree and stage by
  explicit path.

## Hard constraints

- **Never point the db lane at project `glsmljpabrwonfiltiqm`** (the shared production project). 54 of
  these tests write.
- Do not create, pause or delete any Supabase branch before the owner approves the spend and shape.
- Do not commit a key. Do not weaken the runner's refusal path.
- Report actual results, never expected. Say plainly what you skipped and why.
