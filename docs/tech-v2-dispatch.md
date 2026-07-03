# Tech Mobile v2 — Session Dispatch Blocks

Copy-paste launch blocks for every tech-v2 build session, per the model in
`docs/tech-v2-roadmap.md`. Each block is fully self-contained for a cold session with zero
conversation history: settings header, then the complete prompt. Claude Code web hands each
session a harness-assigned `claude/…` branch — use it as-is (CLAUDE.md); the Branch line is
the illustrative name for humans tracking PRs. Blocks cite Foundation artifact names as
specified in the roadmap — if F's implementation drifts, the ownership manifest
(`.claude/rules/tech-v2-wave-ownership.md`) and the roadmap phase blocks are authoritative.

**Preconditions:** Wave 0 (Session F) launches after the tech-v2 roadmap PR is merged into
`dev`. Wave 1 (Sessions S and D — may launch simultaneously OR serially, owner's choice)
launches after Session F's PR is merged into `dev`. Sessions C, M1, M2 launch per the
prerequisites in their headers. **No owner pre-decisions are outstanding** — all four
(rollout, deps, merge scope, offline bar) were locked at plan time and are encoded below.
Flag flips (owner-only → all techs) remain the owner's, in DevTools → Flags.

---

## Wave 0 — Session F alone

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: tech-v2/phase-f-foundation), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: High
Launch after: tech-v2 roadmap PR merged into dev — nothing else

