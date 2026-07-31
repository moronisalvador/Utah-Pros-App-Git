# Domain: Scheduling & Appointments

The live core of this domain is the **dispatch calendar**: `appointments` + `appointment_crew` + `dispatch_board_jobs`, read through a family of SECURITY DEFINER reader RPCs (`get_dispatch_board`, `get_appointments_range`, `get_appointment_detail`, `get_tech_dashboard`, …) and written by direct client inserts plus `update_appointment`/`delete_appointment` (which feed the `appointment_status_history` audit log). A second, thinner live subsystem is the **template/wizard planner** (`schedule_templates` → `template_phases`/`template_tasks`/`template_dependencies`, applied into `job_schedules` + `job_schedule_phases` + `job_tasks` by `apply_schedule_plan`) — real code, real UI, near-zero production use, and already owner-ruled "deactivate, not delete" in `docs/schedule-roadmap.md` (the Schedule Desktop initiative that would have executed that never started). Google Calendar sync (`google_calendar_links`) is a healthy worker-owned chain. Around this live core sits a large fossil ring: an abandoned appointment-generating scheduler v1 (`appointment_dependencies`, `appointments.job_schedule_id`/`template_phase_id`, 4 dead RPCs) and four never-wired console-era tables (`on_call_schedule`, `schedule_blocks`, `selection_dispatches`/`selection_responses`, `sub_confirmations`). Headline numbers: 11/17 tables used, 6 dead; 21/28 RPCs used, 6 dead, 1 duplicated; all 46 policies are always-true (36 band-aid, 10 on dead tables); **anon still has full CRUD on `appointments`**.

## Tables (17)

### appointments — USED
- Purpose: every scheduled visit AND company event (`kind` = 'job'|'event') — the dispatch calendar's single row type.
- Evidence: inserts `src/components/CreateAppointmentModal.jsx:152`, `EditAppointmentModal.jsx:245`, `EventModal.jsx:105`, `src/pages/Schedule.jsx:698`, `src/pages/tech/TechNewAppointment.jsx:231`, `TechNewEvent.jsx:96`; direct updates (notify_client/is_private only) `EditAppointmentModal.jsx:202,220`, `EventModal.jsx:97`, `TechEditAppointment.jsx:256`; select `Schedule.jsx:619`; read/written by 15+ live RPCs (range/board/detail/dashboard/claim/status-board, update/delete); workers `functions/lib/google-calendar.js:487` (reads incl. `notify_client,client_notified_at,client_time_sig`), `functions/api/notify.js:394`.
- Prod stats: 325 live, ins 493 / upd 1436 / del 178, seq+idx scans in the hundreds of thousands, last idx 2026-07-29.
- Provenance: untracked — predates schema-as-code (disclosed in `docs/schedule-roadmap.md:73`).
- Columns: 22 total — 17 used, 3 uncertain, 2 dead, 0 band-aid, 0 duplicated.
  - `job_schedule_id` — DEAD: distinctive name; no writer anywhere (no `INSERT INTO appointments` exists in any function; src inserts never include it; greps `job_schedule_id` in src hit only template-builder/job_tasks contexts); only reader is dead RPC `get_job_schedule`; roadmap live-SQL corroboration: 0/230 appointments reference it. FK ON DELETE SET NULL from re-applies keeps nulling it.
  - `template_phase_id` — DEAD: same trail (writer: none; reader: dead `get_job_schedule`; 0/230 rows).
  - `created_by` — uncertain: returned by `get_appointments_range`/`get_appointment_detail` payloads but NO insert site writes it (grep `created_by` across all 6 insert files = 0); likely NULL on all recent rows.
  - `created_at` — uncertain: default-only, no live reader found (generic-name guard).
  - `updated_at` — uncertain: maintained by trigger, no reader found (generic-name guard).
  - All others (id, job_id, title, date, time_start, time_end, type, status, notes, duration_days, color, is_milestone, kind, is_private, notify_client, client_notified_at, client_time_sig) — used; the last three drive the gcal worker's client-confirmation flow (`google-calendar.js:588-607`).
- Policies: `all_select/insert/update/delete_appointments` (SELECT/INSERT/UPDATE/DELETE, roles **{anon, authenticated}**, USING(true)/CHECK(true)) — all 4 **BAND-AID**: always-true AND grant `anon` outside the database-standard §2 allowlist; table-level anon grants are also intact, so unauthenticated CRUD is live (see structural problem 1).
- Triggers: `trg_appointment_notify` — USED (emits appointment.updated/canceled → notify worker `functions/api/notify.js:86-88`); `trg_appointments_calendar_sync` — USED (gcal upsert/delete + client-cancel payload); `trg_appointments_updated_at` — USED (bookkeeping; column has no reader); `trg_close_open_clocks_before_appt_delete` — USED (closes open `job_time_entries` before delete — real safety on the live delete path); `trg_enforce_private_appointment` — USED (the only server-side guard on `is_private` writes; validates admin/PM via auth.uid()).
- Notes: FK → jobs (CASCADE), employees, job_schedules (SET NULL), template_phases (SET NULL). `job_documents`, `job_tasks`, `job_time_entries` (other domains) FK into it. Appointment creation is client-direct; only update/delete flow through RPCs, so `status`/reschedule audit exists but creation audit does not. Not in realtime publication.

### appointment_crew — USED
- Purpose: crew assignment rows (appointment × employee × role).
- Evidence: direct client writes in `CreateAppointmentModal.jsx:169`, `EditAppointmentModal.jsx:224-259`, `EventModal.jsx:102-121`, `Schedule.jsx:701`, `TechEditAppointment.jsx:260-262`, `TechNewAppointment.jsx:247`, `TechNewEvent.jsx:111`; read by 16 functions incl. all live readers (`get_appointments_range`, `get_tech_dashboard`, `get_tech_status_board`, `get_assigned_tasks`, cross-domain `get_job_hub`/`get_tech_claims`); worker read `functions/api/notify.js:150`.
- Prod stats: 546 live, ins 931 / del 418, idx scans 942k — hottest table in the domain.
- Provenance: untracked — predates schema-as-code.
- Columns: 5 total — 4 used, 1 uncertain, 0 dead.
  - `created_at` — uncertain: default-only, no reader (generic-name guard).
- Policies: `all_delete/insert/select/update_appointment_crew` (authenticated, true) — all 4 BAND-AID (always-true; no assignment/role predicate).
- Triggers: `trg_appointment_crew_calendar_sync` — USED (per-row gcal re-upsert on insert/delete); `trg_appointment_crew_notify` — USED (appointment.assigned push).
- Notes: crew replacement is non-atomic delete-then-insert in every UI path; the atomic `sync_appointment_crew` RPC shipped 2026-07-13 and was never adopted (structural problem 5). Each row change fires a gcal sync webhook.

