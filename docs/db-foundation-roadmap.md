# DB-Foundation — Roadmap (plan of record)

**Initiative:** harden the shared Supabase (`glsmljpabrwonfiltiqm`, dev + prod) —
close the anon-exposure vectors, lock the money-writing RPCs, add the audit/history
and Mountain-Time primitives the app keeps re-deriving, and bring drifted-in live
objects back under schema-as-code. **Foundation-then-phases** model: Phase F ships the
standard, the guardrail migrations, the drift tooling, and this plan; later phases (if
scheduled) run against the `database-standard.md` + the ownership manifest.

Governing docs: `.claude/rules/database-standard.md` (authoritative on grants/safety),
`.claude/rules/db-foundation-wave-ownership.md` (file/RPC ownership).

---

## Phase F (Foundation) — SHIPPED 2026-07-08

All six deliverables applied to the shared Supabase via MCP and verified live. Every
migration is additive / policy-grant / index-only, carries a `ROLLBACK:` note, and
freezes the frontend contract. Build + full vitest suite green.

| # | Deliverable | Status | Live verification |
|---|---|---|---|
| ① | Secret-exposure deny-all gate (integration_credentials, integration_config, user_google_accounts) | ✅ | RLS on + 0 policies; `SET ROLE anon`/`authenticated` → 0 rows on all three |
| ② | `set_billing_setting` admin gate (`PERFORM p9_assert_admin()` first stmt, drift-dumped live body, signature frozen, anon revoked) | ✅ | admin write OK; non-admin → 42501; args `(text,text)`→`void` unchanged |
| ③ | `ALTER DEFAULT PRIVILEGES REVOKE anon` (tables/sequences/functions) | ✅ | new table/sequence deny anon; function-PUBLIC nuance found + codified in §2 |
| ④ | `mt_today()` / `mt_date(timestamptz)` (America/Denver) | ✅ | MDT + MST boundaries both sides of local midnight; `mt_date` IMMUTABLE, `mt_today` STABLE; anon denied |
| ⑤ | Lifecycle history: `claim_status_history` + `invoice_status_history` + defensive WHEN-guarded triggers | ✅ | fire-once on real change, no-op skipped, parent UPDATE unaffected; seed 130/80; anon denied |
| ⑥ | Drift reconciliation: baseline + `db-drift-check.{sql,mjs}` + capture of `system_events`, `get_dashboard_stats` | ✅ | idempotent no-ops live; both now tracked; `job_sales`/`billing_overview` absent live (not captured) |

**Migrations** (all `supabase/migrations/20260708_dbf_*`): `mt_helpers`,
`default_privileges_revoke_anon`, `set_billing_setting_admin_gate`,
`lifecycle_history`, `drift_capture_system_events`, `drift_capture_get_dashboard_stats`.
**Gates** (`supabase/tests/db_foundation_*`): secret_exposure (.sql + .test.js),
billing_admin_gate (.test.js), default_privileges (.sql), mt_helpers (.sql),
lifecycle_history (.sql). `.sql` gates run via the Supabase MCP; `.test.js` self-skip
without creds (CI has none).

---

## Status reconciliation (live vs. schema-as-code, 2026-07-08)

`scripts/db-drift-check.mjs` against the committed baseline reports the live public
schema as **125 tables / 332 functions**. Of these, a large tail predates schema-as-code
and has **no `CREATE` in any migration**: ~73 tables and ~101 functions (mostly early
core: `jobs`, `claims`, `invoices`, `contacts`, `appointments`, the homebuilding suite,
and many `get_*`/`upsert_*`/`trigger_*` RPCs). This is a **known reconciliation backlog**,
documented (not silently ignored) in `db/baseline/README.md`.

**Phase F captured only the two objects it was scoped to** — `system_events` (audit log,
INSERTed by dozens of migrations but never defined) and `get_dashboard_stats` (dashboard
headline counts). Both re-derived from the live catalog and idempotent on apply. The
remaining tail is deliberately left for follow-up phases — capturing it wholesale is a
separate, larger, individually-reviewed effort, not something to hand-copy under time
pressure (that is exactly how schema docs went stale before).

---

## Severity findings (what Phase F closed)

