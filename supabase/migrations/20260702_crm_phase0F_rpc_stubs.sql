-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase F — signature-frozen RPC stubs for the parallel wave
--
-- RENAMED 2026-07-17 (phaseF → phase0F): filename-sort landmine fix, content
-- unchanged. "phaseF" sorted AFTER every "phase<digit>" file on this same
-- date (ASCII digits < uppercase letters), so a from-scratch migration
-- replay would have applied the phase-specific RPC bodies FIRST, then this
-- Foundation stub LAST — overwriting the real implementations with
-- 'not implemented' stubs. "phase0F" sorts first, matching the real
-- apply order this already ran in live. See UPR-Web-Context.md.
--
-- docs/crm-roadmap.md, "Phase F — Foundation": ~30 stubs, one owner phase each.
-- Every stub is SECURITY DEFINER, GRANTed to anon + authenticated, and raises
-- 'not implemented (phase X)' until its owning wave session fills the body via
-- a function-body-only CREATE OR REPLACE. **Signatures are contracts** — a wave
-- session may change a stub's BODY but never its name/args/return type
-- (migration-safety-checker enforces). Ownership + exact signatures are the
-- committed manifest .claude/rules/crm-wave-ownership.md.
--
-- Return types: concrete row/table types where the shape is a cross-phase
-- contract (e.g. get_segments → SETOF crm_segments, consumed by Phase 8);
-- SETOF json where the owning phase alone shapes the rows (directory/report
-- lists) and no other phase reads them.
--
-- ADDITIVE: all new functions, nothing altered. One shared Supabase — live in
-- dev + main on apply, but every consumer is behind the page:crm flag.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ Phase 4d — fixed automations: settings ×2 ═══
CREATE OR REPLACE FUNCTION get_automation_settings(p_org_id uuid DEFAULT NULL)
RETURNS automation_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 4d)'; END; $$;
GRANT EXECUTE ON FUNCTION get_automation_settings(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION set_automation_setting(p_key text, p_value boolean, p_org_id uuid DEFAULT NULL)
RETURNS automation_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 4d)'; END; $$;
GRANT EXECUTE ON FUNCTION set_automation_setting(text, boolean, uuid) TO anon, authenticated;

-- ═══ Phase 6a — contacts read & segments ═══
CREATE OR REPLACE FUNCTION get_crm_contacts(
  p_search text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6a)'; END; $$;