### appointment_status_history — USED (write-only audit)
- Purpose: append-only reschedule/cancel/delete audit for appointments.
- Evidence: written by live RPCs `update_appointment` (events rescheduled/status_changed/cancelled) and `delete_appointment` (event deleted) — both bodies insert into it; zero readers in code (grep src/functions/scripts/upr-mcp = 0; idx scans 0).
- Prod stats: 71 live, ins 71, upd/del 0, idx 0 — pure write-only since creation.
- Provenance: `supabase/migrations/20260721_appointment_status_history.sql`.
- Columns: 14 total — 14 used (every column is populated by the two live writers: appointment_id, event_type, old/new date+time_start+time_end+status, actor_id, reason, changed_at default; id PK).
- Policies: `appointment_status_history_select` (SELECT, authenticated, true) — BAND-AID (always-true; also pointless today — nothing reads it). No anon grant (post-hygiene table).
- Triggers: none.
- Notes: `actor_id` is client-supplied (`p_actor_id`), not derived from auth.uid() — audit attribution is forgeable/NULL-able. Direct-PATCH paths (is_private, notify_client toggles, and any direct status write) bypass the log entirely.

### dispatch_board_jobs — USED
- Purpose: manual "pin this job to the dispatch board" list.
- Evidence: `src/pages/Schedule.jsx:551` (insert/delete toggle); read by live `get_dispatch_board` (pinned flag + inclusion) and `get_dispatch_panel_jobs`; `merge_jobs` deletes rows on job merge.
- Prod stats: 3 live, ins 46 / del 43, seq 339k (board query per page view), last_seq 2026-07-28.
- Provenance: untracked — predates schema-as-code.
- Columns: 4 total — 3 used, 1 uncertain: `added_at` — uncertain (default-only, no reader; generic).
- Policies: `dispatch_board_jobs_delete/insert/select` (authenticated, true) — 3 BAND-AID (always-true). No UPDATE policy (rows are toggle-only — harmless asymmetry).
- Triggers: none.
- Notes: not a duplicate of `appointments` — it stores the pin fact only; the board derives everything else live. Overlap question from the domain notes resolved: complementary, not parallel.

### google_calendar_links — USED
- Purpose: per (source, employee) mapping of appointments to Google Calendar event ids, with sync state.
- Evidence: worker-owned — `functions/lib/google-calendar.js:416-621` (select=*, insert, update of every state column), `functions/api/google-calendar-sync.js`, `functions/api/google-calendar-resync.js`; DB side: fed by `notify_google_calendar_sync()` via pg_net from the two calendar triggers; read by auth-domain RPC `get_google_calendar_status` (synced/error counts). Src references it only in a comment (`src/pages/settings/Integrations.jsx:653`).
- Prod stats: 222 live, ins 295 / upd 990, last idx 2026-07-28 — actively syncing.
- Provenance: `supabase/migrations/20260628_google_calendar_sync.sql`.
- Columns: 14 total — 13 used, 1 uncertain: `created_at` — uncertain (default-only; worker reads select=* so plausibly carried). All others verified in worker code (source_type, source_id, employee_id, google_event_id, calendar_id, sync_hash, time_sig, status, last_error, synced_at, assigned_notified_at, updated_at at `google-calendar.js:558-564`).
- Policies: none — RLS enabled with zero policies = deny-all for client roles; service-role worker bypasses. Correct least-privilege posture (best table in the domain), though the anon/authenticated table GRANTs are still pointlessly present.
- Triggers: none.
- Notes: seam with auth domain — `user_google_accounts` (OAuth tokens) is auth-owned; this table only stores event mappings. Source-agnostic by design (`source_type='appointment'` today).

### job_schedules — USED
- Purpose: one applied schedule-plan instance per job (parent of job_schedule_phases).
- Evidence: written/deleted by live `apply_schedule_plan` (ScheduleWizard `src/components/ScheduleWizard.jsx:204`); looked up by live `add_adhoc_job_task`/`add_custom_schedule_phase` (job_id → schedule id); `merge_jobs` re-points job_id. Direct client access: none.
- Prod stats: 7 live, ins 30 / del 9, last idx 2026-07-21.
- Provenance: untracked — predates schema-as-code.
- Columns: 10 total — 6 used, 4 uncertain, 0 dead.
  - `status` — uncertain: default 'active' only; never written past default; only dead RPCs read it.
  - `notes` — uncertain: no writer, no live reader (generic-name guard).
  - `created_at` — uncertain: default; ordered-by only in dead `get_job_schedules`.
  - `updated_at` — uncertain: trigger-maintained, no reader.
  - used: id, job_id, template_id, name, start_date, created_by (all written by `apply_schedule_plan`).
- Policies: `job_schedules_delete/insert/select/update` (authenticated, true) — 4 BAND-AID (always-true).
- Triggers: `trg_job_schedules_updated` — USED (updated_at bookkeeping via shared `update_updated_at()`).
- Notes: NOT a parallel generation of schedule_templates — templates are the blueprint, this is the per-job instance (`apply_schedule_plan` copies template → schedule + phases + job_tasks). The dead readers (`get_job_schedule/s`) belong to the abandoned v1 that also created appointments from plans.

### job_schedule_phases — USED
- Purpose: dated phase bars of an applied plan; job_tasks hang off them.
- Evidence: written by live `apply_schedule_plan` + `add_custom_schedule_phase` (JobPanel `src/components/JobPanel.jsx:264`, ScheduleWizard:267); read by live cross-domain `get_job_task_pool` (JobPanel:77,127,151 — projects target_start/target_end/duration_days/sort_order); auto-lookup in `add_adhoc_job_task`.
- Prod stats: 48 live, ins 68 / del 20; last_seq 2026-07-08, last idx scan 2026-04-14 (wizard-era).
- Provenance: untracked — predates schema-as-code.
- Columns: 10 total — 9 used, 1 uncertain: `created_at` — uncertain (default-only, no reader).
- Policies: `anon_delete/insert/read/update_job_schedule_phases` (roles=**authenticated**, true) — 4 BAND-AID (always-true; the `anon_*` names are stale relics of the pre-2026-07-08 template — roles were rescoped, names never renamed).
- Triggers: none.
- Notes: FK → job_schedules (CASCADE), template_phases (SET NULL).

### schedule_templates — USED
- Purpose: reusable schedule blueprints (per division).
- Evidence: full CRUD in `src/pages/ScheduleTemplates.jsx:709-748` (routed at /schedule/templates, two nav entries `src/lib/navItems.jsx:91,134`); read via live `get_schedule_templates`/`get_schedule_template` (ScheduleTemplates:680,693; ScheduleWizard:46); consumed by `apply_schedule_plan`/`preview_schedule`.
- Prod stats: 3 live, ins 6 / del 1, last_seq 2026-07-17 — real but thin usage.
- Provenance: untracked — predates schema-as-code.
- Columns: 8 total — 6 used, 2 uncertain.
  - `created_by` — uncertain: returned by `get_schedule_template` payload but no writer found (createTemplate writes name/division/description only).
  - `updated_at` — uncertain: trigger-maintained, no reader.
  - used: id, name, description, division, is_active (list RPC filters `is_active = true`), created_at (list payload).
