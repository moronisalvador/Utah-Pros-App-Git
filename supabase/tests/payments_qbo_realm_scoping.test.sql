-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: payments_qbo_realm_scoping.test.sql
-- Phase: n/a — standalone QBO money-path correctness repair (20260808070000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back behavioural proof for the realm-scoping
-- migration. Establishes EFFECT; tests/qa/unit/payments-qbo-realm-scoping.test.js
-- establishes INTENT only (it reads source text and cannot observe a write).
--
-- Self-contained on purpose. supabase/tests/qbo_multi_invoice_payment_receipts.test.sql
-- covers the same two RPCs but "deliberately refuses to run without two
-- same-contact, QBO-linked fixture invoices" — it assumes a SEEDED database, so
-- it cannot run on the disposable clean clone this file targets. Every row here
-- is created by the fixture and rolled back.
--
-- WHAT IT PROVES
--   1. COLUMN — payments.qbo_realm_id exists, is text, and is NULLABLE. Nullable
--      is load-bearing: the cleanup predicate is NULL-tolerant precisely so the
--      79 pre-existing legacy rows keep being removable by a void.
--   2. STAMP (reconcile) — a reconcile writes the realm onto every payments
--      projection it creates. This is what makes the JS-side scoping meaningful;
--      unstamped projections would match the NULL arm and defeat the fix.
--   3. RE-STAMP — a second reconcile of the SAME payment under a DIFFERENT realm
--      updates the stamp via ON CONFLICT ... qbo_realm_id = EXCLUDED.qbo_realm_id
--      rather than leaving the first realm behind. This is the self-healing tail
--      the migration's no-backfill argument depends on.
--   4. AUTH GATE SURVIVED — both replaced bodies still refuse a non-service_role
--      caller with SQLSTATE 42501. A body replacement silently dropping the
--      auth.role() gate repaired on 2026-08-06 is the expensive failure here,
--      and no static check catches it.
--   5. NULL-SAFETY — a caller with NO request claims at all (auth.role() IS NULL:
--      direct psql, pg_cron, a future internal caller) is still refused.
--   6. GRANTS — anon and authenticated hold no EXECUTE on either function;
--      service_role does. This managed project re-applies EXECUTE TO PUBLIC to
--      every replaced function, so the migration's REVOKE/GRANT block is
--      required, not cosmetic.
--   7. SIGNATURE FREEZE — both functions keep their exact argument types and
--      jsonb return, so the deployed Workers keep calling them unchanged.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Refuse to run anywhere but a disposable stack. current_database() is NOT a
-- usable guard — every Supabase database is named "postgres", including the
-- shared production project — so this keys on a GUC the qualifier sets and
-- nothing else does.
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'REFUSING TO RUN: upr.isolated_test_database is not "on". This file is for a disposable database only.';
  END IF;
END
$guard$;

-- Role switch through the claim object PostgREST actually sets. The legacy
-- flattened GUC request.jwt.claim.role is deliberately NOT set: a harness that
-- sets it manufactures the one signal production never sends, which is exactly
-- how the 2026-08-05 hollow-proof incident happened.
CREATE OR REPLACE FUNCTION pg_temp.become(p_role text, p_sub uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', COALESCE(p_sub::text, gen_random_uuid()::text))::text, true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.unbecome() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
DO $fixture$
DECLARE
  v_contact uuid := gen_random_uuid();
  v_job     uuid := gen_random_uuid();
  v_inv     uuid := gen_random_uuid();
BEGIN
  -- qbo_customer_id is REQUIRED, not decoration: reconcile refuses with
  -- ALLOCATION_INVOICE_MISMATCH unless the invoice's contact carries the same
  -- QBO customer as the receipt. Found by running this proof, not by reading it.
  INSERT INTO public.contacts (id, name, phone, qbo_customer_id)
  VALUES (v_contact, 'QA Realm Fixture', '+15550000001', '11');
  INSERT INTO public.jobs (id, job_number, primary_contact_id, division)
  VALUES (v_job, 'QA-REALM-001', v_contact, 'water');
  INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
  VALUES (v_inv, 'QA-REALM-INV-1', v_job, v_contact, 100.00, '900001', 'sent');

  CREATE TEMP TABLE qa_fixture (contact_id uuid, job_id uuid, invoice_id uuid) ON COMMIT DROP;
  INSERT INTO qa_fixture VALUES (v_contact, v_job, v_inv);
END
$fixture$;

-- ─── 1. COLUMN shape ────────────────────────────────────────────────────────
DO $t1$
DECLARE v_type text; v_nullable text;
BEGIN
  SELECT data_type, is_nullable INTO v_type, v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'qbo_realm_id';

  IF v_type IS NULL THEN RAISE EXCEPTION 'FAIL 1: payments.qbo_realm_id does not exist'; END IF;
  IF v_type <> 'text' THEN RAISE EXCEPTION 'FAIL 1: qbo_realm_id is %, expected text', v_type; END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'FAIL 1: qbo_realm_id is NOT NULL — the NULL-tolerant cleanup arm depends on nullable';
  END IF;
  RAISE NOTICE 'PASS 1 — payments.qbo_realm_id text, nullable';
END
$t1$;

-- ─── 2. reconcile STAMPS the realm on its projections ───────────────────────
DO $t2$
DECLARE
  v_inv uuid; v_stamped text; v_rows int;
BEGIN
  SELECT invoice_id INTO v_inv FROM qa_fixture;
  PERFORM pg_temp.become('service_role');

  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '1111111111', 'qbo_payment_id', 'QA-PAY-1', 'qbo_customer_id', '11',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA ref',
      'total_cents', 10000, 'applied_cents', 10000, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_inv, 'qbo_invoice_id', '900001', 'amount_cents', 10000, 'payer_type', 'homeowner')),
    'reconciled', 'qa-realm-event-1');

  SELECT count(*), max(qbo_realm_id) INTO v_rows, v_stamped
  FROM public.payments WHERE qbo_payment_id = 'QA-PAY-1';

  IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL 2: expected 1 projection, got %', v_rows; END IF;
  IF v_stamped IS DISTINCT FROM '1111111111' THEN
    RAISE EXCEPTION 'FAIL 2: projection carries realm %, expected 1111111111 — unstamped rows defeat the whole fix', COALESCE(v_stamped, '<NULL>');
  END IF;
  PERFORM pg_temp.unbecome();
  RAISE NOTICE 'PASS 2 — reconcile stamps qbo_realm_id on the projection';
