<!--
FILE: docs/upr-engineering-foundation-dispatch.md

WHAT THIS DOES (plain language):
  Provides cold-session prompts for reviewing and later executing the proposed Foundation program.
  Each prompt has a narrow scope and stops when authority or prerequisites are missing.

DEPENDS ON:
  Internal: docs/upr-engineering-foundation-roadmap.md,
            docs/upr-unfinished-work-registry.md,
            .claude/rules/upr-engineering-foundation-wave-ownership.md
  Data:     reads → documentation, source, Git, and approved read-only catalog metadata
            writes → only the files explicitly authorized by each future owner instruction

NOTES / GOTCHAS:
  - DRAFT. These blocks are not authorization to launch implementation.
  - Encircle landed at 0a06a21 and released its writer lease; its rollout tails remain owner-gated.
-->

# UPR Engineering Foundation — Cold-Session Dispatch Blocks

## Preconditions

Every session first:

1. Read `AGENTS.md` and `CLAUDE.md` completely.
2. Run `git status --short --branch` and preserve unrelated work.
3. Rebase/sync to current `origin/dev` only if the owner has authorized branch work.
4. Verify these plan files are on disk. If absent, stop; never recreate them from a chat:
   - `docs/upr-engineering-foundation-roadmap.md`
   - `docs/upr-unfinished-work-registry.md`
   - `.claude/rules/upr-engineering-foundation-wave-ownership.md`
5. Confirm no newer writer lease exists. Encircle’s code lease is released; its unapplied migration,
   OFF flag, unchanged credentials, and obsolete Netlify cleanup are rollout gates, not authority.

These blocks exist only on the local `codex/foundation-roadmap` branch until separately pushed and
adopted. A cold session from `origin/dev` must stop if the artifacts are not reachable from its
assigned ref; never recreate them from chat.

## Current Wave 0 — post-Encircle planning and verification

### Session R — Registry refute/reconcile

```text
[Session R — Wave 0 · READ-ONLY/DOCS-ONLY]
Model: strongest available
Effort: high
Launch after: the four draft Foundation artifacts exist

You are the UPR work-registry acceptance grader. Work in one phase only.

Read AGENTS.md, CLAUDE.md, docs/upr-engineering-foundation-roadmap.md,
docs/upr-unfinished-work-registry.md, and the proposed ownership manifest. Treat `0a06a21` as the
landed Encircle baseline and confirm no newer writer lease exists.

Refute the registry. For every P0/P1 row, re-read current source, latest roadmap reconciliation,
Git history, and read-only live metadata where explicitly allowed. Do not trust checkboxes. Return
CONFIRMED / MODIFIED / REFUTED, exact file:line or query evidence, owner/dependency/acceptance gaps,
and any missing initiative. Verify that shipped owner gates are not labeled active writers and that
superseded dispatch blocks cannot be relaunched.

You may edit only the four new Foundation planning artifacts if the owner explicitly asked for
review edits in this session. Otherwise report findings only. No code, migration, live write,
external change, Git delivery, or publication.
```

### Session V — Current security and provenance refresh

```text
[Session V — Wave 0 · READ-ONLY]
Model: strongest available
Effort: high
Launch after: immediately

You are the UPR security evidence verifier. Work read-only. Encircle’s writer lease is released.

Read project law, database-standard.md, canonical database/auth/testing docs, the July audit, and
Foundation F1/F2. Query only catalog/grant/policy/function/migration metadata. Do not read business
rows, Auth identities, Storage object paths, secrets, or raw logs.

Reverify exec_read_sql ownership/security/grants, public/authenticated unrestricted policies,
SECURITY DEFINER execution counts, latest migration ledger/source reachability, relevant advisors,
and deployed Edge Function inventory if read access exists. Compare current results to the dated
audit and label drift. Produce exact queries/results and an F1/F2 go/no-go checklist.

No SQL write/DDL, migration apply, code/doc edit, external mutation, commit, push, deploy, or PR.
```

### Session Q0 — Isolated QA architecture

