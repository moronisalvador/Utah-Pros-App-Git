# CRM Wave — File & RPC Ownership Manifest

**Last verified:** 2026-07-23

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
  > **AMENDED (2026-07-09, owner-approved):** the `sms-experience` initiative's Phase D edits
  > `automated-send.js` + `run-automations.js` **additively** (thread-visibility for automated SMS,
  > quiet-hours held-retry, MPS pacing) — signature AND return `{ok,skipped,reason}` vocabulary FROZEN
  > (`'sms_disabled'`/`'quiet_hours'` load-bearing for Phase 8/5 held-retry), with backward-compat
  > tests. See `docs/sms-experience-roadmap.md` §8.
- `functions/lib/sms-consent.js`, `functions/lib/email-consent.js` — consent predicates.
- `functions/lib/twilio.js`, `functions/lib/email.js`, `functions/lib/supabase.js`,
  `functions/lib/cors.js`, `functions/lib/date-mt.js`, `functions/lib/phone.js`,
  `src/lib/phone.js` (`normalizePhone`).
- `functions/api/send-message.js` — the staff-SMS worker. Call it (Phase 7, call-only,
  never `skip_compliance`); do not edit it.
- The two Foundation RPC **REPLACEs** — `move_lead_to_stage`, `get_contact_activity`.
  Do NOT re-REPLACE them; Foundation owns their signature and body.
  > **AMENDED (2026-07-21, standalone-production-fix precedent):** this freeze governs
  > Wave-1 parallel sessions. Two standalone production-fix migrations outside the wave —
  > `20260721_crm_contact_link_and_activity.sql` (added the appointment/invoice/
  > work_authorization arms) and `20260721_crm_unlinked_lead_activity.sql` (added the
  > lead_stage_history arm + widened the task arm, alongside the new `get_lead_activity`
  > function for pre-link leads) — each did a function-**body**-only `CREATE OR REPLACE` of
  > `get_contact_activity`, signature and return shape unchanged, with a committed
  > backward-compat test proving existing callers still succeed. Treat this line as a
  > signature freeze, not an absolute body freeze, for that class of change; a genuine
  > Wave-1 parallel session still must not touch it.

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
| J | 4b | `src/pages/Marketing.jsx`, `functions/api/send-text-campaign.js` (new); carrier approval is prerequisite evidence only—live flag enablement or sends require a separate explicit owner instruction and otherwise remain OFF | — (uses `sendAutomatedMessage('sms', …)`) |
| A | 1-closeout | `functions/lib/callrail.test.js`, `supabase/tests/crm_phase1_callrail.test.js` (+ fix-only: `CrmCallLog.jsx`, `CrmIntegrations.jsx`, `callrail-webhook.js`) | — |

`page:crm` opening to staff is gated on **Phase 6b** (defines per-screen roles first).

---

## 3. Frozen stub signatures (contracts — change the BODY, never the signature)

~~Historical Phase-F state: all were `SECURITY DEFINER`, `GRANT EXECUTE TO anon, authenticated`.~~
**Superseded by `.claude/rules/database-standard.md`:** that grant state is a finding, not a frozen
contract. Preserve callable signatures, but remediation validates callers, pins `search_path`,
revokes `PUBLIC, anon`, and grants only intended roles; public exceptions require §2 evidence/tests.
The stubs currently `RAISE EXCEPTION 'not implemented (phase X)'`. Fill the body via a **function-body-only**
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

---

## 7. Phase 5 addendum (2026-07-02) — Automation recipes (post-wave single session)

Committed by the Phase 5 re-plan (`docs/crm-roadmap.md` → "Phase 5 re-plan (2026-07-02)" — the
authoritative phase block). Phase 5 runs AFTER the wave (6b merged 2026-07-02) as **one**
session, **in parallel with Phase 10** — disjointness challenge-proven. §§1–6 stay binding
except as amended here.

| Session | Phase | Owns exclusively (edit only these) | RPCs (created directly — see amendments) |
|---|---|---|---|
| K | 5 | `src/pages/crm/CrmAutomations.jsx` (new), `functions/api/process-crm-automations.js` (new), its one migration + tests, **plus exactly these authorized additive seam edits:** `src/App.jsx` (one lazy import + one `<Route path="automations">` line), `src/lib/crmIcons.jsx` (add `IconAutomations` only), `src/components/CrmLayout.jsx` (one `SIDEBAR_ITEMS` row + its icon import only) | `get_crm_automations`, `upsert_crm_automation`, `set_automation_enabled`, `delete_crm_automation`, `get_automation_runs` |

**Amendments (rule-amendment transparency):**

- **Schema.** §4's "a wave session ships zero schema" governed Wave-1 *parallel* sessions.
  Phase 5 is post-wave and single-session: it ships its **own additive migration**
  (CLAUDE.md Rule 7 discipline — `crm_automations` + `crm_automation_runs`, RLS + explicit
  policy at creation, `org_id`, GRANTs, **`UNIQUE(automation_id, triggering_event_id)`**),
  audited by `migration-safety-checker`. Still forbidden: `ALTER`/`DROP` of any live table —
  including the orphan `automation_rules`, which stays untouched.
- **No frozen stubs.** Stubs freeze contracts BETWEEN parallel sessions; Phase 5 has no
  cross-session consumer, so it creates its five RPCs directly in its migration.
