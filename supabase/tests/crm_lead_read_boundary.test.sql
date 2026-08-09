-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: crm_lead_read_boundary.test.sql
-- Phase: n/a — CRM lead read/write boundary (20260809000000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Role-perspective proof (database-standard.md §5b). Establishes EFFECT; the
-- credential-free source contract in tests/qa/unit/crm-lead-read-boundary.test.js
-- establishes INTENT.
--
-- WHAT IT PROVES
--   1. ALLOW — admin, office, project_manager AND crm_partner each read the
--      fixture back with its EXACT values from all five RPCs, and can move the
--      lead. crm_partner is the case that matters: gating these on
--      billing_edit_access() would have locked 6 active CRM partners out of the
--      desktop kanban, and a proof that only checked the roles the change is
--      "about" would have shipped that.
--   2. DENY — field_tech, estimator, supervisor, an INACTIVE admin and an
--      EXTERNAL admin are each refused with SQLSTATE 42501 on all five.
--   3. An authenticated user with NO employee row is refused.
--   4. Layer 2 works in BOTH directions: a per-employee override grants a
--      field_tech access, and revokes a crm_partner's despite their role row.
--      A one-directional check would pass on a predicate that ignores `false`.
--   5. service_role is ALLOWED — functions/api/transcribe-call.js advances
--      stages that way and must keep working.
--   6. A claimless session (no JWT at all) is refused. This is the NULL-safety
--      case: auth.role() is NULL outside a PostgREST request and `NULL <> 'x'`
--      is NULL, which PL/pgSQL's IF treats as FALSE — a `<>` here would skip
--      the guard for anything holding a raw connection.
--   7. THE BACK DOOR IS SHUT — a field_tech's direct UPDATE of
--      lead_pipeline_stage now affects zero rows, and their direct SELECT of
--      pipeline_stages returns none. Without this the RPC gate is theatre.
--   8. move_lead_to_stage fills moved_by from the caller's own session when the
--      argument is omitted, which is how the phone calls it.
--   9. SIGNATURE FREEZE — every deployed call shape still resolves, including
--      the two-argument move_lead_to_stage the native screen uses.
--
-- THE CONVERSION TRAP IS EXERCISED, NOT ASSUMED
--   Three of the five were LANGUAGE sql. plpgsql's RETURN QUERY demands an exact
--   row-type match where sql assignment-casts. get_lead_activity is therefore
--   read back across FOUR of its five UNION branches (lead, note, task,
--   stage_change) with a fixture that populates each one; if a cast were wrong
--   this raises "structure of query does not match function result type" for
--   ADMIN — the loudest possible failure — rather than shipping.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing CRM lead boundary test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Actors ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE lead_actor (label text, auth_id uuid, employee_id uuid);

DO $seed$
DECLARE r record; v_auth uuid; v_emp uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('admin',          'admin',           true,  false),
      ('office',         'office',          true,  false),
      ('pm',             'project_manager', true,  false),
      ('partner',        'crm_partner',     true,  false),
      ('tech',           'field_tech',      true,  false),
      ('estimator',      'estimator',       true,  false),
      ('supervisor',     'supervisor',      true,  false),
      ('inactive_admin', 'admin',           false, false),
      ('external_admin', 'admin',           true,  true ),
      ('override_tech',  'field_tech',      true,  false),
      ('revoked_partner','crm_partner',     true,  false)
    ) AS t(label, role, is_active, is_external)
  LOOP
    v_auth := gen_random_uuid();
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST lead ' || r.label,
      'test-lead-' || r.label || '-' || substr(v_auth::text, 1, 8) || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO lead_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;
END;
$seed$;

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM lead_actor WHERE label = p_label;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'unknown test actor %', p_label; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE FUNCTION pg_temp.become_owner() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);
END;
$$;

-- ── The nav rows the predicate resolves against ─────────────────────────────
-- The migration inserts the project_manager rows itself; office and crm_partner
-- are seeded here because db/baseline/schema.sql carries schema, not data.
INSERT INTO public.nav_permissions (nav_key, role, can_view)
VALUES ('crm_leads', 'office', true),
       ('crm_call_log', 'office', true),
       ('crm_leads', 'crm_partner', true),
       ('crm_call_log', 'crm_partner', true)
ON CONFLICT (nav_key, role) DO NOTHING;

-- Layer 2, both directions. A field_tech GAINS access by explicit grant; a
-- crm_partner LOSES it by explicit revocation despite holding the role row.
INSERT INTO public.employee_page_access (employee_id, nav_key, can_view)
SELECT employee_id, 'crm_leads', true FROM lead_actor WHERE label = 'override_tech';
INSERT INTO public.employee_page_access (employee_id, nav_key, can_view)
SELECT employee_id, 'crm_leads', false FROM lead_actor WHERE label = 'revoked_partner';
INSERT INTO public.employee_page_access (employee_id, nav_key, can_view)
SELECT employee_id, 'crm_call_log', false FROM lead_actor WHERE label = 'revoked_partner';