```text
[Session Q0 — Wave 0 · PLANNING ONLY]
Model: strongest available
Effort: high
Launch after: immediately

You are the UPR QA isolation architect. Do not create a Supabase project/account, write test data,
or change CI. Confirm no implementation writer lease has been assigned.

Read project law, docs/testing-and-deployment.md, audit TEST/ARCH findings, existing test helpers,
CI, Login real-data test mode, and the unmerged test-auth plan commit if readable. Design options
for hosted isolated Supabase, local Supabase, and a hybrid. Specify representative roles, TEST org,
seed/reset, production-ID refusal, migration-from-zero, Storage/Auth/Realtime, provider sandboxes,
browser/device evidence, costs/owner gates, and adoption of or supersession for commit 3841056.

Return a memo-only decision and an implementation-ready F3a/F3b/F3c and F4a/F4b/F4c split. Do not
edit the four Foundation artifacts or shared QA/CI paths. No external or repository mutation.
```

### Session G0 — Tooling governance architecture

```text
[Session G0 — Wave 0 · PLANNING ONLY]
Model: strongest available
Effort: high
Launch after: immediately

You are the UPR skills/agents/plugin governance architect. Do not rotate credentials, edit
permissions, install/connect/remove plugins, or modify adapters in this session.

Read the July tooling capability review, current .claude skills/agents/hooks/settings, AGENTS.md,
and the Foundation F5 phase. Verify current counts, broken paths, duplicate ports, missing reviewers,
overlapping triggers, broad write permissions, and stale initiative checkers. Propose one canonical
source, adapter generation/validation, prompt collision tests, permission modes, retirement metadata,
and a plugin catalog. Keep Figma blocked until QA/governance prerequisites.

Return a memo-only CONFIRMED/MODIFIED/REFUTED report, exact evidence, owner decisions, and
F5a/F5b/F5c repair phases. Do not edit the Foundation artifacts or shared CI/QA files.
```

### Session O0 — Owner gates and writer-lease decision

```text
[Session O0 — Wave 0 · OWNER DECISIONS ONLY]
Model: strongest available
Effort: high
Launch after: immediately; no repository writer required

Prepare one owner decision sheet for: F1 apply window; Encircle migration/owner-only flag/candidate/
runtime smoke/rotation/fallback cleanup; obsolete Netlify retirement; exposed credential history
treatment; A2P; device/Xcode/ASC; P9 and Web Push; purge scheduling; billing roles; isolated-QA
budget/ownership; and deletion SLA.

Do not rotate, connect, create, send, apply, merge, or edit. Record accountable owner, due/review
date, evidence required, and consequence of deferral. Silence does not authorize a writer.
```

## Foundation implementation — requires separate owner authority

### Session S1 — `exec_read_sql` containment

```text
[Session S1 — Foundation · IMPLEMENTATION REQUIRES SEPARATE OWNER AUTHORITY]
Model: strongest available
Effort: high
Launch after: F1 owner approval and reviewed apply window; Encircle lease is already released

Build only Foundation Phase F1. Read project/database law, current live function definition/grants,
all callers, migration history, tests, roadmap, registry, and ownership manifest.

Test first: anon and authenticated cannot execute exec_read_sql against representative public,
auth, or credential targets; the intended service-only consumer succeeds if one is retained.
Author one narrowly scoped migration with explicit REVOKEs and concrete rollback. Do not touch
Encircle tables/functions or perform broader policy cleanup. Rebase on `0a06a21` and preserve its
landed shared-helper contracts.

Prefer database contract tests in isolated QA. If F3 is unavailable and the owner authorizes
emergency containment, require static migration/ACL tests plus immediate direct post-apply negative
calls as `anon`/`authenticated`; record the isolated-QA rerun as a verification tail. Run the
migration-safety checker, anon-grant auditor, build/unit/targeted lint, provenance, and rollback
review. Applying to the shared project remains a separate owner-authorized action.
Stop and hand off; do not merge, deploy, or apply without explicit authority.
```

### Session S2 — Migration provenance

```text
[Session S2 — Foundation · READ/IMPLEMENT AFTER HANDOFF]
Model: strongest available
Effort: high
Launch after: S1 rebase point; apply strictly after any S1 apply

Build only Foundation Phase F2. Read current live migration ledger, exact live definitions, Git
commits c10a8bb/a5ef0e1/a7ee5f8, current release history, and provenance requirements.

Never overwrite a live function/policy from a guessed or stale branch body. First fingerprint and
compare. Restore only the four selected reviewed source records when byte/semantic equivalence is
established; never merge or cherry-pick a whole historical commit for this purpose. Rebase after S1,
then add a read-only release gate mapping ledger entries to release-reachable source and fingerprints.

Run unit tests/build/targeted lint. No live DDL or data write. Any reconciliation apply requires a
separate owner decision and serialized window.
```

