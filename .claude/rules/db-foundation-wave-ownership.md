# DB-Foundation — File & RPC Ownership Manifest

**Committed by DB-Foundation Phase F (Foundation), 2026-07-08. Binding for every
DB-Foundation session.** Linked from `CLAUDE.md`-adjacent workflow, `.claude/rules/
database-standard.md`, and `docs/db-foundation-roadmap.md` (the plan of record). Each
session's read scope = `CLAUDE.md` + its phase block in the roadmap +
`database-standard.md` + **this file**. Where the roadmap prose and this manifest
disagree on a name or path, **this manifest is authoritative** (it reflects what
Foundation actually shipped and verified live).

Isolation in this initiative is **not** the branch — it is (a) least-privilege grants
+ the secret-store deny-all invariant keeping every secret invisible regardless of
route, and (b) this ownership split. One shared Supabase backs dev + prod, so every
migration is live in prod on apply — sequence dependencies (helpers/tables before the
objects that read them) and verify live via MCP.

---

## 1. Frozen — Foundation owns these; nobody else re-touches them in a DB-Foundation phase

- `.claude/rules/database-standard.md` — the standard (grants, deny-all, trigger,
  MT, drift, test rules). Consume; a change is an F-owner follow-up.
- `.claude/rules/db-foundation-wave-ownership.md` — this manifest.
- `db/baseline/**` + `scripts/db-drift-check.{sql,mjs}` — the drift baseline + tooling.
  Regenerate the snapshot per the README; don't fork the scripts.
- The Phase-F migrations (`supabase/migrations/20260708_dbf_*.sql`) and their gates
  (`supabase/tests/db_foundation_*.{sql,test.js}`) — the shipped Foundation surface.
- The two shared RPC **REPLACEs** Foundation performed — `set_billing_setting`
  (admin gate) and `get_dashboard_stats` (drift capture). Do **not** re-REPLACE them;
  Foundation owns their signature + body.
- The `p9_assert_admin()` guard (owned since Settings P9) — **call it, never redefine**.

## 2. Phase-F deliverables (this phase — all shipped + verified live 2026-07-08)

| # | Deliverable | Objects | Verified |
|---|---|---|---|
| ① | Secret-exposure deny-all gate | `db_foundation_secret_exposure.{sql,test.js}` | anon+authenticated read 0 rows from all 3 secret stores |
| ② | `set_billing_setting` admin gate | `20260708_dbf_set_billing_setting_admin_gate.sql` | admin OK / non-admin 42501 / signature frozen / anon revoked |
| ③ | Default-privileges anon revoke | `20260708_dbf_default_privileges_revoke_anon.sql` + gate | new tables/sequences deny anon; §2 per-function rule documented |
| ④ | Mountain-Time helpers | `20260708_dbf_mt_helpers.sql` + gate | MT boundaries (MDT+MST); mt_date IMMUTABLE, mt_today STABLE; anon denied |
| ⑤ | Lifecycle history (claims+invoices) | `20260708_dbf_lifecycle_history.sql` + gate | fire-once, WHEN-guarded, parent-safe; seed 130/80; anon denied |
| ⑥ | Drift reconciliation | `20260708_dbf_drift_capture_{system_events,get_dashboard_stats}.sql`, `db/baseline/**`, `scripts/db-drift-check.*` | idempotent no-ops live; system_events/get_dashboard_stats now tracked |

## 3. Migration rule (this initiative)

Foundation owns 100% of the Phase-F schema/grant surface above. A **later**
DB-Foundation phase (see the roadmap's dependency graph) ships only its own
**additive / policy-grant / index-only** migrations and:

- **Never** `DROP`/`RENAME`/tightening-`ALTER` a live table (`database-standard §1`).
- **Never** re-REPLACE a frozen RPC (§1) or redefine `p9_assert_admin`.
- Locks every new function with `REVOKE ... FROM PUBLIC, anon` + explicit grants
  (`database-standard §2` — anon only from the allowlist).
- Rollback note on every migration; drift-dump before any live-RPC replace.
- Applies + verifies on the shared Supabase via MCP (helpers/tables before readers)
  and updates `db/baseline/` if the object inventory changed.

## 4. Close-out (every DB-Foundation session)

Commit (test-first) → `npm run test` + `npm run build` + `npx eslint` (changed files)
→ run the applicable `.sql` gates via MCP → `migration-safety-checker`
(+ the db-foundation reviewer / anon-grant audit where available) → apply migrations
live via MCP in a low-traffic window → delete any TEST rows → update
`UPR-Web-Context.md` + this manifest's status table → push `-u` → open a PR into `dev`
as a handoff → **STOP** (the owner merges).
