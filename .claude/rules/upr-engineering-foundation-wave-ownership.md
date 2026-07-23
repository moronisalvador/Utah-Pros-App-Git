<!--
FILE: .claude/rules/upr-engineering-foundation-wave-ownership.md

WHAT THIS DOES (plain language):
  Proposes writer leases, frozen seams, phase ownership, and parallelism rules for the UPR
  Engineering Foundation program.

DEPENDS ON:
  Internal: AGENTS.md, CLAUDE.md, docs/upr-engineering-foundation-roadmap.md,
            docs/upr-unfinished-work-registry.md
  Data:     reads → planning and ownership metadata
            writes → documentation only

NOTES / GOTCHAS:
  - DRAFT FOR OWNER REVIEW. It is not binding project law and grants no implementation authority.
-->

# UPR Engineering Foundation — Proposed Ownership Manifest

**DRAFT FOR OWNER REVIEW.** This file is a planning artifact, not binding project law until the
owner explicitly adopts it. It grants no authority to edit code, apply migrations, change live
systems, commit, push, deploy, or open a PR.

## 1. Current writer state

No application/database writer lease is active. Encircle implementation landed on `origin/dev` at
`0a06a21`; the owner reports CI and Cloudflare staging passed, and its writer lease is released.
Its migration remains unapplied, flag OFF, and credentials unchanged.

Foundation F1 containment and F2 provenance reconciliation are complete. F2 performed no live write;
its source-restoration and release-gate lease is released.

The landed Encircle seam set is in `docs/upr-unfinished-work-registry.md`. It requires rebase and
contract preservation, not a global file freeze. Encircle’s later migration apply, flag change,
candidate entry, runtime smoke, credential rotation/fallback removal, and obsolete Netlify
retirement are separate owner/external gates. They do not reserve a writer lease.

This remains an owner coordination rule, not a technical lock. Before another implementation
launches, classify sibling worktrees/branches (including `codex/messaging-transport-build`) as
writing, paused, review-only, or retirement-candidate. Silence never authorizes a writer.

## 2. Frozen shared seams

No Foundation/product wave co-edits:

- `src/App.jsx`, `src/index.css`, `src/contexts/AuthContext.jsx`, `src/lib/{supabase,realtime}.js`;
- `functions/lib/{auth,http,supabase,worker-runs,cors,credentials}.js`;
- `functions/api/send-message.js`, `twilio-webhook.js`, automation/sequence processors;
- `src/pages/Conversations.jsx`, `src/components/NotificationBell.jsx`, `src/lib/registerSW.js`, and
  `public/sw.js` while a messaging/deep-link phase owns routing;
- canonical docs, existing roadmaps/manifests, or Encircle files;
- a live table/function/policy or migration apply window owned by another active phase.

A shared seam is changed once by a named Foundation owner, with a frozen contract and tests, before
dependent phases launch.

## 3. Foundation ownership matrix

| Session | Owns exclusively | Schema/live | Forbidden |
|---|---|---|---|
| E — Encircle rollout | Landed `0a06a21` contract; pending rollout evidence | migration/flag/credential/provider changes only in separately authorized windows | Holding an app-writer lease while owner/external gated |
| R — Registry | These four new Foundation planning artifacts | none | Existing canonical docs/manifests |
| S1 — SQL containment | one new `exec_read_sql` revoke migration, its DB test, rollback evidence | `exec_read_sql` ACL/boundary only | Encircle tables/functions; broad policy cleanup |
| S2 — Provenance | completed: read-only ledger/Git/fingerprint gate + four exact restored source records | none; no F2 live write occurred | archived regression boundary; never replace live bodies from guesses |
| Q — QA isolation | F3a environment/refusal; F3b identities/seeds; F3c reset/subsystems; then assigned QA config/fixtures/scripts/CI paths | isolated project/local stack only | shared production data/tests; G-owned checker fixtures |
| G — Governance | F5a secret/permissions; F5b adapters/paths; F5c triggers/plugins; exact `.claude` paths and evaluation tests | none | application/database/provider actions; Q-owned CI/config |
| D — Design/Figma | design operating docs; later approved tokens/primitives/visual baselines | none | page rewrites before QA/ownership proof |