END
$t2$;

-- ─── 3. RE-STAMP on re-reconcile under a different realm ────────────────────
DO $t3$
DECLARE v_inv uuid; v_stamped text;
BEGIN
  SELECT invoice_id INTO v_inv FROM qa_fixture;
  PERFORM pg_temp.become('service_role');

  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '2222222222', 'qbo_payment_id', 'QA-PAY-1', 'qbo_customer_id', '11',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA ref',
      'total_cents', 10000, 'applied_cents', 10000, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_inv, 'qbo_invoice_id', '900001', 'amount_cents', 10000, 'payer_type', 'homeowner')),
    'reconciled', 'qa-realm-event-2');

  SELECT max(qbo_realm_id) INTO v_stamped FROM public.payments WHERE qbo_payment_id = 'QA-PAY-1';
  IF v_stamped IS DISTINCT FROM '2222222222' THEN
    RAISE EXCEPTION 'FAIL 3: re-reconcile left realm at % — ON CONFLICT must re-stamp, that is the self-healing tail', COALESCE(v_stamped, '<NULL>');
  END IF;
  PERFORM pg_temp.unbecome();
  RAISE NOTICE 'PASS 3 — re-reconcile re-stamps via ON CONFLICT';
END
$t3$;

-- ─── 4. AUTH GATE survived the body replacement ─────────────────────────────
DO $t4$
DECLARE v_inv uuid; v_role text; v_refused int := 0;
BEGIN
  SELECT invoice_id INTO v_inv FROM qa_fixture;
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM pg_temp.become(v_role);
    BEGIN
      PERFORM public.reconcile_qbo_payment_receipt(
        jsonb_build_object('qbo_realm_id', '3333333333', 'qbo_payment_id', 'QA-PAY-DENY',
          'txn_date', '2026-08-08', 'total_cents', 100, 'applied_cents', 100,
          'unapplied_cents', 0, 'source', 'qbo'),
        jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount_cents', 100)),
        'reconciled', 'qa-realm-deny-' || v_role);
      RAISE EXCEPTION 'FAIL 4: % was NOT refused by reconcile_qbo_payment_receipt', v_role;
    EXCEPTION
      WHEN insufficient_privilege THEN v_refused := v_refused + 1;
    END;
    PERFORM pg_temp.unbecome();
  END LOOP;

  IF v_refused <> 2 THEN RAISE EXCEPTION 'FAIL 4: expected 2 refusals, got %', v_refused; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE qbo_payment_id = 'QA-PAY-DENY') THEN
    RAISE EXCEPTION 'FAIL 4: a refused call still wrote a projection';
  END IF;
  RAISE NOTICE 'PASS 4 — auth.role() gate intact on reconcile (2 refusals, 0 rows)';
