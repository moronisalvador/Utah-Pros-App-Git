---
name: job-hub-redesign-starting-point
description: "Where the Apple Field Pro Job Hub work already lives, why attempt #1 failed, and the one scoping question to settle before writing any code"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-07T17:22:53.164Z
---

**Next big project (owner-stated 2026-08-07): build the Job Hub page that replaces the appointment page (`src/pages/tech/TechAppointment.jsx`), in the "Apple Field Pro" direction, "but keeping the current design we have in the app." First attempt was "a disaster" — go carefully.**

> ## ✅ WAVE 1 SHIPPED to `dev` 2026-08-07 (`91e4c23e`, `94f737a4`, `a29be133`)
>
> **The decisive fact nobody had checked: `page:tech_job_hub` was `enabled=false` with NO dev
> user — the v2 Hub had been fully dark since 2026-07-13 and had never shipped to anyone.** That
> is what "attempt #1 was a disaster" actually means: it got built and never turned on. So the
> Hub is a zero-risk surface to rebuild — techs are still on `/tech/appointment/:id`. The owner
> set `dev_only_user_id` to their own employee id (`d1d37f3c-…`) on 2026-08-07 to bake it.
>
> Wave 1 delivered: `resolveHero()` (the 3-way adaptive rule + **job mode**, which never returns
> a `visitId` so no clock/Finish appears for a visit nobody started), `JobStage`, the
> division-gradient `HubHeader`, `HubActionBar` (Call·Message·Docs·Notes), the work-auth banner,
> uppercase section labels, and `job-hub.css` extracted from `index.css` (**185 B → 29 KB of
> headroom** under the CI-blocking 600,000 B ceiling; that extraction is what made the project
> buildable at all).
>
> **Two traps paid for — do not re-introduce:** (1) the page wrote `?appt=` on every render, which
> satisfies hero rule 2 on the next render and silently flips job mode back into an appointment —
> the sync is visit-mode only now; (2) new files under `src/pages/tech/v2/**` must be added to
> `NATIVE_PAGE_ALLOWLIST` in `scripts/native-bundle-boundary.mjs` or `npm run build:native`
> refuses the bundle. That guard's own test was orphaned (no npm script, no workflow) and its sort
> had rotted; it now runs inside `npm run test:tooling`.
>
> **Wave 2+ (not built):** Dry Logs module, rooms grid + room-first capture (the dock's Photo
> button retires *then*, not before — otherwise techs lose capture), Activity log, dedicated
> Notes/Docs pages, and the clock card in all five states (the stage still swaps shapes).
> Cutover = flag on + retire `TechAppointment.jsx`.

**The design work is NOT lost, and it is NOT a disaster — it is locked and owner-approved.** Everything is in `docs/tech-redesign/`:

- `TECH-DESIGN-STANDARD.md` — **the law.** "Apple Field Pro" = **Direction B, locked**. Every colour, type size, component. §12 carries the flow specs; §12.5 is the Job Hub.
- `specs/` — `foundations.md`, `components-core.md`, `components-new.md`, `field-science.md` (drying/moisture/equipment), `icons.md`, `motion-map.md`.
- `prototypes/job-hub.html` — the working Job Hub prototype. Owner's verdict at the time: **"amazing, we nailed it."** 5 clock states, job-mode adaptive hero, room detail, activity page, Notes page, Docs page (signatures + water-loss report + request-signature FAB). Also `full-app.html` (Schedule → appointment → Hub → rooms/notes/docs, navigable), `schedule.html`, `new-job-flow.html`, `kit.html`.
- `mockups/refine-b-jobhub.html`, `hub-challenge-*.html`, `styleguide-b.html`.
- `SESSION-STATE.md` + `LOCAL-SESSION-HANDOFF.md` — the re-hydration files; read those two plus the standard and the prototypes and you are caught up without chat history.

**Registry entry `UPRF-TECH-REDESIGN-001`** (`docs/upr-unfinished-work-registry.md` line ~67) is the authoritative status: **HAVE / prototype_only / deferred / P2**, direction selected 2026-07-28. Its retirement plan is the playbook, and its last clause is the warning that most likely explains attempt #1:

> "recapture current `dev`, inventory the accepted prototype against shipped contracts, implement **selectively** in a fresh **bounded** wave, run full native UI/device qualification, and retire legacy UI only after rollout evidence; **never blind-merge the stale prototype branch**"

**Branch `claude/upr-tech-redesign-continued` @ `302eb14` is 697 commits behind `dev`** with only 2 docs-only commits ahead (`1d81e2ce`, `302eb14b`) carrying two owner design rulings recorded nowhere else: **Carrier optional; internal claim ID split from carrier claim #**. Merge those two docs commits; never merge the branch as an implementation. Register: `docs/wip/claude-upr-tech-redesign-continued.md`.

**A Job Hub already ships today** — `src/pages/tech/v2/TechJobHub.jsx` + `src/pages/tech/v2/hub/*` (HubStage, HubHeader, HubDock, HubTools, HubChecklist, HubBelowFold, PhotosNotes, StageClock, JobClaimSection, useVisitClock). `initiative-status.md` lists "Tech v2 Job Hub H3 cutover — open, owner-bake-gated". So this is **not greenfield**: it is a redesign of a live surface with existing state/test contracts. `TimeTracker` is composed inside `HubStage` and owns the clock.

**✅ SCOPING RULING — owner-directed 2026-08-07, in conversation. This is settled; do not re-litigate.**
*(The owner restated this later the same day with the reasoning and the long-term destination attached — read [[field-pro-is-the-native-rewrite-target]] alongside this.)*

> **Field Pro layout, current tokens.** Adopt the Field Pro screen structure, hierarchy and interaction patterns (adaptive hero, the 5 clock states, room/notes/docs organisation) — but render them in the app's **existing** `UPR-Design-System.md` tokens so the Hub still looks like UPR. New CSS is **component-scoped and route-lazy**, never appended to `index.css`.

Concretely: Hub structure = Field Pro spec §12.5 · colours/type/spacing = `UPR-Design-System.md` · new CSS = component-scoped, route-lazy.

This means `TECH-DESIGN-STANDARD.md` is consumed as a **layout/interaction** spec, NOT as a token system. Where it specifies a colour, type size or spacing value, translate to the nearest existing UPR token rather than importing its scale.

Binding constraint that reinforces this: `src/index.css` has **~185 bytes of headroom** against a CI-blocking 600,000-byte ceiling, so a second token system could not have been appended anyway. Route chunks and the entry-graph budget are also CI-blocking (`perf-budget.md`).

Related: `origin/codex/native-ios-plan` is an accepted future blueprint, not implementation. Motion law for any of this: `.claude/rules/motion-standard.md`; field UX law: `.claude/rules/tech-mobile-ux.md`.
