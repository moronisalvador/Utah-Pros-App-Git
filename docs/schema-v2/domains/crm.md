# Domain: CRM & Leads

The intake-to-sale funnel: CallRail calls and web forms land in `inbound_leads` (via two service-role upsert RPCs), get AI-enriched (transcription, spam, auto-advance), move through a kanban pipeline (`lead_pipeline_stage` / `pipeline_stages` / `lead_stage_history`), and roll up into attribution/reporting RPCs. `contacts` is the platform-wide person record (messaging, billing/QBO, jobs, e-sign all hang off it). The domain is young (built July 2026 as the flag-gated `page:crm` wave) and mostly healthy on the usage axis — **29/31 tables and 86/92 RPCs are live** — but almost entirely flat on the authorization axis: 30/39 policies are `USING (true)` to `authenticated`, 85 of 88 SECURITY DEFINER RPCs carry no caller check, and **`crm_automations`/`crm_automation_runs` are readable AND writable by `anon`**. Dead weight: the never-wired Phase-9 lead-scoring stack (`score_lead`, `lead_score_factors`, `inbound_leads.lead_score`), the empty `contact_tags` relation (lost to `contacts.tags` jsonb), and four caller-less RPCs. One naming trap: the `forms` table is the tech demo-sheet store, not the CRM form product.

Headline counts: tables 31 (29 used / 2 dead) · columns 365 (346 used / 2 uncertain / 15 dead / 1 band-aid / 1 duplicated) · RPCs 92 (86 used / 5 dead / 1 band-aid) · policies 39 (6 used / 30 band-aid / 2 dead / 1 duplicated) · triggers 4 (4 used).

Method note: all "prod" numbers are production `pg_stat` counters since last stats reset (corroborating signal only, never sole proof). `upr-mcp/src/codeIndex.js` hits are an AUTO-GENERATED keyword index (metadata, not call sites) and were discounted everywhere. No CRM table is in the realtime publication; no CRM table is read by a code-consumed view (`rv_leads` exists but has zero code readers — db-lane test only).

## Tables (31)

### ad_spend — USED
- Purpose: daily per-platform/per-campaign ad spend (Google/Meta) for attribution ROI.
- Evidence: written via `upsert_ad_spend` from `functions/api/sync-google-ads.js:110` and `functions/api/sync-meta-ads.js:96`; read directly by `functions/api/weekly-crm-digest.js:216` (`db.select('ad_spend', …)`) and inside `get_attribution_rollup` / `get_attribution_by_campaign` (fndefs).
- Prod stats: live 0, ins 3 / upd 1 / del 3, last idx scan 2026-07-28. **Live paths exist but the table is currently empty in production** — spend sync is not producing durable rows.
- Provenance: `supabase/migrations/20260701_crm_phase2_adspend.sql`.
- Columns: 12 total — 12 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated.
  - `platform_conversions` — used, write-only: synced by meta-ads worker; `functions/lib/meta-ads.js:45` says "deliberately informational only (per the roadmap)"; no UI reader.
- Policies: `ad_spend_all` (ALL, authenticated) — BAND-AID — `USING (true)/CHECK (true)`; any logged-in user can rewrite spend data.
- Triggers: none.
- Notes: unique key (platform, campaign_id, date) enforced inside `upsert_ad_spend`. Attribution reads join on date windows.

### contact_addresses — USED
- Purpose: multiple labeled service/billing addresses per contact.
- Evidence: `src/pages/CustomerPage.jsx:309/313/314` (`upsert_contact_address`, `delete_contact_address`); `functions/api/encircle-import.js:210` and `encircle-backfill.js:196` write via REST; read embedded in `get_customer_detail` (jobs domain) and used by `create_job_with_contact` (fndef).
- Prod stats: live 139, ins 150 / upd 13 / del 0, last idx 2026-07-28.
- Provenance: untracked — predates schema-as-code.
- Columns: 11 total — 11 used, 0 uncertain, 0 dead, 0 band-aid, 0 duplicated (all fields collected by the CustomerPage address form and returned by `get_customer_detail`).
- Policies: `ca_select` / `ca_insert` / `ca_update` / `ca_delete` (per-cmd, authenticated) — all four BAND-AID — every predicate is `true`; split-by-command shape without any actual scoping.
- Triggers: `trg_contact_addresses_updated_at` — USED — standard BEFORE UPDATE touch of `updated_at` via `update_contact_addresses_updated_at()`.
- Notes: FK → contacts. `merge_contacts` re-parents rows on merge.

### contact_jobs — USED
- Purpose: contact↔job link rows with role/primary flag (the person-to-job join the whole app uses).
- Evidence: `src/components/SendEsignModal.jsx:64` and `src/pages/tech/TechJobDocuments.jsx:115` (`db.select('contact_jobs', …)`); written inside `create_job_with_contact`, `add_related_job`, `merge_contacts` (fndefs); read by `get_job_contacts`, `get_orphan_contacts`.
- Prod stats: live 242, ins 279 / upd 13 / del 48, idx scans 90,986 (hot join table).
- Provenance: untracked — predates schema-as-code.
- Columns: 7 total — 6 used, 1 uncertain, 0 dead, 0 band-aid, 0 duplicated.
  - `notes` — uncertain: generic name; only writer that accepted a notes param was the dead `link_contact_to_job`; no live writer or reader found, but rows ride `select=*` payloads.
- Policies: `contact_jobs_anon_select/insert/update/delete` (per-cmd, roles actually `authenticated` despite the `anon_` names) — all four BAND-AID — `USING (true)`; names are a rename vestige of the closed anon era.
- Triggers: none.
- Notes: FKs → contacts, jobs (jobs domain owns `jobs`).

### contact_tags — DEAD
- Purpose (intended): normalized per-contact tag rows.
- Evidence trail (dead): grep `\bcontact_tags\b` (patterns `'contact_tags'`, `"contact_tags"`, bare word) across src/, functions/, scripts/, upr-mcp/, supabase/tests/, tests/, .github/workflows → **1 hit**, `upr-mcp/src/codeIndex.js:5605`, which is the auto-generated keyword index (metadata, not a call). fndefs (402 functions): referenced only by `merge_contacts` (fndefs-q3-06.sql:320-321) — a dedupe DELETE + re-parent UPDATE that can never create rows. No INSERT into `contact_tags` exists in any function, worker, page, script, or seed. Not in any trigger def, view def, cron command, or the realtime publication. Prod corroboration: live 0, ins 0 / upd 0 / del 0 since stats reset (stats-reset caveat noted; combined with zero insert paths this is conclusive).
- Prod stats: live 0, all counters 0.
- Provenance: untracked — predates schema-as-code.
- Columns: 3 total — 0 used, 0 uncertain, 3 dead (dead with table): `contact_id`, `tag`, `created_at`.
- Policies: `allow_authenticated_contact_tags` (ALL, authenticated) — DEAD — always-true policy on a dead table.
- Triggers: none.
- Notes: superseded by `contacts.tags` jsonb, which segment filters actually consume (`c.tags @> …` in `preview_email_audience` / `get_crm_contacts` / `import_contacts`). Drop candidate.

### contacts — USED
- Purpose: THE person/company record for the whole platform (customers, adjusters, vendors, subs, leads).
- Evidence: 500+ references; e.g. `src/components/admin-mobile/estimate/EstimateCreateForm.jsx:122` (`db.insert('contacts', …)`), PostgREST embeds from Conversations (`conversation_participants(...,contacts(id,name,…))` `src/pages/Conversations.jsx:306`), 54 fndef functions reference it (merge, import, qualify, attribution, consent, QBO).
- Prod stats: live 205, ins 431 / upd 702 / del 137, idx scans 249,221 — the hottest table in the domain.
- Provenance: untracked — predates schema-as-code.
- Columns: 41 total — 40 used, 0 uncertain, 0 dead, 1 band-aid, 0 duplicated.
  - `tags` (jsonb) — BAND-AID — a JSON array standing in for the (dead) `contact_tags` relation; live consumers exist (segment filter `c.tags @> to_jsonb(...)` in `preview_email_audience`, written by `import_contacts`), so it works, but it is the blob-for-relation pattern.
  - Cross-domain columns confirmed used elsewhere: consent set (`opt_in_status/_source/_at`, `opt_out_at/_reason`, `dnd`, `dnd_at`) — messaging domain reads/writes (send gates, attestation); QBO set (`qbo_customer_id`, `qbo_synced_at`, `qbo_sync_error`) — billing sync + `get_qbo_sync_stats`; role-specific sets (adjuster `desk_phone/desk_extension/territory/relationship_notes`, vendor/sub `trade_specialty/payment_terms/coi_expiration/w9_on_file`) — collected by AddContactModal/EditContactModal.
  - `referral_source` (free text) — used, but note: stores a name string chosen from the `referral_sources` managed list with no FK (normalization gap, see structural problems).
