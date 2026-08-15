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
--   R1.  The column REMAINS — dropping it would itself be the defect.
--   R2.  Both functions still EXIST and still carry their grants — the rollback
--        restores predecessor bodies, it does not delete the receipt machinery.
--   R2b. Realm values ALREADY WRITTEN survive. Measured against the projection
--        the seed committed while the migration was applied; without that
--        committed row there is nothing to measure, because this file's own
--        writes roll back.
--   R3.  Neither restored body still stamps qbo_realm_id. The column survives, so
--        a body that kept stamping would NOT error — it would quietly keep half
--        the change alive, which is the failure mode worth catching here.
--   R4.  The auth.role() service-role gate is still present in both — the
--        rollback restores the 2026-08-06 repair, it must not undo it.
--   R4b. Signatures, jsonb returns, SECURITY DEFINER and the pinned search_path
--        all survive the restore, so the deployed Workers keep calling them.
--   R5.  BEHAVIOURAL. A reconcile still WORKS end to end after the rollback and
--        the projection it writes comes back with qbo_realm_id NULL. This is the
--        real regression test: static text cannot tell a reverted body from one
--        that no longer executes, and this shows both at once.
--   R6.  BEHAVIOURAL. authenticated and anon are still refused 42501 by both.
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

-- Both claim forms, for the reason documented at length in the forward proof:
-- this local stack's auth.role() reads only the flattened legacy GUC, so setting
-- only the modern JSON leaves auth.role() NULL and every call slips through the
-- `<>` NULL gap instead of being tested. R3 keeps the legacy-read regression
-- covered by refusing any body that reads request.jwt.claim.role directly.
CREATE OR REPLACE FUNCTION pg_temp.become(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', gen_random_uuid()::text)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
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

-- ─── 2b. realm values ALREADY WRITTEN survive the rollback ──────────────────
-- The seed committed this projection while the migration was applied. Erasing
-- it would destroy the only record of which company that payment belongs to,
-- which is exactly what the rollback header promises not to do.
DO $r2b$
DECLARE v_rows int; v_realm text;
BEGIN
  SELECT count(*), max(qbo_realm_id) INTO v_rows, v_realm
  FROM public.payments WHERE qbo_payment_id = 'QA-SEED-KEEP-PAY';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'FAIL R2b: expected the 1 realm-stamped projection the seed committed while the migration was applied, found % — did the post-migration seed pass run?', v_rows;
  END IF;
  IF v_realm IS DISTINCT FROM '9341453160223706' THEN
    RAISE EXCEPTION
      'FAIL R2b: the rollback erased an already-written realm (now %). Those values are accurate history; the rollback must leave them alone.',
      COALESCE(v_realm, '<NULL>');
  END IF;
  RAISE NOTICE 'PASS R2b — a realm written before the rollback still reads 9341453160223706';
END
$r2b$;

-- ─── 3 + 4. restored bodies: stamping marker gone, gate still there ─────────
-- The marker is the one the rollback's own drift guard keys on, so this and the
-- guard cannot disagree about what "still stamping" means. The earlier version
-- of this case tried to reason about the first 400 characters after the payments
-- INSERT, which is brittle in both directions — and static text alone cannot
-- tell a reverted body from one that no longer runs. R5 covers the behaviour.
DO $r34$
DECLARE r record; v_def text; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    n := n + 1;
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%qbo_realm_id = EXCLUDED.qbo_realm_id%' THEN
      RAISE EXCEPTION
        'FAIL R3: restored % still carries the forward migration''s stamping marker — the rollback is only half applied', r.proname;
    END IF;
    IF v_def NOT LIKE '%auth.role() <> ''service_role''%' THEN
      RAISE EXCEPTION 'FAIL R4: restored % lost the 2026-08-06 auth.role() service-role gate', r.proname;
    END IF;
    IF v_def LIKE '%request.jwt.claim.role%' THEN
      RAISE EXCEPTION
        'FAIL R4: restored % reads the flattened request.jwt.claim.role — the rollback restored a body from BEFORE the 2026-08-06 repair, which is a gate that can never pass', r.proname;
    END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL R3: expected 2 functions, found %', n; END IF;
  RAISE NOTICE 'PASS R3/R4 — neither restored body stamps, both keep the service-role gate';
END
$r34$;

-- ─── 4b. shape freeze survived the restore ──────────────────────────────────
DO $r4b$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef, p.proconfig,
           pg_get_function_identity_arguments(p.oid) AS sig,
           pg_get_function_result(p.oid) AS ret
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    n := n + 1;
    IF NOT r.prosecdef THEN RAISE EXCEPTION 'FAIL R4b: % is no longer SECURITY DEFINER', r.proname; END IF;
    IF NOT (r.proconfig @> ARRAY['search_path=pg_catalog, public']) THEN
      RAISE EXCEPTION 'FAIL R4b: % lost its pinned search_path (proconfig %)', r.proname, r.proconfig;
    END IF;
    IF r.ret <> 'jsonb' THEN RAISE EXCEPTION 'FAIL R4b: % returns %, expected jsonb', r.proname, r.ret; END IF;
    IF r.proname = 'reconcile_qbo_payment_receipt'
       AND r.sig <> 'p_receipt jsonb, p_allocations jsonb, p_event_type text, p_event_key text' THEN
      RAISE EXCEPTION 'FAIL R4b: reconcile signature drifted — got (%)', r.sig;
    END IF;
    IF r.proname = 'finalize_qbo_payment_receipt'
       AND r.sig <> 'p_attempt_id uuid, p_receipt jsonb, p_allocations jsonb' THEN
      RAISE EXCEPTION 'FAIL R4b: finalize signature drifted — got (%)', r.sig;
    END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL R4b: expected 2 functions, found %', n; END IF;
  RAISE NOTICE 'PASS R4b — signatures, jsonb returns, SECURITY DEFINER and pinned search_path all intact';
END
$r4b$;

-- ─── 5. BEHAVIOURAL: a reconcile still works, and no longer stamps ──────────
-- This is the case that actually proves the revert. With the column surviving,
-- a body that kept stamping would NOT error — it would silently leave the change
-- half-applied, which static text checks cannot see and this can.
DO $r5$
DECLARE
  v_contact uuid := gen_random_uuid();
  v_job     uuid := gen_random_uuid();
  v_inv     uuid := gen_random_uuid();
  v_rows int; v_realm text;
BEGIN
  -- qbo_customer_id is REQUIRED, not decoration: reconcile refuses with
  -- ALLOCATION_INVOICE_MISMATCH unless the invoice's contact carries the same
  -- QBO customer as the receipt. Found by running this proof, not by reading it.
  INSERT INTO public.contacts (id, name, phone, qbo_customer_id)
  VALUES (v_contact, 'QA Rollback Fixture', '+15550000903', '903');
  INSERT INTO public.jobs (id, job_number, primary_contact_id, division)
  VALUES (v_job, 'QA-RB-001', v_contact, 'water');
  INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
  VALUES (v_inv, 'QA-RB-INV-1', v_job, v_contact, 50.00, '990301', 'sent');

  PERFORM pg_temp.become('service_role');
  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '5555555555', 'qbo_payment_id', 'QA-RB-PAY-1', 'qbo_customer_id', '903',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA rb',
      'total_cents', 5000, 'applied_cents', 5000, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_inv, 'qbo_invoice_id', '990301', 'amount_cents', 5000, 'payer_type', 'homeowner')),
    'reconciled', 'qa-rb-event-1');

  SELECT count(*), max(qbo_realm_id) INTO v_rows, v_realm
  FROM public.payments WHERE qbo_payment_id = 'QA-RB-PAY-1';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL R5: reconcile wrote % projections after rollback, expected 1', v_rows;
  END IF;
  IF v_realm IS NOT NULL THEN
    RAISE EXCEPTION
      'FAIL R5: a projection written AFTER the rollback still carries realm % — the stamping was not actually reverted', v_realm;
  END IF;
  RAISE NOTICE 'PASS R5 — the restored body executes and writes an UNSTAMPED projection (realm NULL)';
