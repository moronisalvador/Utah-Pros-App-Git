# Database Standard — UPR Platform

**Authored by DB-Foundation Phase F (2026-07-08). Binding for every migration and
every session that touches `supabase/migrations/`, RPCs, policies, or grants.**
Linked from `CLAUDE.md` and `docs/db-foundation-roadmap.md`. Where this file and a
roadmap's prose disagree on a grant or safety rule, **this file is authoritative** —
it reflects what is verified live on the shared project `glsmljpabrwonfiltiqm`.

One shared Supabase backs **dev AND production**. Every migration is live in prod
the moment it applies. **Verify live schema via the Supabase MCP, never memory**
(`pg_get_functiondef`, `information_schema.columns`, `pg_policies`, `pg_default_acl`).

---

## §1 — Migration discipline (hard constraints)

- **Additive / policy-grant / index-only.** New tables, columns, indexes, policies,
  grants, and function bodies only. **No `DROP`, `RENAME`, or tightening `ALTER`**
  (type/nullability/constraint) on a **live** table inside a phase — destructive
  changes to shared data are their own separately-reviewed change.
- **Rollback note on every migration.** A commented `ROLLBACK:` block with the exact
  inverse statements.
- **RLS at creation (CLAUDE.md Rule 7).** Every new table is `ENABLE ROW LEVEL
  SECURITY` + an explicit policy in the same migration. An RLS table with no policy
  is deny-all (correct for secret stores; see §3).
- **Frontend-contract freeze.** No column rename/move and **no RPC return-shape
  change** for any RPC a shipped client calls. A `CREATE OR REPLACE` of a live RPC
  keeps the existing signature callable (new params take `DEFAULT`), rebuilt from the
  **drift-dumped live body** (the repo file may lag the live definition).
- **Drift-dump before you replace.** `SELECT pg_get_functiondef('public.fn'::regprocedure)`
  first; edit that, not the repo copy.

## §2 — Grants: least privilege, and the anon allowlist

Default posture: **`GRANT EXECUTE TO authenticated, service_role` — never `anon`.**

Two roles reach the database from untrusted places: `anon` (the browser, logged-out)
and `authenticated` (a signed-in session). `service_role` is the trusted worker key.
`anon` gets access **only** when the surface is genuinely public, and then only by an
**explicit, reviewed `GRANT ... TO anon`** — never by default.

**Verified platform nuance (2026-07-08).** `ALTER DEFAULT PRIVILEGES ... REVOKE ...
FROM anon` (shipped by Phase F) reliably denies anon on new **tables and sequences**.
But this managed Supabase re-applies PostgreSQL's built-in `EXECUTE TO PUBLIC` to
every **new function** on `ddl_command_end`, and `anon ∈ PUBLIC`. **Therefore every
function migration MUST explicitly**:

```sql
REVOKE ALL ON FUNCTION public.fn(args) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn(args) TO authenticated, service_role;  -- add anon ONLY if on the allowlist
```

Omitting the `REVOKE ... FROM PUBLIC, anon` leaves the function anon-executable no
matter what the default privileges say. `migration-safety-checker` / the
db-foundation reviewer flag any new function lacking an explicit grant block.

**The anon allowlist** — the *only* surfaces where `GRANT EXECUTE TO anon` (or an anon
RLS policy) is sanctioned, because they are reached by logged-out visitors:

| Surface | Objects (representative) |
|---|---|
| Public build-status page (`/status`) | `get_crm_build_progress` (read-only) |
| Public web forms / lead capture | `upsert_lead_from_form`, `upsert_form`→public read, `form_submissions` insert |
| E-sign by token (customer link) | `get_sign_request_by_token`, `complete_sign_request` |
| Email tracking / unsubscribe | `record_email_open`, `email_unsubscribe` |
| Append-only event log | `system_events` anon INSERT (`log_system_event` / click-to-call) + SELECT, both RLS-policied. Anon has NO `UPDATE/DELETE/TRUNCATE` — those were revoked (Phase F): `TRUNCATE` bypasses RLS and would let anon wipe the log. |
| Dashboard headline counts | `get_dashboard_stats` (existing; captured by Phase F) |

Anything **not** on this list is `authenticated`+`service_role` only. Adding a row to
this table is a reviewed change; a write RPC (`set_*`, `upsert_*`, `delete_*`) is
**never** anon unless it is itself an unauthenticated public-form path with its own
in-body validation.

**Secret stores are deny-all** (§3) — never granted a readable policy for anon *or*
authenticated.

## §3 — Secret-store deny-all invariant

`integration_credentials`, `integration_config`, and `user_google_accounts` hold
payment/SMS/email secrets and per-user OAuth tokens. They are **RLS-enabled with ZERO
policies** — deny-all to anon AND authenticated. Only `service_role` (workers) and
`SECURITY DEFINER` RPCs reach them, and every write RPC re-checks admin via
`p9_assert_admin()`. **Never add a client-readable policy to these tables.** The gate
`supabase/tests/db_foundation_secret_exposure.sql` (+ the vitest companion) enforces
this — run it after any migration that could touch their posture.

## §4 — Triggers on hot/financial tables

Triggers on `claims`, `invoices`, `payments`, `jobs`, `estimates` (money/lifecycle
tables) must be **narrow and defensive**:

- **Never a bare `AFTER UPDATE`.** Scope to the column (`AFTER UPDATE OF status`) AND
  guard with `WHEN (OLD.col IS DISTINCT FROM NEW.col)` so it fires only on a real
  change.
- **Defensive body.** Wrap side-effect writes in their own `BEGIN … EXCEPTION WHEN
  OTHERS THEN RAISE WARNING … END` so a trigger failure can **never** roll back the
  parent financial write.
- **`status` is CHECK-constrained** on `claims`/`invoices` — a test that flips status
  must use two valid enum values, not a synthetic marker.

## §5 — Mountain-Time helpers

Bucket "today"/"this week" in `America/Denver`, never UTC. Use `public.mt_date(ts)`
(IMMUTABLE — index/generated-column safe) and `public.mt_today()` (STABLE — reads
`now()`). Both are `authenticated`+`service_role` only.

## §6 — Drift reconciliation

`supabase/migrations/` is the source of truth, but the live DB has predated it —
objects exist live with no `CREATE` in any migration. Capture genuinely-untracked
live objects by **re-deriving them from the live catalog** (`pg_get_functiondef`,
`information_schema`), idempotently (`CREATE TABLE IF NOT EXISTS` / `CREATE OR
REPLACE` with the identical body) so applying to live is a no-op. `db/baseline/` holds
the committed snapshot; `scripts/db-drift-check.{sql,mjs}` regenerate + diff it and
list untracked objects. **Never "capture" an object that isn't live** — verify with
`to_regclass` first.

## §7 — Testing (one shared production Supabase)

- **Test-first.** Commit the failing/guard test before the code.
- **`.sql` gates** in `supabase/tests/` are run via the Supabase MCP (`execute_sql`).
  They RAISE on failure and are **non-destructive**: read-only, or `BEGIN … ROLLBACK`
  around any transient write on a real row. `.test.js` gates are vitest integration
  tests that **self-skip without creds** (CI has none) and mirror the CRM suites.
- **Never assert on live row counts** beyond fixtures you control; clean up any
  persisted TEST rows.
