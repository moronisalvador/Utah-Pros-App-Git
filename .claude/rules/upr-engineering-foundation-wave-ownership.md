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

**Last-verified: 2026-07-24**

> **EXCEPTION TO THE DISCLAIMER BELOW — §6's "Active writer register" is operational fact, not
> draft planning, and it binds.** It records which sessions hold write leases and whether `dev` may
> be promoted. A blanket "this file grants no authority" over a live promotion hold is a defect: a
> session is entitled to read the hold as non-binding and promote anyway. Everything *else* here
> remains a draft. (Recorded 2026-07-26 — alignment ledger #10.)

**DRAFT FOR OWNER REVIEW.** This file is a planning artifact, not binding project law until the
owner explicitly adopts it. It grants no authority to edit code, apply migrations, change live
systems, commit, push, deploy, or open a PR.

## 1. Historical writer state — current leases are in §6

At the 2026-07-24 capture, no application/database writer lease was active. Encircle implementation
had landed on `origin/dev` at `0a06a21`; its writer lease was released, and its migration was then
reported unapplied with the flag OFF and credentials unchanged. Those live-state claims are
historical. Current Encircle state is unknown pending read-only provenance recapture, and §6 is the
binding current writer register.

Foundation F1 containment and F2 provenance reconciliation are complete. F2 performed no live write;
its source-restoration and release-gate lease is released.

The landed Encircle seam set is recorded in `docs/upr-unfinished-work-registry.md`. New work must
fetch current `origin/dev` and reconcile by a normal no-rewrite merge while preserving that
contract; it does not impose a global file freeze. Encircle apply, flag, candidate, runtime-smoke,
credential, fallback-removal, and Netlify-retirement actions remain separate owner/external gates
and reserve no writer lease.

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
| G — Governance | F5a secret/permissions; F5b neutral sources/generated adapters; F5c triggers/plugins; `tooling/`, exact generated `.claude`/`.agents`/`.codex` outputs, governance scripts/tests/docs | none | application/database/provider actions; Q-owned CI/config |
| D — Design/Figma | design operating docs; later approved tokens/primitives/visual baselines | none | page rewrites before QA/ownership proof |

G’s 2026-07-24 pilot is implemented for the four interacting dispatchers and three reviewer
adapters. Fresh-runtime smoke and remaining-entrypoint migration are verification/follow-on work;
unlisted candidate-port files are not part of G’s authoritative output.

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
| Encircle contract ∥ UX/product | overlap possible in landed files/helpers | no automatic live overlap | CONDITIONAL: treat `0a06a21` as historical provenance, reconcile current `origin/dev` by normal no-rewrite merge, preserve tests, assign exact files |

## 6. WIP limits and lease protocol

- A writer lease names owner, files, schema/functions, external systems, start, expected handoff, and
  rollback.
- ~~Current state: zero app/database writers; E is a landed rollout tail.~~
  **Superseded 2026-07-26 — see the active register below.**
- Future initial cap: one DB writer, at most two proven-disjoint app writers, and one independent
  reviewer per implementation. Fewer writers is the default when proof is incomplete.
- A lease expires only by explicit handoff; silence or a stale branch does not release it.
- A lease also records branch/worktree, accountable person, owned files/schema/external systems,
  start, expected handoff, review date, rollback, and extend/pause/transfer decision.
- Owner/external gates have no writer lease and may not retain shared files.
- Any hidden overlap stops the later phase; move the seam to Foundation or serialize.

### Active writer register — opened 2026-07-26

The earlier three-session register reached the repository cap. DB-1 has since released and APP-2/
APP-3 were explicitly transferred into one current-origin mobile integration lease. No other app
writer is declared active by this register. This current state is recorded because either the old
"zero writers" claim or the historical three-writer count would now cause a collision.

**Read this before authoring a migration, touching a permission/notification
surface, or promoting `dev` to `main`.**

| Lease | Owner | Scope | State |
|---|---|---|---|
| ~~**DB-1 — security tightening batch**~~ | ~~`claude/parked-sessions-recovery-4fdbb7`~~ | 8 migrations | **RELEASED 2026-07-26 — owner reports all 8 applied and verified.** The release condition below is met. |
| APP-2, APP-3 | `codex/mobile-readiness-current-origin-review` (owner handoff from the agent-alignment / tooling-governance sessions, 2026-07-26) | `.claude/**`, `AGENTS.md`, `CLAUDE.md`, `tooling/**`, `docs/agent-alignment-*`; reconciliation only outside the mobile ownership manifest | **TRANSFERRED / ACTIVE** until the current-origin mobile integration is locally verified and handed back |

**DB-1 owns these database objects. Do not author a migration touching any of them
until this lease releases:**

- Tables: `automation_settings`, `email_suppressions`, `notification_types`,
  `notification_role_defaults`, `nav_permissions`, `employee_page_access`,
  `feature_flags`, `message_provider_events`
- Functions replaced (body-only, signatures frozen): `set_automation_setting`,
  `upsert_permission`, `upsert_employee_page_access`, `delete_employee_page_access`,
  `upsert_feature_flag` (both overloads), `delete_feature_flag`,
  `set_notification_default`, `set_employee_notification_override`,
  `delete_employee_notification_override`
- Functions created: `is_active_internal_admin()`, `rearm_callrail_provider_event()`,
  `resolve_provider_event()`
- Columns added: `message_provider_events.resolved_at` / `.resolved_by`

`is_active_internal_admin()` is intended as the shared admin predicate that backlog
item 3.2 rolls out in place of 342 individual function reviews — build on it rather
than adding a second one.

**Historical DB-1 disjointness check as of 2026-07-26:** no session other than DB-1 had touched
`supabase/` in the `main..dev` range, and `database-standard.md` is unmodified.
The overlap that DOES exist is `CLAUDE.md` / `close-out-standard.md`, both edited by
the app sessions while DB-1 was running — DB-1 must re-read them before its close-out
rather than working from a cached copy.

**Current promotion hold:** `dev` is **not** to be promoted to `main` while the transferred
APP-2/APP-3 reconciliation lease is active. The previous hold was discharged when the owner
promoted `98786f52`; that historical event is not a standing assertion that the branches remain
equal. At the mobile session's 2026-07-26 read-only recapture, `origin/main` was `c19434a0`,
`origin/dev` was `4583f0a6`, and `origin/dev` was 10 commits ahead. These SHAs are evidence for that
capture only. Promote from a quiet `dev`, then re-fetch and re-check
`git rev-list --left-right --count origin/main...origin/dev` immediately before the separately
authorized promotion.

**Rollback for DB-1:** every migration ships a paired file in `supabase/rollbacks/`.
~~Nothing is applied, so the current rollback is `git revert` alone.~~ **All 8 are now applied
(owner, 2026-07-26), so `git revert` alone no longer undoes them** — an undo means running the
paired rollback file against the shared project, which is a fresh owner-authorized apply.

**Release condition:** DB-1 releases after its 8 migrations are applied and verified,
or on explicit owner handoff. **MET 2026-07-26 — DB-1 is released.** The database objects it
reserved (the 8 tables, 12 replaced/created functions and 2 added columns listed above) are no
longer leased; a new migration touching them needs only the normal review, not this lease.

`is_active_internal_admin()` is now live. Backlog item 3.2 should build on it rather than adding a
second admin predicate.

**What DB-1's release does NOT close** (added 2026-07-27 by the DB-1 session itself, so the
release is not mistaken for "everything is settled"):

