---
name: new-crm-module
description: Scaffold a CRM roadmap phase's building blocks following repo conventions — an org_id-scoped, RLS-enabled table + SECURITY DEFINER RPCs (migration-first), a page:crm-gated /crm route + nav entry + SVG icon, and a failing test committed before the code. Use when starting a phase in docs/crm-roadmap.md.
---

# new-crm-module

Scaffold the repeated per-phase shape for a CRM roadmap phase. Read the target phase's
block in `docs/crm-roadmap.md` first, then produce (following every rule in `CLAUDE.md`,
esp. the CRM Phase Workflow + Rule 7 migration rules):

1. **Migration first** (`supabase/migrations/`, applied via Supabase MCP `apply_migration`):
   each new table additive-only with `org_id UUID` (FK `crm_orgs`), `ENABLE ROW LEVEL
   SECURITY` + an explicit policy at creation, and a `UNIQUE` constraint on any external
   system ID for idempotent upserts. No `ALTER`/`DROP` of a live table.
2. **RPCs:** `SECURITY DEFINER`, `GRANT EXECUTE TO anon, authenticated`; `get_*` readers +
   upsert/update writers. Frontend writes go through `db.rpc()`, never direct PostgREST.
3. **Route + nav:** a `/crm/<screen>` route wrapped in `<FeatureRoute flag="page:crm">`, a
   CRM sidebar entry, and an `IconXxx(p)` SVG following `src/lib/navItems.jsx`.
4. **Failing test first:** a vitest unit test for pure JS helpers, or an integration test
   stub (SQL RPC vs the Supabase dev branch) — commit it and watch it fail before writing
   the implementation. Never edit a committed test to make it pass; fix the code.
5. **Close-out reminders:** set the phase's `crm_build_phases` status to `'shipped'` via
   `set_crm_phase_status`; update `UPR-Web-Context.md` (Rule 9); run `upr-pattern-checker`
   then `crm-phase-reviewer`; delete disposable test rows (dev tracking number / test
   `org_id`) before the `dev → main` PR.

Confirm real column names via `information_schema.columns` (or MCP schema tools) before
writing any query — never assume from memory.
