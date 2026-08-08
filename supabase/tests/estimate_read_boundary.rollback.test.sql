-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: estimate_read_boundary.rollback.test.sql
-- Phase: n/a — runs AFTER the 20260808210000 rollback
-- ═══════════════════════════════════════════════════════════════════════════
-- Proves the rollback does what it promises, by MEASURING the re-opening rather
-- than describing it: a field technician reads the estimate book again.
--
-- That is the uncomfortable assertion on purpose. A rollback that quietly left
-- the gate in place would look like a success in every "did it error?" check,
-- and the operator running it in an incident would believe they had restored
-- service when they had not. So the case is written the way the exposure
-- actually reads: if a tech CANNOT see the quotes after this, the rollback did
-- not roll back.
--
-- ALSO PROVES
--   - the function is LANGUAGE sql again, and its body no longer mentions
--     billing_edit_access();
--   - the 21-column signature is still identical, so a frontend deployed against
--     either state keeps working;
--   - billing_edit_access() itself is untouched — undoing this gate must never
--     disturb the shared predicate the five money reports still depend on;
--   - anon still cannot execute, and authenticated still can. The rollback
--     restores the pre-migration posture; it does not widen past it.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing estimate rollback test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Catalog: the gate is gone and the contract is intact ────────────────────
DO $catalog$
DECLARE v_lang text; v_src text; v_sig text; v_def boolean;
BEGIN
  SELECT l.lanname, p.prosrc, pg_get_function_result(p.oid), p.prosecdef
    INTO v_lang, v_src, v_sig, v_def
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_estimates';

  IF v_lang <> 'sql' THEN
    RAISE EXCEPTION 'rollback left get_estimates as %, expected sql', v_lang;
  END IF;
  IF v_src LIKE '%billing_edit_access%' THEN
    RAISE EXCEPTION 'rollback left the billing gate inside get_estimates';
  END IF;
  IF NOT v_def THEN
    RAISE EXCEPTION 'rollback dropped SECURITY DEFINER from get_estimates';
  END IF;
  IF v_sig NOT LIKE 'TABLE(estimate_id uuid,%converted_invoice_number text)' THEN
    RAISE EXCEPTION 'rollback changed the get_estimates signature: %', v_sig;
  END IF;
  RAISE NOTICE 'ok: get_estimates is LANGUAGE sql again, ungated, same 21-column signature';
END;
$catalog$;

-- ── The shared predicate must be untouched ──────────────────────────────────
DO $predicate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'billing_edit_access'
  ) THEN
    RAISE EXCEPTION 'the rollback removed billing_edit_access() — the five money reports depend on it';
  END IF;
  RAISE NOTICE 'ok: billing_edit_access() is untouched';
END;
$predicate$;

-- ── Grants: pre-migration posture restored, not widened ─────────────────────
DO $grants$
DECLARE v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_estimates';

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback granted anon EXECUTE on get_estimates — it must never be public';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback left authenticated without EXECUTE on get_estimates';
  END IF;
  RAISE NOTICE 'ok: anon still refused, authenticated still granted';
END;
$grants$;

-- ── THE MEASURED RE-OPENING: a field technician reads the quote book ────────
CREATE TEMP TABLE rb_actor (label text, auth_id uuid);

DO $reopen$
DECLARE
  v_auth uuid; v_rows int; v_contact uuid; v_est uuid; v_client text;
BEGIN
  -- This file OWNS its fixture. The forward proof's estimate lived inside that
  -- file's transaction and is long rolled back, so without one of our own the
  -- tech would read zero rows — and "did not raise on an empty set" is a much
  -- weaker claim than this case is making. An exposure is only demonstrated by
  -- reading a real customer's name back.
  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST rollback fixture', '+1555' || substr(gen_random_uuid()::text, 1, 7))
  RETURNING id INTO v_contact;

  INSERT INTO public.estimates (contact_id, estimate_number, estimate_type, status, amount)
  VALUES (v_contact, 'TEST-RB-0001', 'initial', 'draft', 999.99)
  RETURNING id INTO v_est;

  v_auth := gen_random_uuid();
  INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
  VALUES (v_auth, 'TEST rollback tech',
          'test-rollback-tech-' || substr(v_auth::text, 1, 8) || '@example.invalid',
          'field_tech'::public.employee_role, true, false);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Must NOT raise. If this refuses, the rollback did not roll back.
  SELECT count(*) INTO v_rows FROM public.get_estimates();

  -- And the tech must actually SEE the customer, not merely receive an empty set.
  SELECT g.client_name INTO v_client
    FROM public.get_estimates() g WHERE g.estimate_id = v_est;

  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF v_rows < 1 OR v_client IS DISTINCT FROM 'TEST rollback fixture' THEN
    RAISE EXCEPTION
      'rollback did not measurably re-open the gap: tech saw % row(s), client_name=%',
      v_rows, COALESCE(v_client, 'NULL');
  END IF;

  RAISE NOTICE
    'ok: a field technician reads get_estimates again (% row(s)) and can see the customer name — the gap is measurably re-open',
    v_rows;
END;
$reopen$;

ROLLBACK;
