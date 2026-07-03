# Schedule Desktop — Create-and-Schedule Roadmap & Dispatch Model of Record (2026-07-03)

Produced by a `/masterplan` planning session (docs only — zero feature code) and adversarially
reviewed by a 3-agent challenge pass (refute-first verification of 7 load-bearing claims,
counter-ordering skeptic, in-flight-collision check). Every HAVE/PARTIAL verdict below comes from
live code/DB reads (Supabase project `glsmljpabrwonfiltiqm`, read-only), not docs. Companion
dispatch blocks: `docs/schedule-dispatch.md`.

**The initiative:** the desktop Schedule page (`/schedule`) is the dispatch hub, and its #1 pain is
creating a job while the client is on the phone: CreateJobModal → forced navigate to `/jobs/{id}`
(`Layout.jsx:190`) → JobPage has zero appointment affordance → back to `/schedule` → hunt the job in
a picker (fresh jobs sit in a **collapsed** "Ready to Start" rail group) → CreateAppointmentModal.
Live data quantifies the leak: **56 of 105 non-lead jobs (53%) have never had an appointment**.
Target: one continuous flow from the calendar — click a day/slot or "+ New" → HCP-style booking
modal → search-or-create customer, claim choice, job essentials, date/time/crew → **one save creates
contact + claim + job + appointment**, visible on the calendar immediately, no navigation, under
~60 seconds. Then retire the dead weight and bring Month view to Week-view parity.

