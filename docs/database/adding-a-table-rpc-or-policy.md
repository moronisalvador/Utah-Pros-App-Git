# How to Safely Add a Table / RPC / Policy

A step-by-step checklist for the most common database change. This is the practical companion to
`.claude/rules/database-standard.md` (the standing rules) — read that file for the *why*; this file
is the *how, in order*. For a guided walkthrough, use the `db-migration` skill.

Terms used below are defined in [`glossary.md`](glossary.md).

---

## Adding a new table

1. **Write the migration first**, in `supabase/migrations/`, named `YYYYMMDD_short_description.sql`.
   Never hand-edit the live database outside a migration file.
2. **Enable RLS in the same migration** — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` — and add an
   explicit policy. The floor is:
   ```sql
   CREATE POLICY <table>_all ON public.<table>
     FOR ALL TO authenticated USING (true) WITH CHECK (true);
   ```
   Tighten to an ownership/org predicate (`auth.uid()` → `employees` → assignment, or `org_id`) if the
   data is per-user or per-org — don't leave it at the floor by default.
3. **Never grant `anon`** unless the table must be reachable before login — and then only after
   adding a line to the allowlist in `database-standard.md` §2 with a `-- public: <reason>` comment
   in the migration.
4. **If the table needs to be queried right after creation**, use a `SECURITY DEFINER` RPC instead of
   `db.select()` — PostgREST's schema cache lags on brand-new tables (or call `bust_postgrest_cache()`
   after deploy).
5. **Add a rollback note** — for a new table this is just the `DROP TABLE IF EXISTS ...` (or
   deactivation) a reviewer could run to undo it.
6. **Apply via Supabase MCP `apply_migration`**, not manual SQL — this keeps the migration file and
   the live database in sync, which is what `db-drift-check.mjs` verifies.
7. **Update `UPR-Web-Context.md`** (Rule 9) — add the table to `## Database — All Tables` in the
   right subsection. Do not duplicate the schema into this guide or anywhere else.

## Adding a new RPC

1. `SECURITY DEFINER`, and — **important, verified in DB-Foundation Phase F** — this project
   re-applies Postgres's built-in `EXECUTE TO PUBLIC` to every new function automatically. Add an
   explicit `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;` immediately before the `GRANT`, every
   time — the schema-wide `ALTER DEFAULT PRIVILEGES` revoke does not reliably cover functions.
2. `GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role;` — never `anon` unless it's an
   allowlisted pre-login RPC (`database-standard.md` §2).
3. If the RPC replaces a **live** function other code already calls, keep the old signature callable
   (new params get `DEFAULT`s) and add a committed test asserting the existing caller still succeeds.
   This is the "frontend-contract freeze" from `database-standard.md` §3 — a `CREATE OR REPLACE` is
   live in production the instant it applies, while the frontend deploys on its own schedule.
4. Add a rollback note: for a brand-new function, the `DROP FUNCTION IF EXISTS ...`; for a replace,
   the prior body pasted into the migration's rollback comment (see any `20260703_*` migration for
   the pattern).
5. Test-first where the RPC is money/consent/admin-gated — a raises-for-non-admin /
   succeeds-for-admin pair at minimum.
6. Update `UPR-Web-Context.md` → `## All RPCs`, in the relevant subsection.

## Adding/changing a policy

1. Policies are additive/idempotent-friendly — prefer `DROP POLICY IF EXISTS <name> ON <table>;`
   immediately before `CREATE POLICY ...` so a re-run of the migration is a no-op, not an error.
2. Scope to `TO authenticated` by default; `anon` only via the allowlist (§2 of
   `database-standard.md`).
3. If this policy recreate is part of a larger sweep across many tables (e.g. an anon-closure pass),
   chunk it into short, per-table, alphabetically-ordered statements so a partial apply is still
   coherent and re-runnable.
4. Never `DROP` a policy something depends on for **realtime** without checking first — e.g.
   `notifications_select` gets `ALTER POLICY ... TO authenticated`, not a drop-and-recreate, because
   Realtime subscriptions depend on the policy continuing to exist without a gap.
5. Rollback note: the prior policy definition (or the `DROP POLICY` for a newly-added one).

## Before you open the PR

- [ ] Migration is additive-only (no `DROP`/`RENAME`/tightening `ALTER COLUMN` on a live table).
- [ ] RLS enabled + explicit policy at creation, scoped to `authenticated` unless allowlisted.
- [ ] New/replaced function: explicit `REVOKE ... FROM PUBLIC, anon` before the `GRANT`.
- [ ] Rollback note present (`database-standard.md` §6).
- [ ] Apply-window checked against any other in-flight migration touching the same hot table
  (`database-standard.md` §5).
- [ ] Applied + verified live via Supabase MCP `apply_migration`, not by hand.
- [ ] `UPR-Web-Context.md` updated (Rule 9) — never left for "later."
- [ ] `migration-safety-checker` (and `anon-grant-auditor` if this touches grants/policies) come back
  clean.

If any box can't be checked, that's a signal to stop and flag it for a separate reviewed change
rather than force it through — see `CLAUDE.md`'s guidance on risky/hard-to-reverse actions.
