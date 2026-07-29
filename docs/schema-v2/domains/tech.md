# Domain: Tech App & Time-Tracking

Field-tech operational data: the clock (OMW → on-site → finish) writing `job_time_entries`, the admin Time-Tracking page (approve/edit/delete + change-request review), drying-equipment placement (`equipment_placements`), the Scope Sheet versioned schema store (`demo_sheet_schemas`), and the tech feedback inbox (`tech_feedback`). Health: functionally alive and coherent — 6 of 7 tables and 26 of 27 RPCs are on live paths, writes are correctly funneled through SECURITY DEFINER RPCs (no client writes any of these tables directly). The systemic weakness is authorization theater: every definer RPC trusts a caller-supplied `p_actor_id`/`p_employee_id` instead of `auth.uid()`, one legacy write RPC (`upsert_time_entry`) is dead but still executable by any authenticated session with zero checks, and 5 of 7 policies are always-true. One dead table (`job_equipment`, superseded by `equipment_placements`). Headline numbers: 7 tables (6 used, 1 dead) · 96 columns (83 used, 1 uncertain, 12 dead) · 27 RPCs (26 used, 1 dead) · 7 policies (1 used, 5 band-aid, 1 dead) · 2 triggers (both used).

## Tables (7)

### demo_sheet_schemas — USED
- Purpose: versioned Scope Sheet form-schema store; exactly one `is_active=true` row at a time; old published rows are the deliberate rollback mechanism (`.claude/rules/scope-sheet-rollback.md`), not dead data.
- Evidence: all access via RPCs — `src/pages/settings/ScopeSheets.jsx:125,153,214,219,241,262,284` (list/get/upsert/publish/delete) and `src/pages/tech/TechDemoSheet.jsx:837,842` (get_demo_schema / get_active_demo_schema); `save_demo_sheet` reads it for the active schema id. QA fixture seed: `scripts/qa/seed-branch-fixtures.sql:82`.
- Prod stats: 4 live rows; ins 5 / upd 12 / del 1; last_seq 2026-07-28, last_idx 2026-07-28.
- Provenance: table creation untracked — predates schema-as-code (RPC-era migrations exist: `20260704_settings_f_demo_schema_delete.sql`, P1/P3 hardening).
- Columns: 10 total — 9 used, 1 uncertain, 0 dead, 0 band-aid, 0 duplicated.
  - `created_at` — UNCERTAIN: generic name; no RPC returns it (`get_demo_schema`/`list_demo_schemas` return `updated_at`/`created_by`, not `created_at`), no code read found; default-populated only. Harmless bookkeeping.
- Policies: `demo_sheet_schemas_all` (ALL, authenticated) — BAND-AID — `USING true / CHECK true`; grants full direct write on admin-config data to every authenticated user even though the UI only writes via the guarded definer RPCs (the delete guard in `delete_demo_schema` is bypassable by a direct `DELETE` under this policy).
- Triggers: `demo_sheet_schemas_updated_at` (BEFORE UPDATE → `demo_sheet_schemas_touch_updated_at`) — USED — maintains `updated_at`, which the get/list RPCs return.
- Notes: FK `created_by → employees`; `forms.schema_id → demo_sheet_schemas(id)` (Forms domain) pins each saved sheet to its schema version — the sheet_count guard in `delete_demo_schema` depends on it. Partial unique index `uq_demo_sheet_schemas_active` enforces the single-active invariant.