- Policies: `contacts_authenticated_select` — USED — real predicate (`NOT is_crm_partner(auth.uid()) OR id IN (partner-visible lead contacts)`); `contacts_authenticated_insert` / `_update` / `_delete` — USED — real predicate (`NOT is_crm_partner(auth.uid())`). These four are the domain's only genuinely scoped table policies.
- Triggers: `trg_backlink_leads_to_contact` (AFTER INSERT OR UPDATE OF phone) — USED — the lifecycle invariant-7 backlink engine (`crm_backlink_leads_to_contact()`); `trg_qbo_customer_sync` (AFTER INSERT) — USED — kicks the QBO customer sync (`notify_qbo_customer_sync()`, messaging/billing seam).
- Notes: `anon` has NO table grant here (unlike most CRM tables) — good. Heavy cross-domain traffic is expected and real.

### crm_automation_runs — USED
- Purpose: per-run work queue/ledger for CRM automations (enqueue → step cursor → completed/error).
- Evidence: `functions/api/process-crm-automations.js:437/444/514` (`db.update/select`), enqueued via `enqueue_automation_run` RPC (:300); surfaced in UI via `get_automation_runs` (`src/pages/crm/CrmAutomations.jsx:216`). Cron job `process-crm-automations` (prod-cron) drives it.
- Prod stats: live 0, ins 2 / del 2 — the engine is live but essentially idle in production.
- Provenance: `supabase/migrations/20260702_crm_phase5_automations.sql`.
- Columns: 13 total — 13 used (run cursor `current_action`, `next_run_at`, `last_error` all read by worker/UI).
- Policies: `crm_automation_runs_all` (ALL, **roles ["anon","authenticated"]**) — BAND-AID — `USING (true)` INCLUDING `anon`, combined with a full anon table GRANT ⇒ unauthenticated read/write. Outside the database-standard §2 allowlist. See structural problem #1.
- Triggers: none.
- Notes: FK → crm_automations, contacts.

### crm_automations — USED
- Purpose: admin-defined automation rules (trigger event + conditions + actions).
- Evidence: `src/pages/crm/CrmAutomations.jsx` (get/upsert/enable/delete RPCs at :193/:249/:276/:288); `functions/api/process-crm-automations.js:493` (`db.select('crm_automations', …)`) on cron.
- Prod stats: live 0, ins 6 / del 6, seq 2465 (worker polls); zero live rules right now.
- Provenance: `supabase/migrations/20260702_crm_phase5_automations.sql`.
- Columns: 11 total — 11 used.
- Policies: `crm_automations_all` (ALL, **roles ["anon","authenticated"]**) — BAND-AID — same anon-writable always-true problem as the runs table. Structural problem #1.
- Triggers: none.
- Notes: `crm_fixed_automation_conflict` (msg domain) checks conflicts against the fixed missed-call automation.

### crm_build_phases — USED
- Purpose: CRM build roadmap phases powering the public `/status` mirror and `/crm/roadmap`.
- Evidence: read via `get_crm_build_progress` (anon-granted deliberately) from `src/pages/Status.jsx:28` and `src/pages/crm/CrmRoadmap.jsx:57`; written via `set_crm_phase_status`.
- Prod stats: live 17, ins 19 / upd 21.
- Provenance: `supabase/migrations/20260701_crm_phase0_scaffold.sql`.
- Columns: 5 total — 5 used (`phase_key`, `title`, `status`, `shipped_at`, `sort_order` all serialized by `get_crm_build_progress`).
- Policies: `crm_build_phases_all` (ALL, authenticated) — USED — real predicate `NOT is_crm_partner(auth.uid())` (keeps CRM partners out of direct table access while the anon RPC serves the public mirror).
- Triggers: none.
- Notes: the anon path is the RPC, not the table — correct §2-allowlist shape.

### crm_build_stages — USED
- Purpose: per-phase checklist stages for the same roadmap surface.
- Evidence: same readers as phases (`get_crm_build_progress`); written via `set_crm_stage_status`.
- Prod stats: live 115, ins 118 / upd 108.
- Provenance: `supabase/migrations/20260701_crm_phase0_scaffold.sql`.
- Columns: 5 total — 5 used.
- Policies: `crm_build_stages_all` (ALL, authenticated) — USED — real `NOT is_crm_partner(...)` predicate.
- Triggers: none.
- Notes: CLAUDE.md requires reconciling these checkboxes at CRM close-out — a doc-driven write path.

### crm_import_batches — USED
- Purpose: audit row per CSV contact import (counts + errors).
- Evidence: written inside `import_contacts` (fndef); read by `src/components/crm/ImportExportPanel.jsx:136` (`db.select('crm_import_batches', 'select=*&order=created_at.desc&limit=5')`).
- Prod stats: live 1, ins 35 / del 35.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 13 total — 13 used (`created/updated/skipped/error_count` rendered at ImportExportPanel:199/310-311; `total_rows`+`errors` written by the RPC, write-only detail).
- Policies: `crm_import_batches_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### crm_lead_notes — USED
- Purpose: append-only staff notes on a lead (panel Notes tab).
- Evidence: `add_lead_note` (`src/pages/crm/CrmLeads.jsx:685/1417`), `get_lead_notes` (:1395); merged into activity timelines by `get_contact_activity` / `get_lead_activity` (fndefs).
- Prod stats: live 28, ins 30.
- Provenance: `supabase/migrations/20260724180000_crm_lead_notes.sql`.
- Columns: 7 total — 7 used.
- Policies: none (0 assigned) — RLS enabled with no browser-role policy and **service_role-only table grants**: deny-all table, access exclusively through the definer RPCs. This is the domain's one correctly least-privileged table.
- Triggers: none.
- Notes: FK → inbound_leads ON DELETE CASCADE.

### crm_orgs — USED
- Purpose: org scaffold (multi-tenant ceremony; production has exactly one real org + one test org).
- Evidence: workers resolve the org each run — `functions/api/process-crm-automations.js:454`, `process-sequences.js:180`, `run-automations.js:214` (`is_test=eq.false&select=id&order=created_at.asc&limit=1`); 31 fndef functions default `p_org_id` from it.
- Prod stats: live 2, seq 11,424 (org lookup on every worker tick).
- Provenance: `supabase/migrations/20260701_crm_phase0_scaffold.sql`.
- Columns: 4 total — 3 used, 1 uncertain, 0 dead.
  - `name` — uncertain: generic; no reader found anywhere (workers select `id` only); 2 rows.
- Policies: `crm_orgs_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.
- Notes: every CRM table carries `org_id` for a multi-org future that does not exist — see open question 7.

### crm_segments — USED
- Purpose: saved audience filters for contacts/email campaigns.
- Evidence: `get_segments` (`src/components/crm/ContactsDirectory.jsx:95`, `CrmSequences.jsx:75`), `upsert_segment` (:123), `delete_segment` (:144); filter shape consumed by `preview_email_audience`.
- Prod stats: live 0, ins 7 / del 5 — feature live, no saved segments right now.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 8 total — 8 used.
- Policies: `crm_segments_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### crm_sequence_enrollments — USED
- Purpose: a contact's position in a drip sequence (advance/hold/exit/complete).
- Evidence: `enroll_in_sequence` (`CrmSequences.jsx:187`, `process-crm-automations.js:378`); advanced by `functions/api/process-sequences.js:253` (`db.update`), on the `process-sequences` cron.
- Prod stats: live 0, ins 10 / del 8.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 12 total — 12 used (`current_step`, `next_run_at`, `exit_reason`, `enrolled_at` all read by worker/UI).
- Policies: `crm_sequence_enrollments_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### crm_sequence_steps — USED
- Purpose: ordered steps (channel/delay/subject/body) of a sequence.
- Evidence: `functions/api/process-sequences.js:320` (`db.select('crm_sequence_steps', …)`); written by `upsert_sequence` (fndef); read by `get_sequences`.
- Prod stats: live 0, ins 19 / del 16.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 11 total — 11 used (`template_id` confirmed: `process-sequences.js:187-195` copies a template body when the step has none).
- Policies: `crm_sequence_steps_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### crm_sequences — USED
- Purpose: drip-sequence definitions.
- Evidence: `get_sequences`/`upsert_sequence`/`delete_sequence` from `src/pages/crm/CrmSequences.jsx:74/139/161/173`; worker reads active sequences (`process-sequences.js:27`).
- Prod stats: live 0, ins 9 / del 8; idx 2,519 (worker polling).
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 10 total — 10 used (`exit_on_reply` / `exit_on_conversion` consumed at `process-sequences.js:54`).
- Policies: `crm_sequences_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.
- Notes: actual sends route through `sendAutomatedMessage()` (global-opt-in-only) — consent posture lives in the msg domain.