- **The current promotion hold above still stands.** It is keyed to the owner-transferred mobile
  reconciliation lease, not to DB-1, and releasing the database lease does not release it.
- **The provenance gate is RED.** Two independent causes: live evidence needs re-capturing (it
  predates the applies, and there is no capture script — see `7580f93d` for the required shape), and
  the applied source lives on `dev`, so the gate cannot pass against `main` until promotion. The
  apply-ahead-of-promotion is a recorded **owner-authorized `database-standard.md` §5 exception**;
  the reconciliation §5 asks for *is* that promotion.
- **Ledger row `20260726233416 encircle_managed_credentials` is still unmapped.** Applied by another
  session; DB-1 deliberately did not map source it had not reviewed. Its owner needs to, or the next
  fresh evidence capture will report it as an unmapped live ledger row.

**Still open:** the transferred APP-2/APP-3 reconciliation lease and therefore the current
promotion hold. Delete this register when the owner accepts the locally verified handback.

## 7. Close-out for every future phase

- Fetch current `origin/dev`, then reconcile it by a normal no-rewrite merge and prove both
  histories by ancestry; verify plan/manifest on disk; stop if missing.
- Run named risk tests first, then build/unit/targeted lint and the required reviewers.
- Database work: migration safety, anon-grant audit, rollback, intended/denied role tests, provenance,
  and explicit owner apply authorization.
- UI work: loading/error/empty forcing, 390px, minimize/resume, keyboard/accessibility, perf delta.
- Delete isolated TEST data; update registry both directions.
- Commit/push/PR/deploy/live actions occur only when the owner separately requests them.