You are building Tech Mobile v2 Phase F — Foundation: all schema/RPC changes, the data
layer, and the wiring for the S/D wave; one phase only, no feature UI beyond stubs. Read
scope: CLAUDE.md, the "Phase F — Foundation" block plus the "Architecture decisions"
section in docs/tech-v2-roadmap.md, and .claude/rules/tech-mobile-ux.md. Work on your
session's assigned branch cut from origin/dev. Order of work (riskiest first):
(1) SEED THE FLAGS FIRST, before any code merges anywhere: insert feature_flags rows
page:tech_dash_v2 and page:tech_sched_v2 with enabled=false and
dev_only_user_id='d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da' (owner) via upsert_feature_flag on
the live Supabase — the no-row state FAILS OPEN (AuthContext isFeatureEnabled returns true
when no row exists), so the rows must exist before the App.jsx swap ever deploys.
(2) Drift-capture migration: dump the 13 live-only tech RPCs verbatim via
pg_get_functiondef (get_my_appointments_today, get_active_appointment_geo,
get_appointment_tasks, get_assigned_tasks, toggle_appointment_task, update_appointment,
delete_appointment, assign_tasks_to_appointment, get_unassigned_tasks, add_adhoc_job_task,
get_job_task_summary, get_active_techs, get_claim_appointments) into a no-behavior-change
migration — migrations are NOT currently the source of truth for these.
(3) Test-first RPC work (committed failing tests in supabase/tests/ or src/lib tests, then
green): [a] backward-compat upgrades of get_appointments_range and
get_my_appointments_today — ADD jsonb keys color, kind, duration_days, is_milestone, and
crew employees' color/avatar_url, plus per-appointment task done/total counts; add
p_include_cancelled boolean DEFAULT true to get_my_appointments_today; committed tests
prove the legacy callers' expected keys are unchanged (TechEditAppointment.jsx also
consumes get_appointments_range). [b] Body-only CREATE OR REPLACE of
clock_appointment_action changing the work_date stamp from v_now::date (UTC — misdates any
clock-in at/after 6pm MDT; 1 of 158 live rows affected) to (v_now AT TIME ZONE
'America/Denver')::date — same signature; dump the live def first per (2). [c] NEW
get_tech_dashboard(p_employee_id uuid) — SECURITY DEFINER + GRANT EXECUTE TO anon,
authenticated — returning in ONE round trip: today's appointments (full upgraded payload,
excluding cancelled), my upcoming 7 days, the open time entry, hours today and this week,
and photos-today count. Hours math (challenge-verified, test-first): SUM the STORED hours
column + travel_minutes — never recompute closed entries from clock_in/clock_out (breaks
manual hours-only rows, admin edits, midnight-split rows); add a live-elapsed term for the
single open entry (stored hours is 0 until finish); filter by work_date; week =
Monday-start in America/Denver to match get_payroll_summary; return travel and on-site as
SEPARATE fields (the UI shows travel + on-site + total, labeled).
(4) v1 relief patch (this is the ONLY window to touch legacy files — they are frozen
in-wave): in TechSchedule.jsx anchor dateRange to today so day taps stop refetching the
61-day window (refetch only when the selection exits the loaded window); in TechDash.jsx
stop setting loading=true when data already exists (no more full-skeleton on
pull-to-refresh/clock actions). Minimal diffs; verify visually; Rule 8.
(5) Data layer: add @tanstack/react-query, @tanstack/react-query-persist-client, and
@tanstack/query-async-storage-persister, all pinned 5.101.2; write a small async-storage
adapter over the existing idb package using a DEDICATED IndexedDB database named
'upr-query-cache' (never add a store to the existing 'upr-offline' DB — version-bump/
cross-tab hazard); mount PersistQueryClientProvider in src/main.jsx; ship
src/lib/techQuery.js as the COMPLETE frozen query-key + invalidation registry (keys: dash,
sched-month, active-clock, tasks, rooms, docs; mutation→invalidation map unit-tested) —
wave sessions import it and may NOT add keys.
(6) TechLayout pane host (flag-gated; byte-identical legacy behavior with flags off): the
two v2 panes render persistently outside <Outlet/>; each pane owns its scroll container;
hide inactive panes with display:none (transforms are banned on WKWebView) + track
scrollTop continuously into a ref via a passive listener + restore in useLayoutEffect on
activation (a naive save-on-hide reads 0 in WebKit); give panes an `active` prop that
gates geolocation checks and pollers (visibilitychange does not fire on pane hiding);
detail routes keep today's keyed 0.2s opacity fade exactly as-is.
(7) Wiring: App.jsx component-level swaps at /tech and /tech/schedule rendering
TechDashV2/TechScheduleV2 STUB pages when the respective flag allows; add the two
EXPLICIT_FLAGS entries in src/lib/featureFlags.js WITH enabled:false (load-bearing — the
DevTools auto-seed creates missing keys ON without it; do not register nav-derived);
apptHref(id)/jobHref(id) helpers in the v2 primitives — all v2 navigation to
appointment/job detail goes through them (M2 will flip one constant).
(8) Shared v2 primitives in src/components/tech/v2/: StatusChip (status-first color
language per techConstants), ApptListRow, TechV2Page scaffold, skeleton set; pre-commit
EMPTY reserved css marker sections TECH-V2: SCHED / TECH-V2: DASH / TECH-V2: HUB at the
end of the tech block in src/index.css; v2 styles are new tv2-* classes only.
(9) Document the --tech-* token layer in UPR-Design-System.md (currently undocumented);
commit .claude/rules/tech-v2-wave-ownership.md exactly per the roadmap's ownership matrix
+ frozen list. Close-out: npm run test + npm run build + npx eslint (changed files) pass;
migration-safety-checker + upr-pattern-checker clean; tech-phase-reviewer (Opus) sign-off;
visual check — stubs render behind the flags on the branch preview AND legacy pages are
identical with flags off; update UPR-Web-Context.md; reconcile the Phase F checkboxes in
docs/tech-v2-roadmap.md honestly (both directions); push -u and open a PR to dev using the
repo PR template, mark it ready for review.
```

---

## Wave 1 — Sessions S and D (may launch simultaneously once F is merged; serial is equally sanctioned — suggested merge order: S first)

```
[Session S — Wave 1]
Branch: session-assigned (illustrative: tech-v2/schedule-v2), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: High
Launch after: Session F merged into dev