### crm_tasks — USED
- Purpose: CRM to-dos linked to contacts/leads with assignee + due/remind times.
- Evidence: `get_crm_tasks` (`CrmTasks.jsx:88`, `CrmLeads.jsx:1346`), `upsert_crm_task` (:272/:702/:1435), `set_task_status`, `delete_crm_task`; `get_overdue_tasks` widget (`OverdueTasksWidget.jsx:62`).
- Prod stats: live 4, ins 28 / upd 8 / del 16.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 14 total — 14 used.
- Policies: `crm_tasks_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### crm_tracking_numbers — USED
- Purpose: label overlay for CallRail tracking numbers (the numbers themselves live on `inbound_leads.tracking_number`).
- Evidence: `get_tracking_numbers` derives numbers from `inbound_leads` and LEFT JOINs this table for labels (fndef body); called from `CrmCallLog.jsx:400` and `CrmSettings.jsx:93`; written by `set_tracking_number_label` (`CrmSettings.jsx:134`).
- Prod stats: live 0, ins 1 — one label was set then removed; the join tolerates emptiness.
- Provenance: `supabase/migrations/20260701_crm_tracking_numbers.sql`.
- Columns: 6 total — 6 used.
- Policies: `crm_tracking_numbers_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.
- Notes: candidate seam for the future Twilio `phone_numbers` table (lifecycle doc §8).

### fixed_automation_claims — USED
- Purpose: idempotency-claim ledger for "fixed" (code-defined) automations — today the missed-call textback. NOT a one-off repair artifact: it is the claim/finalize/release fence.
- Evidence: `claim_fixed_automation` (`functions/api/run-automations.js:298`), `finalize_fixed_automation_claim` (:368), `release_fixed_automation_claim` (:231); probed by `functions/api/ops-health.js:133` for stuck claims; `run-automations` cron is live.
- Prod stats: live 0, ins 0 — the fence has never admitted a send in production since stats reset (textback still gated: contact_id gap + kill switch; lifecycle doc §7).
- Provenance: `supabase/migrations/20260725060000_fixed_automation_claims.sql`.
- Columns: 8 total — 8 used (`automation_key/entity_type/entity_id/claimed_at/finalized_at/outcome/reason` all read or written by the three RPCs + ops-health).
- Policies: none (0 assigned) — RLS on, service_role-only grants; the three RPCs additionally check `auth.role() = 'service_role'` in-body. Correct least-privilege shape.
- Triggers: none.

