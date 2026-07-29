# Domain: Jobs & Claims

The platform core: `jobs` (81 columns, the god-table) and `claims` model restoration work; around them sit task/checklist/notes/phase satellites, the Encircle mitigation family (rooms, moisture_readings), the real-job metric audit trail, and a small owner-only homebuilding vertical. Health: heavily used but structurally the oldest part of the schema — jobs duplicates the claim's insurance identity across ~12 columns kept aligned by a sync trigger, phase history has two competing writers, four tables are dead planned-verticals (job_costs, job_assignments, checklist_templates, escalation_log), an AR-on-jobs model was abandoned mid-migration to invoices, and `anon` still holds live INSERT/UPDATE/DELETE paths on jobs/claims/job_phase_history. Headline numbers: 22 tables (18 used, 4 dead), 74 RPCs (65 used, 8 dead, 1 band-aid), 299 columns (221 used, 64 dead, 12 uncertain, 2 duplicated), 40 policies (only 5 carry a real predicate), 15 triggers (12 used).

## Tables (22)

### jobs — USED
- Purpose: the core work record — one row per restoration/remodel job, carrying client, insurance, financial, phase, real-job-metric and sync state.
- Evidence: everywhere. `src/pages/Jobs.jsx:86` (55-column list select), `src/pages/JobPage.jsx:135-139` (saveBatch update), `src/pages/Production.jsx:87`, `src/pages/Leads.jsx:22`, `create_job_with_contact`/`add_related_job`/`get_job_hub`/`get_jobs_list` + 60+ other fns reference it; workers `functions/api/sync-encircle.js`, `sync-houzz.js`, `collections-chat.js:351`.
- Prod stats: 276 live rows, ins 557 / upd 3,233 / del 132, idx scans 769,737, last scan 2026-07-29 (hot).
- Provenance: untracked — predates schema-as-code.
- Columns: 81 total — 68 used, 6 uncertain, 5 dead, 0 band-aid, 2 duplicated.
  - `lead_source_detail` — DEAD: 0 code hits (git grep -w across src/functions/scripts/upr-mcp/tests), only reference anywhere is merge_jobs' mechanical COALESCE sweep; CRM lead lifecycle lives in crm_leads now.
  - `lead_contacted_at` — DEAD: 0 code hits, 0 fn-body refs (fndefs grep).
  - `lead_converted_at` — DEAD: 0 code, 0 fns.
  - `lead_lost_reason` — DEAD: 0 code, 0 fns.
  - `lead_tech` (text) — DEAD: 0 code, only merge_jobs sweep; superseded by `lead_tech_id` FK (which is written by JobPage TeamTile + create_job_with_contact).
  - `adjuster` (text) — DUPLICATED: same fact as `adjuster_name`; written only by `functions/api/sync-encircle.js:144`, read in Jobs.jsx:86 select + get_claim_detail/get_water_loss_report_data. Two live columns for one fact (Encircle-sourced vs hand-entered).
  - `project_manager` (text) — DUPLICATED with `project_manager_id` FK: text written by encircle-import.js:165/279, read by get_dispatch_board/get_jobs_list/Jobs select; the FK is written by JobPage TeamTile. Both live.
  - `estimator` — UNCERTAIN: read by used get_estimator_leaderboard (`j.estimator` group key) and Jobs-page select; **no writer found anywhere in code or fns** (only merge sweep + test fixtures). Leaderboard runs on hand/legacy data.
  - `supervisor` — UNCERTAIN: read by get_tech_status_board; no writer found.
  - `ar_notes` — UNCERTAIN: rendered in TechJobDetail.jsx:524 + JobClaimSection.jsx:165; no writer found (AR editing moved to invoices).
  - `last_followup_date` — UNCERTAIN: read only by dead get_ar_jobs + used get_claim_detail; no writer.
  - `deductible_collected` — UNCERTAIN: read via get_ar_jobs(dead)/get_claim_detail; the only UI writer existed in the pre-invoice AR surface (scripts/one-off/patch_claim_links.js is the fossil); no live writer.
  - `deductible_collected_date` — UNCERTAIN: same trail as deductible_collected.
  - Notable used-with-caveat: `total_labor_cost/total_material_cost/total_equipment_cost/total_sub_cost/total_other_cost` are rendered (JobPage:650, CustomerPage:476, Jobs select) but have **no automated writer** — `functions/api/collections-chat.js:239` calls these rollups "deprecated/hand-logged"; `invoiced_value` has dual writers (manual RevenueTile edit at JobPage:575 AND billing-side `sync_job_invoiced_from_invoices`); `supplement_value` is a client-computed rollup of job_supplements (JobPage:600); `ar_status` is written by billing's `update_invoice_paid`; `houzz_*` written by sync-houzz.js; `carrier_identifier`/`assignment_identifier`/`encircle_summary`/`encircle_created_at` written by the Encircle import/sync workers.
- Policies: `allow_anon_insert_jobs` (INSERT, anon) — BAND-AID — CHECK true, and anon holds full table grants (grants.json: anon=ALL), so this is a live unauthenticated write path; on the P3 §8 deferred list, not closed. `allow_anon_read_jobs` (SELECT, anon) — BAND-AID — USING true, live. `allow_anon_update_jobs` (UPDATE, anon) — BAND-AID — USING/CHECK true, live. `allow_authenticated_jobs` (ALL, authenticated) — USED — real predicate `NOT is_crm_partner(auth.uid())` (CRM-partner exclusion), otherwise company-wide by design.
- Triggers: `jobs_updated_at` (BEFORE UPDATE → update_updated_at) — USED. `trg_auto_job_number` (BEFORE INSERT → trigger_auto_job_number) — USED, fills job_number. `trg_create_draft_invoice` (AFTER INSERT → create_draft_invoice_for_job, billing-domain fn) — USED, cross-domain. `trg_job_events` (AFTER INS/UPD → trigger_job_events) — USED, system_events feed. `trg_job_real_flag_history_ins` / `trg_job_real_flag_history_upd` (AFTER INS/UPD → record_job_real_flag_change) — USED, audit. `trg_log_phase_change` (BEFORE UPDATE → log_phase_change) — USED but see structural problem 3 (client code also inserts the same history). `trg_sync_job_to_claim` (AFTER UPDATE → sync_job_to_claim) — BAND-AID, one-way sync of duplicated insurance/loss columns to claims.
- Notes: FK claim_id → claims (SET NULL); 30+ child tables FK into jobs (appointments, invoices, estimates, job_documents, sign_requests, etc. — other domains). `jobs.status/phase` are not the Rule-15 money columns; no direct writes to trigger-owned money columns found in this domain's tables.