You are building Tech Mobile v2 Session S — the Schedule/Calendar rebuild; one phase only,
no scope creep. The bar: a field tech could not tell the difference in feel between this
and Apple/Google Calendar — instant, anchored, nothing jumps. Read scope: CLAUDE.md, the
"Session S — Schedule v2" block in docs/tech-v2-roadmap.md,
.claude/rules/tech-v2-wave-ownership.md (binding: your files + the frozen list), and
.claude/rules/tech-mobile-ux.md (the 64-year-old-tech-in-gloves persona is law: 48px
targets, status = color from 3 feet, no modals for field actions). Work on your session's
assigned branch cut from origin/dev. Foundation already shipped: the page:tech_sched_v2
flag (dev-only), the TechScheduleV2 stub wired at /tech/schedule, the TanStack Query layer
with src/lib/techQuery.js (frozen — import only, never add keys), the persisted idb cache,
the TechLayout pane host with the `active` prop contract, upgraded feed RPCs now returning
color/kind/duration_days/is_milestone + crew color/avatar + task counts, shared v2
primitives (StatusChip, ApptListRow, TechV2Page, skeletons), apptHref()/jobHref() helpers,
and an empty TECH-V2: SCHED css marker section. Hard constraints: ZERO schema/migrations;
edit ONLY src/pages/tech/v2/TechScheduleV2.jsx + src/pages/tech/v2/schedule/** + css
inside your TECH-V2: SCHED marker (new tv2-* classes only — never restyle existing .tech-*
selectors); the frozen list is edited by nobody; all appointment/job navigation via
apptHref()/jobHref() — hardcoding /tech/appointment/ is forbidden; use dedicated TEST
fixture IDs and never assert on live row counts (one shared production Supabase — Session
D's clock-test writes appear in your month window). Test-first (committed failing, then
green): month-window key math (timezone-safe date bucketing), the day-grouping/sorting
selector, and filter-predicate parity with the legacy page (me/all/multi-crew + division).
Build: (1) Agenda view (default) — continuous bidirectional list with sticky day headers,
today anchored on FIRST PAINT via refs (never a setTimeout scroll; never
document.querySelector('.tech-content') — that legacy hack breaks under the pane host);
(2) Day timeline — hour grid with positioned event blocks and a red now-line;
(3) infinite week-strip pager — any date reachable, snaps per week, haptic tick via
lib/nativeHaptics; (4) day selection is pure client-side (never a fetch); month-window
queries via techQuery keys with ±1 month prefetch; (5) render the newly-exposed
color/kind/duration_days/is_milestone — events styled distinctly from job appointments,
multi-day bars, milestone markers; STATUS owns the color channel (division demoted to a
small pill); (6) carry over crew/division filters (persisted per employee), search, and
the create picker (navigating to the existing /tech/new-appointment and /tech/new-event —
do not modify those flows); (7) floating "Today" pill when scrolled away; pull-to-refresh
+ focus revalidate via the query layer; skeletons only on true cold start — content is
never replaced by a spinner. Month view is explicitly DEFERRED (roadmap stage rides with
Phase C) — do not build it, do not silently drop it either; it stays a visible deferred
stage. Close-out: npm run test + npm run build + npx eslint (changed files) pass;
upr-pattern-checker clean; tech-phase-reviewer (Opus) sign-off; visual check on the branch
preview AND the owner's phone via the prod flag; update UPR-Web-Context.md; reconcile your
roadmap checkboxes honestly; push -u and open a PR to dev using the repo PR template, mark
it ready for review.
```

```
[Session D — Wave 1]
Branch: session-assigned (illustrative: tech-v2/dashboard-v2), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: Medium
Launch after: Session F merged into dev — may run simultaneously with Session S

You are building Tech Mobile v2 Session D — the Dashboard rebuild ("mission control for
today"); one phase only, no scope creep. Read scope: CLAUDE.md, the "Session D — Dashboard
v2" block in docs/tech-v2-roadmap.md, .claude/rules/tech-v2-wave-ownership.md (binding),
and .claude/rules/tech-mobile-ux.md (persona is law; ONE primary action per screen —
Clock In dominates). Work on your session's assigned branch cut from origin/dev.
Foundation already shipped: the page:tech_dash_v2 flag (dev-only), the TechDashV2 stub
wired at /tech, get_tech_dashboard(p_employee_id) returning the whole payload in one round
trip (today's appointments with task counts + crew color/avatar, my upcoming 7 days, open
clock entry, hours today/week as separate travel and on-site fields, photos-today — hours
math already test-covered in F), the TanStack layer + frozen src/lib/techQuery.js
(import-only), the pane host with the `active` prop (gate your geolocation check and any
pollers on it), shared v2 primitives, and an empty TECH-V2: DASH css marker. Hard
constraints: ZERO schema/migrations; edit ONLY src/pages/tech/v2/TechDashV2.jsx +
src/pages/tech/v2/dash/** + css inside TECH-V2: DASH (new tv2-* classes only); frozen list
edited by nobody — you CONSUME TimeTracker, PhotoNoteSheet, ClockSupersedeSheet,
StalledWidget, clockPrecheck, the photo/offline-queue stack, and pickNowNext (from
NowNextTile) as-is; all navigation via apptHref()/jobHref(); dedicated TEST fixture IDs,
never assert live counts. Test-first (committed failing, then green): pickNowNext edge
cases (all completed / none today / paused job), hours display formatting (travel +
on-site + total, labeled — Monday-start Denver week, matching the payroll page), and a
cancelled-excluded regression test (call get_tech_dashboard / the today feed with
p_include_cancelled=false semantics). Build: (1) Now/Next hero — the single most relevant
thing right now: live continuous timer + primary action when clocked in (compose
TimeTracker), countdown to the next visit otherwise, next-upcoming-day preview when
nothing today; ONE dominant primary action, photo/notes secondary; (2) attention strip —
away-from-jobsite, still-clocked-in-after-5PM, StalledWidget: reuse the existing logic/
widgets, unify the visual skin, gate geo checks on the `active` prop; (3) today
mini-timeline (horizontal strip, status colors); (4) My numbers — hours today & this week
(travel + on-site + total, labeled), tasks done/total, photos today; (5) completed rows
WITH the travel/on-site/total breakdown (tech-mobile-ux mandate — never bare '3.5h');
(6) Coming Up (next 7 days) scoped to ME by default; (7) everything from the single
get_tech_dashboard query; clock/photo/task mutations invalidate via techQuery's map
instead of onReload full refetches; pull-to-refresh never re-skeletons (content stays put,
refreshes in place); snap-first photo flow preserved exactly (never block the
camera→save path). Close-out: npm run test + npm run build + npx eslint pass;
upr-pattern-checker clean; tech-phase-reviewer (Opus) sign-off; visual check on the branch
preview AND the owner's phone via the prod flag; update UPR-Web-Context.md; reconcile your
roadmap checkboxes honestly; push -u and open a PR to dev using the repo PR template, mark
it ready for review.
```

---

## Post-wave lanes

```
[Session C — Cutover & cleanup]
Branch: session-assigned (illustrative: tech-v2/cutover), cut from origin/dev
Model: Sonnet 5
Effort: Medium
Launch after: S and D merged into dev AND the owner has flipped both flags to all techs
and declared the bake complete — this is an owner-gated anytime lane

You are running Tech Mobile v2 Phase C — cutover & cleanup; one phase only. Read scope:
CLAUDE.md, the "Phase C" block in docs/tech-v2-roadmap.md, and
.claude/rules/tech-v2-wave-ownership.md. Work on your session's assigned branch cut from
origin/dev. Preconditions to verify before touching anything (do not proceed on hope):
page:tech_dash_v2 and page:tech_sched_v2 are enabled=true for everyone in the live
feature_flags table, and the owner has confirmed bake. Tasks: (1) delete the legacy
src/pages/tech/TechDash.jsx and TechSchedule.jsx; remove the App.jsx component-swap shims
so the v2 pages render unconditionally at /tech and /tech/schedule; (2) remove dead css:
the legacy pages' now-orphaned selectors (.tech-schedule-row[data-division] and other
stale classes the roadmap's cssNotes flag) — only after grep-verifying zero remaining
consumers; (3) STRETCH STAGE (explicit): build the deferred Month view for Schedule v2
(full-screen grid, event-density dots, tap day → Agenda anchors there) inside
src/pages/tech/v2/schedule/** — if you skip it, close the stage as 'deferred again' with
the reason disclosed, never silently; (4) verify the TechLayout badge and every remaining
/tech/* page still work post-deletion. Close-out: npm run test + npm run build + npx
eslint pass; upr-pattern-checker clean; tech-phase-reviewer sign-off; visual full
walk-through of the tech app on the owner's phone; update UPR-Web-Context.md; reconcile
roadmap checkboxes; push -u and open a PR to dev using the repo PR template (deletions get
their own reviewed PR — do not bundle unrelated work), mark it ready for review.
```

```
[Session M1 — Job Hub build]
Branch: session-assigned (illustrative: tech-v2/job-hub), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: High
Launch after: S and D merged into dev (C need not be done). Serial — not a wave session;
additive migrations of its own are permitted

You are building Tech Mobile v2 Phase M1 — the Job Hub: the merge of TechAppointment and
TechJobDetail into ONE surface; one phase only, highest-blast-radius phase of the
initiative (clock actions, e-sign adjacency, offline paths). Read scope: CLAUDE.md, the
"Phase M1" block in docs/tech-v2-roadmap.md, .claude/rules/tech-v2-wave-ownership.md, and
.claude/rules/tech-mobile-ux.md. Work on your session's assigned branch cut from
origin/dev. FIRST: seed the page:tech_job_hub feature_flags row (enabled=false,
dev_only_user_id='d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da') on the live Supabase BEFORE any
code referencing it merges (the no-row state fails open), and add the EXPLICIT_FLAGS
entry with enabled:false in the same PR. Test-first (committed failing, then green):
visit-picker selection logic (?appt= present / absent / stale id), work-auth banner
predicate parity with BOTH legacy implementations (TechAppointment.jsx:788-812 and
TechJobDetail.jsx:377-401), and the job_documents or=(appointment_id,job_id) fallback
query parity. Build the hub at /tech/job/:jobId?appt=<id> behind the flag, in
src/pages/tech/v2/TechJobHub.jsx + src/pages/tech/v2/hub/** + css §HUB only: (1) job
identity on the SHARED Hero + ActionBar components (TechAppointment's hand-rolled hero/
5-button bar dies in this merge); (2) visit picker — the job's appointments grouped
upcoming/past; ?appt= selects the visit context, defaulting to today's/next; (3)
per-visit context scoped to the selected appointment: TimeTracker (consume as-is),
tasks + toggle, crew, moisture/equipment/scope-sheet sections each behind their EXISTING
feature flags (page:tech_moisture, page:tech_equipment, page:tech_rooms); (4) job-wide:
photos (grouped, lightbox), documents/e-sign entry, notes, contacts, claim breadcrumb,
collapsible job details; work-auth banner logic extracted ONCE into a shared hub module;
(5) exactly one statusBarLight/Dark effect pair; role-gated merge/typed-DELETE preserved
for admin/manager. Offline decision fork (owner default, on record): per-visit captures
(photo/reading/equipment from appointment context) keep the offline queue; job-level
captures stay direct — do not extend the queue to job-level without an owner ask. If you
ship a get_job_hub aggregate RPC: additive migration, SECURITY DEFINER + GRANT,
migration-first (Rule 7), dump any live function you touch via pg_get_functiondef first.
Do NOT retarget any existing navigation yet — apptHref()/jobHref() stay pointed at the
legacy pages until M2. Close-out: npm run test + npm run build + npx eslint pass;
migration-safety-checker + upr-pattern-checker clean; tech-phase-reviewer (Opus)
sign-off; visual on the owner's phone — enter the hub from a schedule row, a dash card,
and a claims page; update UPR-Web-Context.md; reconcile roadmap checkboxes; push -u and
open a PR to dev using the repo PR template, mark it ready for review.
```

```
[Session M2 — Merge cutover]
Branch: session-assigned (illustrative: tech-v2/merge-cutover), cut from origin/dev
Model: Opus 4.8 (or newest Opus-tier)
Effort: Medium
Launch after: M1 merged into dev AND baked on the owner's phone (owner confirms)

You are running Tech Mobile v2 Phase M2 — the merge cutover; one phase only, the last
phase of the initiative. Read scope: CLAUDE.md, the "Phase M2" block in
docs/tech-v2-roadmap.md, and .claude/rules/tech-v2-wave-ownership.md. Work on your
session's assigned branch cut from origin/dev. Tasks: (1) flip the apptHref()/jobHref()
constants so all v2 navigation lands on /tech/job/:jobId?appt=<id>; (2) convert
/tech/appointment/:id into a thin resolver route (fetch the appointment's job_id via
get_appointment_detail, redirect to the hub with ?appt=) so every old link keeps
resolving; (3) retarget the remaining hardcoded call sites the roadmap inventoried —
grep the live tree for /tech/appointment/ and /tech/jobs/ (18 sites across 9 files at
plan time, including the admin-side ClaimPage.jsx:623 and TimeTracker/StalledWidget) —
and re-verify functions/ workers still contain zero such deep links; (4) after the owner
confirms hub bake: delete src/pages/tech/TechAppointment.jsx and TechJobDetail.jsx,
clean their routes, remove dead css; (5) verify google-calendar event links and any push
notification payloads don't embed the old route (zero found at plan time — re-verify).
Close-out: npm run test + npm run build + npx eslint pass; upr-pattern-checker clean;
tech-phase-reviewer (Opus) sign-off; visual — every tap-through path on the owner's
phone (dash card → hub, schedule row → hub, claims → hub, 5PM banner → hub, an OLD
/tech/appointment/ URL → redirect works); update UPR-Web-Context.md; run the
TWO-DIRECTION checkbox reconciliation across the WHOLE tech-v2 roadmap (this is the
final phase — every stage either genuinely done or open with a disclosed reason);
push -u and open a PR to dev using the repo PR template, mark it ready for review.
```
