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
merged into `dev`. ② **Owner action gating Session B only:** close or rebase **draft PR #102**
(stale lint PR — it edits 6 of Session B's files including `ScheduleTemplates.jsx`, which B
deletes). Hard gate — do not launch B on hope. ③ No external gates for Session C beyond B's merge.

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

## Wave 1 — Session B (launch after Session A merges into dev AND PR #102 is closed/rebased)

```
[Session B — Wave 1]
Branch: session-assigned (illustrative: schedule/phase-2-cleanup), cut from origin/dev
Model: Opus 4.8 (or strongest available)
Effort: Medium
Launch after: Session A merged into dev AND owner has closed/rebased draft PR #102 (hard gate —
it edits 6 of this session's files including ScheduleTemplates.jsx, which you delete)

You are building Schedule Desktop Phase 2 — dead-weight removal + the JobPage reverse path — one
phase only, no scope creep. This is a large deletion on a live page (CLAUDE.md Rule 8): removal
is the deliverable, silent behavior change is the failure mode.

Read scope: CLAUDE.md, the "Session B" phase block + frozen-list in docs/schedule-roadmap.md
(binding). Foundation shipped for you: Session A's BookingModal + shared client/claim component
are live on the schedule page; the three SCHEDULE V2 index.css markers exist — write only inside
the Phase 2 marker.

Work on your session's assigned branch cut from origin/dev.

Hard constraints: ZERO schema migrations; no DB object drops — the template tables
(schedule_templates, template_phases, template_tasks, job_schedules, job_schedule_phases) and the
6 dead RPCs (apply_schedule_plan, preview_schedule, get_schedule_template, get_schedule_templates,
get_job_schedule, get_job_schedules — plus finish_appointment, already caller-less) stay in the DB
and get documented as retired instead. appointments/appointment_crew contracts frozen (see
roadmap). App.jsx: touch ONLY the /schedule/templates route + its lazy import — the in-flight
tech-v2 initiative co-edits tech routes in the same file; rebase-aware, different regions.

Build in this order:
① Delete the Templates/Wizard subsystem end to end: ScheduleTemplates.jsx; the /schedule/templates
   route + lazyRetry import in App.jsx; BOTH navItems.jsx entries (NAV_ITEMS + OVERFLOW_ITEMS);
   the schedule_templates page-access row in Admin.jsx (~:971); ScheduleWizard.jsx plus its
   integrations in JobPage.jsx (import, render, ScheduleTab "Generate schedule" trigger) and
   JobPanel.jsx (import, trigger block, render).
② JobPage reverse path: "Schedule appointment" becomes the Schedule tab's CTA (replacing
   "Generate schedule"), rendering the existing CreateAppointmentModal — JobPage already holds
   job.id / insured_name / division and an employees array; add color to its employees select
   (the modal uses emp.color for crew chips). Verify schedule-from-job end-to-end on dev.
③ Collapse the viewMode axis in Schedule.jsx: remove the Jobs grid + Crew grid views (GridPopover,
   ApptCard, CrewApptCard, grid hover state, grid cell drop handlers, gridPlacementPicker + its
   modal, the Calendar/Jobs/Crew SegControl) and the 3-Day span option; sanitize stale
   localStorage reads (upr_schedule_view goes away; upr_schedule_span must fall back from '3day').
   OVER-DELETION GUARD: keep placementMode, handlePlacementClick, handleRescheduleRemaining — the
   Week/Day CalendarView consumes them. Update the "Jobs move here automatically when a schedule
   is generated" empty-state copy for the post-wizard world.
④ Extract MonthView VERBATIM to src/components/schedule/MonthView.jsx — a zero-behavior move the
   diff can prove (Session C grows this file).
⑤ Dead code: EditAppointmentModal's unreachable clone-visit block (~90 lines: nextVisitPrompt
   footer, handleCloneVisit, getNextBusinessDay), dead DivisionIcon/DIVISION_COLORS imports in
   Schedule.jsx + JobPanel.jsx, the gridDays no-op memo, the local hexToTint duplicate
   (scheduleUtils.js exports it); prune index.css mobile rules orphaned by the removals.
⑥ Separate commit: fix the remodeling division filter gap — remodeling jobs currently match
   neither the Mitigation nor the Recon chip (live correctness bug; decide bucket per the division
   palette: remodeling groups with reconstruction).

Test-first (commit failing first): a scheduleUtils/filter test proving the remodeling bucket fix
(remodeling visible under its chosen chip, hidden under the other), and a localStorage-fallback
test for the '3day'/'jobs'/'crew' → sane-default sanitization.

Close-out: npm run test + npm run build + eslint green; zero schema migrations; grep proves zero
remaining references to removed components/RPCs; Week/Month/Day visually unchanged on
dev.utahpros.app; mobile spot-check (mobile only ever saw Calendar — the toggle was CSS-hidden);
upr-pattern-checker clean; update UPR-Web-Context.md (rewrite the Schedule System bullets — views
list, templates retired, dead RPCs listed retired-no-callers) + session entry; reconcile the
Session B checkboxes in docs/schedule-roadmap.md honestly; delete any test rows (no client_email /
notify OFF / no real crew on test appointments); push -u, open a PR to dev via the template, mark
it ready to merge, then stop — do NOT subscribe to, babysit, or wait for a review on it.
```