- **Seams.** The three seam edits in the matrix row are additive-only and exclusive to
  Session K (6b — CrmLayout's sole wave editor — merged 2026-07-02, freeing that seam).
  Everything else in §1 stays frozen: `automated-send.js` import-only (every send via
  `sendAutomatedMessage()`), `run-automations.js` is 4d-owned (read-only),
  `process-sequences.js` is Phase-8-owned (**import its exported helpers; never edit it**),
  send workers untouched, no `skip_compliance`.
- **index.css.** Session K writes only inside a new
  `/* ─── CRM WAVE RESERVED — Phase 5 (automation recipes · Session K) ─── */` marker
  appended at the bottom (§5 applies unchanged).
- **S1 guard (binding).** `upsert_crm_automation` must refuse an ENABLED rule whose trigger
  duplicates an enabled fixed automation (`automation_settings`: speed-to-lead,
  missed-call-textback, no-response follow-up, review request), and the engine must skip such
  rules at fire time — both with committed tests. Rationale: the fixed engine
  (`run-automations.js`) and the configurable engine keep dedup markers in namespaces that
  cannot see each other; without the guard, one missed call can produce two texts (TCPA,
  per-message penalties).

---

## 8. Phase 5-Ops addendum (2026-07-03) — Ops actions, scan triggers & recipe pack (Session L)

Committed by the Phase 5-Ops plan (`docs/crm-roadmap.md` → "Phase 5-Ops plan (2026-07-03)" — the
authoritative phase block). Runs post-Phase-5 (#253 merged) as **one** session; may run in
parallel with the Feedback Media initiative (disjoint files/tables). §§1–7 stay binding except
as amended here.

| Session | Phase | Owns exclusively (edit only these) | RPCs / schema (created directly) |
|---|---|---|---|
| L | 5-ops | `functions/api/process-crm-automations.js` + `process-crm-automations.test.js`, `src/pages/crm/CrmAutomations.jsx` (the worker + page were Session K's — freed by #253's merge; the test file already exists from K's suite and L extends it — all three assigned to L), its one migration + `supabase/tests/`, its reserved `index.css` marker | `set_job_phase(p_job_id uuid, p_to_phase text, p_actor_id uuid DEFAULT NULL)` (new, SECURITY DEFINER — encapsulates the jobs + job_phase_history two-write); `ALTER TABLE crm_automations ADD COLUMN trigger_kind` + `ADD COLUMN scan_config` (additive, Rule 7); recipe-pack seeds (`enabled=false`, idempotent) |

**Amendments / rules for Session L:**

- **Ownership transfer.** Session K closed with #253; its two code files transfer to Session L
  for this phase only. No other K artifact is touched (K's five RPCs keep their signatures —
  additive params with DEFAULTs allowed if needed for scan rules, with a committed
  old-signature test).
- **Additive-ALTER allowance.** §7 forbade ALTER outright for Session K; Session L may
  `ADD COLUMN` (only) on `crm_automations` — a feature-flagged table with zero production rows.
  Still forbidden: ALTER/DROP on any OTHER live table, and any DROP anywhere.
- **Call-only plumbing:** `create_notification`, `create_invoice_for_job`,
  `sendAutomatedMessage()`. The draft-invoice action must NEVER call `/api/qbo-invoice`
  (BILLING-CONTEXT: the human Save→QBO gate is sacred). Never write computed columns
  (`line_total`, `amount_paid`).
- **Frozen as ever:** `automated-send.js`, `run-automations.js` (4d), `process-sequences.js`
  (8 — import helpers only), send workers, `JobDetailPanel.jsx` (the phase two-write precedent
  is REPLICATED inside `set_job_phase`, not edited).
- **Scan registry is code, not config:** `scan_config` carries thresholds only; a scan's query
  lives in the worker's registry. Scan dedup = deterministic uuidv5 `triggering_event_id`
  (see the roadmap spec).
- **index.css:** only inside a new `/* ─── CRM WAVE RESERVED — Phase 5-Ops (Session L) ─── */`
  marker at the bottom.

---

## 9. Overview-enrichment addendum (2026-07-21) — CrmOverview skeleton unfreeze (owner-approved)

Recorded so §1's frozen list stays truthful. §1 froze `src/pages/crm/CrmOverview.jsx` as a slot
**skeleton** ("Fill the slot components they render, never the skeletons") to protect the Wave-1
*parallel* sessions from colliding on it. Wave 1 is complete (Phase 6b merged 2026-07-02; no parallel
CRM session is in flight), and standalone post-wave CRM edits are already precedented (the §1 AMENDED
note's 2026-07-21 standalone production-fix migrations). The **owner directed and approved** a standalone
"dashboard gap" initiative that enriches the CRM Overview front page into a sales & marketing command
center (KPIs + donut/trend charts), which requires editing the skeleton itself (data load + layout), not
just the slot components.

- **Authorized edit (this initiative only):** `src/pages/crm/CrmOverview.jsx` (rewrite to own a single
  `Promise.all` read + memoized derivations + the new layout) and a new
  `/* ─── CRM OVERVIEW ENRICHMENT (dashboard gap) ─── */` marker at the bottom of `src/index.css`.
- **New presentational components (own files, no collision):** `src/lib/crmCharts.js` (+ test),
  `src/components/crm/charts/{Donut,MiniTrend}.jsx`,
  `src/components/crm/{OverviewKpiStrip,PipelineStageCard,OverviewCharts,ConversionTrendCard}.jsx`.
- **Zero schema / zero migrations** — reads only through existing RPCs
  (`get_attribution_rollup`, `get_call_volume`, `get_speed_to_lead`, `get_estimate_aging`,
  `get_conversion_trend`, `get_crm_revenue_by_division`, `get_pipeline_stages`) +
  `lead_pipeline_stage`/`inbound_leads` selects. No frozen RPC signature touched; `ForecastWidget` /
  `OverdueTasksWidget` kept as-is.
- **Everything else in §§1–8 stays frozen.** This is a one-file skeleton unfreeze for a disclosed,
  owner-approved standalone initiative — not a reopening of the wave.