END
$r5$;

-- ─── 6. BEHAVIOURAL: the service-role gate still refuses ────────────────────
DO $r6$
DECLARE v_role text; v_refused int := 0;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM pg_temp.become(v_role);

    BEGIN
      PERFORM public.reconcile_qbo_payment_receipt(
        jsonb_build_object('qbo_realm_id', '6666666666', 'qbo_payment_id', 'QA-RB-DENY',
          'qbo_customer_id', '903', 'txn_date', '2026-08-08', 'total_cents', 100,
          'applied_cents', 100, 'unapplied_cents', 0, 'source', 'qbo'),
        jsonb_build_array(jsonb_build_object('invoice_id', gen_random_uuid(),
          'qbo_invoice_id', '990301', 'amount_cents', 100, 'payer_type', 'homeowner')),
        'reconciled', 'qa-rb-deny-reconcile-' || v_role);
      RAISE EXCEPTION 'FAIL R6: % was NOT refused by reconcile after the rollback', v_role;
    EXCEPTION
      WHEN insufficient_privilege THEN v_refused := v_refused + 1;
    END;

    BEGIN
      PERFORM public.finalize_qbo_payment_receipt(
        gen_random_uuid(),
        jsonb_build_object('qbo_realm_id', '6666666666', 'qbo_payment_id', 'QA-RB-DENY',
          'qbo_customer_id', '903', 'txn_date', '2026-08-08', 'total_cents', 100,
          'applied_cents', 100, 'unapplied_cents', 0, 'source', 'qbo'),
        jsonb_build_array(jsonb_build_object('invoice_id', gen_random_uuid(),
          'qbo_invoice_id', '990301', 'amount_cents', 100, 'payer_type', 'homeowner')));
      RAISE EXCEPTION 'FAIL R6: % was NOT refused by finalize after the rollback', v_role;
    EXCEPTION
      WHEN insufficient_privilege THEN v_refused := v_refused + 1;
    END;
  END LOOP;

  IF v_refused <> 4 THEN RAISE EXCEPTION 'FAIL R6: expected 4 refusals (2 functions x 2 roles), got %', v_refused; END IF;
  RAISE NOTICE 'PASS R6 — the 2026-08-06 auth.role() gate survived the rollback (4 refusals)';
END
$r6$;

DO $done$ BEGIN RAISE NOTICE 'ALL PASS — payments_qbo_realm_scoping rollback'; END $done$;

ROLLBACK;