### equipment_placements — USED
- Purpose: drying-equipment units placed on a job/room (Hydro), status active/removed, `days_onsite` derived.
- Evidence: `get_job_equipment` (legacy `src/pages/tech/TechAppointment.jsx:319` — legacy page, H3 cutover pending — and v2 `src/pages/tech/v2/hub/HubTools.jsx:87`); `place_equipment` (`TechAppointment.jsx:400`, `HubTools.jsx:152`, offline dispatcher `src/lib/dispatchers/equipmentDispatcher.js:61`); `remove_equipment` (`TechAppointment.jsx:429`, `HubTools.jsx:179`, dispatcher `:103`); `get_active_drying_jobs` reads it for Overview/admin-mobile (`src/components/overview/hooks/useActiveDrying.js:16`, `src/components/admin-mobile/dash/OpsCards.jsx:41`); `get_water_loss_report_data` builds its `job_equipment` CTE from it.
- Prod stats: 0 live rows; ins/upd/del 0 since reset; seq 329 / idx 2,971 (queried constantly — polling reads on an empty table); last_idx 2026-07-29.
- Provenance: `supabase/migrations/20260418_phase2_hydro.sql`.
- Columns: 14 total — 14 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated.
  - `client_id` — USED (reversal of the P4 dead-column flag): now the offline-replay idempotency key — unique index `equipment_placements_client_id_key`, `ON CONFLICT (client_id) DO UPDATE` in `place_equipment`, populated by both the v2 online path (`HubTools.jsx:155`) and the offline dispatcher (`equipmentDispatcher.js:68`). Legacy TechAppointment passes NULL (NULLs don't conflict). P4's all-NULL observation described pre-offline-queue data, not the current contract.
- Policies: `equip_authenticated_all` (ALL, authenticated) — BAND-AID — `USING true / CHECK true`; all writes actually flow through the definer RPCs, so the blanket direct-write policy is unearned surface.
- Triggers: none.
- Notes: FKs `job_id → jobs` CASCADE, `room_id → rooms` SET NULL, `placed_by`/`removed_by → employees`; `moisture_readings.equipment_id → equipment_placements(id)` (Hydro readings domain) hangs readings off placements. Table is empty in production — feature is live in code but apparently not yet adopted in the field.

### job_equipment — DEAD
- Purpose (historical): earlier equipment-on-job model with `quantity`/`daily_rate` (billing-flavored); superseded by `equipment_placements`.
- Evidence (dead trail): greps `'job_equipment'`, `"job_equipment"`, `[^_a-z]job_equipment` across `src/`, `functions/`, `scripts/`, `upr-mcp/`, `tests/`, `supabase/tests/`, `.github/workflows/` → zero call sites (every apparent hit is the `get_job_equipment` RPC name, which reads `equipment_placements`, or the `job_equipment` CTE inside `get_water_loss_report_data`, which is built `FROM equipment_placements` — confirmed in the function body; the CTE shadows the real table). Full 400-function fndefs scan: only two real-table references — that CTE (not the table) and `merge_jobs` (`UPDATE job_equipment SET job_id = p_keep_id WHERE job_id = p_merge_id`), a defensive sweep that can never match a row because **no insert path exists anywhere** (no code inserts, no function inserts, nothing in cron/triggers/views). Not in the realtime publication; no view reads it; upr-mcp `codeIndex.js` entry is a generated name index, not a caller. Prod stats corroborate: 0 live rows, ins/upd/del 0, seq 17 (last 2026-07-08), idx 70 (last 2026-07-21 — consistent with merge_jobs' empty sweeps). Stats-since-reset caveat acknowledged; the absence of any writer in current code is the load-bearing evidence.
- Prod stats: 0 live; 0/0/0; last_seq 2026-07-08.
- Provenance: untracked — predates schema-as-code (no `CREATE TABLE` in `supabase/migrations/`).
- Columns: 12 total — 0 used, 0 uncertain, 12 dead, 0 band-aid, 0 duplicated. All dead with table (id, job_id, equipment_type, equipment_name, serial_number, quantity, daily_rate, placed_at, removed_at, notes, created_at, updated_at).
- Policies: `allow_authenticated_job_equipment` (ALL, authenticated, true/true) — DEAD — always-true policy on a dead table.
- Triggers: none.
- Notes: secondary trait duplicated — models the same "equipment on a job" entity as `equipment_placements` (its unbuilt billing angle, `quantity`×`daily_rate`, never shipped). Drop candidate; also remove the `merge_jobs` sweep line when it goes.

### job_time_entries — USED
- Purpose: the labor table — one row per tech clock session (travel → on-site → out) or manual entry; feeds payroll/labor-cost reporting. Money-adjacent: `total_cost` is a GENERATED column (travel-inclusive since `20260627_travel_inclusive_cost.sql`).
- Evidence: direct selects `src/pages/TimeTracking.jsx:763`, `src/components/StatusBoard.jsx:110`, `src/components/tech/TimeTracker.jsx:225` (legacy page, H3 cutover pending), `src/pages/tech/v2/hub/useVisitClock.js:131`, `src/pages/tech/v2/dash/CompletedRows.jsx:50`, `src/components/MergeModal.jsx:169`; written exclusively via definer RPCs (`admin_clock_out_entry`, `admin_upsert_time_entry`, `approve_time_entries`, `clock_finish_entry`, `delete_time_entry`, plus other-domain `clock_appointment_action`, `apply_midnight_clock_split` and `scan_abandoned_clocks` — the latter two on active pg_cron jobs 1/2/4); read by other-domain RPCs `get_tech_dashboard`, `get_tech_status_board`, `get_timesheet_entries(_admin)`, `get_job_labor_summary`, `get_payroll_summary`, `get_tech_claims`, `get_claims_list`, `get_active_appointment_geo`, view `rv_time_entries`. No client-side insert/update/delete exists (grep `db.insert|update|delete('job_time_entries'` → src zero hits).
- Prod stats: 267 live; ins 285 / upd 796 / del 16; seq 33,325 / idx 91,341; hot through 2026-07-29.
- Provenance: table untracked — predates schema-as-code; RLS from `20260627_pr8_job_time_entries_rls.sql`; non-negativity CHECKs (hours/paused/travel) from DB-Foundation P4.
- Columns: 31 total — 31 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated.
  - `travel_start_lat` / `travel_start_lng` — used with caveat: write-only capture — written by `clock_appointment_action` (live), read by nothing yet (no RPC returns them, no src read). Forensic/geofence value only.
  - `clock_in_lat`/`clock_in_lng` — written by `clock_appointment_action`, read by `get_active_appointment_geo` → away-detection in `AttentionStrip.jsx:78-81`.
  - `auto_split_seq`, `continued_from`, `auto_continued` — midnight-split chain (`apply_midnight_clock_split`, cron-driven; self-FK + index).
  - `total_cost` — GENERATED (hours + travel_minutes/60) × rate; summed by `get_job_labor_summary` / returned by `get_timesheet_entries_admin`. The catalog column dump doesn't show generation expressions — verified from `20260627_travel_inclusive_cost.sql`.
- Policies: `jte_select_all` (SELECT, authenticated, `USING (NOT is_crm_partner(auth.uid()))`) — USED — a real predicate (CRM partner accounts excluded), and the deliberate absence of INSERT/UPDATE/DELETE policies is what forces writes through the RPCs. Caveat: it exposes `hourly_rate`/`total_cost` for every employee to every non-partner staff session (see structural problems).
- Triggers: `trg_calc_time_entry_cost` (BEFORE INSERT OR UPDATE OF hours, hourly_rate, employee_id → `calc_time_entry_cost`) — USED — despite the stale name it no longer computes cost (the generated column does); it backfills `hourly_rate` from `employees` when missing (load-bearing: without it the generated `total_cost` would compute against 0) and touches `updated_at`.
- Notes: FKs to jobs (CASCADE), employees (employee/entered_by/approved_by), appointments (SET NULL), self (`continued_from`). Partial unique `uq_jte_one_open_clock_per_employee` enforces one open clock. `time_entry_change_requests.entry_id` CASCADEs off it. TimeTracking.jsx's realtime subscriptions on this table never fire (not in the publication — see structural problems).

### tech_feedback — USED
- Purpose: bug/feature feedback from techs and office, with screenshot/attachment media and a purge-after-resolution retention flow.
- Evidence: `insert_tech_feedback` (`src/pages/tech/TechFeedback.jsx:84`, `src/pages/Feedback.jsx:85`); `get_tech_feedback` (other-domain-assigned RPC, `src/pages/settings/FeedbackInbox.jsx:110`); `update_tech_feedback` (`FeedbackInbox.jsx:164,187`); purge worker `functions/api/purge-feedback-media.js:115,194` (`get_purgeable_feedback_media` + `mark_feedback_attachments_purged`); db-lane tests `supabase/tests/feedback_media_schema.test.js`.
- Prod stats: 15 live; ins 20 / upd 29 / del 5; last activity 2026-07-28.
- Provenance: `supabase/migrations/tech_feedback.sql` (undated early file); media columns from `20260702_feedback_media.sql`.
- Columns: 13 total — 13 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated. (`screenshots` and `attachments` deliberately mirror each other inside `insert_tech_feedback` for old/new caller compatibility — a band-aid trait carried by the RPC, not the columns; `get_tech_feedback` returns every column including `created_at`.)
- Policies: `tech_feedback_all` (ALL, authenticated, true/true) — BAND-AID — always-true; the db-lane test itself calls it "wide-open by design", which makes it deliberate but still the always-true pattern the standard forbids as a default.
- Triggers: none.
- Notes: FK `employee_id → employees`. The purge worker exists but nothing schedules it (checked all 14 prod cron jobs) — retention is currently manual-only via FeedbackInbox buttons.

### time_entry_change_requests — USED
- Purpose: tech-proposed corrections to time entries, admin-reviewed; one pending per entry (partial unique index).
- Evidence: `submit_time_entry_change_request` (`src/pages/TimeTracking.jsx:1334`); `review_time_entry_change_request` (`TimeTracking.jsx:784`); direct selects for the pending queue (`TimeTracking.jsx:213,758`); `get_timesheet_entries_admin` computes `has_pending_change` from it.
- Prod stats: 0 live rows; ins/upd/del 0 since reset; idx 1,293 (the admin page polls the pending count constantly); last_idx 2026-07-28.
- Provenance: `supabase/migrations/20260627_time_entry_admin_writes.sql`.
- Columns: 10 total — 10 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated.
- Policies: `tecr_read` (SELECT, authenticated, `USING true`) — BAND-AID — always-true read: every staff member can read every tech's proposed corrections and review notes; writes correctly RPC-only.
- Triggers: none.
- Notes: `entry_id → job_time_entries ON DELETE CASCADE` (a hard delete removes its requests — the deletion audit snapshot lives in `time_entry_deletions` instead). Feature currently unused by techs in practice (0 rows) but fully wired.

### time_entry_deletions — USED (write-only audit)
- Purpose: audit snapshot of hard-deleted time entries (full row as jsonb + reason + actor).
- Evidence: written by `delete_time_entry` (fndefs: `insert into time_entry_deletions (entry_id, snapshot, reason, deleted_by)`), whose caller is `TimeTracking.jsx:423,437`. No reader anywhere (src/functions/scripts/upr-mcp/tests grep zero; no fn selects it) — write-only audit, which is its design.
- Prod stats: 4 live; ins 4; idx 0 (never index-read), seq 11 (last 2026-07-13).
- Provenance: `supabase/migrations/20260627_time_entry_admin_writes.sql`.
- Columns: 6 total — 6 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated (all written as the audit record).
- Policies: `ted_read` (SELECT, authenticated, `USING true`) — BAND-AID — always-true read of an audit log whose `snapshot` embeds the deleted row including `hourly_rate` — every staff session can read deleted entries' pay data.
- Triggers: none.
- Notes: `entry_id` deliberately has **no FK** — it points at already-deleted rows (P4 report §4; by design, not a defect). Only FK is `deleted_by → employees`.

## RPCs (27)

All are SECURITY DEFINER except the trigger function `demo_sheet_schemas_touch_updated_at` (invoker). All carry `authenticated=X` + `service_role=X` grants (anon revoked in DB-Foundation P3). "actor-param check" = the function validates a **caller-supplied uuid** (`is_time_admin(p_actor_id)` = role ∈ admin/office/project_manager/supervisor), never `auth.uid()` — spoofable by any authenticated session; noted once here and per-row below.

| function(args) | class | security | callers / evidence | notes |
|---|---|---|---|---|
| admin_clock_out_entry(p_id, p_actor_id, p_clock_out) | used | definer | TimeTracking.jsx:400,412; StatusBoard.jsx:154 | actor-param check only; writes system_events audit |
| admin_upsert_time_entry(p_actor_id, …16 args) | used | definer | TimeTracking.jsx:470,1181; StatusBoard.jsx:174; SQL: review_time_entry_change_request | actor-param check; enforces timestamp ordering, approved-lock, one-open-clock; audit event |
| approve_time_entries(p_entry_ids[], p_approved_by, p_approved) | used | definer | TimeTracking.jsx:381,391 | **NO caller check at all** — any authenticated session can (un)approve any entries and attribute it to anyone |
| clock_finish_entry(p_entry_id, p_employee_id) | used | definer | AttentionStrip.jsx:143 (v2 5PM banner) | no auth binding — p_employee_id caller-supplied; also completes the linked appointment |
| clock_omw_precheck(p_appointment_id, p_employee_id) | used | definer | src/lib/clockPrecheck.js:36 → TechJobHub v2 + legacy TimeTracker | read-only; reads feature_flags `clock_enforce_explicit_clockout` |
| close_open_clocks_on_appt_delete() | used | definer (trigger fn) | trigger `trg_close_open_clocks_before_appt_delete` BEFORE DELETE ON appointments (live table, Scheduling domain) | auto-closes open clocks when the appointment is deleted; appends note |
| delete_demo_schema(p_id) | used | definer | ScopeSheets.jsx:284 | no caller check (any authenticated can delete never-published drafts); refuses active/published/referenced versions — rollback-retention guard |
| delete_time_entry(p_id, p_reason, p_actor_id) | used | definer | TimeTracking.jsx:423,437 | actor-param check; refuses approved rows; snapshots → time_entry_deletions + system_events before delete |
| demo_sheet_schemas_touch_updated_at() | used | invoker (trigger fn) | trigger on demo_sheet_schemas | touch updated_at |
| get_active_demo_schema() | used | definer | TechDemoSheet.jsx:842 | read-only, single active row |
| get_demo_schema(p_id) | used | definer | TechDemoSheet.jsx:837; ScopeSheets.jsx:153,214 | read-only |
| get_job_equipment(p_job_id, p_include_removed) | used | definer | TechAppointment.jsx:319 (legacy page, H3 cutover pending); HubTools.jsx:87 | reads equipment_placements (NOT the dead job_equipment table); joins rooms |
| get_purgeable_feedback_media(p_days) | used | definer | functions/api/purge-feedback-media.js:115 | retention clamped ≥30d inside the RPC; worker has **no cron schedule** (see problems) |
| get_timesheet_entries_admin(6 args) | used | definer STABLE | TimeTracking.jsx:315,1024 | **no caller check** — despite the `_admin` name any authenticated user gets every employee's hours, hourly_rate, total_cost |
| insert_tech_feedback(7 args) | used | definer | TechFeedback.jsx:84; Feedback.jsx:85 | no caller check (p_employee_id caller-supplied); contains deliberate old/new caller screenshots↔attachments mirroring (contract-compat band-aid trait) |
| list_demo_schemas() | used | definer | ScopeSheets.jsx:125 | read-only; counts referencing forms |
| mark_feedback_attachments_purged(p_id) | used | definer | purge-feedback-media.js:194; FeedbackInbox.jsx:218,238 | first-stamp-wins; no caller check |
| place_equipment(8 args) | used | definer | TechAppointment.jsx:400 (legacy); HubTools.jsx:152; equipmentDispatcher.js:61 (offline replay) | ON CONFLICT (client_id) = idempotent replay; no caller check |
| publish_demo_schema(p_id) | used | definer | ScopeSheets.jsx:262; scope-sheet-rollback.md runbook step 1 | single-active flip; stamps published_at once |
| remove_equipment(p_equipment_id, p_removed_by) | used | definer | TechAppointment.jsx:429; HubTools.jsx:179; equipmentDispatcher.js:103 | idempotent-ish (re-select on already-removed); no caller check |
| review_time_entry_change_request(4 args) | used | definer | TimeTracking.jsx:784 | actor-param check; applies via admin_upsert_time_entry(override_approved=>true); notify_emit + audit event |
| save_demo_sheet(14 args) | used | definer | TechDemoSheet.jsx:1015,1108 | writes the **forms** table (Forms domain) — snapshots schema_id; no caller check |
| submit_time_entry_change_request(4 args) | used | definer | TimeTracking.jsx:1334 | NOT_OWNER check compares entry.employee_id to caller-supplied p_actor_id — spoofable; notify_emit |
| tech_hours_bucket(5 args incl. p_open job_time_entries) | used | definer | SQL-only: get_tech_dashboard (→ TechDashV2.jsx:73) | internal helper granted to authenticated though only the dashboard RPC needs it; could be internal-only |
| update_tech_feedback(p_id, p_status, p_admin_notes) | used | definer | FeedbackInbox.jsx:164,187 | no caller check — any authenticated user can retriage feedback; resolved_at stamp logic |
| upsert_demo_schema(5 args) | used | definer | ScopeSheets.jsx:219,241 | no caller check; version auto-increment; never touches is_active |
| upsert_time_entry(8 args) | **dead** | definer | Zero-hit trail: grep `[^_a-z]upsert_time_entry` (also quoted forms) across src/, functions/, scripts/, upr-mcp/, tests/, supabase/tests/, .github/workflows → only docs (archive PR7 handoff: "PR-7 should migrate… to the admin_* writes" — it did: TimeTracking now calls admin_upsert_time_entry), UPR-Web-Context, generated rpc-inventory, migrations (grants), db/baseline snapshot, upr-mcp codeIndex (generated name index, not a caller). 400-function fndefs scan: no SQL caller. Not in prod-cron.json; not a trigger fn; not in any view. prod-fn-stats empty (track_functions off) — no counter corroboration available. | Legacy generation superseded by admin_upsert_time_entry, **still granted to authenticated with NO caller check, no approved-lock, no ordering checks, no audit event** — a live bypass of every guard the admin path added. Revoke/drop candidate. |

## Structural problems (ranked, worst first)

1. **Client-supplied actor identity across the whole time-entry write surface** — severity 4. Every guarded RPC (`admin_clock_out_entry`, `admin_upsert_time_entry`, `delete_time_entry`, `review_time_entry_change_request`) authorizes via `is_time_admin(p_actor_id)` where `p_actor_id` arrives from the client; `submit_time_entry_change_request`'s ownership check and `clock_finish_entry`'s employee scoping are the same pattern. Employee ids are readable by all staff, so any authenticated session can pass an admin's id and edit/delete/approve payroll-feeding hours. `auth.uid()` is available (jte_select_all already uses it) — the fix is mechanical.
2. **`approve_time_entries` and dead `upsert_time_entry` have no check at all** — severity 4. `approve_time_entries` (live, used) lets any authenticated session bulk-approve/unapprove any entries with arbitrary attribution; `upsert_time_entry` (dead, still executable) writes arbitrary `job_time_entries` including approved rows, bypassing the admin path's approved-lock, ordering checks and audit events. One is a body fix, the other a revoke/drop.
3. **Pay-rate visibility to all staff** — severity 3. `jte_select_all` returns `hourly_rate`/`total_cost` on every row to every non-CRM-partner authenticated user; `get_timesheet_entries_admin` (no role check despite the name) returns the same via RPC; `ted_read` exposes deleted-entry snapshots including rate. If pay rates are office-only in intent, both the policy column surface and the RPC need a role predicate.
4. **`anon` still holds full table grants (incl. TRUNCATE) on all 7 tables** — severity 3. P3 closed the *policies* to `authenticated`, but grants.json shows `anon: DELETE,INSERT,…,TRUNCATE` on every tech table. RLS does not govern TRUNCATE. PostgREST exposes no truncate verb, so it is not reachable through the API today — but it is one non-PostgREST surface away from data loss, and it contradicts the least-privilege standard. (Known global posture issue — logged here for this domain's tables.)
5. **TimeTracking's realtime reload can never fire** — severity 2. `useRealtimeReload` (TimeTracking.jsx:159-169) subscribes `postgres_changes` on `job_time_entries` and `time_entry_change_requests`, but `supabase_realtime` publishes only conversations/messages/notifications (publications.json). The admin board silently never live-updates; pending-change badges refresh only on remount/filter change. Either add the tables to the publication (volume caution) or replace with polling.
6. **Feedback-media purge is built but unscheduled** — severity 2. `functions/api/purge-feedback-media.js` + both RPCs are live code, but no pg_cron job (all 14 inspected) and no GitHub workflow invokes it. The 90-day retention promise executes only when an admin manually clicks purge in FeedbackInbox.
7. **Dead table `job_equipment` with an always-true policy still attached** — severity 2. Zero-writer table (see dead trail) still carries full authenticated CRUD via `allow_authenticated_job_equipment` and a live sweep line in `merge_jobs`. Drop table + policy + the merge line together.
8. **Stale trigger name `trg_calc_time_entry_cost`** — severity 1. The function stopped calculating cost when `total_cost` became GENERATED (2026-06-27); it now only backfills `hourly_rate` + touches `updated_at`. Cosmetic, but the name misleads exactly the way the P4/audit reports warn about — rename to `trg_backfill_time_entry_rate` in v2.

## Open questions for the owner

1. `job_equipment` (0 rows, superseded by `equipment_placements` since April): confirm nothing outside this repo (old exports, spreadsheets) ever wrote it, so v2 can drop it outright.
2. `upsert_time_entry`: confirm no out-of-repo caller (old iOS build, script on your machine) before it is revoked/dropped — repository evidence says nothing has called it since the PR-7 migration.
3. Should every staff member (including techs) be able to see every employee's `hourly_rate` and labor cost? Today the schema allows it three ways (direct select, the admin timesheet RPC, deleted-entry snapshots). v2 needs the intended answer, not the accidental one.
4. Is the tech-feedback attachment purge supposed to run automatically? The worker exists but nothing schedules it — if yes, it needs a cron entry; if manual-only is the intent, the 90-day language in the worker header is misleading.
5. `travel_start_lat/lng` are captured on every OMW but never displayed or read — keep capturing for future geofencing/dispute evidence, or stop writing them in v2?
6. `equipment_placements` is empty in production (Hydro adoption). Is equipment tracking expected to be used going forward (worth first-class modeling in v2), or should v2 fold it into a leaner structure?

## Search appendix

- **Code-usage greps (scopes: src/, functions/, scripts/, upr-mcp/, tests/, supabase/tests/, .github/workflows/):** one alternation grep over all 27 RPC names (content mode, per-scope); one alternation over all 7 table names; precision re-greps with `[^_a-z]` guards for substring-collision names (`upsert_time_entry` ⊂ `admin_upsert_time_entry`, `job_equipment` ⊂ `get_job_equipment`, `get_demo_schema` ⊂ `get_demo_schemas`-style); targeted greps for `db.insert|update|delete('<table>'` (zero direct client writes found), `rv_time_entries`, `total_cost`, `useRealtimeReload`, geo/split columns, `get_tech_feedback`.
- **Catalog checks:** full per-function body extraction of all 27 assigned RPCs; a 400-function fndefs cross-reference scan mapping every function body to my 7 tables and 27 RPC names (chain evidence); triggers.json (both my triggers + the appointments trigger firing my trigger-function); views.json (`rv_time_entries` is the only view touching my tables); publications.json (none of my tables in `supabase_realtime`); prod-cron.json (14 jobs — `apply_midnight_clock_split` ×2 and `scan_abandoned_clocks` touch job_time_entries; none call my assigned RPCs directly; no purge job); fks.json / indexes.json / grants.json / rls-flags.json filtered to my tables.
- **Prod-stats caveats:** stats are since-last-reset and corroborating only. `prod-fn-stats.json` is EMPTY (track_functions off) — per-function call counts were unavailable; RPC usage claims rest entirely on code/fndefs/trigger/cron evidence.
- **Known ambiguities, stated honestly:** (a) `TechClaims.jsx` header comment lists job_time_entries among reads/writes but the file body shows no direct call — stale doc header, not counted as evidence; (b) `demo_sheet_schemas.created_at` left uncertain (generic name, no observed reader) rather than claimed dead; (c) `travel_start_lat/lng` counted used as deliberate write-only capture — flagged to the owner instead of guessed; (d) table-creation provenance for `job_equipment`, `job_time_entries`, `demo_sheet_schemas` is untracked (predates schema-as-code) — verified by grepping `supabase/migrations/` for `create table` with each name; (e) supabase/tests + tests/qa references were treated as test-only and never used to keep an object alive (all my used objects have non-test callers).