### Session F3 — Isolated QA foundation

```text
[Session F3a/F3b/F3c — FOUNDATION · EXTERNAL CREATION REQUIRES OWNER AUTHORITY]
Model: strongest available
Effort: high
Launch after: owner selects target, budget, accountable owner, and reset policy

Implement exactly one subphase: F3a environment/bootstrap and production-ID refusal; F3b TEST
organization, representative identities, and deterministic seeds; or F3c reset plus
Auth/Storage/Realtime coverage. Own only the assigned QA config/fixture/script paths. Never point a
mutation test at shared production or use real employee credentials. Provider sandboxes are named
verification tails. Run migration-from-zero, idempotent reset, denied-role, and production-refusal
checks. Stop before commit/push/project creation unless each action is separately authorized.
```

### Session F4 — Verification gates

```text
[Session F4a/F4b/F4c — FOUNDATION · IMPLEMENTATION REQUIRES F3]
Model: strongest available
Effort: high
Launch after: required F3 subphase is verified and exact CI/test paths are leased

Implement exactly one subphase: F4a deterministic unit/database gates; F4b browser/accessibility/
mobile/resume/failure-state gates; or F4c deployment, provenance, binding, and observability gates.
Do not loosen production refusal or hide unexpected skips. Coordinate any checker/fixture overlap
with F5 through one owner and rebase/retest after the earlier phase. Record native/provider checks
as external tails. No deployment or external mutation without separate authority.
```

### Session F5 — Governance repair

```text
[Session F5 — Foundation · IMPLEMENTATION REQUIRES OWNER DECISIONS]
Model: strongest available
Effort: high
Launch after: credential history/rotation decision and canonical-source decision; rebase on `0a06a21`

Build only Foundation Phase F5. Do not touch application/database code.

First verify the exposed credential has been rotated/revoked by the owner; never reproduce it.
Stop tracking machine-local permissions using the owner-approved migration plan. Make shared
permissions read-mostly. Establish one canonical skill/agent source, deterministic adapters,
path/link validation, required reviewer parity, prompt collision tests, and plan/write/apply/publish
authority evaluations. Preserve useful specialist libraries as conditional.

Run all governance fixtures and repository build/unit checks proportional to changed tooling.
Do not install/connect Figma or any plugin. Do not commit/push unless separately requested.
```

### Session F6 — Design authority and baselines

```text
[Session F6a/F6b — FOUNDATION · FIGMA CONNECTION REQUIRES OWNER AUTHORITY]
Model: strongest available
Effort: high
Launch after: F4/F5 prerequisites and owner seat/source-of-truth decision

Implement exactly one subphase. F6a defines design authority by artifact type, repository-token to
Figma mapping, handoff permissions, and seat exit. F6b creates isolated-QA visual/accessibility
baselines and a disjoint UX adoption map. Do not connect/install Figma, rewrite pages, or edit shared
CSS/tokens without separate authority and an exact lease. Stop if product/Encircle owners overlap.
```

## Launch table

| Wave | Sessions | Parallel rule |
|---|---|---|
| Now / 0 | R/V/Q0/G0/O0 (throttle to available slots) | No writer active; lanes are read-only/memo-only; O0 resolves owner gates |
| Foundation 0 | F0a registry adoption, then F0b manifest/worktree reconciliation | Drafts must first be reachable from the approved ref; no merge/delete |
| Foundation 1 | S1 containment; then S2 selected-source reconciliation | One writer/apply; S2 rebases after S1; Encircle lease already released |
| Foundation 2 | F3a→F3b→F3c ∥ F5a→F5b→F5c | Conditional after exact CI/config/fixture/checker paths are assigned |
| Foundation 3 | F4a→F4b→F4c; F6a→F6b after prerequisites | F4 consumes QA; F6 consumes QA + governed tooling |
| Product | max two proven-disjoint phases + one reviewer | One DB writer; exact manifest; finish-first order |

## Product-wave dispatch invariant

Before generating a product cold block, promote its row into the authoritative control ledger and
include: exact base/ref preflight, one-session scope, owned/frozen files, schema/external systems,
prerequisite evidence, negative tests, rollback, canonical-document reconciler, reviewer, and stop
conditions. Signing/Storage use one co-design block; Schedule stays A→B→C; QBO and Stripe launch
together only after shared helpers are frozen.