-- ── Fixture ─────────────────────────────────────────────────────────────────
CREATE TEMP TABLE lead_fixture (
  org_id uuid, lead_id uuid, stage_a uuid, stage_b uuid, note_id uuid
);

DO $fx$
DECLARE
  v_org uuid; v_lead uuid; v_a uuid; v_b uuid; v_note uuid; v_admin uuid;
BEGIN
  SELECT employee_id INTO v_admin FROM lead_actor WHERE label = 'admin';

  -- is_test = false, and the only org in a fresh container, so
  -- get_pipeline_stages' COALESCE default resolves to it.
  INSERT INTO public.crm_orgs (name, is_test) VALUES ('TEST lead org', false) RETURNING id INTO v_org;

  INSERT INTO public.pipeline_stages (org_id, name, sort_order, is_won, is_lost)
  VALUES (v_org, 'TEST New', 1, false, false) RETURNING id INTO v_a;
  INSERT INTO public.pipeline_stages (org_id, name, sort_order, is_won, is_lost)
  VALUES (v_org, 'TEST Won', 2, true, false) RETURNING id INTO v_b;

  INSERT INTO public.inbound_leads (org_id, source_type, callrail_id, occurred_at, transcription)
  VALUES (v_org, 'call', 'TEST-CR-' || substr(gen_random_uuid()::text, 1, 8),
          now() - interval '1 hour', 'TEST transcript body')
  RETURNING id INTO v_lead;

  -- Populates get_lead_activity's `note` branch.
  INSERT INTO public.crm_lead_notes (lead_id, org_id, body, created_by)
  VALUES (v_lead, v_org, 'TEST note body', v_admin) RETURNING id INTO v_note;

  -- Populates its `task` branch — t.title is the column the ::text cast guards.
  INSERT INTO public.crm_tasks (org_id, lead_id, title, notes, created_by)
  VALUES (v_org, v_lead, 'TEST task title', 'TEST task notes', v_admin);

  -- Populates its `stage_change` branch — 'Moved to ' || ps.name is the other cast.
  INSERT INTO public.lead_pipeline_stage (lead_id, org_id, stage_id, moved_by)
  VALUES (v_lead, v_org, v_a, v_admin);
  INSERT INTO public.lead_stage_history (lead_id, org_id, stage_id, moved_by)
  VALUES (v_lead, v_org, v_a, v_admin);

  INSERT INTO lead_fixture VALUES (v_org, v_lead, v_a, v_b, v_note);
END;
$fx$;

-- ── 1. ALLOW: the four lead roles read every RPC back, exactly ───────────────
DO $allow$
DECLARE
  f lead_fixture%ROWTYPE;
  r record;
  v_n int; v_title text; v_body text; v_type text; v_json json;
