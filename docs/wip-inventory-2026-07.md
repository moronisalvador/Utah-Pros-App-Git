# WIP Inventory — 2026-07-29

**Purpose:** every open initiative, what keeping it half-alive costs, and a recommended verdict.
The owner decides; a verdict of **kill** or **park** releases the initiative's file freezes and
deletes its row from `.claude/rules/initiative-status.md`. Archived manifests (the detail behind
each row) live in `docs/archive/rules/`.

Recommended WIP limit going forward: **one initiative in flight, two at absolute most.**

| # | Initiative | State (2026-07-29) | What it blocks while open | Recommended verdict |
|---|---|---|---|---|
| 1 | **Mobile readiness — current-origin reconciliation** | ACTIVE lease (`codex/mobile-readiness-current-origin-review`); landed PR #525; awaiting owner handback acceptance | Sole-writer lease over `.claude/**`, `CLAUDE.md`, `AGENTS.md`, `tooling/**`, Conversations/TechLayout seams | **FINISH FIRST.** Accept or reject the handback this week — it is the widest lease in the repo. |
| 2 | **SMS experience** | Built and live except `20260728000000_sms_consent_opt_out_only.sql` (authored, reviewed, NOT applied) | Consent behaviour split between code (accepts `IMPLIED_CONSENT`) and DB (never returns it) | **FINISH.** One apply window closes the whole initiative. |
| 3 | **Tech v2 — Job Hub H3 cutover** | H1/H2 merged; H3 (legacy page deletion + resolver) gated on owner bake sign-off | Legacy `TechAppointment`/`TechJobDetail` frozen-in-place; db-foundation P8 (signed URLs) hard-gated on it | **FINISH.** Give the bake verdict; H3 is one bounded session and unblocks P8. |
| 4 | **DB foundation P2–P8** | F/P1 done; P3 shipped as tranches A/B; P2/P4–P8 open | The deferred-hardening bucket; anon closure incomplete; P8 waits on H3 | **FINISH P3-to-completion as the next initiative after the staging branch is seeded** (close the remaining anon surface wholesale on the branch, then one reviewed apply). P4–P7 become ordinary backlog, not a wave. |
| 5 | **Messaging transport (CallRail)** | Phases 1–4, 6–7 built; Phase 5 (activation) owner-gated by design | Little — freezes superseded by completion; activation is a runbook away | **PARK explicitly.** It is done-pending-activation; say so and stop tracking it as WIP. |
| 6 | **Omni-inbox (email in conversations)** | I/O/U unbuilt; O/U absorbed by sms-experience | Freezes on `email-worker/**`, email libs; a schema group shipped for a UI that never came | **KILL (or formally re-scope).** If email-in-inbox still matters, it deserves a fresh plan on today's codebase; the 2026-07-04 plan is stale. |
| 7 | **Schedule Desktop A/B/C** | Never started | `Schedule.jsx`, `JobPage.jsx`, `ScheduleTemplates.jsx` reserved for months | **KILL the reservation.** Un-freeze the files; re-plan if/when it becomes a priority. |
| 8 | **UX alignment W1–W5** | Stalled since 2026-07-18; owner said it may restart from scratch | The biggest cross-cutting freeze set (9 tech pages, codemods, perf work) | **KILL and restart later, smaller.** Fold the genuinely-wanted items (failed-load→error-state fixes, toast codemod) into ordinary backlog items. |
| 9 | **App-store readiness (F1/A/B/D)** | Planned, not started | `ios/` project file ownership rules | **PARK** until an App Store submission is actually scheduled. |
| 10 | **Agent QA access P2+** | P1 shipped; P2a gated on a local runtime that never landed | Little — but its hosted-QA design (P2b) is now partially delivered by the qa-staging branch work | **FOLD IN.** Retire the phase plan; the staging-branch runbook + target-policy extension are the living successors. |
| 11 | **CSS split (new)** | Proposed 2026-07-29 (this restructure) — split `src/index.css` (13,003 lines, 99.2% of budget) by route/feature | Every UI initiative shares one file via marker treaties; budget nearly breached | **QUEUE as the first UI initiative once #1 and #2 close.** |
| 12 | **Schema baseline capture (new)** | Proposed 2026-07-29 — commit `pg_dump --schema-only` as `db/baseline/schema.sql` | Until then: no DR, no local replay, staging depends on live clone | **QUEUE immediately after the staging branch is seeded** (same credentials, same sitting). |

## Suggested sequence

1. Accept/reject the mobile handback (#1) and apply the consent migration (#2) — both are
   single owner actions.
2. Seed the staging branch + capture the schema baseline (#12) in one sitting — runbook §2.
3. Give the H3 bake verdict (#3).
4. Then one initiative at a time: anon-closure completion (#4), then the CSS split (#11).
5. Everything else: killed, parked with a one-line status, or demoted to ordinary backlog.