### claims — USED
- Purpose: insurance claim container grouping related jobs; carries carrier/policy/loss identity and Encircle sync state.
- Evidence: `src/pages/ClaimPage.jsx:65,177` (get_claim_detail + db.update), ClaimsList.jsx:66, ClaimCollectionPage, TechClaimDetail/TechClaimAlbum/TechRoomDetail; fns get_claims_list/get_claim_detail/get_claim_jobs/create_job_with_contact/add_related_job (29 fns reference it); workers sync-claim-to-encircle.js:235-283.
- Prod stats: 161 live, ins 205 / upd 312 / del 23, idx 298,643, last 2026-07-29 (hot).
- Provenance: untracked — predates schema-as-code.
- Columns: 23 total — 22 used, 1 uncertain, 0 dead.
  - `adjuster_contact_id` — UNCERTAIN: FK → contacts, returned by get_claim_detail, but 0 code hits and no writer anywhere (not in ClaimPage's update fields, not in create_job_with_contact) — can only ever be NULL unless hand-edited.
- Policies: `anon_insert_claims` (INSERT, anon) — BAND-AID — CHECK true + live anon grant; P3-deferred. `anon_read_claims` (SELECT, anon) — BAND-AID — USING true, live. `anon_update_claims` (UPDATE, anon) — BAND-AID — live. `claims_anon_delete` (DELETE, anon+authenticated) — BAND-AID — USING `NOT is_crm_partner(auth.uid())`; for anon, auth.uid() is NULL → predicate passes → **anon DELETE is live**. `claims_auth_insert` (INSERT, authenticated) — USED — CHECK `NOT is_crm_partner(...)`. `claims_auth_select` (SELECT, authenticated) — USED — same predicate. `claims_auth_update` (UPDATE, authenticated) — USED.
- Triggers: `trg_claim_events` (AFTER INS/UPD → trigger_claim_events) — USED, system_events. `trg_claim_status_history` (AFTER UPDATE OF status WHEN changed → capture_claim_status_history) — USED, audit.
- Notes: claim_number DEFAULT calls `generate_claim_number()`; create_job_with_contact bypasses that default with its own inline `nextval('claim_number_seq')` generator (problem 7). rooms and jobs FK to claims; claim deletion cascades rooms and claim_status_history.

### rooms — USED
- Purpose: rooms of a loss property (attached to the CLAIM, not the job), created by techs for photos/readings; mirrors Encircle room structure conceptually.
- Evidence: create_room (roomDispatcher.js:52, TechAppointment.jsx:298, TechJobHub.jsx:120, PhotoCaptureButton.jsx:160), create_room_for_claim (TechClaimDetail.jsx:285), get_job_rooms / get_claim_rooms consumed across the tech shell.
- Prod stats: 312 live, ins 323 / upd 5 / del 11, last idx 2026-07-29 (hot).
- Provenance: `supabase/migrations/20260420_phase1_rooms.sql`.
- Columns: 12 total — 10 used, 0 uncertain, 2 dead.
  - `encircle_room_id` — DEAD: 0 code hits, 0 fn refs; encircle-backfill/sync-encircle/encircle-upload workers never touch rooms (grep of all encircle-*.js = zero). Planned Encircle room linkage never wired.
  - `encircle_structure_id` — DEAD: same zero trail.
  - `deleted_at` — used (soft-delete filter in get_job_rooms/get_claim_rooms/get_water_loss_report_data) but its ONLY writer is the dead `delete_room` RPC — the app currently has no way to set it.
- Policies: `rooms_authenticated_all` (ALL, authenticated) — BAND-AID — USING/CHECK true; bypasses the create_room RPC discipline (client_id dedupe) for direct writes.
- Triggers: none.
- Notes: FK claim_id → claims ON DELETE CASCADE; job_documents.room_id and moisture_readings.room_id point here (SET NULL).

### moisture_readings — USED
- Purpose: psychrometric/moisture readings per job/room/material for drying documentation (IICRC-style logs, water-loss report).
- Evidence: insert_reading via readingDispatcher.js:69 (offline queue), TechAppointment.jsx:361, HubTools.jsx:126; reads via get_job_readings, get_active_drying_jobs, get_stalled_materials(-for_employee), get_water_loss_report_data → functions/api/generate-water-loss-report.js:62.
- Prod stats: **0 rows ever** (ins 0) — wired UI, no production drying data yet ("Empty until Hydro is used", useActiveDrying.js:5). idx scans 3,013 show the RPCs poll it.
- Provenance: `supabase/migrations/20260418_phase2_hydro.sql`.
- Columns: 22 total — 20 used, 2 uncertain, 0 dead.
  - `edited_at` — UNCERTAIN: written only by dead update_reading; read by get_job_readings. Always NULL in practice.
  - `edited_by` — UNCERTAIN: same trail (FK → employees).
  - `reading_date` used via DEFAULT CURRENT_DATE + reads in get_job_readings/get_water_loss_report_data; `client_id` is the offline-replay dedupe key (UNIQUE, ON CONFLICT in insert_reading).
- Policies: `moisture_authenticated_all` (ALL, authenticated) — BAND-AID — always-true ALL lets any authenticated client UPDATE/DELETE directly, silently bypassing the 10-minute immutability window that update_reading/delete_reading were built to enforce.
- Triggers: none.
- Notes: FKs job_id→jobs CASCADE, room_id→rooms SET NULL, equipment_id→equipment_placements SET NULL (equipment domain).

### job_tasks — USED
- Purpose: per-job work checklist items, linkable to appointments and schedule phases; drives tech task lists and scheduling.
- Evidence: get_unassigned_tasks/assign_tasks_to_appointment (CreateAppointmentModal:58/178, Schedule.jsx:702, TechNewAppointment:256, TechEditAppointment:271), toggle_job_task (JobPanel:255), direct select/insert/delete (EditAppointmentModal:85/265, JobPanel:246, ScheduleWizard:225, Schedule.jsx:673); scheduling fns add_adhoc_job_task/apply_schedule_plan/finish_appointment.
- Prod stats: 196 live, ins 548 / upd 405 / del 423, idx 1,650,250 (hottest index traffic in the domain), last 2026-07-29.
- Provenance: untracked — predates schema-as-code.
- Columns: 19 total — 19 used. (job_schedule_id / job_schedule_phase_id / template_phase_id / template_task_id / target_date carried by the scheduling fns apply_schedule_plan, add_adhoc_job_task, get_job_task_pool; completed_by written by toggle_job_task/toggle_appointment_task.)
- Policies: `job_tasks_delete` / `job_tasks_insert` / `job_tasks_select` / `job_tasks_update` (authenticated) — BAND-AID x4 — all always-true, per-command spelling of a blanket grant.
- Triggers: `trg_job_tasks_updated_at` (BEFORE UPDATE → update_job_tasks_updated_at) — USED.
- Notes: FKs into scheduling domain (job_schedules, job_schedule_phases, template_phases/tasks — cross-domain, theirs to classify) and appointments (SET NULL).

### job_notes — USED
- Purpose: free-text activity notes on a job (office UI + e-sign automation writes a note when a doc is signed).
- Evidence: JobPage.jsx:79,931,934 (select/insert/delete), functions/api/submit-esign.js:316 (insert), read inside get_customer_detail/get_contact_activity.
- Prod stats: 11 live, ins 13 / del 1, seq 957, last 2026-07-28.
- Provenance: untracked.
- Columns: 12 total — 6 used, 1 uncertain, 5 dead.
  - `is_pinned` — DEAD: 0 code, 0 fns.
  - `note_type` — DEAD: 0 code, 0 fns (default 'general' never consulted).
  - `related_form_id` — DEAD: 0 code, 0 fns (FK → forms, never written).
  - `edited_at` — DEAD: 0 code; the fndefs hits for the name belong to moisture_readings, none to job_notes; no note-editing UI exists.
  - `encircle_note_id` — DEAD: the 2 code hits are comments about forms' Encircle note id (encircle-upload.js:3, TechDemoSheet.jsx:1271); neither insert site writes it.
  - `updated_at` — UNCERTAIN: generic; no update path in code (notes are insert/delete only).
- Policies: `allow_authenticated_job_notes` (ALL, authenticated) — BAND-AID — always-true. `anon_delete_job_notes` / `anon_insert_job_notes` / `anon_select_job_notes` / `anon_update_job_notes` (all actually TO authenticated despite names) — DUPLICATED x4 — per-command policies fully redundant with the always-true ALL policy on the same role.
- Triggers: `trg_note_events` (AFTER INSERT → trigger_note_events, events-domain fn) — USED (system_events feed).
- Notes: author_id FK → employees SET NULL.

### job_phase_history — USED
- Purpose: audit of job phase transitions (from/to/when/who/how-long).
- Evidence: written by trg_log_phase_change AND by clients (JobPage.jsx:108, Production.jsx:179, JobDetailPanel.jsx:38); read by JobPage.jsx:80 activity tab, run-automations.js:466 (phase-change automations), get_contact_activity/get_customer_detail.
- Prod stats: 15 live, ins 95 / del 81 — the high delete count is consistent with cleanup of double-written rows (problem 3).
- Provenance: untracked.
- Columns: 7 total — 7 used (duration_hours written by the trigger, changed_by written by the client inserts — each writer fills the half the other leaves NULL).
- Policies: `allow_anon_insert_phase_history` (INSERT, anon) — BAND-AID — live anon write (grant+policy), P3-deferred. `allow_anon_read_phase_history` (SELECT, anon) — BAND-AID — live anon read. `allow_authenticated_job_phase_history` (ALL, authenticated) — BAND-AID — always-true.
- Triggers: none on this table (populated by the jobs trigger).
- Notes: FK job_id → jobs CASCADE; changed_by → employees.

### job_phases — USED
- Purpose: lookup catalog of job phases (key, label, color, ordering) driving phase chips and pipelines.
- Evidence: useLookup.js:45 (cached lookup), JobPage.jsx:76, Jobs.jsx:87 + phase chip render Jobs.jsx:261 (`phase.color`), Production.jsx:88; read in get_contact_activity/get_customer_detail.
- Prod stats: 30 live, ins 30 / upd 3, idx 1,497.
- Provenance: untracked.
- Columns: 10 total — 7 used, 2 uncertain, 1 dead.
  - `is_terminal` — DEAD: 0 code, 0 fns.
  - `description` — UNCERTAIN: generic name, carried by select=* but no observed render.
  - `updated_at` — UNCERTAIN: generic; no app update path (upd=3 likely manual SQL).
- Policies: `allow_anon_read_phases` (SELECT, actually TO authenticated) — DUPLICATED — redundant with the ALL policy below. `allow_authenticated_job_phases` (ALL, authenticated) — BAND-AID — always-true write access to a lookup table that only admins should edit (no editor UI exists).
- Triggers: none.
- Notes: pure lookup; no FKs.

### job_supplements — USED
- Purpose: supplement line amounts per job (insurance supplements), summed client-side into jobs.supplement_value.
- Evidence: JobPage.jsx:594-609 (select/insert/delete + syncSuppTotal rollup).
- Prod stats: **0 rows ever** (ins 0), seq 106 — live UI, feature unused by the business so far.
- Provenance: untracked.
- Columns: 6 total — 6 used (all written/read by the JobPage supplement editor).
- Policies: `anon_all` (ALL, actually TO authenticated) — USED — real predicate `NOT is_crm_partner(auth.uid())` (misleading name kept from the anon era).
- Triggers: none.
- Notes: the client-side rollup into jobs.supplement_value is a denormalization the DB doesn't own (problem 10).

### job_checklists — USED
- Purpose: per-job documentation checklist instance; items are HARDCODED in the component (WATER/MOLD arrays) and snapshotted, completions tracked as JSONB.
- Evidence: DocChecklist.jsx:113 (select), :124 (insert with items_snapshot), :164 (update completions/completed_at/completed_by).
- Prod stats: 19 live, ins 20 / upd 29 / del 2, last idx 2026-07-26 — actively used.
- Provenance: untracked.
- Columns: 12 total — 10 used, 0 uncertain, 2 dead.
  - `template_id` — DEAD: FK → dead checklist_templates; never written (DocChecklist doesn't read templates), 0 meaningful code refs.
  - `assigned_to` — DEAD: 0 job_checklists-context hits (the 4 code hits are conversations.assigned_to in messaging).
- Policies: `allow_authenticated_job_checklists` (ALL, authenticated) — BAND-AID — always-true.
- Triggers: `job_checklists_updated_at` — USED.
- Notes: the authoring→instance model (checklist_templates → job_checklists) was abandoned; the instance table thrives with a code-embedded template.

### checklist_templates — DEAD
- Purpose (intended): authoring table for reusable checklist definitions.
- Evidence trail: git grep -nw 'checklist_templates' across src/ functions/ scripts/ upr-mcp/ supabase/tests/ tests/ .github/workflows → 0 hits (codeIndex.js generated file excluded); fndefs grep \bchecklist_templates\b across all 399 function bodies → 0; not in views.json, prod-cron.json, publications.json; only inbound reference is the never-written job_checklists.template_id FK. DocChecklist builds items from hardcoded arrays (DocChecklist.jsx:40-85).
- Prod stats: 4 rows (seed), ins 4 / upd 0 / del 0, last idx scan 2026-03-04 — corroborates (stats-since-reset caveat noted).
- Provenance: untracked — predates schema-as-code (no migration mentions it).
- Columns: 10 total — 10 dead (dead with table).
- Policies: `allow_authenticated_checklist_templates` (ALL, authenticated, USING/CHECK true) — DEAD — on a dead table.
- Triggers: `checklist_templates_updated_at` — DEAD — maintains a dead table's updated_at.
- Notes: drop candidate for v2 together with job_checklists.template_id.

### claim_status_history — USED (write-only audit)
- Purpose: append-only log of claims.status transitions.
- Evidence: written by trg_claim_status_history → capture_claim_status_history (defensive EXCEPTION handler); read only by db-lane test supabase/tests/db_foundation_lifecycle_history.sql:36-49. No UI reads it yet.
- Prod stats: 130 live, ins 131, growing (last 2026-07-08).
- Provenance: `supabase/migrations/20260708_dbf_lifecycle_history.sql` (DB-Foundation).
- Columns: 5 total — 5 used (trigger writes claim_id/from_status/to_status; id/changed_at default).
- Policies: `claim_status_history_read` (SELECT, authenticated) — BAND-AID — always-true read; note: NO anon grant on this table (one of only two in the domain).
- Triggers: none on itself.
- Notes: healthy modern pattern (definer trigger writes, no client writes).

### job_real_flag_history — USED (write-only audit)
- Purpose: audit trail of jobs.is_real_job flag changes (the sold-job metric integrity trail after the 2026-07-03 bulk-demotion incident).
- Evidence: written by trg_job_real_flag_history_ins/_upd → record_job_real_flag_change (captures auth.uid()); read by supabase/tests/real_job_flag_audit_trail.test.js:61 (db-lane). The daily cron `upr_real_job_evidence_reconciler` audits the flag itself via get_real_job_evidence_mismatches (events domain) — it corroborates the ecosystem, not this table directly.
- Prod stats: 24 live, ins 24, last 2026-07-22 — actively fed.
- Provenance: `supabase/migrations/20260722_real_job_flag_audit_trail.sql`.
- Columns: 10 total — 10 used (all written by the trigger).
- Policies: `job_real_flag_history_select` (SELECT, authenticated) — BAND-AID — always-true read; no anon grant (good).
- Triggers: none on itself.

### job_number_sequences — USED
- Purpose: per-division/per-month job-number counter behind W-2607-001-style numbers.
- Evidence: generate_job_number (INSERT..ON CONFLICT DO UPDATE) called by trg_auto_job_number BEFORE INSERT on jobs; both are SECURITY INVOKER, so the authenticated policies below are load-bearing for every client-side job insert.
- Prod stats: 19 live, upd 682 — every job creation touches it (last idx 2026-07-28).
- Provenance: untracked (extended by 20260629_remodeling_division.sql).
- Columns: 3 total — 3 used.
- Policies: `job_number_sequences_insert` / `_select` / `_update` (authenticated, all true) — BAND-AID x3 — always-true, but note they are functionally required while generate_job_number stays INVOKER.
- Triggers: none.

### insurance_carriers — USED
- Purpose: managed lookup list of carriers for job/estimate forms.
- Evidence: get_insurance_carriers (CreateJobModal:174, Layout:153, NewEstimateModal:71, JobPage:380, TechNewJob:216, EstimateCreateForm:73), upsert/delete via managedLists.js:48-50 + ListsAndValues page; direct select CustomerPage.jsx:92.
- Prod stats: 29 live, ins 54 / del 25, seq 6,848 (hot lookup).
- Provenance: untracked.
- Columns: 7 total — 6 used, 1 dead.
  - `carrier_type` — DEAD: 0 code, 0 fns; get_insurance_carriers returns only id/name/short_name; upsert writes name/short_name/sort_order.
- Policies: `anon_read_carriers` (SELECT, actually TO authenticated) — DUPLICATED — redundant with the ALL policy. `anon_write_insurance_carriers` (ALL, actually TO authenticated) — BAND-AID — always-true write on a lookup any employee can edit (matches the quick-add UX, but unbounded).
- Triggers: none.

### job_assignments — DEAD
- Purpose (intended): per-employee job crew assignments with scheduling windows.
- Evidence trail: git grep -nw 'job_assignments' across all code scopes → 0 hits; embed-pattern grep `job_assignments\s*(\(|!)` → 0; fndefs → referenced ONLY by merge_jobs' child-sweep UPDATE (re-parenting rows that never exist); no view/cron/publication. Crew reality lives in appointment_crew + jobs.lead_tech_id/project_manager_id (scheduling domain).
- Prod stats: **0 rows ever** (ins 0 / upd 0 / del 0); idx 154 scans are merge_jobs sweeps/FK checks.
- Provenance: untracked.
- Columns: 13 total — 13 dead (dead with table).
- Policies: `allow_authenticated_job_assignments` (ALL, authenticated, true) — DEAD — on a dead table.
- Triggers: `assignments_updated_at` — DEAD.
- Notes: reached only via merge_jobs's mechanical sweep — dead-by-chain in practice.

### job_costs — DEAD
- Purpose (intended): itemized job costing (vendor invoices, receipts, unit costs).
- Evidence trail: git grep -nw 'job_costs' across all scopes → 0 hits; fndefs → only merge_jobs sweep; 20260701_crm_partner_rls_non_crm_tables.sql only re-scoped its policy. The live costing workflow is the hand-logged jobs.total_*_cost columns (collections-chat.js:239 calls those "deprecated/hand-logged" — neither model is actually maintained).
- Prod stats: **0 rows ever** (ins 0).
- Provenance: untracked.
- Columns: 16 total — 16 dead (dead with table).
- Policies: `allow_authenticated_job_costs` (ALL, authenticated, NOT is_crm_partner predicate) — DEAD — real predicate but guards a dead table.
- Triggers: none.
- Notes: FK → vendor_invoices (billing domain) also never exercised from this side.

### escalation_log — DEAD
- Purpose (intended): SMS answer-escalation ladder log (who was notified when an inbound message went unanswered).
- Evidence trail: git grep -nw 'escalation_log' across all scopes → 0; fndefs → 0 of 399 bodies; no cron/view/publication. FKs point at messages/conversations/employees (messaging domain) — the feature was never built.
- Prod stats: **0 rows ever** (ins 0), seq 139 (table-scan probes only), last_idx NULL.
- Provenance: untracked.
- Columns: 9 total — 9 dead (dead with table).
- Policies: `allow_authenticated_escalation_log` (ALL, authenticated, true) — DEAD.
- Triggers: none.

### homebuilding_build_projects — USED
- Purpose: saved home-build simulator projects (spec + tuned plan JSONB) for the owner-only homebuilding analysis vertical.
- Evidence: routed at /homebuilding/build behind MoroniRoute (App.jsx:463-465); NewBuildSimulator.jsx:111/259/294/299/305 via list/save/rename/duplicate/delete RPCs; AI workers functions/api/homebuilding-plan-tune.js, homebuilding-estimate.js.
- Prod stats: 0 live (ins 2 / del 2) — owner experiments, currently empty.
- Provenance: untracked (created outside migrations; only referenced by 20260708_dbf_p3_anon_rpc_revoke.sql).
- Columns: 7 total — 7 used.
- Policies: none of its own in my list — access is entirely via SECURITY DEFINER RPCs granted to ALL authenticated (route gate MoroniRoute is client-side only — see problem 4).
- Triggers: none.

### homebuilding_chats — USED
- Purpose: chat sessions for the owner's homebuilding AI analysis page.
- Evidence: /homebuilding route (MoroniRoute), HomebuildingAnalysis.jsx:446/493/528/535 via list/create/rename/delete RPCs.
- Prod stats: 1 live (ins 2 / upd 6 / del 1).
- Provenance: untracked. Columns: 4 total — 4 used. Policies: none assigned. Triggers: none.

### homebuilding_chat_messages — USED
- Purpose: messages within a homebuilding chat (user/assistant turns).
- Evidence: HomebuildingAnalysis.jsx:467 (get_homebuilding_chat_messages), :499/:511 (add_homebuilding_chat_message).
- Prod stats: 2 live (ins 4 / del 2). Provenance: untracked. Columns: 5 total — 5 used. Policies: none assigned. Triggers: none. FK chat_id → homebuilding_chats CASCADE.

### homebuilding_estimates — USED
- Purpose: saved AI cost-estimate snapshots from the homebuilding page.
- Evidence: HomebuildingAnalysis.jsx:762 (list), :790 (save), :822 (rename), :828 (delete).
- Prod stats: 0 live (ins 1 / del 1). Provenance: untracked. Columns: 6 total — 6 used. Policies: none assigned. Triggers: none.

## RPCs (74)

All are EXECUTE-granted to authenticated + service_role. "definer, no caller check" = SECURITY DEFINER whose body validates nothing about the caller (the domain-wide norm — see problem 4; not repeated in every row).

| function(args) | class | security | callers / evidence | notes |
|---|---|---|---|---|
| add_homebuilding_chat_message(chat_id,role,content) | used | definer | HomebuildingAnalysis.jsx:499,511 | owner-only page; gate is client-side |
| add_related_job(8 args) | used | definer | AddRelatedJobModal.jsx:90 | creates sibling job on same claim |
| assign_tasks_to_appointment(appt,task_ids[]) | used | definer | CreateAppointmentModal:178, EditAppointmentModal:168, Schedule:702, TechEdit/NewAppointment:271/256 | |
| capture_claim_status_history() | used | definer | trigger trg_claim_status_history on claims | defensive EXCEPTION wrapper (tested) |
| create_homebuilding_chat(title) | used | definer | HomebuildingAnalysis.jsx:493 | |
| create_room(7 args) | used | definer | roomDispatcher.js:52, TechAppointment:298, TechJobHub:120, PhotoCaptureButton:160 | p_client_id dedupe = offline replay contract |
| create_room_for_claim(7 args) | used | definer | TechClaimDetail.jsx:285 | |
| delete_homebuilding_build_project(id) | used | definer | NewBuildSimulator.jsx:305 | |
| delete_homebuilding_chat(id) | used | definer | HomebuildingAnalysis.jsx:535 | |
| delete_homebuilding_estimate(id) | used | definer | HomebuildingAnalysis.jsx:828 | |
| delete_insurance_carrier(id) | used | definer | managedLists.js:50 → ListsAndValues.jsx | dynamic dispatch via config |
| delete_reading(reading_id) | dead | definer | 0 code hits (grep -w all scopes; only generated codeIndex.js); 0 fn callers; not in cron/views | 10-min delete window enforced here is bypassable via table policy |
| delete_room(room_id) | dead | definer | 0 code hits; 0 fn callers | only writer of rooms.deleted_at — soft-delete unreachable from app |
| duplicate_homebuilding_build_project(id) | used | definer | NewBuildSimulator.jsx:299 | |
| generate_claim_number() | used | invoker | DEFAULT on claims.claim_number (tables-columns.json) | advisory-lock max-scan; second generator lives inline in create_job_with_contact (problem 7) |
| generate_job_number(division) | used | invoker | trigger_auto_job_number → trg_auto_job_number on jobs | invoker ⇒ job_number_sequences policies load-bearing |
| get_active_drying_jobs() | used | definer | OpsCards.jsx:41, useActiveDrying.js:16 | reads moisture_readings (0 rows → always empty today) |
| get_ar_invoices() | used | definer | ARDashboard:141, InvoicesList:78, ArAgingTab:62, InvoicesTab:48, FinancialCards:143, useCollections:24, collections-chat.js:415 | the LIVE AR feed (invoice-based) |
| get_ar_jobs() | dead | definer | 0 code hits (grep -w all scopes); 0 fn callers; not cron/view | superseded by get_ar_invoices — the abandoned AR-on-jobs feed (problem 5) |
| get_claim_demo_sheets(claim_id) | used | definer | ClaimPage.jsx:144, TechClaimDetail.jsx:248 | |
| get_claim_detail(claim_id) | used | definer | ClaimPage:65, ClaimCollectionPage:35, TechClaimAlbum:81, TechClaimDetail:243, TechRoomDetail:82 | returns write-orphaned cols (adjuster_contact_id, AR fields) |
| get_claim_jobs(claim_id) | used | definer | JobPage:89, OOPPricing:107, TechOOPPricing:173, DevTools:929 | |
| get_claim_rooms(claim_id) | used | definer | TechClaimDetail:246,291, TechRoomDetail:83 | filters deleted_at |
| get_claims_list() | used | definer | ClaimsList:66, ClaimPicker:34, TechClaims:86/89, DevTools:1521 | |
| get_contact_ltv(contact,org) | used | definer | CrmReports.jsx:110 | joins jobs for LTV; is_real_job gate |
| get_conversion_trend(start,end,org) | used | definer | CrmOverview:235, CrmReports:104 | heavy db-lane test coverage |
| get_crm_revenue_by_division(start,end) | used | definer | CrmOverview:236, CrmReports:103 | |
| get_crm_sales_summary(start,end) | used | definer | attributionData.js:218 | |
| get_customer_detail(contact_id) | used | definer | CustomerPage:87, CreateJobModal:168, NewInvoiceModal:48, TechNewJob:243, collections-chat.js:303 | reads jobs/job_notes/job_phases/job_phase_history |
| get_customers_list(search,limit,offset) | used | definer | Customers.jsx:30, DevTools:1520 | |
| get_dashboard_action_items(limit) | used | definer | OpsCards.jsx:86, useActionItems.js:20 | |
| get_estimator_leaderboard(start,end,org) | used | definer | CrmReports.jsx:105 | groups by jobs.estimator — a column nothing writes (problem 9) |
| get_homebuilding_build_project(id) | dead | definer | 0 code hits; 0 fn callers (NewBuildSimulator opens rows from the list RPC) | trivially re-addable if page grows |
| get_homebuilding_chat_messages(chat_id) | used | definer | HomebuildingAnalysis.jsx:467 | |
| get_insurance_carriers() | used | definer | 8 call sites (CreateJobModal:174, Layout:153, NewEstimateModal:71, JobPage:380/394, TechNewJob:216/353, EstimateCreateForm:73, managedLists) | |
| get_job_hub(job_id) | used | definer | TechJobHub.jsx:73 (react-query) + tech_v2_h1 contract test | the tech-v2 frame |
| get_job_labor_summary(job,start,end) | used | definer | TimeTracking.jsx:885, collections-chat.js:371 | |
| get_job_readings(job_id) | used | definer | TechAppointment:318, HubTools:82 | |
| get_job_rooms(job_id) | used | definer | TechAppointment:268/290/304, TechJobHub:107, PhotoCaptureButton:67/155/164, HubDock:149/153, PhotosNotes:146/151 | |
| get_job_task_pool(job_id) | used | definer | JobPanel.jsx:77,127,151 | |
| get_job_task_summary(job_id) | used | definer | ClaimPage:112, JobPage:87, TechClaimDetail:264, DevTools:935 | |
| get_jobs_closed(floor) | used | definer | WorkCards:43, useJobsClosed:78, jobsClosed.js:63 + db-lane test | THE canonical sold-job rule (is_real_job) |
| get_jobs_completed(start,end) | used | definer | WorkCards:78, useJobsCompleted:17 | |
| get_jobs_list(search,limit,offset) | dead | definer | 0 app hits; only supabase/tests/uxq_fb_rpcs.{sql,test.js} (test-only reference) | Jobs.jsx uses a direct 55-column select instead — built-but-unadopted pagination RPC |
| get_real_claims_created(floor) | dead | definer | 0 code hits; 0 fn callers; not in cron | claims-based twin of get_jobs_closed that never got a consumer |
| get_stalled_materials(job_id) | used | definer | called by get_stalled_materials_for_employee (fndefs) → StalledWidget.jsx:51 | used via chain |
| get_tech_claims(employee_id) | used | definer | TechClaims.jsx:83 (falls back to get_claims_list) | |
| get_unassigned_tasks(job_id) | used | definer | CreateAppointmentModal:58/122, EditAppointmentModal:123, TechEditAppointment:140/197, TechNewAppointment:121/168/194 | |
| get_water_loss_report_data(job_id) | used | definer | functions/api/generate-water-loss-report.js:62 | worker-only caller |
| insert_reading(15 args) | used | definer | readingDispatcher.js:69, TechAppointment:361, HubTools:126 | ON CONFLICT (client_id) replay-safe; auto dry-standard logic |
| list_homebuilding_build_projects() | used | definer | NewBuildSimulator.jsx:111 | |
| list_homebuilding_chats() | used | definer | HomebuildingAnalysis.jsx:446 | |
| list_homebuilding_estimates() | used | definer | HomebuildingAnalysis.jsx:762 | |
| log_phase_change() | used | invoker | trigger trg_log_phase_change on jobs | co-writer with client inserts (problem 3) |
| mark_job_real(job_id,source) | used | definer | trg_estimate_real_job (estimates), trg_invoice_real_job (invoices), trg_signreq_real_job (sign_requests) — via fndefs + triggers.json | evidence-based real-job promotion; first-source-wins COALESCE |
| merge_claims(keep,merge) | used | definer | MergeModal.jsx:62 RPC_MAP dynamic dispatch | destructive; definer, no caller check |
| merge_jobs(keep,merge) | used | definer | MergeModal.jsx:62 | 30-column COALESCE sweep is the measure of jobs↔claims duplication; payment-conflict guard present |
| record_job_real_flag_change() | used | definer | triggers trg_job_real_flag_history_ins/_upd on jobs | captures auth.uid() as actor |
| rename_homebuilding_build_project(id,label) | used | definer | NewBuildSimulator.jsx:294 | |
| rename_homebuilding_chat(id,title) | used | definer | HomebuildingAnalysis.jsx:528 | |
| rename_homebuilding_estimate(id,label) | used | definer | HomebuildingAnalysis.jsx:822 | |
| save_homebuilding_build_project(id,label,region,spec,plan) | used | definer | NewBuildSimulator.jsx:259 | |
| save_homebuilding_estimate(label,region,spec,estimate) | used | definer | HomebuildingAnalysis.jsx:790 | |
| set_job_real_job(job_id,is_real,actor) | used | definer | JobPage.jsx:120 + real_job_flag_audit_trail test | manual promote/demote; metric-defining, any authenticated caller |
| sync_job_to_claim() | band-aid | definer | trigger trg_sync_job_to_claim on jobs | exists solely to keep duplicated jobs↔claims columns aligned (one-way, guarded overwrite) |
| toggle_job_task(task_id,employee_id) | used | definer | EditAppointmentModal:110, JobPanel:255 | |
| trg_appt_calendar_sync() | used | definer | trigger trg_appointments_calendar_sync on appointments (scheduling-domain table) | Google-calendar outbox nudge; cross-domain |
| trigger_auto_job_number() | used | invoker | trigger trg_auto_job_number on jobs | |
| trigger_claim_events() | used | invoker | trigger trg_claim_events on claims | system_events feed |
| trigger_job_events() | used | invoker | trigger trg_job_events on jobs | system_events feed |
| update_job_tasks_updated_at() | used | invoker | trigger trg_job_tasks_updated_at on job_tasks | |
| update_reading(11 args) | dead | definer | 0 code hits; 0 fn callers; not cron/view | carries the 10-min immutability rule + edited_at/edited_by audit — designed, never wired to UI |
| update_room(5 args) | dead | definer | 0 code hits; 0 fn callers | room rename/resize UI never built |
| upsert_insurance_carrier(id,name,short_name,sort_order) | used | definer | CreateJobModal:180, JobPage:393, TechNewJob:352, managedLists.js:49 | quick-add pattern |

## Structural problems (ranked, worst first)

1. **Live anon write path on the core tables** — severity 5. `anon` retains ALL table privileges on 20 of 22 domain tables (grants.json), and jobs/claims/job_phase_history additionally carry permissive anon RLS policies: `allow_anon_insert_jobs`, `allow_anon_update_jobs`, `anon_insert_claims`, `anon_update_claims`, `allow_anon_insert_phase_history`, plus `claims_anon_delete` whose `NOT is_crm_partner(auth.uid())` predicate evaluates TRUE for anon (auth.uid() NULL) — so the browser-bundled anon key can insert, update, read, and even delete claims without login. The P3 anon-closure test (supabase/tests/db_foundation_p3_anon_closure.sql:26-49) records jobs/job_phase_history/claims as a TEMPORARY deferred list, but nothing in this domain has closed them; the other 17 tables are grant-exposed but policy-blocked (latent, one CREATE POLICY away).
2. **jobs duplicates the claim's identity across ~12 columns, patched by a sync trigger** — severity 4. insurance_company/insurance_carrier, claim_number, policy_number, date_of_loss, address/loss_address(+city/state/zip), adjuster fields exist on BOTH jobs and claims; `trg_sync_job_to_claim` one-way-syncs three of them with only-if-unchanged guards, the rest drift freely; merge_jobs must COALESCE 30+ columns to survive it. v2's single biggest normalization win.
3. **job_phase_history has two competing writers** — severity 4. `trg_log_phase_change` (BEFORE UPDATE on jobs) inserts a history row with duration_hours, AND three client sites (JobPage.jsx:108, Production.jsx:179, JobDetailPanel.jsx:38) insert their own row with changed_by on the same phase change → doubled rows, each carrying only half the data. Prod ins=95/del=81 is consistent with periodic manual dedup.
4. **SECURITY DEFINER-by-default with zero caller validation** — severity 3. 68 of 74 functions are DEFINER and EXECUTE-granted to all authenticated; a body scan found no auth.uid()/role checks in any of them (record_job_real_flag_change reads auth.uid() only for attribution). Concretely: merge_jobs/merge_claims (destructive), set_job_real_job (defines the revenue metric), and the entire homebuilding family (whose only gate is the client-side MoroniRoute) are callable by any logged-in employee via PostgREST.
5. **AR-on-jobs abandoned mid-migration** — severity 3. Collections moved to invoice-based get_ar_invoices, leaving get_ar_jobs dead and jobs.ar_notes/last_followup_date/deductible_collected/deductible_collected_date write-orphaned (still returned by get_claim_detail and rendered in two tech surfaces as permanently-stale data). ar_status/invoiced_date survive only via billing-side trigger writes.
6. **Reading/room immutability designed in the DB but unreachable and bypassable** — severity 3. update_reading/delete_reading enforce a 10-minute edit window with edited_at/edited_by audit, and delete_room implements soft-delete — but no UI calls any of them (all four dead), AND the always-true `moisture_authenticated_all`/`rooms_authenticated_all` ALL policies let any authenticated client UPDATE/DELETE the rows directly, bypassing the window entirely. Either the rule matters (then close the direct-write path in v2) or it doesn't (then drop the RPCs and edited_* columns).
7. **Two claim-number generators** — severity 2. `generate_claim_number()` (advisory lock + max-scan + setval, wired as claims.claim_number DEFAULT) vs `create_job_with_contact`'s inline `'CLM-'||to_char(now(),'YYMM')||'-'||lpad(nextval('claim_number_seq'))` — different algorithms feeding the same number space; the max-scan one resyncs the sequence, the inline one trusts it. Consolidate in v2.
8. **Four dead planned-vertical tables** — severity 2. job_costs (itemized costing; 0 rows ever) lost to hand-logged jobs.total_*_cost columns that themselves have no live writer; job_assignments (0 rows) lost to appointment_crew; checklist_templates lost to hardcoded component arrays; escalation_log (SMS escalation) never built. All carry policies/triggers/FKs that cost comprehension.
9. **Employee-name TEXT columns beside (or instead of) FKs** — severity 2. project_manager(text, Encircle-written)+project_manager_id(FK) both live; adjuster(text)+adjuster_name(text) duplicate one fact; lead_tech(text) dead beside lead_tech_id; estimator/supervisor text-only with NO writer — yet get_estimator_leaderboard groups by jobs.estimator and get_tech_status_board reads supervisor, so two live features silently run on unmaintained columns.
10. **Client-owned financial denormalizations on jobs** — severity 2. invoiced_value is both hand-editable (JobPage RevenueTile:575) and trigger-written (sync_job_invoiced_from_invoices); supplement_value is a client-computed rollup (JobPage:600); total_*_cost are hand-logged with no writer. collections-chat.js:239 already warns these "can disagree" with QBO/invoices. Pick one owner per number in v2.

## Open questions for the owner

1. Homebuilding (NewBuildSimulator + HomebuildingAnalysis, Moroni-only routes): is this a keeper for v2's schema, or should it live outside the operational database (it shares nothing with jobs/claims)?
2. job_costs vs jobs.total_*_cost: do you want itemized job costing back as a real workflow in v2, or is per-job cost tracking dead as a business practice? (Both models currently have zero live writers.)
3. get_estimator_leaderboard reads jobs.estimator, which nothing in the app sets — who/what maintains estimator attribution today, and should v2 source it from estimates instead?
4. Deductible tracking on jobs (deductible_collected/_date, last_followup_date, ar_notes): now that collections run on invoices, is any of the per-job AR state still business-relevant, or can v2 drop the whole AR-on-jobs column family?
5. Is the 10-minute moisture-reading edit window a real documentation/compliance requirement (insurance audit posture)? If yes, v2 must make direct table writes impossible; if no, the update/delete reading RPCs and edited_at/edited_by can go.
6. moisture_readings and job_supplements have working UIs but zero production rows — is Hydro drying documentation (and supplement logging) expected to become real usage, or should v2 descope them?
7. Phase history: do you want changed_by (who), duration_hours (how long), or both on a phase change? Today two writers each record half, in duplicate rows.
8. checklist_templates: the checklist content now lives hardcoded in DocChecklist.jsx — should v2 keep checklists code-defined (drop the tables' template half) or restore DB-driven templates so office staff can edit them?

## Search appendix

- Scopes searched for every object name: `src/ functions/ scripts/ upr-mcp/ supabase/tests/ tests/ .github/workflows/` via `git grep -nw <name>` (word-boundary, all tracked file types). `upr-mcp/src/codeIndex.js` hits were excluded everywhere — it is an auto-generated keyword map (header: "AUTO-GENERATED by npm run build-index"), not call sites.
- Function-body evidence: parsed all `catalog/fndefs-q*.sql` into 399 name→body pairs; regex `\b<name>\b` per table/RPC/column. Trigger bindings from catalog/triggers.json; cron from prod-cron.json (none of this domain's RPCs are cron-called; the real-job reconciler calls get_real_job_evidence_mismatches, events domain); views.json (only rv_jobs touches this domain — itself test-only); publications.json (none of my tables are in supabase_realtime); embed-pattern grep `<table>\s*(\(|!)` for the zero-hit tables → 0.
- prod-fn-stats.json is EMPTY (track_functions off) — no per-function call counts were available; RPC verdicts rest entirely on code/fndefs/trigger/cron evidence. Table stats are since-last-reset and treated as corroboration only.
- Dead-RPC trails all followed the same protocol: grep -w across all seven scopes (zero hits outside the generated index), fndefs caller scan (zero, except chains noted), cron/view/trigger checks (zero). For get_jobs_list the only hits are supabase/tests/uxq_fb_rpcs.sql:86-95 and its .test.js — classified dead "(test-only reference)".
- upr-mcp exposes a generic `upr_rpc` tool that can call ANY function ad hoc (owner automation); per protocol this generic capability was not counted as usage for specific RPCs.
- Column method: per-column `git grep -cw` across code scopes + fndefs cross-reference restricted to functions that also reference the owning table; RPC-mediated tables (moisture_readings, rooms) were adjudicated by parameter mapping in the RPC bodies (p_mc→mc_pct etc.), so zero raw-name code hits there do NOT imply dead. Generic-name columns on used tables with no positive site were bucketed UNCERTAIN, never dead. "UNCERTAIN" was also used for read-live-but-write-orphaned columns (claims.adjuster_contact_id; jobs.estimator/supervisor/ar_notes/last_followup_date/deductible_collected/_date; moisture_readings.edited_at/edited_by) — each is returned by a live RPC but has no writer, so it is reachable-but-inert; flagged rather than declared dead.
- Ambiguities/limits: (a) I could not verify JobDetailPanel.jsx:59's dynamic update payload field-by-field; it may write fields I attributed to other writers (does not change any verdict). (b) jobs.ar_status/invoiced_date writers (update_invoice_paid, sync_job_invoiced_from_invoices) are billing-domain functions — their liveness is that domain's to confirm; I assumed live. (c) trigger_note_events and create_draft_invoice_for_job are other domains' functions bound to my tables' triggers — triggers classified here, functions left to their owners. (d) Prod stats predate an unknown reset; "0 rows ever" claims combine ins=0 counters with zero code paths, not stats alone.
- Counts cross-check: tables 18u+4d=22; RPCs 65u+8d+1b=74; policies 5u+25b+6dup+4d=40; triggers 12u+1b+2d=15; columns 221u+12unc+64d+2dup=299 (64 dead = 48 inherited from the 4 dead tables + 16 individually-dead on live tables).

---

## Amendment — non-app-code blind-spot sweep (2026-07-29)

Every dead claim above was re-checked against the four surfaces application-code search cannot see: (1) repo-root and `docs/` runbooks **executed** against production, (2) recent data-repair migrations that are writes rather than DDL, (3) `UPR-Web-Context.md` annotations naming external consumers this repository cannot inspect, (4) doc-designated computation contracts whose callers are unobservable because `track_functions` is off in production.

**Result: 5 reclassified, 29 survived as dead.**

### Reclassified — no longer dead

- **rpc `get_real_claims_created(p_floor timestamp with time zone)`** → uncertain — owner-executed reconciliation runbook *(surface 1)*
  - Q2-2026-RECONCILIATION-PLAN.md:99 (Phase 7 final verification & sign-off) prescribes executing it: "Re-run `get_real_claims_created` for Apr/May/Jun → confirm the numbers match the Encircle-verified ledger." That reconciliation is still OPEN — Q2-RECON-TASK.md:13 is a live repo-root running punch list ("OPEN — mine to do", kept in place per CLAUDE.md Task File Protocol) and Phase 7 is not in the plan's "already done" list (Q2-2026-RECONCILIATION-PLAN.md:20-27). Corroborated by UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md:140 naming it as the real-claims counter ("Dashboard: `get_real_claims_created(p_start)` and `useNewClaims` count only claims with ≥1 real job") and RECONCILIATION-HANDOFF.md:392. The owner runs RPCs ad hoc through the upr-mcp `upr_rpc` tool, which leaves no code trace — so the mapper's 0-code-hits finding cannot see this caller.
- **rpc `get_jobs_list(p_search text, p_limit integer, p_offset integer)`** → dormant contract — designated consumer in an open initiative *(surface 4)*
  - docs/ux-motion-ui-rollout-dispatch.md:278 prescribes it as THE mechanism for a named perf fix ("Replace unbounded ~50-column no-limit list fetches (Jobs/Production) with get_jobs_list"); :363 and :271 assign it to wave W5; docs/ux-quality-roadmap.md:197 and docs/ux-quality-dispatch.md:90 carry the same contract. .claude/rules/initiative-status.md lists "UX alignment W1–W5" as an OPEN initiative (stalled since 2026-07-18, owner may restart — not cancelled). Live infrastructure was applied for it after the RPC shipped: supabase/migrations/20260713_uxq_perf_indexes.sql:89 built a partial+covering index that "future-proofs get_jobs_list's" query and :49 records its measured plan (1.05 ms). Built, indexed, and doc-designated — unadopted, not dead.
- **column `rooms.encircle_room_id`** → uncertain — external-system import identity *(surface 3)*
  - UPR-Web-Context.md:648-649 annotates it (with encircle_structure_id) as "added later, undated — links a room back to its Encircle source when imported" — Encircle is an external system this repo integrates with but does not control. docs/db-foundation-p4-orphan-report.md:22 and supabase/migrations/20260708_dbf_p4_external_id_unique_clean.sql:21 classify it as a 1:1 external import-identity column that is "ALREADY unique from prior migrations". The live catalog confirms `rooms_encircle_room_id_idx` — CREATE UNIQUE INDEX ... WHERE (encircle_room_id IS NOT NULL AND deleted_at IS NULL), an import-dedup guard. Decisive detail: NO migration in supabase/migrations/ creates the column or that index (git grep encircle_room_id -- supabase/ returns only the P4 comment), so both were provisioned outside schema-as-code by a writer this repository cannot see.
- **column `rooms.encircle_structure_id`** → uncertain — external-system reference *(surface 3)*
  - Same UPR-Web-Context.md:648-649 annotation naming Encircle as the external source. docs/db-foundation-p4-orphan-report.md:25 does not treat it as unused — it deliberately classifies it among "foreign catalog/parent references (not per-row identities)" that are "correctly not uniqueness candidates", i.e. the live data-integrity survey adjudicated it as a real Encircle structure reference. Like encircle_room_id it is untracked — no migration in supabase/migrations/ adds it. Weaker than encircle_room_id (no unique index), but same external annotation and same invisible provenance.
- **column `job_notes.encircle_note_id`** → uncertain — external-system import identity *(surface 3)*
  - docs/db-foundation-p4-orphan-report.md:22 and supabase/migrations/20260708_dbf_p4_external_id_unique_clean.sql:21 name it among the 1:1 Encircle import-identity columns that "already carry a UNIQUE index from prior migrations". Live catalog confirms `job_notes_encircle_note_id_idx` = CREATE UNIQUE INDEX ON public.job_notes (encircle_note_id) WHERE encircle_note_id IS NOT NULL — distinct from `forms_encircle_note_id_uniq`, and created by no migration in the repo. The mapper is right that the two code hits (encircle-upload.js:3, TechDemoSheet.jsx:1271) refer to forms.encircle_note_id, but the job_notes column carries its own live, untracked Encircle import-dedup guard.

### Kill-notes — dependencies a future DROP must carry (Phase P5)

- **job_costs (table)**
  - merge_jobs() — a LIVE, actively-executed RPC — runs `UPDATE job_costs SET job_id = p_keep_id WHERE job_id = p_merge_id;` (catalog/fndefs-q3-06.sql:431). Dropping the table makes merge_jobs fail at runtime on its next call. merge_jobs is not hypothetical: MergeModal.jsx:62 dispatches it AND Q2-2026-RECONCILIATION-PLAN.md:91 (Phase 6 Dedupe) prescribes "Merge with `merge_claims(keep, merge)` / `merge_jobs`" as owner-run reconciliation work. P5 must edit merge_jobs in the SAME change.
- **job_assignments (table)**
  - merge_jobs() runs both `DELETE FROM job_assignments WHERE job_id = p_merge_id AND (employee_id, scheduled_date) IN (...)` and `UPDATE job_assignments SET job_id = p_keep_id ...` (catalog/fndefs-q3-06.sql:447-451). Same live-merge breakage as job_costs — edit merge_jobs in the same change.
- **jobs.lead_source_detail (column)**
  - Projected in merge_jobs()'s COALESCE sweep: `lead_source_detail = COALESCE(lead_source_detail, v_merge.lead_source_detail)` (catalog/fndefs-q3-06.sql:405). Postgres will refuse the DROP COLUMN or the function will break on next call — merge_jobs must be replaced in the same migration.
- **jobs.lead_tech (column)**
  - Projected in merge_jobs()'s COALESCE sweep: `lead_tech = COALESCE(lead_tech, v_merge.lead_tech)` (catalog/fndefs-q3-06.sql:407). Same merge_jobs replacement required. Do not confuse with lead_tech_id, which is live and used.
- **jobs.lead_converted_at (column)**
  - Projected TWICE by the live `rv_jobs` reporting view — as `lead_converted_at` and as `mt_date(lead_converted_at) AS converted_day` (supabase/migrations/20260708_dbf_p6_reporting_views.sql, catalog/views.json). `ALTER TABLE jobs DROP COLUMN lead_converted_at` will fail without CASCADE, and CASCADE would silently drop rv_jobs. Requires rebuilding rv_jobs; the guard supabase/tests/db_foundation_p6_reporting_views.test.js uses `select=*` so it will not catch a column loss, only a dropped view. Exact same shape as the billing domain's invoices.carrier_name / payments.is_depreciation_release.
- **checklist_templates (table)**
  - Inbound FK from a LIVE, actively-used table: `job_checklists_template_id_fkey FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE SET NULL` (catalog/fks.json). job_checklists is live (19 rows, upd 29, last used 2026-07-26). Drop job_checklists.template_id FIRST, then the table — or the DROP fails.
- **job_checklists.template_id (column)**
  - Ordering dependency with the above — it IS the FK to checklist_templates. Must be dropped before (or together with) checklist_templates, and it lives on a live table, so the ALTER touches a hot table (job_checklists) rather than a zero-row one.
- **get_jobs_list(p_search, p_limit, p_offset) (rpc)**
  - EXECUTED by the live CI db lane: supabase/tests/uxq_fb_rpcs.test.js:60-62 calls `db.rpc('get_jobs_list', ...)` as a negative-authorization assertion, and supabase/tests/uxq_fb_rpcs.sql:87,90 calls `get_jobs_list(NULL, 5, 0)`. .claude/rules/initiative-status.md records the db lane as SEEDED/LIVE against qa-staging (.github/workflows/ci.yml:142-167 → npm run test:db:branch). Dropping it reddens CI. Exact save_estimate_lines precedent.
- **checklist_templates_updated_at + assignments_updated_at (triggers)**
  - Both call the SHARED function `update_updated_at()`, which backs 8 triggers total — checklist_templates, forms, job_assignments, job_checklists, job_schedules, jobs, schedule_templates, storage.objects (docs/schema-v2/domains/auth.md:188). Dropping the two dead tables drops these two triggers automatically, which is fine — but P5 must NOT drop update_updated_at() itself; 6 live triggers still depend on it.
- **job_costs.vendor_invoice_id (cross-domain FK)**
  - `job_costs_vendor_invoice_id_fkey FOREIGN KEY (vendor_invoice_id) REFERENCES vendor_invoices(id)` (catalog/fks.json). vendor_invoices is the billing domain's dead-vendor-module table (docs/schema-v2/domains/billing.md:148,217) and is annotated in UPR-Web-Context.md:719 area as tied to the external Netlify vendor app. Sequence the two domains' drops together; job_costs must go before or with vendor_invoices.
- **delete_room(p_room_id) (rpc)**
  - Not a hard DROP dependency, but it is the ONLY writer of `rooms.deleted_at`, and three LIVE RPCs filter on that column (get_job_rooms, get_claim_rooms, get_water_loss_report_data). Dropping the RPC permanently removes the soft-delete capability those filters were built for. Decide the soft-delete story before dropping, or the filters become permanently dead predicates.

### Sweep coverage notes

SWEEP RESULT: 5 of 30 dead claims reclassified — well below billing's ~half, and I re-checked coverage before concluding, as instructed. The structural reason for the gap is real, not sloppiness: billing's live surfaces are OWNER-RUN MONEY RUNBOOKS (UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md contains canonical INSERT INTO invoices recipes). The Jobs & Claims domain has the mirror-image property — the reconciliation runbooks touch jobs/claims/invoices heavily, but they touch the LIVE columns (claim_id, date_of_loss, is_real_job, invoice_date), never the dead planned-vertical tables. The one runbook write into a domain table I found is UPR-QBO-SYNC-PROTOCOL.md:73 `UPDATE rooms SET claim_id = <keep>` — rooms.claim_id is already classified USED, so it changes nothing.

SURFACE-BY-SURFACE COVERAGE (all four swept, all tracked files, archive excluded as history):
- Surface 1 (executed runbooks): grepped every *.md for INSERT INTO / UPDATE naming the 22 domain tables → exactly one hit (UPR-QBO-SYNC-PROTOCOL.md:73, live column). Grepped all *.md for the 8 dead RPC names → the get_real_claims_created hits are the reclassify. No MCP recipe or psql snippet names any dead table/column.
- Surface 2 (recent repair migrations that WRITE): enumerated 2026-06-onward migrations whose bodies contain INSERT/UPDATE against domain tables (9 files, incl. the dorothy_killian precedent 20260727222000). NONE writes any dead object. 20260721_customer_activity_and_claim_creator.sql:218-226 reads job_notes but projects only created_at/body/job_id/author_name — all live columns, no note_type/is_pinned/related_form_id. 20260701_crm_partner_rls_non_crm_tables.sql:102-103 only re-scopes the job_costs POLICY (DDL, not a write).
- Surface 3 (external-consumer annotations): produced 3 of the 5 reclassifications, all Encircle-identity columns. UPR-Web-Context.md's one-line entries for the four dead TABLES (:551 job_assignments, :553 job_costs, :572 checklist_templates, :719 escalation_log) are bare descriptions naming no external app — note that :720 email_sync_log IS annotated "(vendor invoice app)", so the doc does mark external consumers when they exist and deliberately did not mark these.
- Surface 4 (doc-designated computation contracts): produced get_jobs_list; get_real_claims_created is corroborated here too.

TWO ANTI-FINDINGS THE SYNTHESIZER SHOULD TRUST:
1. get_ar_jobs is the most confidently dead object in the domain — two independent docs affirmatively retire it AND pre-authorize the drop: QBO-BILLING-STATUS.md:93 ("remain in the DB (harmless, unused) — drop later if desired") and :122 ("Drop deprecated billing_overview / get_ar_jobs once confident"), plus BILLING-AR-CONSUMER-CHAIN.md:148,328. Caveat for doc hygiene: UPR-Web-Context.md:740 still advertises it in the live RPC catalog — that entry is stale and should be removed with the drop.
2. tests/qa/unit/** and .github/workflows/** contain ZERO references to any object on this list. The only test-lane exposure in the whole domain is get_jobs_list via supabase/tests/uxq_fb_rpcs.{sql,test.js}.

PROVENANCE FLAG WORTH ESCALATING: rooms.encircle_room_id, rooms.encircle_structure_id and the unique index job_notes_encircle_note_id_idx exist LIVE but are created by no migration in supabase/migrations/ — untracked schema applied outside schema-as-code. supabase/migrations/20260708_dbf_p4_external_id_unique_clean.sql:20-21 asserts they are unique "from prior migrations", which is factually wrong; no such migration exists in the repo. That doc error is why a code-only pass reads them as inert. Anything provisioned outside schema-as-code has, by definition, a writer this repository cannot enumerate — which is exactly the blind spot this sweep exists to catch, so I reclassified rather than trusting the zero-hit grep.

CALIBRATION NOTE ON jobs.lead_converted_at: I deliberately did NOT reclassify it despite rv_jobs projecting it twice, because the billing sweep's stated precedent puts view-projected columns in kill_notes (invoices.carrier_name, payments.is_depreciation_release), not in reclassify. Keeping that consistent matters for cross-domain synthesis. But note the asymmetry: supabase/migrations/20260708_dbf_p6_reporting_views.sql:14-15 states plainly "no widget consumes them yet, so they are purely additive scaffolding" — so unlike billing's rv_invoices, rv_jobs is self-declared consumer-less. If the owner has since pointed any external BI client or spreadsheet at rv_jobs (granted SELECT to authenticated + service_role), lead_converted_at and its derived converted_day become externally visible and this should flip to uncertain. That is one owner question, not a repo-answerable one.

DOMAIN-SPECIFIC RISK P5 SHOULD KNOW: merge_jobs() is the single highest-leverage kill blocker here — it mechanically sweeps job_costs, job_assignments, jobs.lead_source_detail and jobs.lead_tech by name (4 of my 30 claims), it is executed by owner reconciliation work (Q2-2026-RECONCILIATION-PLAN.md:91), and it is a 30-column COALESCE monolith. Any P5 tranche that drops even one of those four MUST ship a replaced merge_jobs body in the same migration, with a backward-compat test that MergeModal.jsx:62's call still succeeds (AGENTS.md §13 frontend-contract freeze).