- Policies: `schedule_templates_delete/insert/select/update` (authenticated, true) — 4 BAND-AID (always-true).
- Triggers: `trg_schedule_templates_updated` — USED (bookkeeping).
- Notes: owner decision 2026-07-03 (`docs/schedule-roadmap.md:70`): subsystem judged dead-by-usage, disposition "deactivate (hide), keep dormant as future-Gantt groundwork" — never executed because Schedule Desktop never started; it is still fully live in nav today.

### template_phases — USED
- Purpose: phase definitions inside a template.
- Evidence: builder CRUD `ScheduleTemplates.jsx:759-820`; engine reads name/color/duration_days/is_milestone/display_order (`apply_schedule_plan`, `preview_schedule`); detail payload (`get_schedule_template`) returns all columns; Gantt preview renders day_offset (`ScheduleTemplates.jsx:51-147`).
- Prod stats: 14 live, ins 38 / del 20, last activity 2026-07-17.
- Provenance: untracked — predates schema-as-code.
- Columns: 15 total — 14 used, 1 uncertain: `created_at` — uncertain (default-only, no reader).
  - Note (not separately counted): `appointment_type`, `default_start_time`, `default_end_time`, `default_crew_count`, `day_offset` are builder-form-editable (`ScheduleTemplates.jsx:193-280`) but **ignored by the apply engine** — fossils of the appointment-generating v1 kept alive by the builder UI round-trip.
- Policies: `template_phases_delete/insert/select/update` (authenticated, true) — 4 BAND-AID.
- Triggers: none.

### template_tasks — USED
- Purpose: task checklist items per template phase; copied into job_tasks on apply.
- Evidence: builder CRUD `ScheduleTemplates.jsx:314-335,771`; ScheduleWizard direct select (`ScheduleWizard.jsx:71`); `apply_schedule_plan` copies title/is_required; `preview_schedule`/`get_schedule_templates` count them.
- Prod stats: 57 live, ins 122 / del 45.
- Provenance: untracked — predates schema-as-code.
- Columns: 7 total — 6 used, 1 uncertain: `created_at` — uncertain (default-only).
- Policies: `template_tasks_delete/insert/select/update` (authenticated, true) — 4 BAND-AID.
- Triggers: none.

### template_dependencies — USED
- Purpose: phase-ordering edges (source → target, type, lag) inside a template.
- Evidence: builder CRUD `ScheduleTemplates.jsx:424-439,784`; read by `preview_schedule` (honors lag_days), `apply_schedule_plan` (reads dependency_type only), `get_schedule_template`.
- Prod stats: 14 live, ins 31 / del 17.
- Provenance: untracked — predates schema-as-code.
- Columns: 7 total — 6 used, 1 uncertain: `created_at` — uncertain (default-only).
- Policies: `template_dependencies_delete/insert/select/update` (authenticated, true) — 4 BAND-AID.
- Triggers: none.
- Notes: `lag_days` is used by preview but ignored by apply — preview/apply divergence (structural problem 6).

### appointment_dependencies — DEAD
- Purpose (intended): appointment-to-appointment ordering edges for the abandoned scheduler v1 that generated appointments from plans.
- Evidence trail: greps `'appointment_dependencies'`, `"appointment_dependencies"`, `\bappointment_dependencies\b` across src/, functions/, scripts/, upr-mcp/ (excl. generated codeIndex), tests/, supabase/tests/, .github/ = 0 hits. fndefs: referenced ONLY by `get_job_schedule` — itself dead (0 callers) → dead-by-chain. triggers.json: none. views.json: none. prod-cron: none. publications: not present. Git history (`git log -S`): only docs/migration/tooling commits ever mention it — no application code in repo history. Prod stats: 0 live rows, ins/upd/del 0 all-time since stats reset (roadmap live-SQL 2026-07-03 independently found 0 rows). Caveat: counters are since last stats reset.
- Provenance: untracked — predates schema-as-code.
- Columns: 7 total — 7 dead (dead with table).
- Policies: `appointment_dependencies_delete/insert/select/update` (authenticated, true) — 4 DEAD (on a dead table).
- Triggers: none.

### on_call_schedule — DEAD
- Purpose (intended, from shape): per-day on-call employee rotation with priority_order.
- Evidence trail: greps `on_call_schedule`, `on_call`, `oncall` (case-insensitive) across src/, functions/, scripts/, upr-mcp/ = 0 real hits (only unrelated `invocationCallOrder`/`IconCallLog` matches). fndefs: zero function references. No triggers, no views, no cron, not in publication. The notify/escalation path (`functions/api/notify.js`) resolves audiences from `appointment_crew`/employees — never touches on_call_schedule. Git history: no application code ever referenced it. Prod stats: 0 rows, 0 ins all-time.
- Provenance: untracked — predates schema-as-code.
- Columns: 4 total — 4 dead (dead with table).
- Policies: `allow_authenticated_on_call_schedule` (ALL, authenticated, true) — 1 DEAD (dead table).
- Triggers: none.