**Owner decisions on record (interview 2026-07-03, two rounds + HCP reference screenshot):**
① **Week view is the beloved standard** (the original brief said Month — owner corrected); Week +
Month both matter, full upgrade for both, neither view's visuals may regress. ② Kill list
confirmed: Jobs grid view, Crew grid view, ~~3-Day span~~, entire Templates/Wizard subsystem.
**⚠️ AMENDED later the same day (2026-07-03, owner, relayed via the notify planning session):
the 3-Day span is KEPT** — "the three-day view will work great for iPad"; Week stays the daily
driver ("pretty much perfect as is"); Month is the occasional overview and the foundation for a
future HCP-style Gantt. Wherever this doc says to remove the 3-Day span (kill list, Phase B
scope/close-out, decision matrix), read it as **Jobs/Crew grids + Templates/Wizard only — 3-Day
survives.** ③ Flow
shape: HCP-style booking modal, **schedule-page only** (top-bar/CustomerPage keep today's
CreateJobModal); right column = **dispatch context, not billing** ("in reconstruction, mitigation,
and insurance work, there is no billing directly to the client"). ④ Claim hierarchy: after
selecting an existing client → **"New claim" (default, every time)** vs "Existing claim"; the
existing-claim picker rows show **address · date of loss · claim number**. ⑤ Notify customer:
visible toggle, **default ON**. ⑥ **Single-day appointment rows stay** ("(continued)" clone pattern
for spillover); multi-day spanning + recurrence explicitly deferred. ⑦ The doc-referenced
"appointments→scheduled-jobs refactor" is **stale — this plan supersedes it**. ⑧ Desktop web only;
mobile later (see `docs/tech-v2-roadmap.md` for the tech-side initiative).

## Status reconciliation (live, 2026-07-03)

| Piece | Live status | Notes |
|---|---|---|
| Dispatch calendar usage | **Real** | 230 appointments since 2026-04-14, ~75/mo, 92% crewed, 100% timed, all single-day (live SQL) |
| Templates/Wizard subsystem | **Dead** | 0/230 appointments reference `job_schedule_id`/`template_phase_id`; 0 `appointment_dependencies` rows; `schedule_templates` untouched since 2026-03-20; wizard last run 2026-04-14; ScheduleWizard.jsx 0 commits since 2026-03-20 (GitHub API) |
| Jobs/Crew grids, 3-Day span | **Unverifiable** from code (per-user localStorage, no telemetry) | Killed by owner decision, not data |
| Prior schedule plan doc | **None exists** | The twice-referenced "appointments→scheduled-jobs refactor" (`UPR-Web-Context.md` Calendar-sync section, `GOOGLE-INTEGRATIONS-HANDOFF.md`) has no plan file — superseded by this doc (refs struck in place this session) |
| Schema drift | **Disclosed** | ~19 live schedule/customer RPCs have no file in `supabase/migrations/` (incl. `update_appointment`, `delete_appointment`, `get_dispatch_panel_jobs`, `apply_schedule_plan`); no CREATE TABLE for `appointments` is tracked. This initiative ships zero schema and does not capture the drift — the tech-v2 Phase F drift-capture migration covers the tech RPC surface; the dispatch RPCs remain uncaptured (accepted, on record) |
| Orphan tables | **Disclosed** | `schedule_blocks`, `on_call_schedule`: 0 rows AND 0 code references; `appointment_dependencies`: 0 rows. Stay in place (additive-only rule) — documented as retired |

**Doc-drift disclosures:** `UPR-Web-Context.md` "Schedule System" bullets still describe the
Jobs/Crew/3-Day surfaces and `apply_schedule_plan` as live — Phase B's close-out updates that
section rather than this session silently rewriting history.

## Severity findings

1. **F1 (P2) — Month view silently omits all `kind='event'` rows.** Mechanism: `Schedule.jsx`
   renders `<MonthView boardData={filteredBoardData}>` with no `events` prop, so the 69 live
   company events (meetings/PTO — real usage) are invisible in a primary view. Exposure: dispatcher
   double-books over events when planning in Month. Interim guidance: check Week before committing
   a Month-planned slot. Fix: **Session C**.
2. **F2 (P3, live correctness bug) — remodeling division matches neither division-filter chip.**
   `MITIGATION_DIVISIONS` (`Schedule.jsx:66`) excludes `remodeling` and the Recon bucket tests
   `=== 'reconstruction'`, so remodeling jobs vanish under either filter. The division shipped
   2026-06-29, after the filter was written. Exposure: any remodeling job scheduled while a filter
   chip is active is invisible. Fix: **Session B, its own commit** (challenge ruling: don't sit on
   a live bug until a UX phase).
3. **F3 (P3, latent) — localStorage skew renders a broken grid.** Stored
   `upr_schedule_view='jobs'` + `upr_schedule_span='month'` (cross-tab skew) hits an unhandled
   render branch; on mobile a stored `'jobs'`/`'crew'` renders an escape-proof grid (the toggle is
   CSS-hidden). Mooted by **Session B's** viewMode-axis removal.
4. **F4 (P3) — CreateJobModal passes dead props.** `prefillName`/`defaultRole` are not in
   `AddContactModal`'s signature — a name typed into the job search is NOT carried into the
   quick-add form. **Session A** fixes the seam for the shared component's paths.
5. **F5 (disclosure, out of scope) — appointments RLS is fully open to `anon`;** `is_private` is
   enforced only inside `get_appointments_range`/`get_appointment_detail`/`get_dispatch_board`, so
   a direct `db.select('appointments')` leaks private rows to any anon caller. Frozen for now: the
   deployed iOS bundles direct-insert into `appointments`/`appointment_crew`, so a PR-8-style
   write-lockdown would break them. Needs its own initiative after tech-v2's cutover retires the
   direct-insert clients.

## Gap-audit appendix (evidence-based; HAVE only from code/schema, never from docs)

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| E1 | Timed, crewed, single-day dispatch calendar | HAVE | Live SQL: 230 appts, 100% `time_start`, max `duration_days`=1, 92% with `appointment_crew`; statuses persist only `scheduled`/`completed` |
| E2 | Create-job-from-calendar | MISSING (the pain) | Every calendar create path requires an existing job (`creationPicker` → job search → CreateAppointmentModal); `Layout.jsx:190` force-navigates after CreateJobModal |
| E3 | Schedule-from-JobPage | MISSING | JobPage Schedule tab: "N tasks still need to be scheduled" + "Open dispatch board" only; never queries appointments |
| E4 | Booking-modal ingredients | HAVE ~80% (Challenge-CONFIRMED) | CreateJobModal: contact typeahead (`search_contacts_for_job`) + AddContactModal quick-add w/ duplicate-phone recovery + claim new/existing (`p_existing_claim_id`) + division + AddressAutocomplete + CarrierSelect; `create_job_with_contact` live functiondef = tracked migration (no drift), returns `{job, contact, claim_id, claim_number}`, phase `job_received`; CreateAppointmentModal: crew chips (lead-first), ad-hoc tasks (`add_adhoc_job_task` + `assign_tasks_to_appointment`), notify toggle, direct inserts; **imported only by Schedule.jsx**, prop contract JobPage-compatible |
| E5 | Month-view parity | PARTIAL | No create affordance (day click jumps to Day view), no drag-reschedule, omits events (F1), chips lack `_jobId` enrichment. **Challenge-MODIFIED:** live `get_dispatch_board` appointment JSON carries no `job_id` — parity fix is frontend `_jobId` stamping from the parent job row (as the other views already do); no RPC change |
| E6 | Templates/Gantt | DEAD | E2 row of status table. **Challenge-MODIFIED:** removal surface is larger than the discovery map — `navItems.jsx` has TWO entries (:76 NAV_ITEMS, :116 OVERFLOW_ITEMS) plus an `Admin.jsx:971` page-access registry row |
| E7 | Appointment-write side effects | HAVE (live in prod, Challenge-CONFIRMED) | `trg_appointments_calendar_sync` fires on **INSERT**; worker emails the client 'confirmed' on first sync when `job.client_email` && `appt.notify_client` (column DEFAULT true) && ≥1 connected Google writer (live count = 1). **Crew members get real 'assigned' emails + Google Calendar events on create.** Governs every phase's test protocol |
| E8 | lead_source plumbing | PARTIAL | `jobs.lead_source` (text) exists live, is NULL on all 236 jobs, has zero writers anywhere — picker options are spec'd fresh; write via post-insert `db.update` (a `CREATE OR REPLACE` param-add would mint an overload — the `clock_appointment_action` PGRST203 incident class) |
| E9 | viewMode-axis removal safety | HAVE (Challenge-CONFIRMED) | `upr_schedule_view`/`upr_schedule_span` read only by Schedule.jsx; CalendarView/JobPanel independent; mobile only ever saw Calendar (toggle CSS-hidden); removal also fixes F3's mobile trap |
| E10 | Post-save board refresh | HAVE (Challenge-CONFIRMED) | `onSaved(date)` re-anchors → `days` regenerate → `loadBoard` refires (request-counter guarded); live `get_dispatch_board` auto-show branch surfaces any job with an in-range appointment with **no** `dispatch_board_jobs` pin. Caveat: Auto-show toggle OFF hides it → **the booking modal pins on save** |

## Booking-modal design (spec'd here so Session A doesn't improvise)

Two-column HCP-style modal (desktop; follows the design system's admin-modal/bottom-sheet rule),
new file `src/components/schedule/BookingModal.jsx`:

- **Left — Customer & schedule.** Contact search-or-create: extract CreateJobModal's contact/claim
  section into a shared component consumed by BOTH modals (one codepath; carries the typed name
  into quick-add, fixing F4 for these paths). **Claim choice (owner decision ④):** after a client
  is selected — `New claim` (default, always) | `Existing claim (N)`; existing rows show
  **address · date of loss · claim number** (all present in `get_customer_detail().claims`; the
  enriched rows apply to CreateJobModal too via the shared component — a deliberate, disclosed
  improvement, not a silent change). Picking an existing claim prefills loss address / carrier /
  claim # / DOL, fields stay editable; the job files under it via `p_existing_claim_id`.
  **Schedule block:** date + start/end time selects ("anytime" = null times, schema-supported),
  crew chips (first-selected = lead, rest tech — existing role logic), **Notify customer toggle,
  default ON**. **Lead source** select → `jobs.lead_source` (text): starter options
  `Google / Web`, `Referral — past client`, `Referral — plumber/trade`, `Insurance adjuster/agent`,
  `Property manager`, `Repeat customer`, `Other` + free-text — a plain constant, owner-editable in
  review (all live values are NULL; nothing to migrate).
- **Right — Dispatch context** (replaces HCP's line items; no billing content): division picker
  (drives `divisionToType` auto-derivation), loss/service address (AddressAutocomplete — degrades
  to plain text while the Places kill-switch is on), appointment title (auto from division/phase if
  blank), "what to do" ad-hoc task list, notes to crew, and a claim/job association summary.
- **Save chain (order matters):** `create_job_with_contact` (incl. `p_existing_claim_id`) →
  `db.update('jobs', …)` for `lead_source` → `db.insert('appointments', {job_id, title, date,
  time_start, time_end, type, status:'scheduled', notes, notify_client})` → per-crew
  `db.insert('appointment_crew')` → `add_adhoc_job_task` + `assign_tasks_to_appointment` →
  **`syncClaimToEncircle` await for NEW claims only** (same bounded 8s pattern as
  CreateJobModal.jsx:51-74 — the easiest step to miss; omitting it silently breaks the Encircle
  pipeline) → **pin via `db.insert('dispatch_board_jobs', {job_id, added_by})`** (E10 caveat) →
  `onSaved(date)`: stay on the calendar, re-anchor, reload board, success toast.
- **Entry wiring** (`Schedule.jsx`): the creationPicker gains a third option — **New job** /
  Job appointment / Event; day-cell and hour-slot clicks prefill date (+time on hour grids).
- **Fallback checkpoint (challenge ruling, binding):** if at ~70% of the session budget the unified
  modal isn't converging, ship the **chained flow** instead — CreateJobModal → auto-open
  CreateAppointmentModal preloaded with the new job — behind the same "New job" picker entry, and
  record the unified modal as follow-up work. The flow ships either way.

## Phase blocks

### Session A — Phase 1: HCP-style booking modal (the #1 pain)

> **Branch:** harness-assigned (illustrative: `schedule/phase-1-booking`), cut from `origin/dev`.
> **Prerequisite:** this plan-of-record merged into `dev`. Model: **Opus 4.8 (or strongest
> available) · high** (multi-write orchestration incl. Encircle + client-email side effects on a
> live, ungated page).
> **Read scope:** this block + the design section above + `CLAUDE.md` + `UPR-Design-System.md`
> (modal/form patterns) + the frozen-contract list below.
> **Close-out checklist (all true before the PR):**
> - [ ] Test-first, now green (committed failing first): ① save-chain payload builder — correct
>       ordering and payloads for new-claim vs existing-claim (incl. `p_existing_claim_id`,
>       `notify_client`, lead_source update, board pin); ② claim-mode logic — default `new` on
>       every client selection/change, existing list disabled at 0 claims; ③ `divisionToType`
>       derivation + auto-title fallback.
> - [ ] Acceptance: from `/schedule`, "+ New" or a day/slot click → New job → new client (typed
>       name carried into quick-add) → job + appointment saved in one pass → appears on the
>       calendar with **no navigation**; same for an existing client under an existing claim
>       (picker rows show address · DOL · claim #); CreateJobModal still works at its 3 mounts
>       (Layout, CustomerPage, NewInvoiceModal) — shared-component regression checked.
> - [ ] `npm run test` + `npm run build` + eslint (changed files, no new errors) pass; **zero
>       schema migrations**; index.css writes only inside the three pre-committed
>       `/* ─── SCHEDULE V2 RESERVED — Phase N ─── */` markers (commit all three in this session).
> - [ ] `upr-pattern-checker` clean on changed files.
> - [ ] Visual: booking modal on dev.utahpros.app matches the design system (centered modal,
>       bottom-sheet at 768px per the standing rule) and Week/Month render unchanged.
> - [ ] Test protocol honored: test jobs have **no client_email or notify OFF**, no real-crew
>       selection (crew get real emails + gcal events); ALL test rows deleted (contacts, claims,
>       jobs, appointments via `delete_appointment`, dispatch_board_jobs).
> - [ ] `UPR-Web-Context.md` updated (Schedule System section + session entry); reconcile this
>       doc's checkboxes; push; PR into `dev` opened as a handoff the owner merges (no babysitting).

Scope: new `src/components/schedule/BookingModal.jsx` + extracted shared client/claim component;
`src/pages/Schedule.jsx` (creationPicker + render wiring only); `src/components/CreateJobModal.jsx`
(consume the shared component); `src/index.css` (the three reserved markers). Deliberately NOT:
JobPage changes (Session B), any view removal, any RPC/schema change, top-bar/CustomerPage flow
changes beyond the shared component swap.

### Session B — Phase 2: dead-weight removal + JobPage reverse path (explicit cleanup)

> **Branch:** harness-assigned (illustrative: `schedule/phase-2-cleanup`), cut from `origin/dev`.
> **Prerequisite:** Session A merged into `dev` **AND owner has closed/rebased draft PR #102**
> (stale lint PR touching 6 of this phase's files, incl. ScheduleTemplates.jsx which this phase
> deletes — hard gate, do not launch on hope). Model: **Opus 4.8 (or strongest available) ·
> medium** (large deletion on a live page; mechanical but Rule-8-sensitive).
> **Read scope:** this block + `CLAUDE.md` + the frozen-contract list below.
> **Close-out checklist (all true before the PR):**
> - [ ] Removal complete: Jobs/Crew grid views + 3-Day span gone from Schedule.jsx (viewMode axis
>       collapsed → Calendar-only with Day/Week/Month; stale localStorage reads sanitized);
>       ScheduleTemplates.jsx + `/schedule/templates` route + App.jsx import + **both** navItems
>       entries + **Admin.jsx page-access row** deleted; ScheduleWizard.jsx + its JobPage and
>       JobPanel integrations deleted; dead code removed (EditAppointmentModal clone-visit block,
>       dead DivisionIcon imports, gridDays no-op, hexToTint dup); orphaned mobile CSS pruned.
> - [ ] **Kept intact (over-deletion guard):** `placementMode` / `handlePlacementClick` /
>       `handleRescheduleRemaining` — CalendarView consumes them; the "when a schedule is
>       generated" empty-state copy updated for the post-wizard world.
> - [ ] MonthView extracted **verbatim** to `src/components/schedule/MonthView.jsx`
>       (zero-behavior move — diff proves it).
> - [ ] JobPage reverse path: "Schedule appointment" replaces "Generate schedule" as the Schedule
>       tab CTA, rendering the existing CreateAppointmentModal (add `color` to JobPage's employees
>       select); schedule-from-job works end-to-end on dev.
> - [ ] F2 remodeling-filter fix shipped as its **own commit**.
> - [ ] `npm run test` + `npm run build` + eslint pass; zero schema migrations; grep proves zero
>       remaining references to removed components/RPCs; Week/Month/Day visually unchanged on dev;
>       mobile spot-check (mobile only ever saw Calendar).
> - [ ] `upr-pattern-checker` clean; `UPR-Web-Context.md` updated (Schedule System bullets
>       rewritten — views list, templates marked retired, the 6 dead RPCs listed as
>       retired-no-callers) + session entry; reconcile this doc's checkboxes; test rows deleted;
>       push; PR into `dev` as a handoff, then stop.

Scope: Schedule.jsx (deletion + span options), ScheduleTemplates.jsx (delete), ScheduleWizard.jsx
(delete), JobPanel.jsx, JobPage.jsx, App.jsx (route region: `/schedule/templates` only — tech-v2
co-edits tech routes; rebase-aware), `src/lib/navItems.jsx`, `src/pages/Admin.jsx` (one row),
EditAppointmentModal.jsx, index.css (inside the Phase-2 marker + deleting orphaned rules), new
`src/components/schedule/MonthView.jsx`. Deliberately NOT: any Month-view behavior change (Session
C), any DB object drop (tables/RPCs stay, documented retired), any styling change to surviving
views.

### Session C — Phase 3: Month-view parity (UX upgrade)

> **Branch:** harness-assigned (illustrative: `schedule/phase-3-month`), cut from `origin/dev`.
> **Prerequisite:** Session B merged into `dev`. Model: **Opus 4.8 (or strongest available) ·
> medium** (drag-drop interaction work; reschedule email side effect in play).
> **Read scope:** this block + `CLAUDE.md` + `UPR-Design-System.md` + the frozen-contract list.
> **Close-out checklist (all true before the PR):**
> - [ ] Month renders `kind='event'` rows (F1 fixed) with the same event styling language the
>       other views use; division filter continues to hide events (existing rule).
> - [ ] Click-day → creationPicker prefilled with that date (day-number keeps zoom-to-Day);
>       drag-to-reschedule chips between days (date-only `update_appointment`, optimistic +
>       rollback like Week); chips enriched with `_jobId`/`_division`/`_address` stamped from the
>       parent job row so hover/edit paths match Week (E5).
> - [ ] Week view: zero code changes expected — regression-verified only.
> - [ ] Visual parity: before/after screenshots of Week + Month on dev — same chips, colors, grid.
> - [ ] Reschedule email CAS verified with test rows (notify OFF): date-only drags respect the
>       `client_time_sig` logic; no mass-email risk.
> - [ ] `npm run test` + `npm run build` + eslint pass; zero schema migrations;
>       `upr-pattern-checker` clean; `UPR-Web-Context.md` + this doc's checkboxes reconciled; test
>       rows deleted; push; PR into `dev` as a handoff, then stop.

Scope: `src/components/schedule/MonthView.jsx` (primary), Schedule.jsx (props/wiring), possibly
CalendarView.jsx (shared drop helpers), index.css (Phase-3 marker only). Deliberately NOT: Week
feature work, multi-day bars (deferred with decision ⑥), any RPC change.

## Dependency graph

```
plan-of-record PR (this doc) merged into dev
        │
        ▼
   Session A ── hard artifact edge ──► Session B ── hard artifact edge ──► Session C
   (booking modal)                     (removal + reverse path)            (month parity)

owner anytime lane (hard gate, not built on hope): close/rebase draft PR #102 — gates Session B only
external co-edits (coordination, not gates): tech-v2 sessions touch App.jsx tech routes + index.css markers
```

Edge types: A→B→C are hard artifact edges (shared Schedule.jsx surface — see the ledger); the PR
#102 item is an owner action on the anytime lane; tech-v2 adjacency is a rebase-awareness note, not
an ordering edge.

## Dispatch model

- **Wave 0 = Session A alone.** Waves 1 and 2 are Sessions B and C, each launching after the prior
  session's PR merges. No parallel sessions in this initiative (disjointness unprovable — ledger ①).
- **How work lands (per CLAUDE.md Rule 4):** each session pushes its branch and opens a **PR into
  `dev` as a handoff, marked ready to merge, then stops** — no subscribing, babysitting, or waiting
  on review. The owner merges; `dev` auto-deploys to dev.utahpros.app; production remains the
  reviewed `dev → main` PR.
- **No feature flag (decision on record):** this upgrades an already-live, ungated internal surface;
  production exposure is gated by the `dev → main` PR (feedback-media precedent).
- **Progress tracking:** non-CRM initiative → tracked via THIS doc's phase checklists (the CRM
  tracker is not used; no generic tracker exists).
- **Owner pre-decisions due at dispatch:** none for Session A; close/rebase PR #102 before B.

## Ownership matrix & frozen list (authoritative for these sessions — no separate manifest file; a 3-session serial initiative doesn't earn `.claude/rules/` ceremony)

| Session | Owns exclusively (edit only these) | New files it creates |
|---|---|---|
| A | `src/pages/Schedule.jsx` (picker/render wiring), `src/components/CreateJobModal.jsx` (shared-component swap), `src/index.css` (3 reserved markers) | `src/components/schedule/BookingModal.jsx`, shared client/claim component (e.g. `src/components/ClientClaimPicker.jsx`) |
| B | `src/pages/Schedule.jsx`, `src/pages/JobPage.jsx`, `src/components/JobPanel.jsx`, `src/App.jsx` (`/schedule/templates` region only), `src/lib/navItems.jsx`, `src/pages/Admin.jsx` (one row), `src/components/EditAppointmentModal.jsx`, `src/index.css` (own marker); DELETES `ScheduleTemplates.jsx`, `ScheduleWizard.jsx` | `src/components/schedule/MonthView.jsx` (verbatim extraction) |
| C | `src/components/schedule/MonthView.jsx`, `src/pages/Schedule.jsx`, `src/components/CalendarView.jsx` (shared drop helpers only), `src/index.css` (own marker) | — |

**Frozen for every session (contracts, not files):** `appointments`/`appointment_crew` table shape,
column defaults, and the currently-open RLS write policies (deployed iOS bundles direct-insert);
no new overload of ANY live RPC (`clock_appointment_action` incident class — additive needs use a
post-insert update or a DROP+CREATE in one migration, and this initiative ships neither);
`create_job_with_contact` signature; tech-app RPC result shapes (`get_appointments_range`,
`get_my_appointments_today`, `get_appointment_detail`, `get_assigned_tasks`); the gcal-sync +
client-email trigger chain (work WITH it via `notify_client`, never around it);
`functions/api/google-calendar-sync.js` and `functions/lib/google-calendar.js` (read-only).
**Migration rule:** all three sessions ship **zero schema migrations** — any session that believes
it needs one stops and flags it for a separate reviewed change.

**What resisted maximum parallelism (honest record):** ① all three phases concentrate on
Schedule.jsx — cross-session disjointness unprovable → serial; a Foundation file-split session would
cost more than it saves at 3-session scale. ② The owner's pain-first directive puts the build
(A) before the cleanup (B) that would have shrunk its host file — adjudicated by the
counter-ordering skeptic and upheld on the merits (their Schedule.jsx regions are disjoint, so the
"shrink first" benefit was nearly moot). ③ JobPage.jsx (B) and CreateJobModal.jsx (A) co-edits are
serialized by the wave order — disclosed. ④ External adjacency accepted: tech-v2 co-edits App.jsx
(different route regions) and appends index.css markers — mitigated by Session A pre-committing all
three SCHEDULE V2 markers; draft PR #102 is a real conflict → owner gate before B. ⑤ No feature
flag — dev-staging is the gate; a booking-modal bug would hit the live schedule page on dev only
until the prod PR.

## Options on record (owner decisions 2026-07-03)

| Decision | Chosen | Rejected + the caveat under which it wins later |
|---|---|---|
| Flow surface | **HCP-style booking modal, schedule-page only** | Replace CreateJobModal everywhere — right if/when the booking modal proves itself and the owner wants one intake flow platform-wide (the shared client/claim component is the groundwork) |
| Modal architecture | **Unified single-save modal, with a committed chained-modals fallback at ~70% session budget** | Chained modals as the target — right if the unified modal stalls; ships behind the same picker entry |
| lead_source write path | **Post-insert `db.update`** | Adding `p_lead_source` to `create_job_with_contact` — right when CreateJobModal unification happens; must be a DROP+CREATE (not REPLACE) in one migration with an old-caller compat test, per the overload incident |
| Appointment data model | **Single-day rows; "(continued)" cloning for spillover** | True multi-day via the dormant `duration_days` — right only with a dedicated initiative that upgrades every consumer (tech app, gcal sync, dispatch RPCs) together |
| Recurrence | **Deferred, no schema** | Recurrence schema + expansion — right when a real recurring-work pattern shows up in operations |
| View retirement | **Delete Jobs/Crew/3-Day code** | Flag-gating them off — pointless for a solo-decided kill; git history is the archive |
| appointments→scheduled-jobs refactor | **Superseded by this plan** | — (stale references struck in place this session) |

## Challenge report (adversarial pass, run before this doc was committed)

- **Refute-first verification (7 claims):** 5 CONFIRMED, 2 MODIFIED. MODIFIED-1: templates removal
  surface is larger (navItems ×2 + Admin.jsx registry row → folded into Session B's checklist).
  MODIFIED-2: `get_dispatch_board` appointment JSON carries no `job_id` → Month parity is frontend
  stamping, no RPC change (folded into Session C). New facts: crew receive real emails + calendar
  events on appointment create (test protocols tightened in every phase block); with Auto-show OFF
  a new job wouldn't surface → the booking modal pins via `dispatch_board_jobs`; `jobs.lead_source`
  is 100% NULL with zero writers → options spec'd fresh, post-insert update chosen over an RPC
  param (overload hazard).
- **Counter-ordering skeptic:** cleanup-first REJECTED — P1's wiring (creationPicker, cell-click)
  and P2's ~550 deletion lines occupy disjoint Schedule.jsx regions, so the "shrink the file first"
  benefit is nearly moot and the owner's pain-first directive + time-to-value dominate. ADOPTED
  amendments: JobPage reverse path moved P1→P2 (keeps A single-deliverable; B was light);
  MonthView verbatim extraction added to B; F2 remodeling fix promoted P3→P2 as its own commit;
  A gained the Encircle-sync callout, the shared-component extraction strategy, and the
  fallback checkpoint; B gained the keep-placementMode over-deletion guard. Merging B+C was
  rejected (the deletion diff must stay trivially revertable).
- **Collision check:** CRM 5-Ops (Session L), CRM 4b (Session J), feedback-media B/C — all
  DISJOINT from this initiative's files. **tech-v2** (plan merged #258) co-edits App.jsx (tech
  routes; different region) and will append index.css markers → mitigated as above; its planned
  body-REPLACE of `clock_appointment_action` and additive `get_appointments_range` keys don't touch
  this initiative's read paths (desktop schedule reads `get_dispatch_board`/`get_dispatch_events`).
  **Draft PR #102 is a real conflict** (edits 6 Session-B files incl. one B deletes) → owner gate.
  `navItems.jsx` currently unclaimed by any in-flight session; Q2-RECON punch list disjoint.