BEGIN
  SELECT * INTO f FROM lead_fixture;

  FOR r IN SELECT unnest(ARRAY['admin', 'office', 'pm', 'partner']) AS label
  LOOP
    PERFORM pg_temp.become(r.label);

    -- get_pipeline_stages, through the COALESCE default path the clients use.
    SELECT count(*) INTO v_n FROM public.get_pipeline_stages() s WHERE s.org_id = f.org_id;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'get_pipeline_stages returned % stages for %, expected 2', v_n, r.label;
    END IF;

    -- get_lead_activity, read across four of its five branches. This is where a
    -- botched sql -> plpgsql conversion raises instead of returning.
    SELECT count(*) INTO v_n FROM public.get_lead_activity(f.lead_id);
    IF v_n < 4 THEN
      RAISE EXCEPTION 'get_lead_activity returned % rows for %, expected at least 4', v_n, r.label;
    END IF;

    SELECT a.title, a.body INTO v_title, v_body
      FROM public.get_lead_activity(f.lead_id) a WHERE a.activity_type = 'lead';
    IF v_title IS DISTINCT FROM 'Call' OR v_body IS DISTINCT FROM 'TEST transcript body' THEN
      RAISE EXCEPTION 'lead branch came back (%, %) for %', COALESCE(v_title,'NULL'), COALESCE(v_body,'NULL'), r.label;
    END IF;

    SELECT a.title INTO v_title FROM public.get_lead_activity(f.lead_id) a WHERE a.activity_type = 'task';
    IF v_title IS DISTINCT FROM 'TEST task title' THEN
      RAISE EXCEPTION 'task branch title came back % for % (the t.title::text cast)', COALESCE(v_title,'NULL'), r.label;
    END IF;

    SELECT a.title INTO v_title FROM public.get_lead_activity(f.lead_id) a WHERE a.activity_type = 'stage_change';
    IF v_title IS DISTINCT FROM 'Moved to TEST New' THEN
      RAISE EXCEPTION 'stage_change title came back % for % (the concatenation cast)', COALESCE(v_title,'NULL'), r.label;
    END IF;

    -- get_lead_notes returns SETOF json; read a field out of it, not just a count.
    SELECT count(*) INTO v_n FROM public.get_lead_notes(f.lead_id);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'get_lead_notes returned % rows for %, expected 1', v_n, r.label;
    END IF;
    SELECT n INTO v_json FROM public.get_lead_notes(f.lead_id) n LIMIT 1;
    IF (v_json ->> 'body') IS DISTINCT FROM 'TEST note body' THEN
      RAISE EXCEPTION 'get_lead_notes body came back % for %', COALESCE(v_json ->> 'body','NULL'), r.label;
    END IF;

    -- add_lead_note writes, and returns the row it wrote.
    SELECT public.add_lead_note(f.lead_id, 'TEST note from ' || r.label) INTO v_json;
    IF (v_json ->> 'body') IS DISTINCT FROM 'TEST note from ' || r.label THEN
      RAISE EXCEPTION 'add_lead_note echoed % for %', COALESCE(v_json ->> 'body','NULL'), r.label;
    END IF;

    -- move_lead_to_stage with the TWO-argument shape the native screen uses.
    PERFORM public.move_lead_to_stage(f.lead_id, f.stage_b);
    SELECT stage_id::text INTO v_type FROM public.lead_pipeline_stage WHERE lead_id = f.lead_id;
    IF v_type IS DISTINCT FROM f.stage_b::text THEN
      RAISE EXCEPTION 'move_lead_to_stage did not land the lead on stage_b for %', r.label;
    END IF;
    PERFORM public.move_lead_to_stage(f.lead_id, f.stage_a);
  END LOOP;

  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'ALLOW: admin, office, project_manager and crm_partner read and wrote every lead RPC';
END;
$allow$;

-- ── 2 + 3 + 4. DENY, including both override directions ─────────────────────
DO $deny$
DECLARE
  f lead_fixture%ROWTYPE;
  r record;
  v_state text;
  v_stranger uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM lead_fixture;

  FOR r IN SELECT unnest(ARRAY[
    'tech', 'estimator', 'supervisor', 'inactive_admin', 'external_admin', 'revoked_partner'
  ]) AS label
  LOOP
    PERFORM pg_temp.become(r.label);

    BEGIN
      PERFORM count(*) FROM public.get_pipeline_stages();
      RAISE EXCEPTION 'get_pipeline_stages did NOT refuse %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      PERFORM count(*) FROM public.get_lead_activity(f.lead_id);
      RAISE EXCEPTION 'get_lead_activity did NOT refuse %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      PERFORM count(*) FROM public.get_lead_notes(f.lead_id);
      RAISE EXCEPTION 'get_lead_notes did NOT refuse %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      PERFORM public.add_lead_note(f.lead_id, 'TEST should never land');
      RAISE EXCEPTION 'add_lead_note did NOT refuse %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
      PERFORM public.move_lead_to_stage(f.lead_id, f.stage_b);
      RAISE EXCEPTION 'move_lead_to_stage did NOT refuse %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- An authenticated session whose subject matches no employee row.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM count(*) FROM public.get_lead_notes(f.lead_id);
    RAISE EXCEPTION 'get_lead_notes did NOT refuse a session with no employee row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Layer 2 the other way: an explicit grant lets a field_tech through.
  PERFORM pg_temp.become('override_tech');
  IF (SELECT count(*) FROM public.get_lead_notes(f.lead_id)) <> 1 THEN
    RAISE EXCEPTION 'the per-employee override did not grant access to override_tech';
  END IF;

  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'DENY: field_tech, estimator, supervisor, inactive, external, revoked-override and stranger all refused; explicit grant honoured';
END;
$deny$;

-- ── 5 + 6. service_role allowed; a claimless connection refused ──────────────
DO $edges$
DECLARE f lead_fixture%ROWTYPE; v_n int;
BEGIN
  SELECT * INTO f FROM lead_fixture;

  -- transcribe-call.js reaches the database this way and advances stages.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('role', 'service_role', true);
  SELECT count(*) INTO v_n FROM public.get_pipeline_stages() s WHERE s.org_id = f.org_id;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'service_role got % stages, expected 2 — the worker path is broken', v_n;
  END IF;
  PERFORM public.move_lead_to_stage(f.lead_id, f.stage_b, NULL, NULL);
  PERFORM public.move_lead_to_stage(f.lead_id, f.stage_a, NULL, NULL);
  PERFORM pg_temp.become_owner();

  -- No JWT at all. auth.role() is NULL here; `NULL <> 'service_role'` is NULL,
  -- which IF treats as false — a `<>` would hand the pipeline to a raw connection.
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM count(*) FROM public.get_lead_notes(f.lead_id);
    RAISE EXCEPTION 'a claimless session was NOT refused — the guard used <> instead of IS DISTINCT FROM';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'EDGES: service_role allowed, claimless session refused';