### form_definition_versions — USED
- Purpose: immutable published/draft schema versions of CRM forms.
- Evidence: `functions/api/form-submit.js:376`, `functions/f/[public_id].js:306` (hosted form render), `src/pages/crm/CrmLeads.jsx:1332` (`db.select('form_definition_versions', …)` to render a lead's submitted answers); written by `upsert_form` (fndef).
- Prod stats: live 10, ins 14 / upd 17.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 9 total — 9 used (`is_published`/`published_at` written by `upsert_form`, `published_at` also seeded by `scripts/qa/seed-branch-fixtures.sql`).
- Policies: `form_definition_versions_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### form_definitions — USED
- Purpose: the CRM form-builder product (public lead-capture forms).
- Evidence: `get_forms`/`upsert_form` (`CrmForms.jsx:144/216/240`); public render worker `functions/f/[public_id].js`; submit worker `functions/api/form-submit.js:368`; `CrmLeads.jsx:1329` reads `published_version_id`.
- Prod stats: live 5, ins 7 / upd 25.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 11 total — 11 used (`public_id`, `turnstile_enabled` drive the hosted embed).
- Policies: `form_definitions_all` (ALL, authenticated) — BAND-AID — `USING (true)`. (The public path reads via the service-role worker, not anon — correct since 2026-07-24.)
- Triggers: none.

### form_submissions — USED
- Purpose: raw public form submissions (token-idempotent) with UTM + spam flag.
- Evidence: written inside `upsert_lead_from_form` (service-role-only, called by `form-submit.js:437` and `webflow-form-webhook.js:215`); per-IP rate check reads it (`form-submit.js:28`); listed in CrmForms (`s.is_spam` badge at `CrmForms.jsx:764` via `get_forms`' submissions array).
- Prod stats: live 18, ins 22.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 13 total — 13 used (`version_id`, `user_agent` written by the RPC — write-only lineage/audit; `submission_token` is the idempotency key, `form-submit.js:424`).
- Policies: `form_submissions_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### forms — USED
- Purpose: **the tech demo-sheet store** (`form_type='demo_sheet'` rows: form_data, summary, Encircle sync, email flags). Despite the name it is NOT part of the CRM form-builder family.
- Evidence: read/written by the demo-sheet RPC family (`get_demo_sheet` FROM forms WHERE `form_type='demo_sheet'` — fndefs-q2-05.sql:189-190; `save_demo_sheet`, `get_demo_sheet_drafts`, `get_claim_demo_sheets`, `get_demo_sheet_pdf_gaps`); UI: `TechDemoSheet.jsx:850/966`, `ClaimPage.jsx:1053+`; `functions/api/sync-claim-to-encircle.js:235` writes sync stamps; `get_contact_activity` has a scope-sheet arm.
- Prod stats: live 60, ins 86 / **upd 1,678** (autosave), del 19.
- Provenance: untracked — predates schema-as-code.
- Columns: 18 total — 17 used, 0 uncertain, 1 dead, 0 band-aid, 0 duplicated.
  - `form_version` — DEAD: grep `\bform_version\b` across all code scopes → 0 hits; 0 references in all 402 fndefs; no trigger/view/cron reference. Legacy version marker superseded by `schema_id` (which TechDemoSheet snapshots per draft).
  - `submitted_by`, `email_sent_at` — used via chain (returned by `get_demo_sheet`, written by `save_demo_sheet`), no direct code greps — noted for honesty.
- Policies: `allow_authenticated_forms` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: `forms_updated_at` — USED — BEFORE UPDATE touch via shared `update_updated_at()` (auth-domain function).
- Notes: naming trap (structural problem #6). The demo-sheet schema versions live in `demo_sheet_schemas` (tech domain).

### inbound_leads — USED
- Purpose: layer-1 capture row for every call/form lead; carries transcription, AI analysis, spam flag, merge pointer, provider answered flag.
- Evidence: written by `upsert_lead_from_callrail` (`callrail-webhook.js:213`, `callrail-backfill.js:141`) and `upsert_lead_from_form`; board reads it directly (`ForecastWidget.jsx:54` `db.select('inbound_leads', …)`, CrmLeads board query); `get_inbound_leads` feeds CrmCallLog:417 + AdminLeadCenter:62; 32 fndef functions touch it; `run-automations.js` reads `answered` for textback.
- Prod stats: live 164, ins 283 / **upd 2,997** (webhook re-deliveries + enrichment), idx 70,334.
- Provenance: `supabase/migrations/20260701_crm_phase1_shell_callrail.sql`.
- Columns: 31 total — 29 used, 0 uncertain, 1 dead, 0 band-aid, 1 duplicated.
  - `lead_score` — DEAD: written only by `score_lead()` (fndef, sole writer), which has no live caller (see RPC entry); readers: grep `\blead_score\b` in src → 1 comment (`crmPipeline.js:33`); functions → 0; only other exposure is the `rv_leads` view, which itself has zero code readers (db-lane test only). Prod corroboration: nothing selects it.
  - `lead_status` — DUPLICATED: a second lead-progress vocabulary (`new/contacted/qualified/lost/spam` — `leadFormat.js:31`, written by `update_lead_status` from CrmCallLog:447 + AdminLeadCenter) running in parallel with the canonical `lead_pipeline_stage` kanban layer. Both live; nothing syncs them (structural problem #5).
  - `transcription_source`, `transcribed_at` — used, write-only provenance stamps from `set_lead_transcription`.
  - `answered` — used; THE provider-truth missed-call definition (`20260725160000_inbound_leads_answered.sql`, `run-automations.js` `isMissedCall`).
- Policies: `inbound_leads_all` (ALL, authenticated) — BAND-AID — `USING (true)` (PII: names, phones, transcripts readable/writable by every logged-in role).
- Triggers: none (backlink trigger lives on contacts).
- Notes: `callrail_id` unique-key idempotency; `merged_into_lead_id` implements the repeat-caller merge; `raw_payload` jsonb holds the CallRail shape that `crm_call_is_answered` and the JS twin parse (provider-coupling seam, lifecycle §8).

### lead_attribution — USED
- Purpose: attribution facts (channel/source/campaign) per lead/contact — the "traced" predicate's anchor.
- Evidence: single writer `upsert_lead_attribution` called only inside `upsert_lead_from_form` (fndefs-q4-03:870); read by `crm_contact_is_traced`, `get_attribution_rollup`, `merge_contacts` (fndefs); UI reads via CrmAttribution/CrmOverview RPCs.
- Prod stats: live 18, ins 24; idx 180,382 (the traced-predicate join is hot).
- Provenance: `supabase/migrations/20260701_crm_phase3_attribution.sql`.
- Columns: 12 total — 11 used, 0 uncertain, 1 dead.
  - `referral_source_id` — DEAD: the only caller passes literal NULL (`PERFORM upsert_lead_attribution(..., NULL, now(), NULL, v_org)` fndefs-q4-03:870); code grep → 0 hits in all scopes; only fndef mention is the writer's own column list; no reader in any of 402 fndefs (rollup groups by channel/campaign only). The referral-source FK dream never materialized.
- Policies: `lead_attribution_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.
- Notes: calls-side attribution never writes here (channel resolution falls back to `crm_channel_for_source(lead.source)`) — by design per lifecycle §1 ("forms … the only writer of lead_attribution").

### lead_pipeline_stage — USED
- Purpose: one row per lead = current kanban stage (layer 3).
- Evidence: `move_lead_to_stage` (CrmLeads:623), auto-advance chain (`crm_advance_lead_if_forward`, `crm_auto_advance_leads` via billing triggers), direct board read `ForecastWidget.jsx:55` (`db.select('lead_pipeline_stage','select=lead_id,stage_id')`).
- Prod stats: live 79, ins 165 / upd 80 / del 89.
- Provenance: `supabase/migrations/20260701_crm_phase4a_lead_pipeline.sql`.
- Columns: 7 total — 7 used (`moved_by` NULL-means-system convention powers speed-to-lead).
- Policies: `lead_pipeline_stage_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.
- Notes: invariant — a merged lead never owns a stage row (enforced in the advance RPCs).

### lead_score_factors — DEAD
- Purpose (intended): per-lead score-factor breakdown for Phase-9 lead scoring.
- Evidence trail (dead-by-chain): sole writer AND sole reader is `score_lead()` (fndefs-q4-01:419-499 DELETE+INSERT+UPDATE) — and `score_lead` has zero live callers (full trail under its RPC entry). Direct greps: `\blead_score_factors\b` → src 1 hit = comment (`crmPipeline.js:33`); functions/scripts/.github → 0; upr-mcp → 0; remaining hits are `supabase/tests/crm_phase9_intelligence.test.js` (test-only reference). Not in any trigger/view/cron/publication.
- Prod stats: live 5, ins 5 / upd 0 / del 0 — five rows from test invocations, never touched since.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 8 total — 8 dead (dead with table): `id`, `lead_id`, `org_id`, `factor`, `points`, `detail`, `scored_at`, `created_at`.
- Policies: `lead_score_factors_all` (ALL, authenticated) — DEAD — always-true policy on a dead table.
- Triggers: none.
- Notes: the JS twin (`crmPipeline.js` scoreLead) is also display-less; see structural problem #3.

### lead_stage_history — USED
- Purpose: append-only log of every stage move (who/when/from/to) — speed-to-lead + pipeline movement source.
- Evidence: written by `move_lead_to_stage` + advance RPCs (fndefs); read by `get_speed_to_lead`, `get_pipeline_movement`, `get_contact_activity`, `get_lead_activity` (fndefs); UI CrmReports:107/109, ActivityTimeline.
- Prod stats: live 185, ins 236 / upd 0.
- Provenance: `supabase/migrations/20260702_crm_phase0F_wave_schema.sql`.
- Columns: 9 total — 9 used (`moved_at`/`from_stage_id` consumed inside the reporting fndefs; `moved_by IS NOT NULL` is THE human-move predicate).
- Policies: `lead_stage_history_all` (ALL, authenticated) — BAND-AID — `USING (true)` on an audit log (any user can UPDATE/DELETE history — an always-true ALL policy on an append-only ledger is worse than on a working table).
- Triggers: none.

### pipeline_stages — USED
- Purpose: admin-editable stage catalog (name/color/order/is_won/is_lost/is_recoverable).
- Evidence: `get_pipeline_stages` (ForecastWidget:53, CrmLeads:496, CrmOverview, CrmSettings), `upsert_pipeline_stage`/`delete_pipeline_stage` (CrmSettings:156/175/193-194); every advance RPC resolves stages by name (fndefs).
- Prod stats: live 16, ins 18 / upd 13.
- Provenance: `supabase/migrations/20260701_crm_phase4a_lead_pipeline.sql`.
- Columns: 11 total — 11 used, with one loud caveat:
  - `win_probability` — used (read live by ForecastWidget/`crmPipeline.js:67`) **but has NO writer anywhere** — `upsert_pipeline_stage` has no such param, no db.update touches it, no migration seeds it. The "admin-set win_probability" the comments describe cannot be set from the app; the positional fallback always runs. Never-wired half-feature (structural problem #3).
  - `is_recoverable` — used (read by `crm_advance_lead_if_forward` revive logic; seeded by migration; Missed Calls = true).
- Policies: `pipeline_stages_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### property_meld_melds — USED
- Purpose: Property Meld work-order ingestion (inbound email → parsed meld cards).
- Evidence: written via `upsert_property_meld_meld` from `functions/api/inbound-meld.js:91` (email worker, `functions/lib/property-meld.js` parser); read by `get_property_meld_melds` from `src/pages/Melds.jsx:62`.
- Prod stats: live 3, ins 3 / upd 1.
- Provenance: `supabase/migrations/20260707_property_meld_melds.sql`.
- Columns: 29 total — 28 used, 0 uncertain, 1 dead.
  - `imported_job_id` — DEAD: grep `\bimported_job_id\b` all scopes → 0; all 402 fndefs → 0 (the upsert RPC does not write it; `get_property_meld_melds` does not return it via its json build — and no code ever sets it). A planned "meld → job import" link never built.
  - `meld_internal_id`, `vendor_account_id`, `pm_brand`, `last_message_from`, `last_message_text`, `thread_reply_address`, `last_event_at` — used, write-only ingest capture (written by the upsert RPC from parsed email; no UI reader yet).
- Policies: `property_meld_melds_all` (ALL, authenticated) — BAND-AID — `USING (true)`.
- Triggers: none.

### referral_sources — USED
- Purpose: managed lookup list of referral sources (used by contact forms and channel classification).
- Evidence: `get_referral_sources` (`Layout.jsx:154` — loaded app-wide; `CrmCampaigns.jsx:137`; `ListsAndValues.jsx` via `managedLists.js:67-69`), `upsert_referral_source`/`delete_referral_source` (settings list editor); `crm_channel_for_source` secondary category lookup (fndef).
- Prod stats: live 49, ins 54, seq 8,973.
- Provenance: untracked — predates schema-as-code (last idx scan timestamp reaches back to 2026-03).
- Columns: 6 total — 6 used.
- Policies: `anon_read_referral_sources` (SELECT, roles actually authenticated) — DUPLICATED — fully subsumed by `anon_write_referral_sources` (ALL, same role, same `USING (true)`): redundant multiple-permissive pair on the same table+cmd+role. `anon_write_referral_sources` (ALL, authenticated) — BAND-AID — `USING (true)` + vestigial `anon_` name.
- Triggers: none.
- Notes: consumers store the NAME (`contacts.referral_source` text), not the id — the list is referential in spirit only.

## RPCs (92)

Security shorthand: **D** = SECURITY DEFINER, **I** = INVOKER; grants are `authenticated+service_role` unless noted. **Only the three `*_fixed_automation_*` functions validate their caller in-body**; every other definer relies on the grant alone (flagged once here rather than per-row: see structural problem #2).

| function(args) | class | security | callers / evidence | notes |
|---|---|---|---|---|
| add_lead_note(lead,body,by) | used | D | CrmLeads.jsx:685,1417 | writes crm_lead_notes (deny-all table — definer IS the gate) |
| claim_fixed_automation(key,type,id,now) | used | I, svc-only grant | run-automations.js:298 (cron) | in-body `auth.role()='service_role'` check; atomic claim |
| create_job_with_contact(33 args) | used | D | CreateJobModal.jsx:282, TechNewJob.jsx:370 | cross-domain: writes contacts, contact_addresses, contact_jobs, claims, jobs |
| create_manual_lead(phone,name,src,val,org,by) | used | D | CrmLeads.jsx:1244 | manual lead + contact |
| crm_advance_lead_if_forward(lead,stage) | used | D | transcribe-call.js:517,528,649,655 | AI forward-advance; resolves merge pointer; revives recoverable stages |
| crm_auto_advance_leads(contact,stage) | used | D | zero code callers — called by `crm_trg_estimate_submitted/invoice_created/invoice_paid/sign_request_signed` trigger fns (fndefs), wired to live billing/e-sign triggers | business-event auto-advance to Won/Estimate Sent |
| crm_auto_qualify_contact(lead) | used | D | transcribe-call.js:506,643 | AI contact create/link + qualify |
| crm_backlink_leads_to_contact() | used | D (trigger fn) | trigger `trg_backlink_leads_to_contact` on contacts (AFTER INSERT OR UPDATE OF phone) | invariant-7 backlink + revert, writes system_events |
| crm_call_is_answered(payload,dur) | used | I | inside `get_attribution_rollup`, `get_call_volume`, `get_conversion_trend` (fndefs) | THE SQL countable-call predicate; JS twin `isCountableLead` (crmCharts.js) |
| crm_channel_for_source(src) | used | D | inside `get_attribution_rollup`, `score_lead`, `upsert_lead_from_form` (fndefs) | channel classifier + referral_sources category lookup |
| crm_contact_is_traced(contact) | used | D | CRM-traced predicate inside rollup/trend/revenue/sales-summary/leaderboard/LTV fndefs; tests | canonical §3 rule |
| crm_disqualify_lead_if_open(lead,reason) | used | D | transcribe-call.js:555,670 | AI out-of-scope → Lost |
| crm_sync_lead_value(contact,amount) | band-aid | D | called by `crm_trg_invoice_created` (fndef; live invoices trigger) | sync-maintenance of the duplicated `inbound_leads.value` ← invoice total; used daily but exists to keep a denormalized copy aligned |
| delete_contact_address(id,contact) | used | D | CustomerPage.jsx:314 | |
| delete_crm_automation(id) | used | D | CrmAutomations.jsx:288 | |
| delete_crm_task(id) | used | D | CrmLeads.jsx:1469, CrmTasks.jsx:132 | |
| delete_pipeline_stage(id) | used | D | CrmSettings.jsx:175 | refuses when stage in use (toast surfaces error) |
| delete_referral_source(id) | used | D | ListsAndValues via managedLists.js:69 | |
| delete_segment(id) | used | D | ContactsDirectory.jsx:144 | |
| delete_sequence(id) | used | D | CrmSequences.jsx:173 | |
| enqueue_automation_run(7 args) | used | D | process-crm-automations.js:300 (cron) | dedupe on UNIQUE(automation_id, triggering_event_id) |
| enroll_in_sequence(seq,contact,segment,org) | used | D | CrmSequences.jsx:187; process-crm-automations.js:378 | |
| finalize_fixed_automation_claim(key,id,outcome,reason,now) | used | I, svc-only grant | run-automations.js:368 | in-body svc check |
| get_ad_spend(platform,start,end) | **dead** | D | Zero-hit trail: grep `'get_ad_spend'`/`"get_ad_spend"`/`\bget_ad_spend\b` across src/, functions/, scripts/, upr-mcp/, tests/, supabase/tests/, .github/workflows → only `upr-mcp/src/codeIndex.js:3784` (auto-generated metadata, not a call); 0 refs in 402 fndefs; not in cron commands, trigger defs, or views. Spend is read via `get_attribution_rollup`/`by_campaign` and a direct `db.select('ad_spend')` in weekly-crm-digest.js:216 | authenticated-granted definer with no caller — drop candidate |
| get_attribution_by_campaign(start,end,org) | used | D | CrmAttribution.jsx:70 | campaign spend/leads table |
| get_attribution_rollup(start,end,org) | used | D | CrmAttribution.jsx:69, CrmOverview.jsx | traced-scoped since 2026-07-22 |
| get_automation_runs(automation,org,limit) | used | D | CrmAutomations.jsx:216 | |
| get_call_volume(start,end,org) | used | D | CrmOverview.jsx, CrmReports.jsx:106ish | CallRail answered/missed split from raw_payload |
| get_contact_activity(contact) | used | D | ActivityTimeline.jsx:167; CrmLeads timeline | 24-arm unified timeline; 12kB body |
| get_contact_addresses(contact) | **dead** | D | Zero-hit trail: same three grep patterns, all scopes → 0 hits anywhere (not even codeIndex); 0 fndef refs; no cron/trigger/view. Addresses reach the UI embedded in `get_customer_detail` (CustomerPage.jsx:87, jobs domain) | superseded read path — drop candidate |
| get_crm_automations(org) | used | D | CrmAutomations.jsx:193 | |
| get_crm_build_progress() | used | D, **grants anon + PUBLIC** | Status.jsx (public /status), CrmRoadmap.jsx:57 | deliberate §2-allowlist anon RPC; returns metadata only |
| get_crm_contacts(search,limit,offset,org) | used | D | ContactsDirectory.jsx:77 | window total_count per row |
| get_crm_tasks(assignee,status,contact,lead,org) | used | D | CrmTasks.jsx:88, CrmLeads.jsx:1346 | |
| get_dashboard_stats() | used | D | DevTools.jsx:479,1513 | dev-surface only. Note: counts `contacts.role='lead'` as "open_leads" — a parallel lead definition that contradicts lifecycle §3 (harmless while DevTools-only) |
| get_demo_sheet(id) | used | D | TechDemoSheet.jsx:850 | reads `forms` WHERE form_type='demo_sheet' |
| get_demo_sheet_drafts() | used | D | TechDemoSheet.jsx:966 | |
| get_demo_sheet_pdf_gaps() | used | D | settings/PdfGapsPanel.jsx:45 | forms + job_documents reconciliation |
| get_duplicate_contacts() | used | D | MergeTool.jsx:82, DevTools.jsx:1047 | phone+email dup groups |
| get_forms(org) | used | D | CrmForms.jsx:144 | form_definitions + versions + submissions bundle |
| get_inbound_leads(limit) | used | D | CrmCallLog.jsx:417, AdminLeadCenter.jsx:62 | embeds contact |
| get_job_contacts(job) | used | D | openInAppThread.js:103, TechJobDetail, DevTools:934 | also inside get_job_hub (fndef) |
| get_job_demo_sheets(job) | **dead** | D | Zero-hit trail: three grep patterns, all scopes → 0 hits (not even codeIndex); 0 fndef refs; no cron/trigger/view. Sibling `get_claim_demo_sheets` (jobs domain) is the live reader (ClaimPage.jsx, TechClaimDetail.jsx) | superseded by claim-scoped variant — drop candidate |
| get_lead_activity(lead) | used | D | ActivityTimeline.jsx:168 | unlinked-lead timeline twin |
| get_lead_notes(lead) | used | D | CrmLeads.jsx:1395 | |
| get_orphan_contacts() | used | D | DevTools.jsx:819,1518 | dev-surface only |
| get_overdue_tasks(assignee,org,now) | used | D | OverdueTasksWidget.jsx:62 | Denver-day boundary, JS/SQL twin predicate |
| get_pipeline_movement(start,end,org) | used | D | CrmReports.jsx:109; weekly-crm-digest.js:197 | history-backed in/out per stage |
| get_pipeline_stages(org) | used | D | ForecastWidget:53, CrmLeads:496, CrmOverview, CrmSettings | returns SETOF pipeline_stages (all columns incl. unwritable win_probability) |
| get_property_meld_melds(include_closed) | used | D | Melds.jsx:62 | |
| get_qbo_sync_stats() | used | D | settings/Integrations.jsx:269 | contacts qbo_* rollup |
| get_referral_sources() | used | D | Layout.jsx:154 (app-wide), CrmCampaigns:137, ListsAndValues | |
| get_segments(org) | used | D | ContactsDirectory.jsx:95, CrmSequences.jsx:75 | |
| get_sequences(org) | used | D | CrmSequences.jsx:74, CrmAutomations.jsx:194 | |
| get_speed_to_lead(start,end,org) | used | D | CrmOverview.jsx:233, CrmReports.jsx:107 | human-moves-only (moved_by IS NOT NULL) |
| get_tracking_numbers() | used | D | CrmCallLog.jsx:400, CrmSettings.jsx:93 | derives numbers from inbound_leads, labels from crm_tracking_numbers |
| import_contacts(rows,org,by,filename) | used | D | ImportExportPanel.jsx:197 | dedupe + batch audit row |
| link_contact_to_job(contact,job,role,primary,notes) | **dead** | D | Zero-hit trail: three grep patterns, all scopes → 0 hits (not even codeIndex); 0 fndef refs; no cron/trigger/view. contact_jobs rows are created by `create_job_with_contact` (fndef) and worker REST inserts | authenticated-granted definer with no caller — drop candidate |
| merge_contacts(keep,merge) | used | D | MergeTool.jsx:101, MergeModal.jsx:62 | re-parents 10+ tables incl. dead contact_tags; CRM-history-safe (P0 fix) |
| move_lead_to_stage(lead,stage,by,lost_reason) | used | D | CrmLeads.jsx:623 | writes stage + history; p_lost_reason optional (back-compat) |
| preview_email_audience(filter,org,limit) | used | D | ContactsDirectory.jsx:102, CrmCampaigns.jsx:176; inside queue_email_campaign etc. (msg fndefs) | filter incl. `tags @>`, minus suppressions |
| promote_lead_to_contact(lead,name,email,by) | used | D | CrmLeads.jsx:1378 | the sanctioned lead→contact path (QBO side effects via contact insert trigger) |
| record_email_suppression(email,reason,src) | used | D, svc-only grant | resend-webhook.js:131,140 | bounce/complaint ledger |
| release_fixed_automation_claim(key,id,reason) | used | I, svc-only grant | run-automations.js:231 | in-body svc check |
| score_lead(lead) | **dead** | D | Zero-live-caller trail: grep `'score_lead'`/`"score_lead"`/`\bscore_lead\b`: src → 4 comment-only hits (crmPipeline.js:32,97,117; CrmLeads.jsx:149); functions/, scripts/, .github → 0; upr-mcp → codeIndex metadata only; remaining hits are `supabase/tests/crm_phase9_intelligence.test.js` (test-only reference); 0 refs in 402 fndefs; no cron/trigger/view. Prod: lead_score_factors ins=5 (test runs) | Phase-9 scoring engine, never wired to ingest/enrich; JS twin equally display-less. Wire or drop (owner Q2) |
| search_contacts_for_job(query) | used | D | CreateJobModal:190, NewEstimateModal:101, EstimateCreateForm:98, TechNewJob | |
| set_automation_enabled(id,enabled) | used | D | CrmAutomations.jsx:276 | |
| set_contact_lifecycle(contact,status,actor) | used | D | MergeTool.jsx:221 | logs to system_events |
| set_crm_phase_status(key,status) | used | D | CrmRoadmap close-out writes (doc-mandated); db-lane tests | UI reference CrmRoadmap.jsx:30; write path is agent close-out ritual |
| set_crm_stage_status(id,status) | used | D | same as above | |
| set_lead_caller_name(lead,name,upgrade) | used | D | transcribe-call.js:495 (+3 more) | fill-blank/extend-only guard; canonical-root propagation (invariant 2) |
| set_lead_contact_details(lead,email,addr) | used | D | transcribe-call.js:567,678 | fills blanks on linked contact only |
| set_lead_details(lead,notes,value,by) | used | D | CrmCallLog.jsx:224 | |
| set_lead_spam_flag(lead,spam,reason) | used | D | transcribe-call.js:536,546 (+) | AI spam gate |
| set_lead_transcription(lead,text,src,analysis) | used | D | transcribe-call.js:479,624 | |
| set_task_status(task,status,actor) | used | D | CrmLeads.jsx:1457, CrmTasks.jsx:120 | |
| set_tracking_number_label(number,label) | used | D | CrmSettings.jsx:134 | upserts crm_tracking_numbers |
| update_contact_addresses_updated_at() | used | I (trigger fn) | trigger `trg_contact_addresses_updated_at` | touch trigger |
| update_lead_status(lead,status,notes,by) | used | D | CrmCallLog.jsx:447, AdminLeadCenter | writes the DUPLICATED lead_status vocabulary (problem #5) |
| upsert_ad_spend(9 args) | used | D | sync-google-ads.js:110, sync-meta-ads.js:96 | |
| upsert_contact_address(9 args) | used | D | CustomerPage.jsx:309,313 | |
| upsert_crm_automation(9 args) | used | D | CrmAutomations.jsx:249 | fixed-automation conflict check inside |
| upsert_crm_task(10 args) | used | D | CrmLeads.jsx:702,1435; CrmTasks.jsx:272 | |
| upsert_form(9 args) | used | D | CrmForms.jsx:216,240 | draft/publish versioning |
| upsert_lead_attribution(9 args) | used | D | zero direct code callers; called inside `upsert_lead_from_form` (fndefs-q4-03:870) — live chain via form workers | always invoked with referral_source_id=NULL |
| upsert_lead_from_callrail(18 args) | used | D | callrail-webhook.js:213, callrail-backfill.js:141 | layer-1 ingest: idempotent on callrail_id, repeat-caller merge, missed-call auto-stage |
| upsert_lead_from_form(8 args) | used | D, **svc-only grant** | form-submit.js:437, webflow-form-webhook.js:215 | anon closed 2026-07-24; writes leads+contacts+submissions+attribution+consent |
| upsert_pipeline_stage(7 args) | used | D | CrmSettings.jsx:156,193,194 | no win_probability param (problem #3) |
| upsert_property_meld_meld(23 args) | used | D | inbound-meld.js:91 | |
| upsert_referral_source(id,name,cat,sort) | used | D | ListsAndValues via managedLists.js:68 | |
| upsert_segment(6 args) | used | D | ContactsDirectory.jsx:123 | |
| upsert_sequence(7 args) | used | D | CrmSequences.jsx:139,161 | steps replaced wholesale (p_steps jsonb) |

## Structural problems (ranked, worst first)

1. **`anon` can read AND write `crm_automations` + `crm_automation_runs` (severity 5).** Both tables combine a full `anon` table GRANT (grants.json) with an `ALL`-command `USING (true) / CHECK (true)` policy whose roles array literally includes `anon` (`crm_automations_all`, `crm_automation_runs_all`) — the only two CRM policies that do. The anon key ships in the browser bundle, so an unauthenticated caller can create, enable, or rewrite automation rules that the live `process-crm-automations` cron then executes (downstream consent/kill-switch gates still apply to sends, but task-creation/stage-change actions have no such gate). Outside the database-standard §2 allowlist; classic F-red-style policy-recreate fix.
2. **Blanket always-true authorization across the domain (severity 4).** 30 of 39 policies are `USING (true)` to `authenticated` (every CRM table except contacts and the two build tables), and 85 of 88 SECURITY DEFINER RPCs contain no in-body caller validation (verified by scanning all bodies for `auth.role()/auth.uid()/is_crm_partner/is_active_internal_admin` — only the three `fixed_automation_claims` RPCs check). Any authenticated user — including field techs — can rewrite pipeline stages, delete sequences, edit `lead_stage_history` (an audit log), or mass-update `inbound_leads` PII. Matches the 2026-07-22 live-audit finding; `authenticated` proves identity, not permission.
3. **Phase-9 "intelligence" shipped writer-less and reader-less (severity 3).** `score_lead` has no live caller; `lead_score_factors` and `inbound_leads.lead_score` are dead; the JS twin (`crmPipeline.js` scoreLead) is display-less; and `pipeline_stages.win_probability` is read by the Forecast widget but has NO write path anywhere (no RPC param, no db.update, no admin UI). This is exactly lifecycle-doc failure lens #2 (manual-once/never-wired surfaces that look automated) living in current code.
4. **Two parallel lead-progress vocabularies (severity 3).** `inbound_leads.lead_status` (new/contacted/qualified/lost/spam — written by `update_lead_status` from CrmCallLog and AdminLeadCenter) coexists with the canonical `lead_pipeline_stage` kanban layer. Nothing syncs them: a lead can be `lead_status='lost'` while its card sits in Qualified. The lifecycle doc's canonical rules never mention `lead_status`, and reporting ignores it — parallel-definition drift (lens #1) waiting to bite whichever surface trusts the wrong field.
5. **Dead relation + blob replacement: `contact_tags` vs `contacts.tags` (severity 2).** The normalized table has never held a row (ins 0 lifetime-of-stats, no INSERT path in 402 functions) while the jsonb blob on contacts is what segments actually filter on. Keep the blob or build the relation — carrying both invites a future writer to pick the dead one.
6. **`forms` is the demo-sheet store, not the CRM form product (severity 2).** The CRM form builder lives in `form_definitions` / `form_definition_versions` / `form_submissions`; `forms` holds `form_type='demo_sheet'` rows with 1,678 updates. Any session grepping "forms" for the form feature lands on the wrong table; v2 renaming (e.g. `demo_sheets`) would close the trap. Its `form_version` column is additionally dead (superseded by `schema_id`).
7. **Attribution's referral FK never populated (severity 2).** `lead_attribution.referral_source_id` is written NULL by its only caller and read by nothing; referral attribution actually rides free text (`contacts.referral_source` name string + `crm_channel_for_source` name lookup). The managed `referral_sources` list is referenced by name, not key — renaming a source silently orphans history.
8. **Four dead, `authenticated`-granted SECURITY DEFINER RPCs (severity 2).** `get_ad_spend`, `get_contact_addresses`, `get_job_demo_sheets`, `link_contact_to_job` have zero callers but remain executable by every logged-in user — pure attack/maintenance surface. `link_contact_to_job` is the only one with side effects (writes contact_jobs).
9. **Vestigial `anon_*` policy names on authenticated policies (severity 1).** `contact_jobs_anon_*` and `anon_read/write_referral_sources` are scoped to `authenticated` but keep their pre-closure names, plus `anon_read_referral_sources` is fully redundant with the ALL policy beside it. Cosmetic, but it makes every future anon audit slower.

## Open questions for the owner

1. **contact_tags:** the normalized tag table has never held a row; segments filter on `contacts.tags` jsonb instead. OK to drop the table (and its policy) in v2, or do you want real tag rows eventually?
2. **Lead scoring:** Phase 9 shipped `score_lead` + `lead_score_factors` + a JS twin, but nothing ever calls it and no screen shows a score. Is scoring something you still want (we'd wire it into ingest/enrich and surface it on the board), or should the whole stack go?
3. **Call-log status vs pipeline:** CrmCallLog/AdminLeadCenter still set `lead_status` (new/contacted/qualified/lost/spam) separately from the kanban stage. Is that triage label part of your real workflow, or should the pipeline stage become the only progress field?
4. **Forecast win probability:** the forecast widget prefers an "admin-set" per-stage `win_probability`, but no screen can set it. Want a control in CRM Settings, or keep the positional fallback and drop the column?
5. **Property Meld → job:** `imported_job_id` suggests a planned "create job from meld" link that was never built. Still wanted?
6. **Multi-org ceremony:** every CRM table carries `org_id` and every reporting RPC takes `p_org_id`, but production is one real org (+1 test). Is multi-org a real prospect, or should v2 collapse to single-org?
7. **anon on automations:** presumably an oversight — confirm no external tool writes `crm_automations`/`crm_automation_runs` with the anon key before we close it (F-red-style policy recreate).
8. **Ad spend:** the Google/Meta sync workers exist but `ad_spend` is empty in production (3 inserts, 3 deletes ever). Are the ad-platform credentials/accounts meant to be live, or is attribution-spend intentionally parked?
9. **Dead RPC drops:** `get_ad_spend`, `get_contact_addresses`, `get_job_demo_sheets`, `link_contact_to_job` — any owner tooling (e.g. ad-hoc `upr_rpc` calls from the MCP) that still uses these names before we write the (rollback-paired) drop migration?

## Search appendix

- **Scope scanned for usage:** `src/`, `functions/`, `scripts/`, `upr-mcp/`, `supabase/tests/`, `tests/`, `.github/workflows/` — 1,063 files (`.js .jsx .mjs .cjs .ts .tsx .sql .toml .yml .yaml .html`), node_modules/dist excluded. `supabase/migrations/` + `supabase/rollbacks/` (291 files) scanned for provenance only. Docs (`*.md`) excluded as evidence per protocol.
- **Patterns per object name N:** word-boundary regex `\bN\b` over every scanned file (catches `'N'`, `"N"`, backticked, embedded `N(...)` PostgREST embeds, and bare SQL references); results bucketed by directory; per-name samples capped at 12 (columns 4). Separately: `\bN\b` over the full `pg_get_functiondef()` corpus (402 functions, parsed into per-function sections so referencing functions are named), over `triggers.json` defs, `views.json` defs, `prod-cron.json` commands, and `publications.json`.
- **Chain rule applied:** an object referenced only by functions was classified by those functions' own liveness (e.g. `crm_auto_advance_leads` used via billing triggers; `lead_score_factors` dead via caller-less `score_lead`).
- **codeIndex discount:** `upr-mcp/src/codeIndex.js` is header-marked "AUTO-GENERATED … curated keyword map" — its `"name": "<rpc>"` entries are search metadata for the MCP's code-context tool, not call sites. All mcp-only hits were discounted. Caveat: the MCP's generic `upr_rpc` tool can invoke ANY rpc by name at owner discretion; that capability was not treated as per-RPC usage evidence (owner question 9 covers it).
- **Caller-check scan:** every assigned RPC body searched for `auth.role()`, `auth.uid()`, `is_crm_partner`, `is_active_internal_admin`, `service_role` — hits only in the three fixed_automation_claims RPCs.
- **Ambiguity handled honestly:**
  - `forms`, `contacts`, `inbound_leads` have hundreds of raw word hits (common English/JSX words); classification leaned on quoted call-site patterns (`db.select('forms'…)` etc.) and fndef references rather than raw counts.
  - Generic column names (id/status/created_at/…) on used tables were classified used only where structural evidence exists (PK/FK joins in fndefs, `order=created_at` query strings, form fields); the two where I could find neither reader nor writer (`contact_jobs.notes`, `crm_orgs.name`) are marked **uncertain**, not dead.
  - `forms.submitted_by` / `forms.email_sent_at` and the seven write-only `property_meld_melds` capture columns have no direct code greps; they are classified used via the RPC bodies that write/return them — stated inline where it applies.
  - `win_probability` is read live but writer-less — classified used with the never-wired caveat rather than dead, since a hand-set value would change behavior.
  - Prod `pg_stat` counters are since-last-reset and were used only as corroboration (stated on every dead claim).
- **Not fully verifiable from here:** whether the owner ever invokes the four dead RPCs ad hoc via the MCP `upr_rpc` tool or the Supabase dashboard (no repository trace would exist); whether `ad_spend` emptiness is credential state or intent; whether any manual SQL ever set `pipeline_stages.win_probability` in the past (current live values not inspectable from the catalog snapshot — the column exists with no app writer either way).

---

## Amendment — non-app-code blind-spot sweep (2026-07-29)

Every dead claim above was re-checked against the four surfaces application-code search cannot see: (1) repo-root and `docs/` runbooks **executed** against production, (2) recent data-repair migrations that are writes rather than DDL, (3) `UPR-Web-Context.md` annotations naming external consumers this repository cannot inspect, (4) doc-designated computation contracts whose callers are unobservable because `track_functions` is off in production.

**Result: 0 reclassified, 24 survived as dead.**

No reclassifications. Per the calibration instruction, grep coverage was re-audited before concluding this — see the sweep notes below.

### Kill-notes — dependencies a future DROP must carry (Phase P5)

- **table:contact_tags**
  - merge_contacts(p_keep_id, p_merge_id) sweeps it BY NAME — catalog/fndefs-q3-06.sql:320-321 (`DELETE FROM contact_tags WHERE contact_id = p_merge_id AND tag IN (...)` + `UPDATE contact_tags SET contact_id = p_keep_id ...`). merge_contacts is LIVE (src/components/MergeTool.jsx:101, src/components/MergeModal.jsx:62) and is exercised by supabase/tests/crm_merge_contacts_safety.test.js in the now-live CI db lane. plpgsql resolves table names at EXECUTION, so a bare DROP TABLE makes every contact merge throw `relation "contact_tags" does not exist` at runtime with no compile-time warning. P5 must CREATE OR REPLACE merge_contacts (deleting those two lines) in the SAME migration as the DROP. Source: supabase/migrations/20260702_crm_phase0F_merge_contacts_safety.sql:125.
- **table:lead_score_factors**
  - Executed by the LIVE CI db lane. supabase/tests/crm_phase9_intelligence.test.js:57 (`db.delete('lead_score_factors', ...)`), :97 and :115 (`db.select('lead_score_factors', ...)`) run via `npm run test:db:branch` (.github/workflows/ci.yml:142-167) against the seeded qa-staging branch — LIVE since 2026-07-29 per .claude/rules/initiative-status.md. The gate is failed-test count only with a shrink-only baseline of 19 (scripts/qa/db-lane-baseline.json), so dropping the table without deleting that suite raises the count and reddens CI. Exactly the save_estimate_lines precedent. Second ordering blocker: score_lead() is the sole writer — drop it in the same migration or score_lead breaks.
- **rpc:score_lead(p_lead_id uuid)**
  - EXECUTED by the live CI db lane: supabase/tests/crm_phase9_intelligence.test.js:86 and :111 call `db.rpc('score_lead', { p_lead_id: lead.id })`. Same lane/baseline as lead_score_factors above — a drop that leaves the suite in place pushes the failed-test count past the shrink-only 19 and reddens CI. Delete the suite in the same change. Secondary: src/lib/crmPipeline.js scoreLead() is its behavioral JS twin (referenced at :32, :97, :117) and becomes an orphan twin with no SQL counterpart if only the RPC goes.
- **column:inbound_leads.lead_score**
  - Projected by the rv_leads view — `il.lead_score,` at supabase/migrations/20260708_dbf_p6_reporting_views.sql:163, confirmed in the live catalog (catalog/views.json rv_leads def). `ALTER TABLE inbound_leads DROP COLUMN lead_score` will FAIL with a dependent-object error, and DROP ... CASCADE would silently destroy rv_leads — a shipped DB-Foundation P6 reporting view whose anon-denial contract is guarded by supabase/tests/db_foundation_p6_reporting_views.test.js in the live db lane (note: that test asserts ACCESS only, so a CASCADE-dropped view would make it pass SPURIOUSLY rather than fail — it will not catch this). P5 must rebuild rv_leads (and its rollback) in the same migration. Third writer ordering: score_lead() UPDATEs this column (fndefs-q4-01.sql:424, :499).
- **column:lead_attribution.referral_source_id**
  - Named in the INSERT column list of upsert_lead_attribution — catalog/fndefs-q4-03.sql:603 (`referral_source_id, occurred_at, created_by`). That function is LIVE: it is called inside upsert_lead_from_form, the public form-ingest path (functions/api/form-submit.js:437, functions/api/webflow-form-webhook.js:215). Dropping the column requires a CREATE OR REPLACE of upsert_lead_attribution in the same migration or every public form submission throws. Second: `p_referral_source_id uuid DEFAULT NULL` is argument 6 of its frozen 9-arg signature — removing the parameter is a signature change barred by the FE-contract freeze (AGENTS.md §13, Code Review Rule 3); keep the param and ignore its value. Third: FK constraint lead_attribution_referral_source_id_fkey → referral_sources(id) drops with the column (catalog/fks.json).
- **column:forms.form_version**
  - UPR-Web-Context.md:642 documents `demo_sheets — VIEW over forms WHERE form_type='demo_sheet' (legacy flat shape, read-only)`. That view is NOT in the current catalog (catalog/views.json holds only the 5 rv_* views; the snapshot table list has only demo_sheet_schemas), so the doc line reads as stale — but a view dependency is precisely what blocks a DROP COLUMN, and this map cannot see live pg_views. P5 must re-verify against live pg_views/pg_depend before dropping. No other blocker: zero fndef references, zero migration writes.
- **column:property_meld_melds.imported_job_id**
  - FK constraint property_meld_melds_imported_job_id_fkey → jobs(id) drops with the column (catalog/fks.json) — low risk, but name it in the migration. Semantic pairing: property_meld_melds.state retains an `'imported'` enum value that becomes unreachable once the job pointer is gone (UPR-Web-Context.md:2982 documents both as one unbuilt feature: `state ∈ open|canceled|imported|archived; imported_job_id → jobs(id) for the future import`). Drop them together or record why 'imported' survives.
- **rpc:link_contact_to_job(p_contact_id uuid, p_job_id uuid, p_role text, p_is_primary boolean, p_notes text)**
  - It is the SOLE writer of contact_jobs.notes — catalog/fndefs-q3-05.sql:11-15 inserts (contact_id, job_id, role, is_primary, notes); the only other two contact_jobs writers insert four columns and hardcode role='primary_client' (add_related_job fndefs-q1-01.sql:181, create_job_with_contact fndefs-q1-02.sql:110). The map itself classifies contact_jobs.notes as UNCERTAIN, not dead. Resolve that column FIRST: if any production contact_jobs.notes is non-NULL, something invoked this RPC (or hand-written SQL), which is positive evidence against its dead verdict. It is also the only writer that can set an arbitrary role plus atomically demote sibling primaries and update jobs.primary_contact_id.
- **policy:lead_score_factors:lead_score_factors_all**
  - Explicitly recreated by supabase/migrations/20260708_dbf_p3_anon_policy_closure.sql:192-193, and re-created WITH anon in that file's rollback block at :459-460. Dropping the policy (or its table) makes that committed rollback script un-runnable. Pair the drop with an update to the P3 rollback in supabase/rollbacks/. The sibling policy contact_tags:allow_authenticated_contact_tags is NOT touched by the anon-closure migrations and drops cleanly with its table.
- **all 5 dead RPCs + both dead tables (shared blocker)**
  - TWO shared blockers. (1) supabase/migrations/20260708_dbf_p3_anon_rpc_revoke.sql REVOKEs then GRANTs all five by exact signature (get_ad_spend :182-183, get_contact_addresses :234-235, get_job_demo_sheets :306-307, link_contact_to_job :438-439, score_lead :518-519) and its rollback block re-GRANTs them to anon (:755, :781, :817, :883, :923) — after a DROP those GRANT statements reference nonexistent functions and the rollback errors out. Update the paired file in supabase/rollbacks/ in the same change. (2) db/baseline/live-schema-snapshot.json enumerates contact_tags and lead_score_factors (line 7) and all five RPCs (line 9); scripts/db-drift-check.mjs diffs a fresh live snapshot against that baseline and EXITS 1 on any removed object. It is operator-run, not CI-gated (no npm script, no .github/workflows reference), so it will not block the merge — it will fail silently later in the owner's hands unless the baseline is regenerated in the same change.

### Sweep coverage notes

ZERO RECLASSIFICATIONS — all 24 CRM dead claims survived all four surfaces. I re-read coverage before concluding, as instructed, and closed a real scope gap in the process (below). The honest reason this domain diverges from billing's ~50% move rate is structural, not a search failure: CRM has no operational runbook surface at all. Every SQL-bearing doc in this repo is billing/QBO/recon — BILLING-CONTEXT.md, GOOGLE-INTEGRATIONS-HANDOFF.md, Q2-2026-RECONCILIATION-PLAN.md, RECONCILIATION-HANDOFF.md, UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md, UPR-QBO-SYNC-PROTOCOL.md — and not one names a CRM object. CRM is young (built July 2026, schema-as-code from birth) so it never accumulated the hand-run repair layer that billing did.

SURFACE-BY-SURFACE RESULT.
(1) Executed runbooks: grepped every *.md repo-wide (including hidden .claude/.agents/.codex/.github) for all 11 dead object names -> 10 files, all of them inventory (UPR-Web-Context.md), auto-generated (docs/generated/*), this initiative's own output (docs/schema-v2/*), or history (docs/archive/*). Zero INSERT/UPDATE/SELECT/MCP-recipe prescriptions. No CRM equivalent of the invoices precedent exists.
(2) Recent repair migrations: enumerated all 78 migrations dated 2026-06+ and grepped for INSERT/UPDATE against contact_tags, lead_score_factors, inbound_leads, lead_attribution, forms, property_meld_melds. Every hit is inside a function body. The only top-level data repair in the window, supabase/migrations/20260726183409_inbound_lead_recording_source_boundary.sql:387-401, writes recording_url and raw_payload only — it does not touch lead_score. The named precedent 20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql names no CRM dead object. Also confirmed no migration or script CALLS a dead RPC (no PERFORM/SELECT backfill), and scripts/qa/seed-branch-fixtures.sql (the CI seed) touches none of them.
(3) External-consumer annotations: read the actual surrounding lines for all six objects that appear in UPR-Web-Context.md — :539 contact_tags, :638 forms.form_version, :737 link_contact_to_job, :752 get_contact_addresses, :1111 get_job_demo_sheets, :2982 imported_job_id. All are plain schema/RPC inventory rows. No external app, partner portal, spreadsheet, Zapier/Make scenario, or owner automation is named against any of them. BILLING-CONTEXT.md and docs/integrations.md contain zero mentions of any CRM dead object. Note on :2982 — Property Meld IS an external partner, but the annotation says imported_job_id is "for the future import", i.e. a UPR-side pointer for an unbuilt feature; the partner writes the ingest columns, never this one.
(4) Doc-designated computation contracts: docs/crm-lead-lifecycle.md — the mandatory-read law for how anything CRM is counted, staged, classified or reported — contains ZERO occurrences of "score". docs/crm-roadmap.md:1264,1272 and docs/crm-dispatch.md:311,323 do designate score_lead as the Phase-9 scoring mechanism, which is the closest call in this domain, but it fails the second half of the test: lead scoring is not a business process that demonstrably still happens.

THE DECISIVE POINT ON SURFACE 4, and the thing the synthesizer most needs. I verified the calibration premise directly: catalog/prod-fn-stats.json is EMPTY (0 entries), confirming track_functions is OFF in production. But unlike get_commissions, score_lead's callers are NOT unobservable — it DELETEs from and INSERTs into lead_score_factors and UPDATEs inbound_leads on EVERY invocation (fndefs-q4-01.sql:419, :422, :424, :486, :499). The prod row counters therefore observe it directly: lead_score_factors shows ins 5 / upd 0 / del 0, and contact_tags shows all counters at 0. So the entire Phase-9 stack and contact_tags are corroborated dead by write counters, not merely by absence-of-grep. That closes the surface-4 loophole for four of the seven table/RPC claims.

WHERE THE EVIDENCE IS GENUINELY WEAKER — flag this to the owner. Three claims are read-only RPCs: get_ad_spend, get_contact_addresses, get_job_demo_sheets. They leave no row counters, track_functions is off, and upr-mcp has no per-RPC audit. Their dead verdict rests ENTIRELY on the absence of a repository caller and is unfalsifiable by observation. I found no surface touching them, so per "no evidence means clean" they stay clean — but P5 should treat their DROP as cheaply reversible (keep the full CREATE OR REPLACE body in the paired rollback) rather than assume safety, and should land the owner's answer to the mapper's open question 9 first.

ON THE MCP. upr-mcp's upr_rpc tool can invoke ANY RPC by name at owner discretion. I checked upr-mcp/src/* for a curated per-RPC allowlist and there is none — the only allowlist there is the ALLOWED_EMAIL owner gate (upr-mcp/src/audit.js:12, auth.js:63). So this is a uniform capability across all 92 CRM RPCs, not per-object evidence for any of the five, and I did not treat it as a surface. It remains a live owner question.

COVERAGE GAP I FOUND AND CLOSED. The mapper's stated search scope (crm.md search appendix) was src/, functions/, scripts/, upr-mcp/, supabase/tests/, tests/, .github/workflows/ — it did NOT cover ios/, ci_scripts/, tooling/, public/, or db/. docs/agent-alignment-ownership-DRAFT.md:78 also lists an email-worker/** deployable. I swept all of them: ios/ returns 0 files for every one of the 11 names (unfiltered count), and ci_scripts/, tooling/, public/ return zero. There is no email-worker/ directory in this repository — that DRAFT reference points at something outside this tree, and if it is a real separate deployable the owner should confirm it does not speak to CRM tables. That is the one residual unknown I cannot close from here.

TIMING FACT THAT CHANGES A MAPPER JUDGEMENT. The mapper discounted supabase/tests/ references as "test-only" because the db lane was dark. Per .claude/rules/initiative-status.md the qa-staging branch was SEEDED 2026-07-29 and the CI db lane is now LIVE. Two CRM dead objects (score_lead, lead_score_factors) plus one dead column (inbound_leads.lead_score) are now CI-EXECUTED. That does not resurrect them — it is the save_estimate_lines pattern — but it moves them from "free to drop" to "drop reddens CI unless the suite goes too". See kill_notes.

DOC-UPDATE DEBT FOR P5 (not a liveness surface, but it ships with the drop). UPR-Web-Context.md documents six of these dead objects as if live: :539 (contact_tags in the Core Business table list), :638 (form_version in the forms column inventory), :737 (link_contact_to_job under Jobs & Claims RPCs), :752 (get_contact_addresses under Contacts & Customers RPCs), :1111 (get_job_demo_sheets), :2982 (imported_job_id). Also stale and worth correcting either way: :642 documents a demo_sheets VIEW over forms that is absent from the current catalog. Leaving these rows in the canonical doc after the drop recreates the exact trap that made the domain hard to map.
