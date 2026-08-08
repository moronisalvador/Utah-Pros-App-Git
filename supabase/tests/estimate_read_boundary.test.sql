-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: estimate_read_boundary.test.sql
-- Phase: n/a — get_estimates() read boundary (20260808210000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Role-perspective proof. Establishes EFFECT; the credential-free source
-- contract in tests/qa/unit/estimate-read-boundary.test.js establishes INTENT.
--
-- WHAT IT PROVES
--   1. ALLOW — admin, office and project_manager each read the fixture estimate
--      back with its EXACT values. Not "did not raise": the values are read,
--      because a function that returns the wrong shape or silently empty rows
--      would pass a raises/does-not-raise check.
--   2. DENY — field_tech, estimator, supervisor, crm_partner, an INACTIVE admin
--      and an EXTERNAL admin are each refused with SQLSTATE 42501. The last two
--      matter most: billing_edit_access() requires active AND internal, not just
--      the right role, and a role-only reading of this change would miss them.
--      supervisor and estimator are refused by explicit owner decision
--      (2026-08-08): supervisors do not see quotes.
--   3. An authenticated user with NO employee row is refused.
--   4. service_role is ALLOWED — the /api/collections-chat worker reaches the
--      database that way and must keep working.
--   5. A claimless session (no JWT at all) is refused. This is the NULL-safety
--      case: auth.role() is NULL outside a PostgREST request, and `NULL <>
--      'service_role'` is NULL, which PL/pgSQL's IF treats as FALSE — a `<>`
--      here would skip the guard entirely and hand the estimate book to
--      anything holding a raw connection.
--   6. SIGNATURE FREEZE — 21 columns, exact names and types, unchanged from the
--      LANGUAGE sql original, so no deployed frontend breaks
--      (database-standard.md §3).
--
-- THE FIXTURE IS BUILT TO CATCH THE CONVERSION TRAP
--   `intended_division` is deliberately left NULL so that
--   COALESCE(e.intended_division, j.division::text) actually evaluates the
--   SECOND branch. jobs.division is enum job_division, and plpgsql's RETURN QUERY
--   demands an exact row-type match where LANGUAGE sql would have assignment-cast
--   it. If that ::text cast were ever dropped, this case raises "structure of
--   query does not match function result type" for ADMIN — the loudest possible
--   failure — instead of shipping. That defect reached the apply step on
--   20260807230000 and 17 static assertions had passed over it.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing estimate read boundary test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Actors ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE est_actor (label text, auth_id uuid, employee_id uuid);

DO $seed$
DECLARE r record; v_auth uuid; v_emp uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('admin',          'admin',           true,  false),
      ('office',         'office',          true,  false),
      ('pm',             'project_manager', true,  false),
      ('tech',           'field_tech',      true,  false),
      ('estimator',      'estimator',       true,  false),
      ('supervisor',     'supervisor',      true,  false),
      ('partner',        'crm_partner',     true,  false),
      ('inactive_admin', 'admin',           false, false),
      ('external_admin', 'admin',           true,  true )
    ) AS t(label, role, is_active, is_external)
  LOOP
    v_auth := gen_random_uuid();
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST est ' || r.label,
      'test-est-' || r.label || '-' || substr(v_auth::text, 1, 8) || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO est_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;
END;
$seed$;

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM est_actor WHERE label = p_label;
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

-- ── Fixture ─────────────────────────────────────────────────────────────────
CREATE TEMP TABLE est_fixture (contact_id uuid, claim_id uuid, claim_number text,
                               job_id uuid, job_number text, estimate_id uuid);

DO $fx$
DECLARE
  v_contact uuid; v_claim uuid; v_job uuid; v_est uuid;
  v_claim_no text := 'TEST-CLM-' || substr(gen_random_uuid()::text, 1, 8);
  v_job_no   text := 'TEST-JOB-' || substr(gen_random_uuid()::text, 1, 8);
BEGIN
  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST estimate fixture', '+1555' || substr(gen_random_uuid()::text, 1, 7))
  RETURNING id INTO v_contact;

  INSERT INTO public.claims (claim_number) VALUES (v_claim_no) RETURNING id INTO v_claim;

  -- division is the enum job_division. 'water' is a real label; the cast under
  -- test is j.division::text inside the COALESCE.
  INSERT INTO public.jobs (claim_id, job_number, division, primary_contact_id)
  VALUES (v_claim, v_job_no, 'water'::public.job_division, v_contact)
  RETURNING id INTO v_job;

  -- intended_division stays NULL ON PURPOSE — see the header. That is what makes
  -- the COALESCE fall through to the enum cast.
  -- estimate_type and status are constrained text, not free text:
  --   estimates_estimate_type_check -> initial | supplement | change_order | final
  --   estimates_status_check        -> draft | submitted | under_review | approved
  --                                    | denied | revised | paid
  INSERT INTO public.estimates (job_id, contact_id, estimate_number, estimate_type, status, amount, intended_division)
  VALUES (v_job, v_contact, 'TEST-EST-0001', 'initial', 'draft', 1234.56, NULL)
  RETURNING id INTO v_est;

  INSERT INTO est_fixture VALUES (v_contact, v_claim, v_claim_no, v_job, v_job_no, v_est);
