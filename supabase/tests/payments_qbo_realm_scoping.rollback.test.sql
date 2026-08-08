-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: payments_qbo_realm_scoping.rollback.test.sql
-- Phase: n/a — rollback proof for 20260808070000_payments_qbo_realm_scoping
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs immediately after the paired rollback, on the same disposable stack.
--
-- A rollback proof has to assert the UNDO actually happened, not merely that
-- nothing exploded — and it has to assert the RIGHT undo. My first draft failed
-- here for the correct reason: it demanded the column be dropped. It must not be.
-- database-standard.md §3 forbids DROP on a live table, so the rollback leaves
-- payments.qbo_realm_id in place (its DROP line is present only as a commented,
-- separately-reviewed option) and reverts behaviour by restoring the two bodies.
-- A nullable, non-secret, no-longer-written column costs nothing and is governed
-- by the same RLS and grants as every other payments column.
--
-- WHAT IT PROVES
--   1. The column REMAINS — dropping it would itself be the defect.
--   2. Both functions still EXIST and still carry their grants — the rollback
--      restores predecessor bodies, it does not delete the receipt machinery.
--   3. Neither restored body still stamps qbo_realm_id. The column survives, so a
--      body that kept stamping would NOT error — it would quietly keep half the
--      change alive, which is the failure mode worth catching here.
--   4. The auth.role() service-role gate is still present in both — the
--      rollback restores the 2026-08-06 repair, it must not undo it.
--   5. A reconcile still WORKS end to end after the rollback, writing a
--      projection with no realm stamp. This is the real regression test: it
--      proves the restored bodies actually execute against the reverted schema.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'REFUSING TO RUN: upr.isolated_test_database is not "on". This file is for a disposable database only.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION pg_temp.become(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', gen_random_uuid()::text)::text, true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;

-- ─── 1. column REMAINS (dropping it would be the defect) ────────────────────
DO $r1$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'qbo_realm_id'
  ) THEN
    RAISE EXCEPTION
      'FAIL R1: the rollback DROPPED payments.qbo_realm_id. database-standard.md §3 forbids DROP on a live table; the rollback must revert behaviour by restoring the bodies and leave the column in place.';
  END IF;
  RAISE NOTICE 'PASS R1 — column correctly left in place (no DROP on a live table)';
END
$r1$;

-- ─── 2. functions survive, with grants ──────────────────────────────────────
DO $r2$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    n := n + 1;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL R2: rollback re-opened % to a browser role', r.proname;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL R2: rollback dropped service_role EXECUTE on %', r.proname;
    END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL R2: expected both functions to survive, found %', n; END IF;
  RAISE NOTICE 'PASS R2 — both functions present, boundary intact';
END
$r2$;

-- ─── 3 + 4. restored bodies: no realm reference, gate still there ───────────
DO $r34$
DECLARE r record; v_def text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ILIKE '%qbo_realm_id%' AND v_def ILIKE '%INSERT INTO public.payments%'
       AND position('qbo_realm_id' in split_part(v_def, 'INSERT INTO public.payments', 2)) > 0
       AND position('qbo_realm_id' in left(split_part(v_def, 'INSERT INTO public.payments', 2), 400)) > 0 THEN
      RAISE EXCEPTION
        'FAIL R3: restored % still stamps qbo_realm_id — the rollback is only half applied', r.proname;
    END IF;
    IF v_def NOT ILIKE '%auth.role()%' THEN
      RAISE EXCEPTION 'FAIL R4: restored % lost its auth.role() service-role gate', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS R3/R4 — restored bodies are realm-free and still gated';
END
$r34$;

-- ─── 5. a reconcile still works after the rollback ──────────────────────────
DO $r5$
DECLARE
  v_contact uuid := gen_random_uuid();
  v_job     uuid := gen_random_uuid();
  v_inv     uuid := gen_random_uuid();
  v_rows int;
BEGIN
  -- qbo_customer_id is REQUIRED, not decoration: reconcile refuses with
  -- ALLOCATION_INVOICE_MISMATCH unless the invoice's contact carries the same
  -- QBO customer as the receipt. Found by running this proof, not by reading it.
  INSERT INTO public.contacts (id, name, phone, qbo_customer_id)
  VALUES (v_contact, 'QA Rollback Fixture', '+15550000002', '11');
  INSERT INTO public.jobs (id, job_number, primary_contact_id, division)
  VALUES (v_job, 'QA-RB-001', v_contact, 'water');
  INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
  VALUES (v_inv, 'QA-RB-INV-1', v_job, v_contact, 50.00, '900002', 'sent');

  PERFORM pg_temp.become('service_role');
  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '5555555555', 'qbo_payment_id', 'QA-RB-PAY-1', 'qbo_customer_id', '11',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA rb',
      'total_cents', 5000, 'applied_cents', 5000, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_inv, 'qbo_invoice_id', '900002', 'amount_cents', 5000, 'payer_type', 'homeowner')),
    'reconciled', 'qa-rb-event-1');

  SELECT count(*) INTO v_rows FROM public.payments WHERE qbo_payment_id = 'QA-RB-PAY-1';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL R5: reconcile wrote % projections after rollback, expected 1', v_rows;
  END IF;
  RAISE NOTICE 'PASS R5 — reconcile still functions against the reverted schema';
END
$r5$;

DO $done$ BEGIN RAISE NOTICE 'ALL PASS — payments_qbo_realm_scoping rollback'; END $done$;

ROLLBACK;
