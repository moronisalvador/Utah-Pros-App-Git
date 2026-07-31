# WIP Inventory — 2026-07-31

**Purpose:** every open initiative, what keeping it half-alive costs, and a recommended verdict.
The owner decides; a verdict of **kill** or **park** releases the initiative's file freezes and
deletes its row from `.claude/rules/initiative-status.md`. Archived manifests (the detail behind
each row) live in `docs/archive/rules/`.

Recommended WIP limit going forward: **one initiative in flight, two at absolute most.**

| # | Initiative | State (2026-07-31) | What it blocks while open | Recommended verdict |
|---|---|---|---|---|
| 3 | **Tech v2 — Job Hub H3 cutover** | H1/H2 merged; H3 (legacy page deletion + resolver) gated on owner bake sign-off | Legacy `TechAppointment`/`TechJobDetail` frozen-in-place; db-foundation P8 (signed URLs) hard-gated on it | **FINISH.** Give the bake verdict; H3 is one bounded session and unblocks P8. |
| 4 | **DB foundation P2–P8** | F/P1 done; P3 shipped as tranches A/B; P2/P4–P8 open. The hosted `qa-staging` database lane is seeded and live. | The deferred-hardening bucket; anon closure incomplete; P8 waits on H3 | **FINISH P3-to-completion on `qa-staging`** (close the remaining anon surface wholesale on the branch, then one reviewed apply). P4–P7 become ordinary backlog, not a wave. |
| 5 | **Messaging transport (CallRail)** | Phases 1–4, 6–7 built; Phase 5 (activation) owner-gated by design | Little — freezes superseded by completion; activation is a runbook away | **PARK explicitly.** It is done-pending-activation; say so and stop tracking it as WIP. |
| 6 | **Omni-inbox (email in conversations)** | I/O/U unbuilt; O/U absorbed by sms-experience | Freezes on `email-worker/**`, email libs; a schema group shipped for a UI that never came | **KILL (or formally re-scope).** If email-in-inbox still matters, it deserves a fresh plan on today's codebase; the 2026-07-04 plan is stale. |
| 7 | **Schedule Desktop A/B/C** | Never started | `Schedule.jsx`, `JobPage.jsx`, `ScheduleTemplates.jsx` reserved for months | **KILL the reservation.** Un-freeze the files; re-plan if/when it becomes a priority. |
| 8 | **UX alignment W1–W5** | Stalled since 2026-07-18; owner said it may restart from scratch | The biggest cross-cutting freeze set (9 tech pages, codemods, perf work) | **KILL and restart later, smaller.** Fold the genuinely-wanted items (failed-load→error-state fixes, toast codemod) into ordinary backlog items. |
| 9 | **App-store readiness (F1/A/B/D)** | Core source phases shipped; historical TestFlight builds and production Push matrix passed, but those builds predate the current per-token APNs client source. Second-account/current-source device proof remains; App Store submission is deliberately deferred. | `ios/` release ownership and external Apple operations | **FOLLOW THE DEFERRED STRATEGY:** H3 bake → P8 signed media → rooms → dry logs/offline → reports, then current-source signed-device, privacy, distribution-route and App Review gates. |
| 10 | **Agent QA access P2+** | P1 shipped; hosted `qa-staging` CI lane is live with three signed-in fixture identities, but P2a's local runtime never landed | Little — local replay remains absent and the hosted lane still has a shrink-only anon-era-test baseline | **FOLD IN.** Retire the phase plan; the staging runbook, target-policy extension, and remaining test conversions are the living successors. |
| 11 | **CSS split (new)** | Proposed 2026-07-29 (this restructure) — split the route/feature markers out of the oversized `src/index.css` | Every UI initiative shares one file via marker treaties; budget nearly breached | **QUEUE after the current database and release-critical tail.** |
| 12 | **Schema baseline bootstrap (new)** | Capture is complete: `db/baseline/schema.sql` is tracked from commit `8e1cf9cc`. The governed local-runtime/bootstrap path and refresh cadence remain open. | Local replay still cannot consume the captured baseline automatically; staging remains the enforced hosted database lane | **QUEUE.** Wire and verify local bootstrap from the committed capture, then document a reviewed refresh cadence. |
| 13 | **Schema v2 / clean rebuild (multi-tenant)** | Baseline plan on file: `docs/schema-v2-plan.md` — QUEUED, owner-gated start | Nothing yet (deliberately); wants the repo nearly to itself when it starts | **Design (P0–P1) before the UI redesign's data-flow work; the UI redesign is then the module-by-module delivery vehicle.** Run the plan's §7 refresh checklist on start day. |

## Suggested sequence

1. Give the H3 bake verdict (#3).
2. Finish the current database hardening tail on `qa-staging` (#4), converting the remaining
   anon-era suites and ratcheting the shrink-only CI baseline.
3. Wire and verify local bootstrap from the already-captured schema baseline (#12).
4. Close the field-documentation prerequisites, then resume the App Store release gates (#9) when
   submission is scheduled.
5. Then one initiative at a time: CSS split (#11), while everything else is killed, explicitly
   parked, or demoted to ordinary backlog.

Completed items removed in this rewrite: mobile current-origin reconciliation (accepted
2026-07-29) and SMS experience (consent migration applied 2026-07-30 under live ledger
`20260730121811`).