GRANT EXECUTE ON FUNCTION get_crm_contacts(text, int, int, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION upsert_segment(
  p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_filter jsonb DEFAULT '{}'::jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_segments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6a)'; END; $$;
GRANT EXECUTE ON FUNCTION upsert_segment(uuid, text, text, jsonb, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_segments(p_org_id uuid DEFAULT NULL)
RETURNS SETOF crm_segments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6a)'; END; $$;
GRANT EXECUTE ON FUNCTION get_segments(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION delete_segment(p_segment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6a)'; END; $$;
GRANT EXECUTE ON FUNCTION delete_segment(uuid) TO anon, authenticated;

-- Unified do-not-contact read: dnd ∪ opt_out (SMS) ∪ email_suppressions (email).
CREATE OR REPLACE FUNCTION get_contact_consent(p_contact_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6a)'; END; $$;
GRANT EXECUTE ON FUNCTION get_contact_consent(uuid) TO anon, authenticated;

-- ═══ Phase 6b — ownership, CSV import ═══
CREATE OR REPLACE FUNCTION import_contacts(
  p_rows jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL, p_filename text DEFAULT NULL)
RETURNS crm_import_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6b)'; END; $$;
GRANT EXECUTE ON FUNCTION import_contacts(jsonb, uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION set_contact_owner(p_contact_id uuid, p_owner_id uuid, p_actor_id uuid DEFAULT NULL)
RETURNS contacts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6b)'; END; $$;
GRANT EXECUTE ON FUNCTION set_contact_owner(uuid, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION set_contact_lifecycle(p_contact_id uuid, p_lifecycle_status text, p_actor_id uuid DEFAULT NULL)
RETURNS contacts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 6b)'; END; $$;
GRANT EXECUTE ON FUNCTION set_contact_lifecycle(uuid, text, uuid) TO anon, authenticated;

-- ═══ Phase 7 — tasks ×4 + overdue ═══
CREATE OR REPLACE FUNCTION get_crm_tasks(
  p_assignee uuid DEFAULT NULL, p_status text DEFAULT NULL, p_contact_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 7)'; END; $$;
GRANT EXECUTE ON FUNCTION get_crm_tasks(uuid, text, uuid, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION upsert_crm_task(
  p_id uuid DEFAULT NULL, p_title text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL, p_remind_at timestamptz DEFAULT NULL, p_assignee_id uuid DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 7)'; END; $$;
GRANT EXECUTE ON FUNCTION upsert_crm_task(uuid, text, text, timestamptz, timestamptz, uuid, uuid, uuid, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION set_task_status(p_task_id uuid, p_status text, p_actor_id uuid DEFAULT NULL)
RETURNS crm_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 7)'; END; $$;
GRANT EXECUTE ON FUNCTION set_task_status(uuid, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION delete_crm_task(p_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 7)'; END; $$;
GRANT EXECUTE ON FUNCTION delete_crm_task(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_overdue_tasks(
  p_assignee uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 7)'; END; $$;
GRANT EXECUTE ON FUNCTION get_overdue_tasks(uuid, uuid, timestamptz) TO anon, authenticated;

-- ═══ Phase 8 — drip sequences ×4 ═══
CREATE OR REPLACE FUNCTION upsert_sequence(
  p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_status text DEFAULT NULL, p_steps jsonb DEFAULT '[]'::jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_sequences LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 8)'; END; $$;
GRANT EXECUTE ON FUNCTION upsert_sequence(uuid, text, text, text, jsonb, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_sequences(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 8)'; END; $$;
GRANT EXECUTE ON FUNCTION get_sequences(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION delete_sequence(p_sequence_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 8)'; END; $$;
GRANT EXECUTE ON FUNCTION delete_sequence(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION enroll_in_sequence(
  p_sequence_id uuid, p_contact_id uuid DEFAULT NULL, p_segment_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF crm_sequence_enrollments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 8)'; END; $$;
GRANT EXECUTE ON FUNCTION enroll_in_sequence(uuid, uuid, uuid, uuid) TO anon, authenticated;

-- ═══ Phase 9 — intelligence: score_lead + reports ×7 ═══
CREATE OR REPLACE FUNCTION score_lead(p_lead_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION score_lead(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_conversion_trend(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_conversion_trend(date, date, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_estimator_leaderboard(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_estimator_leaderboard(date, date, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_call_volume(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_call_volume(date, date, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_speed_to_lead(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_speed_to_lead(date, date, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_estimate_aging(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_estimate_aging(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_pipeline_movement(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_pipeline_movement(date, date, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_contact_ltv(p_contact_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 9)'; END; $$;
GRANT EXECUTE ON FUNCTION get_contact_ltv(uuid, uuid) TO anon, authenticated;

-- ═══ Phase 10 — CRM Forms ×3 ═══
-- Idempotent on callrail_id = 'form:' || p_submission_token (the create_manual_lead
-- 'manual:' precedent); find-or-create contact by normalized phone; consent=true
-- writes an sms_consent_log opt_in row (IP + version).
CREATE OR REPLACE FUNCTION upsert_lead_from_form(
  p_form_id uuid, p_submission_token text, p_data jsonb, p_utm jsonb DEFAULT '{}'::jsonb,
  p_consent boolean DEFAULT false, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS inbound_leads LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 10)'; END; $$;
GRANT EXECUTE ON FUNCTION upsert_lead_from_form(uuid, text, jsonb, jsonb, boolean, text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION upsert_form(
  p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_schema jsonb DEFAULT '{}'::jsonb, p_theme jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT NULL, p_publish boolean DEFAULT false, p_turnstile_enabled boolean DEFAULT false,
  p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS form_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 10)'; END; $$;
GRANT EXECUTE ON FUNCTION upsert_form(uuid, text, jsonb, jsonb, text, boolean, boolean, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_forms(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RAISE EXCEPTION 'not implemented (phase 10)'; END; $$;
GRANT EXECUTE ON FUNCTION get_forms(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
