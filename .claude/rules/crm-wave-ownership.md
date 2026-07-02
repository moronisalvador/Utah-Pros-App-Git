# CRM Wave — File & RPC Ownership Manifest

**Committed by Phase F (Foundation). Binding for every Wave-1 session.**
Linked from `CLAUDE.md` ("CRM Phase Workflow") and `docs/crm-roadmap.md` (Roadmap v3).
Each wave session's read scope = `CLAUDE.md` + its phase block in `docs/crm-roadmap.md`
+ **this file**. Where the roadmap prose and this manifest disagree on a name or path,
**this manifest is authoritative** (it reflects what Foundation actually shipped).

Isolation in the wave is **not** the branch — it is (a) the `page:crm` feature flag
keeping every `/crm/*` screen invisible until the owner opens it, and (b) this ownership
split. Stay inside your files and your frozen stubs and no two sessions can collide.

---

## 1. Frozen in-wave — NOBODY edits these (Foundation owns them; they are the seams)

- `src/App.jsx` — all wave routes already wired (contacts, conversations, sequences, forms).
- `src/lib/crmIcons.jsx` — all wave nav icons already added.
- `src/components/CrmLayout.jsx` — nav already wired. **Exception:** Phase 6b is the *sole*
  in-wave editor, for role-gating only (see its row).
- `src/pages/crm/CrmOverview.jsx` and `src/pages/crm/CrmContacts.jsx` — slot **skeletons**.
  Fill the slot components they render, never the skeletons.
- `functions/lib/automated-send.js` — the completed send gate (email + sms). Import only.
- `functions/lib/sms-consent.js`, `functions/lib/email-consent.js` — consent predicates.
- `functions/lib/twilio.js`, `functions/lib/email.js`, `functions/lib/supabase.js`,
  `functions/lib/cors.js`, `functions/lib/date-mt.js`, `functions/lib/phone.js`,
  `src/lib/phone.js` (`normalizePhone`).
- `functions/api/send-message.js` — the staff-SMS worker. Call it (Phase 7, call-only,
  never `skip_compliance`); do not edit it.
- The two Foundation RPC **REPLACEs** — `move_lead_to_stage`, `get_contact_activity`.
  Do NOT re-REPLACE them; Foundation owns their signature and body.

**Shared append-only log tables** (`system_events`, `worker_runs`, `sms_consent_log`) are
DATA writes only — insert rows, never change their schema. **Zero schema migrations outside
Foundation** (see §4).

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Fills these frozen RPC stubs (body only) |
|---|---|---|---|
| B | 4d | `functions/api/run-automations.js` (new), `src/pages/crm/CrmSettings.jsx` | `get_automation_settings`, `set_automation_setting` |
| C | 6a | `src/components/crm/ContactsDirectory.jsx`, `src/components/crm/ContactDetail.jsx` | `get_crm_contacts`, `upsert_segment`, `get_segments`, `delete_segment`, `get_contact_consent` (+ backward-compat body-replace of `get_duplicate_contacts` adding email) |
| D | 6b | `src/components/crm/ImportExportPanel.jsx`, `src/components/crm/MergeTool.jsx`, `src/pages/Admin.jsx`, `src/pages/DevTools.jsx`, `src/lib/featureFlags.js`, `src/components/CrmLayout.jsx` (role-gating only) | `import_contacts`, `set_contact_owner`, `set_contact_lifecycle` (+ audit-hardening body-replaces of the email-campaign RPCs — see §3) |
| E | 7 | `src/pages/crm/CrmTasks.jsx`, `src/pages/crm/CrmLeads.jsx`, `src/components/crm/OverdueTasksWidget.jsx`, `src/pages/crm/CrmConversations.jsx` | `get_crm_tasks`, `upsert_crm_task`, `set_task_status`, `delete_crm_task`, `get_overdue_tasks` |
| G | 8 | `src/pages/crm/CrmSequences.jsx`, `functions/api/process-sequences.js` (new) | `upsert_sequence`, `get_sequences`, `delete_sequence`, `enroll_in_sequence` |
| H | 9 | `src/pages/crm/CrmReports.jsx`, `src/components/crm/ForecastWidget.jsx`, `src/lib/crmPipeline.js` + `src/lib/attribution.js` (+ tests), `functions/api/weekly-crm-digest.js` (new), `src/components/crm/AiReplySuggestions.jsx` (new) | `score_lead`, `get_conversion_trend`, `get_estimator_leaderboard`, `get_call_volume`, `get_speed_to_lead`, `get_estimate_aging`, `get_pipeline_movement`, `get_contact_ltv` |
| I | 10 | `src/pages/crm/CrmForms.jsx`, `functions/f/[public_id].js` (new), `functions/api/form-submit.js` (new), `public/embed.js` (new), optional `functions/api/webflow-form-webhook.js` (new) | `upsert_lead_from_form`, `upsert_form`, `get_forms` |
| J | 4b | `src/pages/Marketing.jsx`, `functions/api/send-text-campaign.js` (new); flips `automation_settings.sms_sending_enabled` ON via `set_automation_setting` after carrier approval | — (uses `sendAutomatedMessage('sms', …)`) |
| A | 1-closeout | `functions/lib/callrail.test.js`, `supabase/tests/crm_phase1_callrail.test.js` (+ fix-only: `CrmCallLog.jsx`, `CrmIntegrations.jsx`, `callrail-webhook.js`) | — |

`page:crm` opening to staff is gated on **Phase 6b** (defines per-screen roles first).

---

## 3. Frozen stub signatures (contracts — change the BODY, never the signature)

All are `SECURITY DEFINER`, `GRANT EXECUTE TO anon, authenticated`, and currently
`RAISE EXCEPTION 'not implemented (phase X)'`. Fill the body via a **function-body-only**
`CREATE OR REPLACE` migration; `migration-safety-checker` fails any signature change.