### schedule_blocks — DEAD
- Purpose (intended, from shape): per-employee/per-job calendar blocks (title, date, times, all_day, block_type).
- Evidence trail: greps `schedule_blocks`/`schedule_block` across all code scopes = 0. fndefs: only `merge_jobs` (`UPDATE schedule_blocks SET job_id...` — merge-time FK repointing, housekeeping of rows that don't exist, not domain usage). No triggers/views/cron/publication. Git history: no application code ever. Prod stats: 0 rows, 0 ins all-time.
- Provenance: untracked — predates schema-as-code.
- Columns: 13 total — 13 dead (dead with table).
- Policies: `allow_anon_read_schedule_blocks` (SELECT, roles=authenticated despite the name, true) — DEAD; `allow_authenticated_schedule_blocks` (ALL, authenticated, true) — DEAD (also redundant with the SELECT one). 2 DEAD.
- Triggers: none.

### selection_dispatches — DEAD
- Purpose (established from schema, not name-guessing: token, surveys[], survey_url, client_email, email_sent, completed_at, status='sent'): a tokenized client materials-selection survey dispatch — an emailed pick-your-selections flow. No code that implements it exists anywhere in the repo or its git history.
- Evidence trail: greps `selection_dispatches`, `selection_dispatch`, `selectiondispatch` (case-insensitive) across src/, functions/, scripts/, upr-mcp/ = 0. fndefs: only `merge_jobs` FK repointing. No triggers/views/cron/publication. Git history (`git log -S selection_dispatches --all`): only docs/tooling/migration commits. Prod stats: 0 live, ins 2 / upd 2 (some post-reset activity — console/manual or a pre-repo deploy; no in-repo path can produce it), last idx 2026-07-21 (likely catalog scans).
- Provenance: untracked — predates schema-as-code.
- Columns: 15 total — 15 dead (dead with table).
- Policies: `allow_authenticated_selection_dispatches` (ALL, authenticated, true) — 1 DEAD.
- Triggers: none.

### selection_responses — DEAD
- Purpose (from schema): the client-submitted selections (jsonb) matching a dispatch token.
- Evidence trail: same protocol as selection_dispatches — 0 code hits anywhere; fndefs only `merge_jobs`; no triggers/views/cron/publication; git history clean of app code. Prod stats: 0 rows, 0 ins all-time, idx 0.
- Provenance: untracked — predates schema-as-code.
- Columns: 10 total — 10 dead (dead with table).
- Policies: `allow_authenticated_selection_responses` (ALL, authenticated, true) — 1 DEAD.
- Triggers: none.

### sub_confirmations — DEAD
- Purpose (from schema: conversation_id, contact_id, trade, scheduled_date, confirmed, reminder_sent): subcontractor schedule-confirmation tracking tied to SMS conversations — a planned confirm-by-text loop that was never built (or predates the repo and was retired before import).
- Evidence trail: greps `sub_confirmations`, `sub_confirm` across all scopes = 0. fndefs: only `merge_contacts` + `merge_jobs` FK repointing. No triggers/views/cron/publication. Git history: no application code ever. Prod stats: 0 rows, 0 ins all-time, idx 0.
- Provenance: untracked — predates schema-as-code.
- Columns: 10 total — 10 dead (dead with table).
- Policies: `allow_authenticated_sub_confirmations` (ALL, authenticated, true) — 1 DEAD.
- Triggers: none.
- Notes: cross-domain FKs into conversations/contacts/jobs — dropping it removes three inbound FK edges from messaging/CRM tables.

## RPCs (28)

All are SECURITY DEFINER except the two invoker trigger functions; all are granted `authenticated + service_role` (no anon — fine). "no caller check" = body validates nothing about the calling user.

| function(args) | class | security | callers / evidence | notes |
|---|---|---|---|---|
| get_appointments_range(date,date) | used | definer | TechEditAppointment.jsx:167, tech/v2/schedule/useScheduleData.js:70 (TechScheduleV2) | Has real caller logic: resolves auth.uid() → filters is_private. Model citizen. |
| get_appointment_detail(uuid) | used | definer | TechJobHub.jsx:93, TechAppointment.jsx:135, TechEditAppointment.jsx:113, HubStage consumer | is_private filtered via auth.uid(). |
| get_dispatch_board(date,date,bool) | used | definer | Schedule.jsx:525,538 | is_private filtered. Board + auto-show + pins. |
| get_dispatch_events(date,date) | used | definer | Schedule.jsx:526,539 | kind='event' lane; is_private filtered. |
| get_dispatch_panel_jobs() | used | definer | Schedule.jsx:519 | Active-phase + pinned jobs list. |
| get_tech_dashboard(uuid) | used | definer | TechDashV2.jsx:73 (+7 helper files) | **p_employee_id caller-supplied, no auth.uid() binding** — any authenticated user can pull any tech's dashboard. |
| get_tech_status_board() | used | definer (STABLE, sql) | StatusBoard.jsx:122, admin-mobile OpsCards.jsx:130, overview useEmployeeStatus.js:54 | Whole-company status board; no caller check (arguably company-wide by design). |
| get_assigned_tasks(uuid) | used | definer | TechLayout.jsx:468, TechTasks.jsx:175, TechMore.jsx:236 | p_employee_id unbound to caller. |
| get_claim_appointments(uuid) | used | definer | ClaimPage.jsx:102, TechJobDetail.jsx:212, TechClaimDetail.jsx:244 | **No is_private filter** — leaks private appointments the other readers hide. |
| get_active_appointment_geo(uuid) | used | definer | tech/v2/dash/AttentionStrip.jsx:77 | p_employee_id unbound. |
| get_stalled_materials_for_employee(uuid) | used | definer | components/tech/StalledWidget.jsx:51 | Drying-domain join surfaced on tech dash; also db-lane test. |
| update_appointment(uuid,…,p_actor_id) | used | definer | Schedule.jsx:650,656 (drag/resize), EditAppointmentModal.jsx:205, EventModal.jsx:80, TechEditAppointment.jsx:241 | No caller check; p_actor_id client-supplied → audit forgeable. Writes history rows. |
| delete_appointment(uuid,uuid,text) | used | definer | EditAppointmentModal.jsx:292, EventModal.jsx:143, TechEditAppointment.jsx:297 | No caller check; logs 'deleted' + unlinks job_tasks + deletes crew. |
| add_adhoc_job_task(…) | used | definer | 7 files: EditAppointmentModal:182, CreateAppointmentModal:115, JobPanel:218,233, ScheduleWizard:234,279, TechEditAppointment:191, TechNewAppointment:188, HubChecklist:84 | Writes job_tasks (jobs domain) + auto-links job_schedule_phases. No caller check. |
| add_custom_schedule_phase(…) | used | definer | JobPanel.jsx:264, ScheduleWizard.jsx:267 | Raises if job has no schedule; db-lane guard test too. No caller check. |
| apply_schedule_plan(…) | used | definer | ScheduleWizard.jsx:204 | Destructive re-apply (deletes prior schedule+phases+templated tasks); also auto-advances jobs.phase + writes job_phase_history (cross-domain side effect). No caller check. |
| preview_schedule(…) | used | definer | ScheduleWizard.jsx:56,90 | Pure computation; honors lag_days (apply does not — see problem 6). |
| get_schedule_templates(text) | used | definer | ScheduleTemplates.jsx:680, ScheduleWizard.jsx:46 | Filters is_active. |
| get_schedule_template(uuid) | used | definer | ScheduleTemplates.jsx:693 | Full template payload incl. engine-ignored v1 fields. |
| enforce_private_appointment_role() | used | invoker (trigger) | Fired by trg_enforce_private_appointment on appointments | Real auth.uid() role check (admin/PM) — the one true write-guard in the domain. |
| trg_appt_crew_calendar_sync() | used | definer (trigger) | Fired by trg_appointment_crew_calendar_sync on appointment_crew | Calls notify_google_calendar_sync → pg_net → gcal worker. |
| update_appointments_updated_at() | duplicated | invoker (trigger) | Fired by trg_appointments_updated_at | Byte-identical behavior to generic `update_updated_at()` (used by job_schedules/schedule_templates triggers) — redundant per-table copy. Works; consolidate in v2. |
| finish_appointment(uuid,uuid) | dead | definer | Zero hits: greps `'finish_appointment'`/`"finish_appointment"`/`\bfinish_appointment\b` in src/, functions/, scripts/, upr-mcp/ (non-generated), tests/, supabase/tests/, .github/ = 0; not called by any function body (fndefs grep), no trigger, no cron, no view | Releases incomplete job_tasks + marks appointment completed. SECURITY DEFINER, no caller check, still granted to authenticated — dead but callable. |
| get_job_schedule(uuid) | dead | definer | Same zero-hit trail (all scopes + fndefs callers + cron/triggers/views = 0) | Scheduler-v1 detail reader; reads legacy `appointment_tasks` + `appointment_dependencies`. Its death kills appointment_dependencies by chain. |
| get_job_schedules(uuid) | dead | definer | Same zero-hit trail = 0 | v1 list reader (also reads legacy appointment_tasks). |
| get_my_appointments_today(uuid,bool) | dead | definer | src/functions/scripts/upr-mcp = 0; only supabase/tests/tech_v2_feed_upgrades.test.js:90-119 + db_foundation_p6_timezone_rpcs.test.js:103 (test-only reference); its documented consumer `src/pages/tech/TechDash.jsx` no longer exists (v2 cutover — TechDashV2 uses get_tech_dashboard) | Contract tests keep it alive artificially; the test comment "legacy TechDash.jsx consumes" is stale. |
| sync_appointment_crew(uuid,jsonb) | dead | definer | src/functions = 0; only supabase/tests/uxq_fb_rpcs.{test.js,sql} (test-only reference) | Built 2026-07-13 (`20260713_uxq_fb_sync_appointment_crew.sql`) to make crew replace atomic; every UI path still does manual delete+insert. Authored fix never adopted. |
| upsert_appointment_task(…) | dead | definer | Zero-hit trail across all scopes + fndefs/cron/triggers/views = 0 | Writes legacy `appointment_tasks` (superseded by job_tasks + add_adhoc_job_task). Definer, no caller check, granted to authenticated. |

Provenance notes: the dead v1 RPCs surface in migrations only as grant-hygiene targets (`20260708_dbf_p3_anon_rpc_revoke.sql`) — their bodies predate schema-as-code. `get_my_appointments_today` body was drift-captured in `20260703_tech_v2_phaseF_drift_capture.sql`.

## Structural problems (ranked, worst first)

1. **anon retains full CRUD on `appointments`** — severity 5. The four `all_*_appointments` policies name roles {anon, authenticated} with USING(true)/CHECK(true), and the table-level anon GRANT (DELETE,INSERT,SELECT,UPDATE…) is intact. Anyone holding the publishable key shipped in the browser bundle can read, modify, or delete every appointment (incl. titles/notes that carry client names and addresses via joined payload patterns) with no session. This is the exact exposure class F-red closed for messaging tables (`.claude/rules/sms-experience-wave-ownership.md`) and the live audit flagged (`docs/audit/2026-07/evidence/live-supabase.md`); appointments never got its closure migration. It is the only sched table whose policies still name anon.

2. **`is_private` is reader-side-only privacy over a wide-open base table** — severity 4. The privacy predicate (admin/PM or crew-member via auth.uid()) is implemented inside `get_appointments_range`, `get_appointment_detail`, `get_dispatch_board`, `get_dispatch_events` — but RLS is USING(true) (plus anon, per problem 1), so a direct `/rest/v1/appointments` select bypasses it entirely, and `get_claim_appointments` (live, 3 call sites) returns private appointments with no filter. Write-side is guarded (trg_enforce_private_appointment); read-side is a sieve. `docs/schedule-roadmap.md:101` acknowledges this.

3. **Abandoned scheduler-v1 fossils are still live schema and callable code** — severity 3. The generation that created appointments from plans left: `appointments.job_schedule_id`/`template_phase_id` (no writer, 0/230 rows), `appointment_dependencies` (0 rows ever), legacy `appointment_tasks` readers, and four dead SECURITY DEFINER RPCs (`get_job_schedule`, `get_job_schedules`, `finish_appointment`, `upsert_appointment_task`) still granted to authenticated with no caller checks — `finish_appointment` mutates appointments and job_tasks for any caller. Dead surface that is both maintenance drag and attack surface; v2 should not carry any of it.

4. **Uniform SECURITY DEFINER + always-true RLS + client-supplied identity** — severity 3. All 26 non-trigger RPCs are definer; the write RPCs validate nothing about the caller, and audit attribution (`p_actor_id` in update/delete_appointment) plus employee scoping (`p_employee_id` in get_tech_dashboard/get_assigned_tasks/get_active_appointment_geo/get_stalled_materials_for_employee) are client-supplied rather than derived from auth.uid(). Today this adds nothing over the always-true policies beneath; structurally it means RLS can never be tightened until every RPC learns to resolve the caller the way get_appointments_range already does.

5. **Atomic crew replace was built and never adopted** — severity 2. Every crew edit path (EditAppointmentModal:224, EventModal:102, TechEditAppointment:260, Schedule.jsx:701, plus create modals) does client-side delete-then-insert; a mid-sequence failure silently drops crew, and each row fires trg_appointment_crew_calendar_sync → one gcal webhook per row. `sync_appointment_crew` (20260713) fixes both and has zero callers outside its own tests.

6. **preview_schedule and apply_schedule_plan disagree on dependency math** — severity 2. Preview honors `template_dependencies.lag_days` (`end + lag`); apply ignores lag entirely and applies `starts_after → end + 1 (+weekend skip)`. Any template using lag previews dates that differ from what apply writes. Low current blast radius (wizard barely used) but it silently falsifies the wizard's confirmation step.

7. **Six dead tables (61 columns, 10 policies, 19 indexes) with full anon table-grants sit in the schema** — severity 2. `appointment_dependencies`, `on_call_schedule`, `schedule_blocks`, `selection_dispatches`, `selection_responses`, `sub_confirmations` — no in-repo code has ever referenced them (git history verified), all hold 0 rows. Pure v2 drop candidates; until then each is unnecessary grant surface and catalog noise.

8. **appointment_status_history audit is partial and forgeable** — severity 1. Creation is client-direct (never logged), is_private/notify_client PATCHes bypass it, and actor_id is caller-supplied. Fine as a convenience trail; not evidence-grade. If v2 wants a real audit, derive actor from auth.uid() and cover all mutation paths.

## Open questions for the owner

1. **selection_dispatches / selection_responses** (tokenized client materials-selection surveys, emailed) and **sub_confirmations** (subcontractor confirm-by-text tracking): no code in the repo's entire history has touched these and they hold 0 rows. Were these console-era experiments, or is either flow still on your roadmap? OK to drop both in v2? (selection_dispatches shows 2 manual-era inserts since stats reset — is any of that data worth keeping?)
2. **on_call_schedule** and **schedule_blocks**: same status — never wired to anything, 0 rows. Is an on-call rotation or personal time-block feature still wanted (the notify path currently has no on-call concept), or drop in v2?
3. **Templates/Wizard**: your 2026-07-03 ruling was "hide from UI, keep dormant as future Gantt groundwork," but Schedule Desktop never started so it is still fully visible and lightly used (3 templates, last real apply ~April; template browsing as recent as 2026-07-17). Does the deactivate ruling still stand, and should schema v2 model templates/plans at all — or is the dispatch calendar + job_tasks pool the whole model of record?
4. Is appointment data (including private appointments' existence and client names in titles/notes) considered company-wide-visible to all logged-in staff? That decides whether v2 keeps always-true authenticated read policies (documented, per database-standard) or scopes reads — and how urgently the anon closure migration for `appointments` should be scheduled.
5. **appointment_status_history** has never been read by any UI. Keep the reschedule/cancel audit trail in v2 (and if so, should it become trustworthy — server-derived actor, all mutation paths covered — per problem 8), or drop it?
6. `appointments.created_by` is returned by the readers but never written by any create path. Does v2 need "who created this appointment"?

## Search appendix

- **Scopes searched** (repo root `C:\Users\moronisalvador\APPS\Utah-Pros-App-Git`): `src/`, `functions/`, `scripts/`, `upr-mcp/src` (excluding the generated `codeIndex.js` name catalog), `tests/`, `supabase/tests/`, `.github/`. `supabase/migrations/` used for provenance only; `docs/*.md` orientation only.
- **Per object name N**: `grep -rE "\bN\b"` per scope (counts + content passes with `'N'` / `"N"` quoting where needed); variant passes for suspicious tables (`selection_dispatch|selection_response|selectiondispatch`, `on_call|oncall`, `sub_confirm`, `schedule_block`, case-insensitive). Call-site patterns confirmed concretely (`db.rpc('N'`, `db.insert('N'`, `db.select('N'`, `db.update('N'`, `db.delete('N'`); raw-fetch check `rest/v1/rpc` found only generic dispatchers (src/lib/supabase.js, SignPage e-sign fns, water-loss report, encircle cache-bust — none naming sched RPCs).
- **Chain checks**: all 400+ function bodies scanned via the fndefs catalog (`awk` per `-- ### FUNCTION:` block) for every table; `triggers.json` (9 domain triggers, all enabled 'O'), `views.json` (5 views — none touch sched tables), `publications.json` (only conversations/messages/notifications), `prod-cron.json` (14 jobs — none call sched RPCs), `prod-fn-stats.json` (empty — track_functions off, so no call-count corroboration available).
- **Prod-stats caveat**: ins/upd/del and scan counters are since the last stats reset; 0-activity readings for the six dead tables are corroborated by 0 live rows, zero code references, and clean git history (`git log -S <name> --all` shows only docs/migration/tooling commits), but "0 since reset" is stated as such, not as "0 ever" — except where `docs/schedule-roadmap.md`'s 2026-07-03 live SQL independently confirms (appointment_dependencies, job_schedule_id/template_phase_id).
- **Ambiguities / honest uncertainties**: (a) 16 columns marked *uncertain* are generic-name bookkeeping columns (created_at/updated_at/status/notes/created_by/added_at) on used tables with no positive read/write evidence — per the generic-name guard I did not claim them dead. (b) `selection_dispatches` ins=2/upd=2 post-reset activity has no in-repo producer; source unknown (console or pre-repo deploy). (c) `upr-mcp`'s `upr_rpc`/`upr_select` tools can generically reach ANY table/RPC by name — treated as capability, not usage; its `codeIndex.js` lists sched RPC names as generated schema metadata only. (d) `get_tech_status_board`/`get_stalled_materials_for_employee` also belong conceptually to time-tracking/drying domains; classified here per assignment with cross-domain reads noted, trusting neighbor owners for `job_time_entries`/`moisture_*`/`job_tasks`/`appointment_tasks`. (e) `appointments.status` is not a Rule-15 trigger-owned money column; no money-domain triggers touch sched tables.

---

## Amendment — non-app-code blind-spot sweep (2026-07-29)

Every dead claim above was re-checked against the four surfaces application-code search cannot see: (1) repo-root and `docs/` runbooks **executed** against production, (2) recent data-repair migrations that are writes rather than DDL, (3) `UPR-Web-Context.md` annotations naming external consumers this repository cannot inspect, (4) doc-designated computation contracts whose callers are unobservable because `track_functions` is off in production.

**Result: 15 reclassified, 68 survived as dead.**

### Reclassified — no longer dead

- **rpc `get_my_appointments_today(p_employee_id uuid, p_include_cancelled boolean)`** → dormant contract — doc-frozen tech-v2 RPC, still doc-designated as part of a live data layer *(surface 4)*
  - docs/tech-redesign/design-context-pack.md:1161 — the CURRENT tech-redesign spec names it among the 'frozen RPC contracts' of the live TechDashV2/TechScheduleV2 data layer (`get_tech_dashboard`, `get_appointments_range`, `get_my_appointments_today`) and rules that layer 'is a keep — reskin on top'. Corroborated by docs/schedule-roadmap.md:347 ('Frozen for every session (contracts, not files) ... tech-app RPC result shapes'), docs/db-foundation-roadmap.md:157,159 ('tech-v2-frozen — body-only replaces with a disclosed rule amendment and the existing backward-compat tests green'), and UPR-Web-Context.md:1591-1594 (the 1-arg legacy call resolving is a documented backward-compat guarantee). The mapper's own note that the doc consumer TechDash.jsx no longer exists is true, but three separate live-initiative docs still name it as a frozen contract to preserve — that is a dormant contract, not a dead object.
- **rpc `get_job_schedule(p_job_schedule_id uuid)`** → dormant contract — owner-ruled explicit keep *(surface 4)*
  - docs/schedule-dispatch.md:125 + :138-141 — 'ROUND-3 OWNER AMENDMENT: this is DEACTIVATE, NOT DELETE' followed by 'Hard constraints: ZERO schema migrations; ZERO DB object drops; ZERO code-file deletions of the deactivated features — the template tables ..., their RPCs (apply_schedule_plan, preview_schedule, get_schedule_template(s), get_job_schedule(s)) ... all STAY, documented as deactivated/dormant.' Corroborated by docs/schedule-roadmap.md:70 ('files + tables + RPCs retained dormant as the future-Gantt groundwork'). The owning initiative (Schedule Desktop A/B/C) is listed 'Unstarted' in .claude/rules/initiative-status.md, so this owner ruling is still current law, not archived history.
- **rpc `get_job_schedules(p_job_id uuid)`** → dormant contract — owner-ruled explicit keep *(surface 4)*
  - docs/schedule-dispatch.md:141 — the same round-3 owner hard constraint names 'get_job_schedule(s)' (both the singular and plural RPC) in the must-STAY list; docs/schedule-roadmap.md:70 repeats the disposition. Body verified live: it reads job_schedules + appointments.job_schedule_id + appointment_tasks.
- **rpc `sync_appointment_crew(p_appointment_id uuid, p_crew jsonb)`** → dormant contract — doc-designated fix for a live process, in an initiative that is stalled not closed *(surface 4)*
  - docs/ux-quality-roadmap.md:67 names it as THE mechanism for finding H7 (non-atomic crew replace) — 'full `sync_appointment_crew` RPC in F-B' — and :126/:160 repeat it; docs/ux-motion-ui-rollout-dispatch.md:27 states W5 'consumes F-B's three additive RPCs (`sync_appointment_crew`, `save_estimate_lines`, `get_jobs_list`)' — the exact same triad as the billing precedent. The business process (crew replacement: 546 live rows, 931 inserts) demonstrably still happens, and .claude/rules/initiative-status.md lists 'UX alignment W1–W5 | Stalled since 2026-07-18; owner may restart from scratch' — open, not retired. It is also executed by the CI db lane (supabase/tests/uxq_fb_rpcs.test.js:48-50).
- **table `appointment_dependencies`** → dormant contract — read by the owner-retained get_job_schedule *(surface 4)*
  - Live function body (catalog fndefs-q2-08.sql:346, get_job_schedule): `... FROM appointment_dependencies ad WHERE ad.job_schedule_id = js.id` projecting id/source_appointment_id/target_appointment_id/dependency_type/lag_days. Because docs/schedule-dispatch.md:138-141 forbids dropping get_job_schedule, the table it reads cannot be dropped without breaking that retained RPC at runtime. Second doc statement: docs/schedule-roadmap.md:74 — 'Orphan tables | Disclosed | ... `appointment_dependencies`: 0 rows. Stay in place (additive-only rule) — documented as retired.'
- **table `sub_confirmations`** → uncertain — write-executed by a live RPC whose body ships in a committed 2026-07 migration *(surface 2)*
  - supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:151-152 — `-- 14. sub_confirmations.contact_id` / `UPDATE sub_confirmations SET contact_id = p_keep_id WHERE contact_id = p_merge_id;` inside the merge_contacts body (verified live at catalog fndefs-q3-06.sql:331). merge_contacts is a live, user-invoked RPC (contact/job MergeModal). merge_jobs additionally runs `UPDATE sub_confirmations SET job_id = ...` (fndefs-q3-06.sql:467). Also surface 1: UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:186 names `sub_confirmations` as one of the NO-ACTION FK children that block a job delete, inside the delete-ORDER recipe the owner executes against production via execute_sql.
- **column `appointments.job_schedule_id`** → dormant contract — sole read surface of two owner-retained RPCs *(surface 4)*
  - catalog fndefs-q2-08.sql:340 (get_job_schedule: `FROM appointments a WHERE a.job_schedule_id = js.id`) and fndefs-q2-09.sql:14-18 (get_job_schedules: three count() subqueries keyed on `a.job_schedule_id = js.id`). Both RPCs are in the docs/schedule-dispatch.md:141 must-STAY list, so dropping this column breaks retained function bodies. docs/schedule-roadmap.md:70 records the disposition as 'retained dormant as the future-Gantt groundwork', not 'drop'.
- **column `appointments.template_phase_id`** → dormant contract — projected by the owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:324 — get_job_schedule builds `'template_phase_id', a.template_phase_id` into its appointments payload. Same owner keep-ruling as above (docs/schedule-dispatch.md:141; docs/schedule-roadmap.md:70). It is also the FK seam into template_phases, a LIVE table.
- **column `appointment_dependencies.id`** → dormant contract — projected by owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:342 — `jsonb_build_object('id', ad.id, ...)` inside get_job_schedule's 'dependencies' key.
- **column `appointment_dependencies.job_schedule_id`** → dormant contract — join predicate of owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:346 — `FROM appointment_dependencies ad WHERE ad.job_schedule_id = js.id`.
- **column `appointment_dependencies.source_appointment_id`** → dormant contract — projected by owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:343 — `'source_appointment_id', ad.source_appointment_id`.
- **column `appointment_dependencies.target_appointment_id`** → dormant contract — projected by owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:344 — `'target_appointment_id', ad.target_appointment_id`.
- **column `appointment_dependencies.dependency_type`** → dormant contract — projected by owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:345 — `'dependency_type', ad.dependency_type`.
- **column `appointment_dependencies.lag_days`** → dormant contract — projected by owner-retained get_job_schedule *(surface 4)*
  - catalog fndefs-q2-08.sql:345 — `'lag_days', ad.lag_days`. (Note: template_dependencies.lag_days on the LIVE side is honored by preview_schedule and ignored by apply_schedule_plan — the same field name, different table; do not conflate.)
- **column `sub_confirmations.contact_id`** → write-only via a committed migration body — live merge_contacts UPDATEs it *(surface 2)*
  - supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:151-152 — `UPDATE sub_confirmations SET contact_id = p_keep_id WHERE contact_id = p_merge_id;`. This is a repository-committed 2026-07 migration whose body performs a write (not DDL) naming the column, inside a live user-invoked RPC.

### Kill-notes — dependencies a future DROP must carry (Phase P5)

- **schedule_blocks**
  - Live merge_jobs body executes `UPDATE schedule_blocks SET job_id = p_keep_id WHERE job_id = p_merge_id;` (catalog fndefs-q3-06.sql:454; documented live at docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md:168). merge_jobs is a live user-invoked RPC (job MergeModal) and — critically — its CREATE FUNCTION is NOT in any committed migration (untracked drift; the only merge_jobs hits in supabase/migrations are a grant-revoke and an RLS file). So P5 must CREATE OR REPLACE merge_jobs from a pg_get_functiondef dump in the same migration as the DROP, or every job merge throws at runtime with no repo source to diff against.
- **selection_dispatches**
  - Same untracked merge_jobs sweep: `UPDATE selection_dispatches SET job_id = ...` (fndefs-q3-06.sql:465). Additionally selection_responses.dispatch_id has an FK → selection_dispatches(id) ON DELETE SET NULL (catalog fks.json), so drop order is selection_responses first, then selection_dispatches. Also note the only unexplained activity in this domain: prod stats show ins 2 / upd 2 with 0 live rows and no producer on ANY of the four surfaces — console-era or pre-repo. Rows were written then removed; nothing to preserve, but the anomaly is unexplained.
- **selection_responses**
  - Same untracked merge_jobs sweep: `UPDATE selection_responses SET job_id = ...` (fndefs-q3-06.sql:466). Must be dropped before selection_dispatches (its dispatch_id FK points there).
- **sub_confirmations**
  - RECLASSIFIED to uncertain, but the drop dependencies are concrete and should travel with it: (a) merge_contacts writes it and its body IS a committed migration — supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:152 — so a drop requires a paired CREATE OR REPLACE of merge_contacts plus an amendment to that migration's provenance; (b) merge_jobs writes it too (fndefs-q3-06.sql:467, untracked); (c) UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:186 lists it in the executed production job-delete order, so that runbook line must be corrected in the same change; (d) it holds three inbound-domain FKs (conversations, contacts, jobs) — dropping it removes messaging/CRM edges other domain maps may be counting.
- **appointment_dependencies policies (appointment_dependencies_delete/insert/select/update)**
  - All four are CREATEd by the APPLIED migration supabase/migrations/20260708_dbf_p3_anon_policy_closure.sql:52-59 and re-created by name in that file's committed ROLLBACK block at :319-326. Dropping the policies or the table makes the P3 rollback block un-runnable. P5 must explicitly supersede that rollback rather than silently invalidating it.
- **allow_anon_read_schedule_blocks (policy)**
  - Same P3 dependency: created at supabase/migrations/20260708_dbf_p3_anon_policy_closure.sql:234-235 and named in the committed ROLLBACK block at :501-502 (which would restore it TO anon). Dropping it/schedule_blocks invalidates that rollback path. Note its name is a stale relic — P3 rescoped it to `authenticated`; the name was never changed.
- **upsert_appointment_task(...)**
  - No caller dependency, but it writes the legacy `appointment_tasks` table, which belongs to the jobs/tasks domain and is ALSO read by the two RPCs I reclassified as owner-retained (get_job_schedule at fndefs-q2-08.sql:337, get_job_schedules at fndefs-q2-09.sql:17-18). So `appointment_tasks` itself cannot be dropped while those RPCs are retained — flag this to the jobs-domain owner so the two maps do not disagree. Dropping upsert_appointment_task alone is safe and is a security improvement (SECURITY DEFINER, no caller check, still GRANTed to authenticated per 20260708_dbf_p3_anon_rpc_revoke.sql:626-627).
- **finish_appointment(p_appointment_id uuid, p_employee_id uuid)**
  - No hard blocker — no caller, no test, no view, no cron, no doc contract. Two coordination notes: (1) it mutates cross-domain `job_tasks` and `appointments`, and docs/schema-v2/domains/jobs.md:70 lists it among the scheduling fns that touch job_tasks — make sure the jobs map does not count it as a live writer; (2) it is still SECURITY DEFINER with no caller check and GRANTed to authenticated (20260708_dbf_p3_anon_rpc_revoke.sql:162-163), so dropping it closes callable attack surface. Also regenerate docs/generated/rpc-inventory.md (row 107) after the drop.

### Sweep coverage notes

SWEEP RESULT: 15 of 83 claims reclassified (18%) — lower than billing's ~47%, and that is a real difference in kind, not thin coverage. Billing's hits came from an owner-executed reconciliation runbook that INSERTs and from an external Netlify consumer annotation; scheduling has neither. Its non-code aliveness is concentrated in ONE mechanism: owner keep-rulings that designate objects dormant-but-retained (surface 4). Surface 3 produced ZERO hits for this domain — I read every UPR-Web-Context.md annotation for the six dead tables (lines 566, 567, 573, 697-699) and they are bare one-line descriptions with no external app, partner, portal, spreadsheet, Zapier/Make, or owner-automation mention; the only such annotation in that file is the billing precedent itself (vendor_invoices, line 680).

THE HEADLINE FOR P5 — the round-3 owner amendment is still live law. docs/schedule-dispatch.md:125 ("ROUND-3 OWNER AMENDMENT: this is DEACTIVATE, NOT DELETE") + :138-141 ("ZERO DB object drops ... get_schedule_template(s), get_job_schedule(s) ... all STAY, documented as deactivated/dormant") and docs/schedule-roadmap.md:70 ("files + tables + RPCs retained dormant as the future-Gantt groundwork") are an explicit owner instruction to KEEP the scheduler-v1/templates fossil ring. The owning initiative (Schedule Desktop A/B/C) is "Unstarted" in .claude/rules/initiative-status.md, so nothing has superseded it. That single ruling is what pulls get_job_schedule, get_job_schedules, appointment_dependencies (+6 of its columns), and appointments.job_schedule_id/template_phase_id off the kill list. Recommend the synthesizer surface it to the owner as an explicit "does the 2026-07-03 deactivate-not-delete ruling still stand for v2?" question rather than assuming either way — the mapper already raised the sibling question (docs/schema-v2/domains/sched.md:239) and it is now the single highest-leverage open decision in this domain.

CI DB-LANE FACTS (relevant if the owner overrides any reclassification): the db lane is now LIVE — .github/workflows/ci.yml:142-167 runs `npm run test:db:branch` against seeded qa-staging, failed assertions are gated at zero, and setup-suite debt is shrink-only. `db_foundation_p6_timezone_rpcs.test.js` currently reaches its get_my_appointments_today assertions; dropping that RPC would therefore create a failed assertion and fail the gate. `tech_v2_feed_upgrades.test.js` contains four additional intended calls but currently fails in setup, so do not count those as effective coverage until converted.

HONEST CORRECTION TO THE BILLING PRECEDENT I was handed: supabase/tests/uxq_fb_rpcs.test.js does NOT redden if its RPC is dropped. Its header states it explicitly at :37-38 — "if run with creds against a DB that lacks the RPCs, the calls still reject (function-not-found), so it stays green" — and the three assertions are `rejects.toThrow()`. So dropping sync_appointment_crew (and, for the billing map, save_estimate_lines) leaves that suite green. My reclassification of sync_appointment_crew rests on the open-initiative doc designation (surface 4), not on CI. The behavioral positive test supabase/tests/uxq_fb_rpcs.sql:32-52 (`PERFORM sync_appointment_crew(...)`) WOULD break, but it is a .sql file and the vitest db lane includes only `supabase/tests/**/*.test.js` (vitest.config.js:47) — it is not executed by anything. Worth correcting in the billing sweep's kill note.

ONE FREE-STANDING DROP: on_call_schedule is the only claim in this domain with zero dependency of any kind — no function body references it anywhere in the 400+ fndefs, no inbound FK, no view, no publication, no cron, no test, no CI SQL, no doc contract. The only "on-call" prose in docs/ is human release/incident on-call ownership (docs/mobile-production-readiness-roadmap.md:158, docs/upr-agent-qa-access-dispatch.md:234,329) — unrelated to this table. It is the cleanest drop candidate in the domain.

COVERAGE (re-checked once before concluding, per instruction): (1) recursive Grep of every *.md in the repo for all 6 table names, all 6 RPC names, and job_schedule_id/template_phase_id — plus a second pass on distinctive dead-table column names (survey_url, dispatched_by, priority_order, reminder_sent, block_type, all_day, lag_days, dependency_type, source/target_appointment_id) which hit ONLY the map itself; plus a prose pass for the underlying business processes ("on-call/oncall", "materials selection", "selection survey", "subcontractor confirm") which found no doc naming any of these as a live mechanism. (2) supabase/migrations/ grep for all names: 10 files, all inspected — the only body WRITE is merge_contacts_safety:152; every other hit is DDL, grant hygiene (20260708_dbf_p3_anon_rpc_revoke.sql), policy recreation, or a function-body replace; no data-repair/backfill migration touches this domain. (3) tests/qa/unit/** — ZERO matches for every claim name, so no static contract test reads these migrations. (4) .github/workflows/ — ZERO matches; also checked scripts/qa/seed-branch-fixtures.sql (the CI seed) — no reference. (5) catalog/views.json — no view projects any dead scheduling object (the 5 rv_* views are billing/jobs/leads/time only). (6) catalog/fks.json — every FK on these six tables is OUTBOUND to live tables (employees, jobs, contacts, conversations, appointments, job_schedules) plus one internal selection_responses→selection_dispatches edge; there are NO inbound FKs from live tables, so the referential side of a drop is safe. (7) Worktree copies under .claude/worktrees/ were excluded as duplicates of docs/schedule-roadmap.md.

The policies stay clean on purpose: get_job_schedule is SECURITY DEFINER, so it bypasses RLS entirely — retaining that RPC does not make the appointment_dependencies policies reachable. They are dead policies on a retained table, which is exactly the "unnecessary grant surface" the mapper's structural problem 7 describes.
