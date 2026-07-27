---
name: new-crm-module
description: Implement a currently active UPR CRM roadmap phase within its committed acceptance criteria and ownership manifest. Use only when the requested work is an active CRM phase; route initiative redesign to masterplan and database-primary work through db-migration. Live database apply, tracker/status writes, cleanup, commit, push, PR, and deployment remain separately authorized.
---

<!-- GENERATED from tooling/skills/new-crm-module/SKILL.md by scripts/render-tooling-adapters.mjs. Do not edit this adapter directly. Source SHA-256: 415b1a3d0440d934. -->

# New CRM module

This dispatcher executes one active CRM phase; it does not invent a new phase or bypass its plan.

1. Read `AGENTS.md`, `CLAUDE.md`, the target block in `docs/crm-roadmap.md`, its current dispatch
   block, the active ownership manifest, `docs/crm-lead-lifecycle.md` when counting or lifecycle is
   affected, and every applicable canonical/rule document.
2. Run `git status --short --branch`. Verify the phase is active, prerequisites are real, files and
   database objects are leased to this phase, flags/stubs are current, and the registry does not show
   a conflicting unfinished implementation.
3. Convert the committed phase criteria into positive, negative, failure, rollback, and close-out
   tests. Do not broaden scope merely because an older scaffold expected one table, Worker, screen,
   route, or icon.
4. Route each database portion through `db-migration`. Author migrations before dependent code when
   the phase contract requires them, but never apply to the shared database without separate
   authorization. Preserve `org_id`, external-ID idempotency, RLS, ACL, caller, and deployed-contract
   requirements from the current database standard.
5. Keep `/crm/*` behind the existing CRM feature/access boundary. Reuse current route, navigation,
   icon, component, query, toast, confirmation, lifecycle, and error-state patterns instead of
   reproducing old scaffolding recipes.
6. Workers enforce session, employee membership, and role/capability server-side. Messaging uses the
   consent gate. Money and external side effects use stable idempotency and the focused domain rules.
7. Run targeted tests plus the repository close-out. Select reviewers from the actual diff:
   UI three-reviewer gauntlet, database reviewers, Worker security, consent, motion, and the
   `crm-phase-reviewer`.
8. Reconcile roadmap and tracker claims both directions, but mutate database-backed status only when
   separately authorized. Update canonical docs, `UPR-Web-Context.md`, the registry, and ownership
   manifest when their governed facts changed.

Finish with exact files, tests/reviewers/results, migration apply state, flag/deployment state,
remaining owner/external gates, rollback, branch, and working tree. Commit, push, PR, deploy, live
apply, status writes, cleanup, and feature activation occur only when explicitly requested.
