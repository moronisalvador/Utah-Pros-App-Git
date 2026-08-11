---
branch: claude/admiring-jones-714a09
ships: true
opened: 2026-08-09
---

# What

Unify Admin Mobile invoice and estimate presentation/line interactions, add the missing native New
Invoice flow, replace the legacy native estimate builder, and extend both QuickBooks paths with
provider-first durable line create/update/delete/reorder commands.

# Why it matters

Admins need the same predictable financial-document experience on iPhone without a screen that only
looks equivalent while persisting different accounting outcomes. A known QBO rejection must not
leave either document locally changed, and native document creation must reuse the existing guarded,
idempotent shells instead of inventing duplicate jobs, estimates, or invoices.

# Next action

Package the exact, locally qualified P4c candidate reconstructed on `origin/main` in a named local
branch after fresh owner `AUTH-GIT`. Repository implementation, all four disposable database
qualifiers, and blocking review lanes are complete. All six migrations
`20260810010000` through `20260810182905` remain authored and unapplied; commit, push, config,
Pages/MCP deployment, shared-database apply, and provider verification remain separately
owner-gated under `docs/admin-mobile-p4c-production-runbook.md`.