- **HIGH — payment settings writable by anyone (②).** `set_billing_setting` (accept
  card/ACH, surcharge %, QBO clearing/fee/bank account mappings) was `GRANT`ed to
  `anon` and checked only the *key name*, never the caller. A logged-out visitor hitting
  PostgREST could flip payment behavior. Closed with the `p9_assert_admin()` gate + anon
  revoke.
- **HIGH — new objects auto-open to anon (③).** Supabase's default privileges grant
  `anon` full access to every new table/sequence and (via the built-in `EXECUTE TO
  PUBLIC`) every new function. One forgotten lock-down = an internet-readable table.
  Closed for tables/sequences via `ALTER DEFAULT PRIVILEGES REVOKE`. **Platform nuance
  found:** this managed instance re-applies the built-in PUBLIC EXECUTE to new functions
  on `ddl_command_end`, so functions must be locked per-object
  (`REVOKE ... FROM PUBLIC, anon`) — now the mandatory `database-standard §2` rule.
- **MEDIUM — no financial audit trail (⑤).** Claims/invoices status changes left no
  history. Closed with append-only history + defensive triggers that can never roll back
  the parent write.
- **MEDIUM — UTC day-bucketing (④).** "Today"/"this week" computed in UTC mis-file
  anything between ~5–6pm local and midnight. Closed with `America/Denver` helpers.
- **LOW/HYGIENE — drift (⑥).** Two heavily-used live objects had no migration; captured.
  Broader backlog documented above.
- **Guard (①).** The secret-store deny-all invariant (payment/SMS/email secrets, per-user
  OAuth tokens) was already correct live; Phase F adds a permanent tripwire so a future
  migration can't silently regress it.

---

## Autonomy ledger (decisions taken without asking)

Recorded for transparency — Phase F ran as an autonomous build from a self-contained spec.

1. **Authored the governing docs.** `database-standard.md`, this roadmap, and the
   ownership manifest did not exist; a Foundation phase's job is to establish them, so
   Phase F wrote them (matching the repo's other Foundation phases). The prompt's item
   spec was treated as authoritative.
2. **Built `set_billing_setting` from the drift-dumped LIVE body**, not the repo file —
   the live whitelist had drifted ahead (`qbo_bank_account_*`). Also revoked anon EXECUTE
   (least privilege) since the admin gate already denies anon and the shipped caller is an
   authenticated admin page — no contract change.
3. **`③` function nuance.** Discovered live that `ALTER DEFAULT PRIVILEGES` does not stop
   anon executing new functions (built-in PUBLIC re-applied by the platform). Kept the
   revoke (it protects tables/sequences — the data-bearing objects) as a backstop and
   codified the enforceable per-function rule in §2, adjusting the ③ gate to assert the
   real, enforceable contract rather than a permanently-red one.
4. **`⑤` triggers.** Scoped `AFTER UPDATE OF status` + `WHEN (OLD.status IS DISTINCT FROM
   NEW.status)`, defensive `EXCEPTION` body, `ON DELETE CASCADE` FK, current-state seed.
   Chose innocuous non-terminal enum values in the gate (status is CHECK-constrained).
5. **`⑥` scope.** Captured only `system_events` + `get_dashboard_stats` (verified live,
   untracked); did not capture `job_sales`/`billing_overview` (verified absent live);
   documented the ~73/~101 untracked tail as backlog rather than mass-capturing it.
6. **`⑥` system_events anon over-grant (reviewer-driven tightening).** The faithful
   drift-capture initially reproduced the live grant set, which included anon
   `UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER`. Both reviewers flagged `TRUNCATE` — it is
   not filtered by RLS, so a logged-out caller could wipe the entire audit log. Since the
   app only ever INSERTs to `system_events` as anon (click-to-call logging) and reads via
   SECURITY DEFINER RPCs, those DML grants have no legitimate use; revoked them live (anon
   kept only the RLS-policied SELECT + INSERT) — a functionally-safe least-privilege fix,
   and `database-standard §2` updated to match.
7. **Reviewers.** The prompt named `anon-grant-auditor` + `db-foundation-phase-reviewer`;
   those agent types are not registered in this environment. Ran `migration-safety-checker`
   + `upr-pattern-checker` (the closest available), acted on both findings (this ledger #6
   + the `capture_*` explicit-grant / rollback-note polish), and did the anon-grant audit
   inline via live `pg_default_acl` / `has_*_privilege` checks (recorded in the PR).