END;
$fx$;

-- ── 1. ALLOW: the three billing roles read the fixture back, exactly ─────────
DO $allow$
DECLARE
  f est_fixture%ROWTYPE;
  r record;
  v_rows int;
  v_division text; v_client text; v_claim_no text; v_amount numeric; v_status text;
BEGIN
  SELECT * INTO f FROM est_fixture;

  FOR r IN SELECT unnest(ARRAY['admin', 'office', 'pm']) AS label
  LOOP
    PERFORM pg_temp.become(r.label);

    -- Scoped to the fixture row so a seeded clone cannot change the answer.
    SELECT count(*) INTO v_rows FROM public.get_estimates() g WHERE g.estimate_id = f.estimate_id;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'get_estimates returned % fixture rows for %, expected 1', v_rows, r.label;
    END IF;

    SELECT g.division, g.client_name, g.claim_number, g.amount, g.status
      INTO v_division, v_client, v_claim_no, v_amount, v_status
      FROM public.get_estimates() g WHERE g.estimate_id = f.estimate_id;

    -- v_division proves the enum cast survived the plpgsql conversion.
    IF v_division IS DISTINCT FROM 'water' THEN
      RAISE EXCEPTION 'division came back % for %, expected water (the j.division::text cast)', COALESCE(v_division, 'NULL'), r.label;
    END IF;
    IF v_client IS DISTINCT FROM 'TEST estimate fixture'
       OR v_claim_no IS DISTINCT FROM f.claim_number
       OR v_amount IS DISTINCT FROM 1234.56
       OR v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'fixture values came back wrong for %: client=%, claim=%, amount=%, status=%',
        r.label, v_client, v_claim_no, v_amount, v_status;
    END IF;

    PERFORM pg_temp.become_owner();
  END LOOP;
  RAISE NOTICE 'ok: admin, office and project_manager each read the fixture estimate with exact values';
END;
$allow$;

-- ── 2. DENY: every other role, plus inactive and external admins ────────────
DO $deny$
DECLARE
  r record;
  v_refused int := 0;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
    'tech', 'estimator', 'supervisor', 'partner', 'inactive_admin', 'external_admin'
  ]) AS label
  LOOP
    PERFORM pg_temp.become(r.label);
    BEGIN
      PERFORM count(*) FROM public.get_estimates();
      RAISE EXCEPTION 'LEAK: % read get_estimates and should have been refused', r.label;
    EXCEPTION
      WHEN insufficient_privilege THEN
        v_refused := v_refused + 1;
    END;
    PERFORM pg_temp.become_owner();
  END LOOP;

  IF v_refused <> 6 THEN
    RAISE EXCEPTION 'expected 6 refusals, got %', v_refused;
  END IF;
  RAISE NOTICE 'ok: field_tech, estimator, supervisor, crm_partner, inactive admin and external admin all refused 42501';
END;
$deny$;

-- ── 3. An authenticated user with no employee row ───────────────────────────
DO $unmapped$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM count(*) FROM public.get_estimates();
    RAISE EXCEPTION 'LEAK: an unmapped auth user read get_estimates';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'ok: an authenticated user with no employee row is refused';
END;
$unmapped$;

-- ── 4. service_role bypass — the worker path must keep working ──────────────
DO $svc$
DECLARE v_rows int;
BEGIN
  -- No `sub`, so billing_edit_access() would be false; the short-circuit on
  -- auth.role() is what lets this through.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SELECT count(*) INTO v_rows FROM public.get_estimates();
  IF v_rows < 1 THEN
    RAISE EXCEPTION 'service_role got % rows; the worker bypass is broken', v_rows;
  END IF;
  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'ok: service_role still reads get_estimates (collections-chat worker path)';
END;
$svc$;

-- ── 5. Claimless session — the IS DISTINCT FROM null-safety case ────────────
DO $claimless$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM count(*) FROM public.get_estimates();
    RAISE EXCEPTION 'LEAK: a claimless session read get_estimates — the guard used <> instead of IS DISTINCT FROM';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok: a claimless session is refused (auth.role() NULL does not skip the guard)';
END;
$claimless$;

-- ── 6. Signature freeze — 21 columns, unchanged ─────────────────────────────
DO $sig$
DECLARE v_sig text; v_expected text;
BEGIN
  SELECT pg_get_function_result(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_estimates';

  v_expected := 'TABLE(estimate_id uuid, estimate_number text, estimate_type text, status text, '
             || 'amount numeric, created_at timestamp with time zone, submitted_at timestamp with time zone, '
             || 'expiration_date date, qbo_estimate_id text, qbo_doc_number text, qbo_sync_error text, '
             || 'qbo_emailed_at timestamp with time zone, job_id uuid, job_number text, division text, '
             || 'claim_id uuid, claim_number text, contact_id uuid, client_name text, '
             || 'converted_invoice_id uuid, converted_invoice_number text)';

  IF v_sig IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'get_estimates signature changed — a deployed frontend reads these columns. got: % / expected: %',
      v_sig, v_expected;
  END IF;
  RAISE NOTICE 'ok: all 21 columns unchanged — no deployed frontend breaks';
END;
$sig$;

ROLLBACK;