END
$t4$;

-- ─── 5. NULL-SAFETY: no claims at all is still refused ──────────────────────
DO $t5$
DECLARE v_inv uuid;
BEGIN
  SELECT invoice_id INTO v_inv FROM qa_fixture;
  PERFORM pg_temp.unbecome();   -- auth.role() IS NULL from here
  BEGIN
    PERFORM public.reconcile_qbo_payment_receipt(
      jsonb_build_object('qbo_realm_id', '4444444444', 'qbo_payment_id', 'QA-PAY-NULLCLAIM',
        'txn_date', '2026-08-08', 'total_cents', 100, 'applied_cents', 100,
        'unapplied_cents', 0, 'source', 'qbo'),
      jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount_cents', 100)),
      'reconciled', 'qa-realm-nullclaim');
    RAISE EXCEPTION 'FAIL 5: a claimless caller was ALLOWED — the NULL-safety case regressed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 5 — claimless caller refused (42501)';
  END;
END
$t5$;

-- ─── 6. GRANTS ──────────────────────────────────────────────────────────────
DO $t6$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 6: anon holds EXECUTE on %', r.proname;
    END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 6: authenticated holds EXECUTE on %', r.proname;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 6: service_role LOST EXECUTE on % — the worker path is broken', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS 6 — anon/authenticated revoked, service_role granted on both';
END
$t6$;

-- ─── 7. SIGNATURE FREEZE ────────────────────────────────────────────────────
DO $t7$
DECLARE v_sig text; v_ret text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    INTO v_sig, v_ret
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reconcile_qbo_payment_receipt';
  IF v_sig <> 'p_receipt jsonb, p_allocations jsonb, p_event_type text, p_event_key text'
     OR v_ret <> 'jsonb' THEN
    RAISE EXCEPTION 'FAIL 7: reconcile signature drifted — got (%) RETURNS %', v_sig, v_ret;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    INTO v_sig, v_ret
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'finalize_qbo_payment_receipt';
  IF v_sig <> 'p_attempt_id uuid, p_receipt jsonb, p_allocations jsonb' OR v_ret <> 'jsonb' THEN
    RAISE EXCEPTION 'FAIL 7: finalize signature drifted — got (%) RETURNS %', v_sig, v_ret;
  END IF;
  RAISE NOTICE 'PASS 7 — both signatures and jsonb returns unchanged';
END
$t7$;

DO $done$ BEGIN RAISE NOTICE 'ALL PASS — payments_qbo_realm_scoping'; END $done$;

ROLLBACK;
