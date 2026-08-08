-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: office_financial_read_boundary.rollback.test.sql
-- Phase: n/a — paired rollback proof for 20260807230000
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs AFTER supabase/rollbacks/20260807230000_office_financial_read_boundary
--   .rollback.sql, inside the local qualification cycle.
--
-- A rollback for this migration is not "are the objects gone" — the migration
-- replaces BODIES, so the objects are there either way. The question is whether
-- the operator genuinely has a way back, which for a read boundary means the
-- gap is measurably re-open. So this asserts the thing the rollback header
-- promises in words: a FIELD TECHNICIAN can read the whole A/R book again.
--
-- WHAT IT PROVES
--   1. The guard is gone from all five bodies, and all five are LANGUAGE sql
--      again — a rollback that left the guard is not a rollback.
--   2. All five still exist with their deployed grants (authenticated yes,
--      anon no). A rollback that drops or un-grants them breaks every screen.
--   3. Behaviourally: an active field_tech reads real money out of all five.
--      That is the deliberate re-opening, proven rather than described.
--   4. The rollback leaves billing_edit_access() alone — widened, present, and
--      still owned by 20260804120100. This migration does not own it.
--   5. get_pipeline_summary is untouched on this side of the cycle too.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing money-read rollback test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── 1/2. Catalog: guard removed, language restored, grants intact ───────────
DO $c1$
DECLARE
  r record;
  v_seen int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, l.lanname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_ar_invoices', 'get_payments_ledger', 'get_payments_received',
                         'get_avg_ticket', 'get_revenue_by_division')
  LOOP
    IF r.def LIKE '%billing_edit_access()%' THEN
      RAISE EXCEPTION 'rollback left % still gated on billing_edit_access()', r.proname;
    END IF;
    IF r.def LIKE '%42501%' THEN
      RAISE EXCEPTION 'rollback left the refusal in %', r.proname;
    END IF;
    IF r.lanname <> 'sql' THEN
      RAISE EXCEPTION 'rollback left % as LANGUAGE %, not sql', r.proname, r.lanname;
    END IF;
    IF r.def NOT LIKE '%SECURITY DEFINER%' THEN
      RAISE EXCEPTION 'rollback changed the SECURITY DEFINER posture of %', r.proname;
    END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'rollback left % unreadable by authenticated', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'rollback granted % to anon', r.proname;
    END IF;
    v_seen := v_seen + 1;
  END LOOP;

  IF v_seen <> 5 THEN
    RAISE EXCEPTION 'expected 5 restored reports, found %', v_seen;
  END IF;
  RAISE NOTICE 'ok: all five restored to LANGUAGE sql, unguarded, grants intact';
END;
$c1$;

-- ── 3. The gap is genuinely re-open — a field tech reads the money ──────────
DO $c2$
DECLARE
  v_auth uuid := gen_random_uuid();
  v_contact uuid; v_claim uuid; v_job uuid;
  v_rows bigint;
  v_json jsonb;
BEGIN
  INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
  VALUES (v_auth, 'TEST rollback tech',
          'test-rollback-tech-' || substr(v_auth::text, 1, 8) || '@example.invalid',
          'field_tech'::public.employee_role, true, false);

  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST rollback fixture', '+1555' || substr(gen_random_uuid()::text, 1, 7))
  RETURNING id INTO v_contact;
  INSERT INTO public.claims DEFAULT VALUES RETURNING id INTO v_claim;
  INSERT INTO public.jobs (division, phase, claim_id, primary_contact_id)
  VALUES ('water'::public.job_division, 'job_received', v_claim, v_contact)
  RETURNING id INTO v_job;
  INSERT INTO public.invoices (job_id, contact_id, invoice_number, total, invoice_date, qbo_invoice_id)
  VALUES (v_job, v_contact, 'TEST-ROLLBACK-A', 250.00, DATE '2019-03-10', 'TEST-QBO-R');
  INSERT INTO public.payments (job_id, contact_id, amount, payment_date, payer_type, payment_method)
  VALUES (v_job, v_contact, 250.00, DATE '2019-03-12', 'homeowner', 'check');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_rows FROM public.get_ar_invoices() a
   WHERE a.invoice_number = 'TEST-ROLLBACK-A';
  IF v_rows <> 1 THEN
    RESET role;
    RAISE EXCEPTION 'rollback did not re-open get_ar_invoices to a field tech';
  END IF;

  SELECT count(*) INTO v_rows FROM public.get_payments_ledger(500) p WHERE p.job_id = v_job;
  IF v_rows <> 1 THEN
    RESET role;
    RAISE EXCEPTION 'rollback did not re-open get_payments_ledger to a field tech';
  END IF;

  v_json := public.get_revenue_by_division(DATE '2019-03-01', DATE '2019-03-31');
  IF (v_json->>'total')::numeric < 250.00 THEN
    RESET role;
    RAISE EXCEPTION 'rollback did not re-open get_revenue_by_division to a field tech: %', v_json;
  END IF;

  PERFORM public.get_payments_received(DATE '2019-03-01', DATE '2019-03-31');
  PERFORM public.get_avg_ticket(DATE '2019-03-01', DATE '2019-03-31');

  PERFORM set_config('role', 'none', true);
  RESET role;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'ok: the gap is genuinely re-open — a field tech read A/R, the ledger and revenue';
END;
$c2$;

-- ── 4/5. What this migration does NOT own is undisturbed ───────────────────
DO $c3$
DECLARE v_body text; v_lang text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'billing_edit_access';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'rollback removed billing_edit_access() — it belongs to 20260804120100';
  END IF;
  IF v_body NOT LIKE '%''office''%' OR v_body NOT LIKE '%''project_manager''%' THEN
    RAISE EXCEPTION 'rollback narrowed billing_edit_access() — it is not this migration to change';
  END IF;

  SELECT l.lanname, pg_get_functiondef(p.oid) INTO v_lang, v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_summary';
  IF v_lang <> 'sql' OR v_body LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'get_pipeline_summary was touched; the Dashboard fetches it ungated for supervisor and estimator';
  END IF;

  RAISE NOTICE 'ok: billing_edit_access() and get_pipeline_summary are untouched';
END;
$c3$;

ROLLBACK;
