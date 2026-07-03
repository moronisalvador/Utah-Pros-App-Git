# Schedule Desktop — Dispatch Blocks (2026-07-03)

Copy-paste blocks below are complete, self-contained prompts for cold sessions with zero history.
Claude Code web hands each session a harness-assigned `claude/…` branch — the `Branch:` line in
each settings header is illustrative for humans. Where a block cites artifact names (component
paths, marker text), the phase blocks + ownership matrix in `docs/schedule-roadmap.md` are
authoritative if names drift.

**How work lands (per CLAUDE.md Rule 4):** each session pushes its branch and opens a **PR into
`dev` as a handoff, marked ready to merge, then stops** — no subscribing to, babysitting, or
waiting on the PR. The owner merges; `dev` auto-deploys to dev.utahpros.app; production stays the
reviewed `dev → main` PR.

**Preconditions:** ① Session A launches once the plan-of-record PR (this doc + the roadmap) is
merged into `dev`. ② **Soft coordination before Session B (round-3 — no longer a hard gate):**
close or rebase **draft PR #102** (stale lint PR editing 6 of Session B's files). B no longer
*deletes* `ScheduleTemplates.jsx` (it's deactivated, kept dormant), so the file-deletion clash is
gone; B still edits shared `Schedule.jsx`/`JobPage.jsx`/`JobPanel.jsx`, so clearing #102 first is
good hygiene — recommended, not required. ③ No external gates for Session C beyond B's merge.

Sessions are strictly serial: A → B → C (shared `src/pages/Schedule.jsx` surface — no
simultaneous launches in this initiative).

## Wave 0 — Session A (launch after the plan-of-record PR merges into dev)

```
[Session A — Wave 0]
Branch: session-assigned (illustrative: schedule/phase-1-booking), cut from origin/dev
Model: Opus 4.8 (or strongest available)
Effort: High
Launch after: plan-of-record PR (docs/schedule-roadmap.md + docs/schedule-dispatch.md) merged into dev

You are building Schedule Desktop Phase 1 — the HCP-style booking modal — one phase only, no scope
creep. This is multi-write orchestration on a live, ungated page with real e-mail side effects:
weight correctness of the save chain and the test protocol accordingly.

Read scope: CLAUDE.md, the "Booking-modal design" section + "Session A" phase block + frozen-list
in docs/schedule-roadmap.md (binding), and UPR-Design-System.md (modal/form patterns). Verify
column names live before writing queries — never from memory.

Work on your session's assigned branch cut from origin/dev.

Already shipped for you to build on: CreateJobModal.jsx (contact typeahead via
search_contacts_for_job, AddContactModal quick-add with duplicate-phone recovery, claim
new/existing via get_customer_detail + p_existing_claim_id, division picker, AddressAutocomplete,
CarrierSelect, bounded syncClaimToEncircle helper) and CreateAppointmentModal.jsx (crew chips with
lead-first roles, ad-hoc tasks via add_adhoc_job_task + assign_tasks_to_appointment, notify_client
toggle, direct appointments/appointment_crew inserts). The create_job_with_contact RPC is live and
drift-free (returns {job, contact, claim_id, claim_number}, sets phase 'job_received').

Hard constraints: ZERO schema migrations. Do not change any RPC (no CREATE OR REPLACE anywhere —
adding a param mints an overload; the clock_appointment_action PGRST203 incident is the cautionary
precedent). appointments/appointment_crew table shape and open RLS write policies are frozen
(deployed iOS bundles direct-insert). Never touch functions/api/google-calendar-sync.js or
functions/lib/google-calendar.js — the INSERT trigger chain is live in production and emails the
CLIENT when job.client_email is set and notify_client is true (column default TRUE), and emails +
calendar-invites the CREW on create. index.css writes only inside three new reserved markers you
pre-commit at the bottom: /* ─── SCHEDULE V2 RESERVED — Phase 1|2|3 ─── */ (pre-committing all
three avoids EOF contention with the in-flight tech-v2 markers). Top-bar and CustomerPage keep
today's CreateJobModal behavior (navigate-after-create) — you change their internals only via the
shared component swap, not their flow.

Build in this order (riskiest first):
① Extract CreateJobModal's contact/claim section into a shared component (e.g.
   src/components/ClientClaimPicker.jsx) consumed by BOTH CreateJobModal and the new modal — one
   codepath; carry the typed search name into the quick-add form (fixes the dead
   prefillName/defaultRole seam); claim choice = "New claim" (DEFAULT on every client
   selection/change) vs "Existing claim (N)" with rows showing address · date of loss · claim
   number, prefilling loss address/carrier/claim#/DOL when picked. Verify CreateJobModal still
   works at its 3 mounts (Layout, CustomerPage, NewInvoiceModal).
② The save chain as a tested pure builder + executor: create_job_with_contact (incl.
   p_existing_claim_id) → db.update('jobs', …) for lead_source → db.insert('appointments',
   {job_id, title, date, time_start, time_end, type, status:'scheduled', notes, notify_client}) →
   per-crew db.insert('appointment_crew') → add_adhoc_job_task + assign_tasks_to_appointment →
   syncClaimToEncircle await for NEW claims only (same bounded pattern as CreateJobModal — do not
   skip) → db.insert('dispatch_board_jobs', {job_id, added_by}) pin → onSaved(date).
③ BookingModal.jsx, two-column HCP style per the roadmap's design section: left = customer +
   claim + schedule block (date, start/end times, "anytime" = null times, crew chips lead-first,
   Notify customer toggle DEFAULT ON, lead-source select with the roadmap's starter options →
   jobs.lead_source); right = dispatch context (division picker driving divisionToType, address
   via AddressAutocomplete — it degrades to plain text while the Places kill-switch is on,
   appointment title with auto-fallback, "what to do" ad-hoc task list, notes to crew, claim/job
   summary). Centered modal on desktop, bottom sheet at 768px per the design system.
④ Entry wiring in Schedule.jsx: creationPicker gains "New job" as the first of three options
   (New job / Job appointment / Event); day-cell and hour-slot clicks prefill date (+time);
   onSaved stays on the calendar — re-anchor, reload board, toast. No navigation.

Fallback checkpoint (binding): if at ~70% of your session budget the unified modal is not
converging, ship the chained flow instead — CreateJobModal then auto-open CreateAppointmentModal
preloaded with the new job — behind the same "New job" picker entry, and record the unified modal
as follow-up in the PR. The flow ships either way.

Test-first (commit failing first): ① save-chain builder — ordering + payloads for new-claim vs
existing-claim (p_existing_claim_id, notify_client, lead_source, board pin); ② claim-mode logic —
default 'new' on every client selection/change, existing disabled at 0 claims; ③ divisionToType +
auto-title fallback.

Test protocol (TCPA-adjacent — real emails): test jobs must have NO client_email or notify OFF;
never select real crew on test bookings (they get real emails + Google Calendar events); delete
ALL test rows at close-out (contacts, claims, jobs, appointments via delete_appointment,
dispatch_board_jobs).

Close-out: npm run test + npm run build + eslint (changed files) green; upr-pattern-checker clean;
acceptance on dev.utahpros.app (new client under 60s, existing-claim path, CreateJobModal
regression at all 3 mounts); update UPR-Web-Context.md (Schedule System section + a session
entry); reconcile the Session A checkboxes in docs/schedule-roadmap.md honestly (no marking done
what isn't, no leaving done work unticked); delete test rows; push -u, open a PR to dev via the
template, mark it ready to merge, then stop — the PR is a handoff the owner merges; do NOT
subscribe to, babysit, or wait for a review on it.
```

## Wave 1 — Session B (launch after Session A merges into dev)

```
[Session B — Wave 1]
Branch: session-assigned (illustrative: schedule/phase-2-cleanup), cut from origin/dev
Model: Opus 4.8 (or strongest available)
Effort: Medium
Launch after: Session A merged into dev. (Draft PR #102 — soft coordination, round-3: you no
longer DELETE ScheduleTemplates.jsx, so the old file-deletion clash is gone; you still edit shared
Schedule.jsx/JobPage.jsx/JobPanel.jsx, so having the owner close/rebase #102 first is good hygiene,
not a hard gate.)

You are building Schedule Desktop Phase 2 — DEACTIVATE the unused views + the JobPage reverse path
— one phase only, no scope creep. ⚠️ ROUND-3 OWNER AMENDMENT: this is DEACTIVATE, NOT DELETE. The
Jobs view, Crew view, and the Templates/Wizard subsystem are HIDDEN from the UI but their code,
route, tables, and RPCs are KEPT DORMANT for a future revival (Templates/Wizard is the future-Gantt
groundwork). Deleting any of that code is the failure mode. Live page (CLAUDE.md Rule 8) — no
silent behavior change to the surviving Calendar view.

Read scope: CLAUDE.md, the "Session B" phase block + frozen-list in docs/schedule-roadmap.md
(binding). Foundation shipped for you: Session A's BookingModal + shared client/claim component
are live on the schedule page; the three SCHEDULE V2 index.css markers exist — write only inside
the Phase 2 marker.

Work on your session's assigned branch cut from origin/dev.

Hard constraints: ZERO schema migrations; ZERO DB object drops; ZERO code-file deletions of the
deactivated features — the template tables (schedule_templates, template_phases, template_tasks,
job_schedules, job_schedule_phases), their RPCs (apply_schedule_plan, preview_schedule,
get_schedule_template(s), get_job_schedule(s)), AND the component files ScheduleTemplates.jsx +
ScheduleWizard.jsx all STAY, documented as deactivated/dormant. appointments/appointment_crew
contracts frozen (see roadmap). App.jsx: if you touch it at all, ONLY the /schedule/templates route
region — but you may leave the route registered (nav-less) since the files survive; the in-flight
tech-v2 initiative co-edits tech routes in the same file (rebase-aware, different regions).

Build in this order:
① Deactivate the Templates/Wizard subsystem (HIDE, don't delete): remove BOTH navItems.jsx entries
   (NAV_ITEMS + OVERFLOW_ITEMS), the schedule_templates page-access row in Admin.jsx (~:971), and
   the "Generate schedule" entry points in JobPage.jsx (the ScheduleTab trigger) and JobPanel.jsx.
   KEEP ScheduleTemplates.jsx, ScheduleWizard.jsx, the tables, and the RPCs in place. (Leaving the
   /schedule/templates route registered but nav-less is fine — the point is the files survive so a
   future session can re-add the nav and revive it.)
② JobPage reverse path: "Schedule appointment" becomes the Schedule tab's CTA (the "Generate
   schedule" button is gone with step ①), rendering the existing CreateAppointmentModal — JobPage
   already holds job.id / insured_name / division and an employees array; add color to its
   employees select (the modal uses emp.color for crew chips). Verify schedule-from-job on dev.
③ Deactivate the Jobs + Crew views in Schedule.jsx (HIDE, don't delete): remove 'jobs' and 'crew'
   from the view toggle so Calendar is the only selectable view, and HIDE the Calendar/Jobs/Crew
   SegControl entirely (a single-option toggle is pointless). Sanitize viewMode so it always
   resolves 'calendar' (a stored upr_schedule_view of 'jobs'/'crew' must fall back to 'calendar' —
   this auto-fixes the F3 mobile bug and guarantees iPhone + desktop both land on Calendar). ⚠️ Do
   NOT delete the grid code — GridPopover, ApptCard, CrewApptCard, the grid render blocks, the
   gridPlacementPicker + its modal all STAY dormant (unreachable). ⚠️ 3-Day span is KEPT ("works
   great for iPad") — do NOT touch upr_schedule_span; the Day/3-Day/Week/Month span toggle stays.
   OVER-DELETION GUARD: keep placementMode, handlePlacementClick, handleRescheduleRemaining — the
   CalendarView consumes them. Update the "Jobs move here automatically when a schedule is
   generated" empty-state copy for the deactivated-wizard world.
④ Extract MonthView VERBATIM to src/components/schedule/MonthView.jsx — a zero-behavior move the
   diff can prove (Session C grows this file).
⑤ Optional genuinely-dead code (unreachable, NOT a deactivated feature — safe to remove):
   EditAppointmentModal's clone-visit block (~90 lines: nextVisitPrompt footer, handleCloneVisit,
   getNextBusinessDay), the gridDays no-op memo, unused DivisionIcon imports. ⚠️ hexToTint STAYS —
   still used by the retained (dormant) grid code.
⑥ Separate commit: fix the remodeling division filter gap — remodeling jobs currently match
   neither the Mitigation nor the Recon chip (live correctness bug; decide bucket per the division
   palette: remodeling groups with reconstruction).

Result: desktop is unchanged (Calendar + Week default; the only visible difference is the
Calendar/Jobs/Crew toggle is gone); iPhone lands on Calendar (Day span, as today).

Test-first (commit failing first): a scheduleUtils/filter test proving the remodeling bucket fix
(remodeling visible under its chosen chip, hidden under the other), and a viewMode-sanitize test —
stored 'jobs'/'crew' resolves to 'calendar' ('3day' span values stay VALID — the ② amendment keeps
the 3-Day span).

Close-out: npm run test + npm run build + eslint green; zero schema migrations; grep proves the
Jobs/Crew grid code + ScheduleTemplates.jsx + ScheduleWizard.jsx STILL EXIST (retained) and are
unreachable from nav/toggle; Day/3-Day/Week/Month ALL visually unchanged on dev.utahpros.app (3-Day
KEPT); iPhone lands on Calendar, desktop stays Calendar+Week; mobile spot-check only — no mobile
work (roadmap decision ⑨); upr-pattern-checker clean; update UPR-Web-Context.md (rewrite the
Schedule System bullets — Jobs/Crew + Templates/Wizard marked DEACTIVATED/DORMANT + revivable, NOT
removed) + session entry; reconcile the Session B checkboxes in docs/schedule-roadmap.md honestly;
delete any test rows (no client_email / notify OFF / no real crew on test appointments); push -u,
open a PR to dev via the template, mark
it ready to merge, then stop — do NOT subscribe to, babysit, or wait for a review on it.
```

## Wave 2 — Session C (launch after Session B merges into dev)

```
[Session C — Wave 2]
Branch: session-assigned (illustrative: schedule/phase-3-month), cut from origin/dev
Model: Opus 4.8 (or strongest available)
Effort: Medium
Launch after: Session B merged into dev

You are building Schedule Desktop Phase 3 — the Month-view upgrade: Week's design SYSTEM at month
DENSITY — one phase only, no scope creep. The Week view is the owner's beloved standard ("spot
on") and takes ZERO code changes this phase (regression-verify only). Month is rescoped by owner
decision ① (2026-07-03): it ADOPTS Week's visual and interaction language — its current look is
superseded, not preserved — but at month density. Do NOT transplant Week's card geometry: month
cells are ~90px, Week cards 40-70px; full cards would show ~1 appointment/day and destroy the
overview. Miniaturize the language instead.

Read scope: CLAUDE.md, the "Session C" phase block + decision ① + frozen-list in
docs/schedule-roadmap.md (binding), UPR-Design-System.md. Foundation shipped for you: MonthView
lives in src/components/schedule/MonthView.jsx (Session B's verbatim extraction); the
creationPicker (New job / Job appointment / Event) is live; Calendar is the only active view
(Jobs/Crew deactivated by Session B, their code dormant) with Day/3-Day/Week/Month spans (3-Day
kept — iPad).

Work on your session's assigned branch cut from origin/dev.

Hard constraints: ZERO schema migrations; no RPC changes — get_dispatch_board's appointment
objects carry NO job_id (it lives on the parent job row), so chip enrichment is frontend stamping
exactly as the Week path does (_jobId/_division/_address from the job row). appointments contracts
frozen (see roadmap). index.css writes only inside the Phase 3 SCHEDULE V2 marker. The
update_appointment path fires the live gcal-sync + client-reschedule-email chain — test rows only,
notify OFF. Mobile is a NON-GOAL (roadmap decision ⑨) — no mobile-specific work; the tech app
owns mobile scheduling and is untouched. Week view: byte-identical.

Build in this order (riskiest first):
① Restyle Month on Week's design system, month density: chips become miniature single-line
   eventCardStyle cards — soft-tint background + 3px left accent + dark text (replacing the solid
   divColor blocks with white text; this also fixes the DIV_COLORS-vs-eventCardStyle palette
   clash), completed = gray at reduced opacity, events styled exactly as Week styles events.
   Single-line chips + "+N more" overflow preserved — density is the acceptance bar.
② Drag-to-reschedule in Month: chips draggable between day cells (date-only change), reusing the
   page's optimistic handleApptDrop → update_appointment → silent reload → rollback-on-failure
   pattern; completed appointments stay non-draggable, consistent with Week.
③ Week's hover popover on Month chips (reuse/adapt the ApptPopover pattern from CalendarView) —
   full appointment detail without leaving the month overview.
④ Click-day → creationPicker prefilled with that date (replacing the jump-to-Day navigation);
   the day NUMBER keeps zoom-to-Day so the drill-down isn't lost.
⑤ Events in Month: render kind='event' rows (pass the page's filteredEvents into MonthView); the
   existing rule stands — an active division filter hides events, crew filter applies.
⑥ Chip enrichment: stamp _jobId/_division/_address/_jobNumber from the parent job row so the
   hover/edit/'View job' paths from Month match Week exactly.

Test-first (commit failing first): the by-date bucketing/enrichment helper — events merged with
job appointments per day cell, enrichment fields present, +N-more overflow count correct with
mixed kinds.

Close-out: npm run test + npm run build + eslint green; upr-pattern-checker clean; before/after
screenshots of Week + Month on dev.utahpros.app proving Month now speaks Week's visual language
at month density while Week is byte-identical (if the soft tints read too quiet at month size,
disclose the tint/accent ratio as the one-variable tuning lever — owner adjusts on staging, not a
redesign); drag a TEST appointment (notify OFF) and verify the reschedule email CAS logic isn't
tripped by date-only moves; update UPR-Web-Context.md (Schedule System + session entry); reconcile
the Session C checkboxes in docs/schedule-roadmap.md honestly; delete test rows; push -u, open a
PR to dev via the template, mark it ready to merge, then stop — do NOT subscribe to, babysit, or
wait for a review on it.
```