END;
$edges$;

-- ── 7. The back door under the RPCs ─────────────────────────────────────────
DO $tables$
DECLARE f lead_fixture%ROWTYPE; v_n int;
BEGIN
  SELECT * INTO f FROM lead_fixture;

  PERFORM pg_temp.become('tech');

  -- Before this migration these three were ALL USING (true) to authenticated,
  -- so a field tech could move a lead with no history row and no audit event.
  UPDATE public.lead_pipeline_stage SET stage_id = f.stage_b WHERE lead_id = f.lead_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'a field_tech UPDATEd % lead_pipeline_stage rows directly — the RPC gate is theatre', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.pipeline_stages;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'a field_tech read % pipeline_stages rows directly', v_n;
  END IF;

  DELETE FROM public.lead_stage_history WHERE lead_id = f.lead_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'a field_tech DELETEd % lead_stage_history rows directly', v_n;
  END IF;

  -- The four client SELECTs that legitimately read lead_pipeline_stage must survive.
  PERFORM pg_temp.become('partner');
  SELECT count(*) INTO v_n FROM public.lead_pipeline_stage WHERE lead_id = f.lead_id;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'crm_partner read % lead_pipeline_stage rows, expected 1 — CrmLeads/CrmOverview are broken', v_n;
  END IF;

  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'TABLES: browser writes closed on all three, the four legitimate SELECTs survive';
END;
$tables$;

-- ── 8. The actor a phone move records ───────────────────────────────────────
DO $actor$
DECLARE f lead_fixture%ROWTYPE; v_moved uuid; v_expected uuid;
BEGIN
  SELECT * INTO f FROM lead_fixture;
  SELECT employee_id INTO v_expected FROM lead_actor WHERE label = 'office';

  PERFORM pg_temp.become('office');
  -- Exactly how AdminLeadCenter calls it: no p_moved_by. Before this migration
  -- every stage move from the phone recorded moved_by = NULL.
  PERFORM public.move_lead_to_stage(f.lead_id, f.stage_b);
  PERFORM pg_temp.become_owner();

  SELECT moved_by INTO v_moved FROM public.lead_pipeline_stage WHERE lead_id = f.lead_id;
  IF v_moved IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'moved_by came back % , expected the caller''s own employee id %', COALESCE(v_moved::text,'NULL'), v_expected;
  END IF;

  SELECT actor_id INTO v_moved FROM public.system_events
   WHERE entity_id = f.lead_id AND event_type = 'crm_lead_stage_changed'
   ORDER BY created_at DESC LIMIT 1;
  IF v_moved IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'the audit event recorded actor % , expected %', COALESCE(v_moved::text,'NULL'), v_expected;
  END IF;

  RAISE NOTICE 'ACTOR: a two-argument move records the caller, not NULL';
END;
$actor$;

-- ── 9. Signature freeze ─────────────────────────────────────────────────────
DO $sig$
DECLARE v_sig text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'move_lead_to_stage';
  IF v_sig IS DISTINCT FROM 'p_lead_id uuid, p_stage_id uuid, p_moved_by uuid, p_lost_reason text' THEN
    RAISE EXCEPTION 'move_lead_to_stage signature drifted to: %', v_sig;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_stages';
  IF v_sig IS DISTINCT FROM 'p_org_id uuid' THEN
    RAISE EXCEPTION 'get_pipeline_stages signature drifted to: %', v_sig;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'add_lead_note';
  IF v_sig IS DISTINCT FROM 'p_lead_id uuid, p_body text, p_created_by uuid' THEN
    RAISE EXCEPTION 'add_lead_note signature drifted to: %', v_sig;
  END IF;

  -- The project_manager grant the owner's decision depends on.
  IF (SELECT count(*) FROM public.nav_permissions
       WHERE role = 'project_manager' AND nav_key IN ('crm_leads','crm_call_log') AND can_view) <> 2 THEN
    RAISE EXCEPTION 'project_manager did not receive both CRM lead nav rows';
  END IF;

  RAISE NOTICE 'SIGNATURES: every deployed call shape still resolves';
END;
$sig$;

ROLLBACK;
