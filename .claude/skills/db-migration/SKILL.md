---
name: db-migration
description: Plan or author a SAFE Supabase migration the UPR way, and apply it only when the owner separately authorizes that live action. This is the UPR dispatcher for schema, RPC, policy, grant, constraint, and index changes; vendor database skills are advisory.
---

# db-migration

The safe path for changing the database. One shared Supabase (`glsmljpabrwonfiltiqm`) sits behind
BOTH `dev` and production, so **every migration is live for real customers the instant it applies** —
this skill makes the safe sequence automatic. Ground rules: `.claude/rules/database-standard.md`
(the standard) + `CLAUDE.md` Rule 7. Follow in order.

**Authority gate:** planning, repository authoring, live apply, and publication are separate. Do not
author unless implementation was requested. Do not call `apply_migration` or mutation-capable direct
SQL unless the owner explicitly asks to apply the exact reviewed migration in this task. Do not
commit, push, open a PR, deploy, or mutate live cleanup/status data unless separately requested.

## 1. Understand the live truth first (never from memory)
- Read the actual tables/RPCs you'll touch via the Supabase MCP: `information_schema.columns` for real
  column names (tables have 20–60+ columns), `pg_policies` for current RLS, `pg_get_functiondef` for
  any RPC you'll replace (**some live functions are NOT in `supabase/migrations/` — drift-dump them
  first, or your replace silently drops their real body/`search_path`/`SECURITY DEFINER`**).
- Decide the change **class**: additive (new table/column/index/RPC), backward-compatible replace,
  policy/grant change, constraint, or data repair. Removals (`DROP`/`RENAME`/tightening `ALTER`) on a
  live table are **not allowed here** — they need a separate reviewed change.

## 2. Write the failing test FIRST
- Money math, data writes, idempotency, auth gates, date/timezone, and any RPC the frontend reads get
  a failing test before the SQL (`supabase/tests/` integration test, or a `vitest` unit test
  for pure JS). Self-skip without creds (mirror the existing suites); use disposable fixture IDs; never
  assert on live row counts. The test need not be committed unless delivery was requested. Never
  weaken a valid failing test to green it — fix the code.

## 3. Write the migration to `.claude/rules/database-standard.md`
- **Additive-only.** New tables/columns/indexes/constraints-on-new-columns. No `DROP`/`RENAME`/tightening
  `ALTER` on a live table.
- **RLS at creation, scoped to the real access model.** Browser-readable tables get operation-specific
  policies using owner, assignment, role, organization, or capability predicates. `USING (true)` is
  blocking unless the table is explicitly documented company-wide. Service-only secret/internal
  tables may intentionally have RLS with no browser policy. `anon` is only allowed through §2.
- **Least-privilege functions and grants.** Prefer `SECURITY INVOKER`. A necessary `SECURITY DEFINER`
  function validates the caller inside the function, pins `search_path`, explicitly revokes
  `EXECUTE` from `PUBLIC, anon`, and grants only to intended callers. Do not grant browser or service
  roles reflexively. New views use `security_invoker` and explicit least-privilege ACLs.
- **Backward-compatible replace.** A `CREATE OR REPLACE` of a live RPC keeps the exact signature (new
  params `DEFAULT`) and return shape — the **frontend contract is frozen** (no column rename/move, no
  return-shape change a deployed page reads). Grep `src/` for the RPC name; keep every caller working.
- **Secrets.** No credential/token/API key in a column readable by `anon`/`authenticated`; secret tables
  stay RLS-deny-all (no policy) + no RPC returns the secret value. No migration `INSERT` seeds a secret.
- **Constraints on real data.** Add `UNIQUE`/`FK`/`CHECK` only after checking existing rows comply
  (`SELECT` the violators first); repair non-canonical duplicates before the constraint. Use
  `ADD CONSTRAINT ... NOT VALID` → `VALIDATE CONSTRAINT` to keep the exclusive-lock window to ms.
- **Time.** `timestamptz` columns; day/week bucketing in `America/Denver` (never UTC/server-local).
- **Header + rollback note.** Plain-language `-- WHAT / WHY / TABLES+RPCS / -- Rollback:` at the top —
  the undo is the prior function body, the `DROP`/deactivation of the additive object, or the re-`GRANT`.
  A migration with no stated undo is not done.

## 4. Apply + verify on the shared prod DB (only when separately authorized)
- Without a fresh owner instruction to apply this exact reviewed migration, stop with the authored
  migration, tests, rollback, review findings, and apply plan. Never use `execute_sql` for iterative
  schema work on the shared project.
- When explicitly authorized, apply via Supabase MCP `apply_migration` in a low-traffic window.
  **Sequence so consuming code deploys
  first** for any additive column the frontend will read. If two migrations strong-lock the same hot
  tables (`CREATE/DROP POLICY`, `ADD CONSTRAINT`, `ADD/DROP INDEX`), don't overlap their apply windows.
- Re-query live to prove it worked (the row is there, the policy scopes to `authenticated`, the RPC
  returns the expected shape, `anon` still can't read what it shouldn't).

## 5. Review gauntlet + ship
- Run **`migration-safety-checker`** (additive-only, RLS, least-privilege) **and `anon-grant-auditor`**
  (no stray `anon`, no secret exposure) on the migration; for a DB Foundation phase also
  **`db-foundation-phase-reviewer`**. Then `npm run test` + `npm run build` green.
- Update `UPR-Web-Context.md` (Rule 9) for any new/changed table/RPC. Delete disposable test rows.
- If publication was explicitly requested, land per `CLAUDE.md` Rule 4. Otherwise stop with a diff
  and verification report. Never push `main` directly.
