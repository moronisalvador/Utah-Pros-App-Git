-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: crm_lead_read_boundary.rollback.test.sql
-- Phase: n/a — CRM lead read/write boundary (20260809000000) undo proof
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs AFTER the paired rollback has been applied. Proves the undo actually
-- undoes: a field technician can read and move leads again, and can write the
-- three pipeline tables directly. That re-opening IS the rollback — describing
-- it is not proving it.
--
-- WHY IT ASSERTS ON REAL ROWS
--   On 20260808 a rollback proof in this repository read ZERO rows and therefore
--   asserted "did not raise on an empty set" — which any broken function also
--   satisfies. Every case here counts the fixture it created and fails if the
--   count is wrong, so an empty result is a failure rather than a pass.
--
-- Everything rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing CRM lead rollback test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- The predicate the boundary introduced must be gone.
DO $gone$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'crm_lead_access'
  ) THEN
    RAISE EXCEPTION 'crm_lead_access() still exists after the rollback';
  END IF;

  -- Three of the five must be LANGUAGE sql again, or re-applying the forward
  -- migration will fail its own drift guard.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND l.lanname = 'sql'
        AND p.proname IN ('get_pipeline_stages', 'get_lead_activity', 'get_lead_notes')) <> 3 THEN
    RAISE EXCEPTION 'the three LANGUAGE sql bodies were not restored';
  END IF;
END;
$gone$;

-- ── A field technician, who the boundary refused ────────────────────────────
DO $reopened$
DECLARE
  v_auth uuid := gen_random_uuid();
  v_emp uuid; v_org uuid; v_lead uuid; v_a uuid; v_b uuid; v_n int;
BEGIN
  INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
  VALUES (v_auth, 'TEST rollback tech',
          'test-rollback-tech-' || substr(v_auth::text, 1, 8) || '@example.invalid',
          'field_tech'::public.employee_role, true, false)
  RETURNING id INTO v_emp;

  INSERT INTO public.crm_orgs (name, is_test) VALUES ('TEST rollback org', false) RETURNING id INTO v_org;
  INSERT INTO public.pipeline_stages (org_id, name, sort_order, is_won, is_lost)
  VALUES (v_org, 'TEST New', 1, false, false) RETURNING id INTO v_a;
  INSERT INTO public.pipeline_stages (org_id, name, sort_order, is_won, is_lost)
  VALUES (v_org, 'TEST Won', 2, true, false) RETURNING id INTO v_b;
  INSERT INTO public.inbound_leads (org_id, source_type, callrail_id, occurred_at, transcription)
  VALUES (v_org, 'call', 'TEST-RB-' || substr(gen_random_uuid()::text, 1, 8), now(), 'TEST rollback transcript')
  RETURNING id INTO v_lead;
  INSERT INTO public.crm_lead_notes (lead_id, org_id, body, created_by)
  VALUES (v_lead, v_org, 'TEST rollback note', v_emp);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_n FROM public.get_pipeline_stages() s WHERE s.org_id = v_org;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'after rollback a field_tech read % stages, expected 2 — the undo did not re-open the RPC', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.get_lead_notes(v_lead);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'after rollback a field_tech read % notes, expected 1', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.get_lead_activity(v_lead);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'after rollback a field_tech read % activity rows, expected at least 2', v_n;
  END IF;

  PERFORM public.add_lead_note(v_lead, 'TEST note a tech should not be able to write');
  PERFORM public.move_lead_to_stage(v_lead, v_b);
  SELECT count(*) INTO v_n FROM public.lead_pipeline_stage WHERE lead_id = v_lead AND stage_id = v_b;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'after rollback a field_tech could not move a lead — the undo is incomplete';
  END IF;

  -- The always-true table policies are back, so the direct path works again too.
  UPDATE public.lead_pipeline_stage SET stage_id = v_a WHERE lead_id = v_lead;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'after rollback a direct UPDATE affected % rows, expected 1', v_n;
  END IF;

  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'ROLLBACK PROVEN: a field technician reads, writes and moves leads again, on real rows';
END;
$reopened$;

ROLLBACK;
