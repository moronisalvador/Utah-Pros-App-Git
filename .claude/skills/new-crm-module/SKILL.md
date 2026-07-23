---
name: new-crm-module
description: Conditionally implement an active CRM roadmap phase within its ownership manifest. Repository migrations are authored first when in scope; live apply, status writes, commit, push, and PR delivery require separate explicit authorization.
---

# new-crm-module

Scaffold the repeated per-phase shape for a CRM roadmap phase. Read the target phase's
block in `docs/crm-roadmap.md` first, then produce (following every rule in `CLAUDE.md`,
esp. the CRM Phase Workflow + Rule 7 migration rules):

1. **Migration first** (`supabase/migrations/`, authored but not applied unless the owner separately
   authorizes the exact reviewed migration):
   each new table additive-only with `org_id UUID` (FK `crm_orgs`), `ENABLE ROW LEVEL
   SECURITY` + an explicit policy at creation, and a `UNIQUE` constraint on any external
   system ID for idempotent upserts. No `ALTER`/`DROP` of a live table.
2. **RPCs:** prefer `SECURITY INVOKER`. A necessary `SECURITY DEFINER` RPC validates the caller,
   pins `search_path`, revokes `PUBLIC, anon`, and grants only intended callers. Policies enforce
   owner/role/assignment/org scope; `authenticated` alone is not authorization. `anon` requires the
   §2 allowlist + reason + abuse tests. Frontend writes use the approved narrow contract.
3. **Route + nav:** a `/crm/<screen>` route wrapped in `<FeatureRoute flag="page:crm">`, a
   CRM sidebar entry, and an `IconXxx(p)` SVG following `src/lib/navItems.jsx`.
4. **Failing test first:** write the relevant unit/integration test before implementation. Do not
   run SQL tests against the shared project without authorization, and do not commit unless delivery
   was requested.
5. **Close-out reminders:** only when explicitly authorized, set the phase status via
   `set_crm_phase_status`; update `UPR-Web-Context.md` (Rule 9); run `upr-pattern-checker`,
   `migration-safety-checker` + `anon-grant-auditor` (the migration), then `crm-phase-reviewer`;
   delete authorized disposable test rows; commit/push/PR only when separately requested.

Confirm real column names via `information_schema.columns` (or MCP schema tools) before
writing any query — never assume from memory.