## 4. Post-Foundation product ownership

- One DB owner creates/replaces schema contracts for a wave; product phases ship zero schema unless a
  separately reviewed exception is named.
- QBO and Stripe each own their Worker/test files. Shared auth/http changes belong to Foundation.
- Public form is mostly separate, but shared tests/docs serialize. Signing and Storage are one
  co-designed privacy contract because signing writes PDFs into `job-files`/`job_documents`; their
  database applies remain serial.
- Schedule phases A→B→C are serial and own their named roadmap files only.
- UX W3 is the sole cross-cutting codemod owner. W1/W2/W4/W5 launch only after exact file sets are
  rebaselined against current product owners.
- Messaging/CRM/Omni phases consume the existing consent/send chokepoints; no alternate send path.

## 5. Disjointness ledger

| Pair | Files | Schema/external | Verdict |
|---|---|---|---|
| E ∥ R | Encircle/current app vs four new docs | Encircle provider/DB vs none | PROVEN for current planning |
| E ∥ read-only security | app/DB writes vs catalog/Git reads | no write in security lane | PROVEN with read-only constraint |
| E ∥ Q-design | app/DB writes vs new QA planning docs | no project creation | PROVEN with planning-only constraint |
| E ∥ G-design | app/DB writes vs new governance planning docs | no permission/plugin/credential change | PROVEN with planning-only constraint |
| S1 ∥ G | migration/test vs `.claude` files | DB apply vs none | CONDITIONAL: G may execute S1 checkers; freeze checker/test ownership and rebase/retest |
| Q ∥ G | test/CI/isolated env vs `.claude` | isolated QA vs none | CONDITIONAL: exact CI/config/fixture/checker paths must be assigned first |
| QBO ∥ Stripe | separate Workers/tests | separate providers | CONDITIONAL: shared helpers must land first |
| Form ∥ Signing | mostly separate Workers/RPCs | one shared DB | CONDITIONAL: shared tests/docs serialize |
| Signing ∥ Storage | shared PDF, job-file, document behavior | one bucket/document contract | NOT DISJOINT; co-design and apply serially |
| Schedule ∥ UX | overlapping pages/CSS/shared UI likely | shared browser fixtures | NOT PROVEN; serialize/rebaseline |
| Encircle rollout ∥ DB phase | code landed; possible shared migration/apply state | one shared DB | NOT DISJOINT for apply; serialize |
| Encircle contract ∥ UX/product | overlap possible in landed files/helpers | no automatic live overlap | CONDITIONAL: rebase on `0a06a21`, preserve tests, assign exact files |

## 6. WIP limits and lease protocol

- A writer lease names owner, files, schema/functions, external systems, start, expected handoff, and
  rollback.
- Current state: zero app/database writers; E is a landed rollout tail.
- Future initial cap: one DB writer, at most two proven-disjoint app writers, and one independent
  reviewer per implementation. Fewer writers is the default when proof is incomplete.
- A lease expires only by explicit handoff; silence or a stale branch does not release it.
- A lease also records branch/worktree, accountable person, owned files/schema/external systems,
  start, expected handoff, review date, rollback, and extend/pause/transfer decision.
- Owner/external gates have no writer lease and may not retain shared files.
- Any hidden overlap stops the later phase; move the seam to Foundation or serialize.

## 7. Close-out for every future phase

- Rebase from current `origin/dev`; verify plan/manifest on disk; stop if missing.
- Run named risk tests first, then build/unit/targeted lint and the required reviewers.
- Database work: migration safety, anon-grant audit, rollback, intended/denied role tests, provenance,
  and explicit owner apply authorization.
- UI work: loading/error/empty forcing, 390px, minimize/resume, keyboard/accessibility, perf delta.
- Delete isolated TEST data; update registry both directions.
- Commit/push/PR/deploy/live actions occur only when the owner separately requests them.