## Wave 2 — Session C (launch after Session B merges into dev)

```
[Session C — Wave 2]
Branch: session-assigned (illustrative: schedule/phase-3-month), cut from origin/dev
Model: Opus 4.8 (or strongest available)
Effort: Medium
Launch after: Session B merged into dev

You are building Schedule Desktop Phase 3 — Month-view parity — one phase only, no scope creep.
The Week view is the owner's beloved standard and takes ZERO code changes this phase
(regression-verify only); Month gains parity without changing its visual language.

Read scope: CLAUDE.md, the "Session C" phase block + frozen-list in docs/schedule-roadmap.md
(binding), UPR-Design-System.md. Foundation shipped for you: MonthView lives in
src/components/schedule/MonthView.jsx (Session B's verbatim extraction); the creationPicker
(New job / Job appointment / Event) is live; the page is Calendar-only with Day/Week/Month.

Work on your session's assigned branch cut from origin/dev.

Hard constraints: ZERO schema migrations; no RPC changes — get_dispatch_board's appointment
objects carry NO job_id (it lives on the parent job row), so chip enrichment is frontend stamping
exactly as the Week path does (_jobId/_division/_address from the job row). appointments contracts
frozen (see roadmap). index.css writes only inside the Phase 3 SCHEDULE V2 marker. The
update_appointment path fires the live gcal-sync + client-reschedule-email chain — test rows only,
notify OFF.

Build in this order (riskiest first):
① Drag-to-reschedule in Month: chips draggable between day cells (date-only change), reusing the
   page's optimistic handleApptDrop → update_appointment → silent reload → rollback-on-failure
   pattern; completed appointments stay non-draggable, consistent with Week.
② Click-day → creationPicker prefilled with that date (replacing the jump-to-Day navigation);
   the day NUMBER keeps zoom-to-Day so the drill-down isn't lost.
③ Events in Month: render kind='event' rows (pass the page's filteredEvents into MonthView) with
   the same event styling language the other views use; the existing rule stands — an active
   division filter hides events, crew filter applies.
④ Chip enrichment: stamp _jobId/_division/_address/_jobNumber from the parent job row so the
   hover/edit/'View job' paths from Month match Week exactly.

Test-first (commit failing first): the by-date bucketing/enrichment helper — events merged with
job appointments per day cell, enrichment fields present, +N-more overflow count correct with
mixed kinds.

Close-out: npm run test + npm run build + eslint green; upr-pattern-checker clean; before/after
screenshots of Week + Month on dev.utahpros.app proving visual parity (same chips, colors, grid);
drag a TEST appointment (notify OFF) and verify the reschedule email CAS logic isn't tripped by
date-only moves; update UPR-Web-Context.md (Schedule System + session entry); reconcile the
Session C checkboxes in docs/schedule-roadmap.md honestly; delete test rows; push -u, open a PR to
dev via the template, mark it ready to merge, then stop — do NOT subscribe to, babysit, or wait
for a review on it.
```