**Phase 4d**
- `get_automation_settings(p_org_id uuid DEFAULT NULL) → automation_settings`
- `set_automation_setting(p_key text, p_value boolean, p_org_id uuid DEFAULT NULL) → automation_settings`

**Phase 6a**
- `get_crm_contacts(p_search text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0, p_org_id uuid DEFAULT NULL) → SETOF json`
- `upsert_segment(p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL, p_filter jsonb DEFAULT '{}', p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL) → crm_segments`
- `get_segments(p_org_id uuid DEFAULT NULL) → SETOF crm_segments`
- `delete_segment(p_segment_id uuid) → void`
- `get_contact_consent(p_contact_id uuid) → json`
- (live, not a stub) `get_duplicate_contacts()` — body-replace to add normalized-email detection.

**Phase 6b**
- `import_contacts(p_rows jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL, p_filename text DEFAULT NULL) → crm_import_batches`
- `set_contact_owner(p_contact_id uuid, p_owner_id uuid, p_actor_id uuid DEFAULT NULL) → contacts`
- `set_contact_lifecycle(p_contact_id uuid, p_lifecycle_status text, p_actor_id uuid DEFAULT NULL) → contacts`
- Audit-hardening body-replaces (signatures unchanged, committed test that existing callers
  still succeed): add `system_events` writes to `set_campaign_exclusions`,
  `upsert_email_campaign`, `delete_email_campaign`; make the campaign-sent event fire exactly
  once with a sent/suppressed/failed counts payload (the `record_email_campaign_send` path).

**Phase 7**
- `get_crm_tasks(p_assignee uuid DEFAULT NULL, p_status text DEFAULT NULL, p_contact_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`
- `upsert_crm_task(p_id uuid DEFAULT NULL, p_title text DEFAULT NULL, p_notes text DEFAULT NULL, p_due_at timestamptz DEFAULT NULL, p_remind_at timestamptz DEFAULT NULL, p_assignee_id uuid DEFAULT NULL, p_contact_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL) → crm_tasks`
- `set_task_status(p_task_id uuid, p_status text, p_actor_id uuid DEFAULT NULL) → crm_tasks`
- `delete_crm_task(p_task_id uuid) → void`
- `get_overdue_tasks(p_assignee uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now()) → SETOF json`

**Phase 8**
- `upsert_sequence(p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL, p_status text DEFAULT NULL, p_steps jsonb DEFAULT '[]', p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL) → crm_sequences`
- `get_sequences(p_org_id uuid DEFAULT NULL) → SETOF json`
- `delete_sequence(p_sequence_id uuid) → void`
- `enroll_in_sequence(p_sequence_id uuid, p_contact_id uuid DEFAULT NULL, p_segment_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF crm_sequence_enrollments`

**Phase 9**
- `score_lead(p_lead_id uuid) → integer`
- `get_conversion_trend(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`
- `get_estimator_leaderboard(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`
- `get_call_volume(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`
- `get_speed_to_lead(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`
- `get_estimate_aging(p_org_id uuid DEFAULT NULL) → SETOF json`
- `get_pipeline_movement(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`
- `get_contact_ltv(p_contact_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL) → SETOF json`

**Phase 10**
- `upsert_lead_from_form(p_form_id uuid, p_submission_token text, p_data jsonb, p_utm jsonb DEFAULT '{}', p_consent boolean DEFAULT false, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL, p_org_id uuid DEFAULT NULL) → inbound_leads`
- `upsert_form(p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_schema jsonb DEFAULT '{}', p_theme jsonb DEFAULT '{}', p_status text DEFAULT NULL, p_publish boolean DEFAULT false, p_turnstile_enabled boolean DEFAULT false, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL) → form_definitions`
- `get_forms(p_org_id uuid DEFAULT NULL) → SETOF json`

---

## 4. Migration rule (amended for the wave)

Foundation owns **100% of SCHEMA** (tables, columns, constraints, policies, indexes) + both
shared RPC REPLACEs + every stub signature. A wave session ships **zero schema migrations**.
It MAY ship **function-body-only** `CREATE OR REPLACE` migrations for its OWN frozen stubs
(and, for 6b, the assigned audit-hardening replaces) — collision-free because every function
has exactly one owner. Any `CREATE OR REPLACE` of a live RPC must keep the existing signature
callable (new params `DEFAULT`) with a committed test that the shipped caller still succeeds.
If a table genuinely lacks a column you need: **stop and flag it** for a separate reviewed
change — do not `ALTER` a live table inside a wave phase.

## 5. index.css rule

Write CSS ONLY inside your phase's reserved marker
(`/* ─── CRM WAVE RESERVED — Phase N … ─── */`) at the bottom of `src/index.css`. Never edit
Foundation's block or another phase's section. Mobile-only rules use `@media (max-width: 768px)`.

## 6. Foundation tables this wave consumes

New tables (all org_id + RLS + policy at creation): `automation_settings` (SMS kill-switch
`sms_sending_enabled` default OFF), `crm_tasks`, `lead_stage_history`, `crm_segments`,
`crm_import_batches`, `crm_sequences` / `crm_sequence_steps` / `crm_sequence_enrollments`
(UNIQUE(sequence_id, contact_id) → enrollment idempotency), `lead_score_factors`,
`form_definitions` / `form_definition_versions` / `form_submissions` (public_id +
submission_token UNIQUE). New columns: `inbound_leads.lost_reason`, `inbound_leads.lead_score`,
`contacts.owner_id`, `contacts.lifecycle_status`, `pipeline_stages.win_probability` (0..1,
NULL → positional fallback).
