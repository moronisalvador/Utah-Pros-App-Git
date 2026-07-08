---
name: db-migration
description: Author and ship a SAFE Supabase migration the UPR way — additive-only, least-privilege RLS/grants, secrets never plaintext-readable, a rollback note, apply-window discipline on the one shared prod DB, test-first, and the reviewer-agent gauntlet. Use for any schema/RPC/policy/index change (new table or column, new or replaced RPC, RLS/grant change, constraint, index). The guided companion to `.claude/rules/database-standard.md`.
---

# db-migration

The safe path for changing the database. One shared Supabase (`glsmljpabrwonfiltiqm`) sits behind
BOTH `dev` and production, so **every migration is live for real customers the instant it applies** —
this skill makes the safe sequence automatic. Ground rules: `.claude/rules/database-standard.md`
(the standard) + `CLAUDE.md` Rule 7. Follow in order.

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
  a committed failing test before the SQL (`supabase/tests/` integration test, or a `vitest` unit test
  for pure JS). Self-skip without creds (mirror the existing suites); use disposable fixture IDs; never
  assert on live row counts. Never edit a committed test to green it — fix the code.

## 3. Write the migration to `.claude/rules/database-standard.md`
- **Additive-only.** New tables/columns/indexes/constraints-on-new-columns. No `DROP`/`RENAME`/tightening
  `ALTER` on a live table.
- **RLS at creation, scoped `TO authenticated`.** Every `CREATE TABLE` gets `ENABLE ROW LEVEL SECURITY`
  + an explicit policy `TO authenticated` (floor `USING (true)`; tighten to an ownership/org predicate
  for per-user/per-org data). A policy `TO anon`/`TO public` is only allowed for a genuinely public
  surface via the standard's §2 allowlist + a `-- public: <reason>` comment.
- **Least-privilege grants.** `SECURITY DEFINER` RPC + `GRANT EXECUTE TO authenticated, service_role`
  — **never `anon`** outside the allowlist. New views: `WITH (security_invoker = true)` +
  `REVOKE ALL ... FROM anon` (Postgres default-privileges would otherwise re-grant `anon`).
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

## 4. Apply + verify on the shared prod DB (carefully)
- Apply via Supabase MCP `apply_migration` in a low-traffic window. **Sequence so consuming code deploys
  first** for any additive column the frontend will read. If two migrations strong-lock the same hot
  tables (`CREATE/DROP POLICY`, `ADD CONSTRAINT`, `ADD/DROP INDEX`), don't overlap their apply windows.
- Re-query live to prove it worked (the row is there, the policy scopes to `authenticated`, the RPC
  returns the expected shape, `anon` still can't read what it shouldn't).

## 5. Review gauntlet + ship
- Run **`migration-safety-checker`** (additive-only, RLS, least-privilege) **and `anon-grant-auditor`**
  (no stray `anon`, no secret exposure) on the migration; for a DB Foundation phase also
  **`db-foundation-phase-reviewer`**. Then `npm run test` + `npm run build` green.
- Update `UPR-Web-Context.md` (Rule 9) for any new/changed table/RPC. Delete disposable test rows.
- Land per `CLAUDE.md` Rule 4: routine → commit to `dev`; a wave phase → PR into `dev` as a handoff.
  Never a direct `main` push.
