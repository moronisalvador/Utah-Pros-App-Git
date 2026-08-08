-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: payments_qbo_realm_scoping.test.sql
-- Phase: n/a — standalone QBO money-path correctness repair (20260808070000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back behavioural proof for the realm-scoping
-- migration. Establishes EFFECT; tests/qa/unit/payments-qbo-realm-scoping.test.js
-- establishes INTENT only (it reads source text and cannot observe a write).
--
-- Self-contained except for the committed rows in
-- payments_qbo_realm_scoping.seed.sql, which exist because two claims here are
-- meaningless unless a row crosses a boundary this transaction cannot cross
-- (see that file's header). Everything else is created and rolled back here.
--
-- supabase/tests/qbo_multi_invoice_payment_receipts.test.sql covers the same two
-- RPCs but "deliberately refuses to run without two same-contact, QBO-linked
-- fixture invoices" — it assumes a SEEDED database, so it cannot run on the
-- disposable clean clone this file targets.
--
-- WHAT IT PROVES
--   1. COLUMN — payments.qbo_realm_id exists, is text, is NULLABLE and has NO
--      default. All three are load-bearing: the Worker's cleanup predicate is
--      NULL-tolerant precisely so the pre-existing legacy rows stay removable by
--      a void, and a default would silently backfill new rows with a realm
--      nobody verified.
--   2. NO BACKFILL — a payments row committed BEFORE the migration still reads
--      qbo_realm_id IS NULL after it. The migration's whole safety argument is
--      that it asserts nothing about history it cannot verify.
--   3. STAMP (reconcile) — a reconcile writes the realm onto EVERY payments
--      projection it creates, across a multi-invoice allocation. Unstamped
--      projections would match the NULL-tolerant arm and defeat the fix.
--   4. STAMP (finalize) — the same, through reserve → mark_created → finalize,
--      which is the outbound path the grouped Receive-Payment screen uses.
--   5. SELF-HEALING — a pre-existing NULL-realm row that collides on
--      (qbo_payment_id, invoice_id) is stamped by the ON CONFLICT DO UPDATE
--      branch on re-reconcile. This is the tail the no-backfill decision leans on.
--   6. ★ CROSS-REALM ISOLATION — the defect this migration exists to close.
--      Two receipts share ONE qbo_payment_id in TWO realms; removing realm A
--      leaves realm B's money untouched and still correctly attributed.
--   6b. THE WORKER PREDICATE — measured directly: the unscoped predicate
--      removeQboPaymentFromUpr() used reaches BOTH realms; the realm-scoped
--      NULL-tolerant replacement reaches realm A and the legacy tail only.
--   7. AUTH GATE SURVIVED — both replaced bodies still refuse a non-service_role
--      caller with SQLSTATE 42501, writing nothing. A body replacement silently
--      dropping the auth.role() gate repaired on 2026-08-06 is the expensive
--      failure here, and no static check catches it.
--   8. NULL-CLAIM — pins a KNOWN pre-existing gap rather than asserting a
--      refusal that does not happen. See the case for why.
--   9. GRANTS — anon and authenticated hold no EXECUTE on either function;
--      service_role does. This managed project re-applies EXECUTE TO PUBLIC to
--      every replaced function, so the migration's REVOKE/GRANT block is
--      required, not cosmetic.
--  10. SHAPE FREEZE — both keep their exact argument types, jsonb return,
--      SECURITY DEFINER and pinned search_path, so the deployed Workers keep
--      calling them unchanged.
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
CREATE OR REPLACE FUNCTION pg_temp.become(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', gen_random_uuid()::text)::text, true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.unbecome() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;

DO $harness$
BEGIN
  PERFORM pg_temp.become('service_role');
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> '' THEN
    RAISE EXCEPTION 'harness must not set the legacy flattened GUC; PostgREST does not send it';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'auth.role() did not resolve service_role from request.jwt.claims (got %)',
      COALESCE(auth.role(), '<NULL>');
  END IF;
  PERFORM pg_temp.unbecome();
END
$harness$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
-- Two DIFFERENT QuickBooks companies, each with its own contact, job and
-- invoice. That is the real shape of the collision: a leftover row from a prior
-- QuickBooks connection whose payment number happens to match a live one.
DO $fixture$
DECLARE
  v_contact_a uuid := gen_random_uuid();
  v_contact_b uuid := gen_random_uuid();
  v_job_a uuid := gen_random_uuid();
  v_job_b uuid := gen_random_uuid();
  v_inv_a1 uuid := gen_random_uuid();
  v_inv_a2 uuid := gen_random_uuid();
  v_inv_b1 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.contacts (id, name, phone, qbo_customer_id)
  VALUES (v_contact_a, 'QA Realm A Customer', '+15550000801', '801');
  INSERT INTO public.contacts (id, name, phone, qbo_customer_id)
  VALUES (v_contact_b, 'QA Realm B Customer', '+15550000802', '802');

  INSERT INTO public.jobs (id, job_number, primary_contact_id, division)
  VALUES (v_job_a, 'QA-REALM-A-001', v_contact_a, 'water');
  INSERT INTO public.jobs (id, job_number, primary_contact_id, division)
  VALUES (v_job_b, 'QA-REALM-B-001', v_contact_b, 'mold');

  INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
  VALUES (v_inv_a1, 'QA-REALM-A-INV-1', v_job_a, v_contact_a, 100.00, '990101', 'sent');
  INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
  VALUES (v_inv_a2, 'QA-REALM-A-INV-2', v_job_a, v_contact_a, 250.00, '990102', 'sent');
  INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
  VALUES (v_inv_b1, 'QA-REALM-B-INV-1', v_job_b, v_contact_b, 175.00, '990201', 'sent');

  CREATE TEMP TABLE qa_fixture (
    contact_a uuid, contact_b uuid, job_a uuid, job_b uuid,
    inv_a1 uuid, inv_a2 uuid, inv_b1 uuid
  ) ON COMMIT DROP;
  INSERT INTO qa_fixture VALUES (v_contact_a, v_contact_b, v_job_a, v_job_b, v_inv_a1, v_inv_a2, v_inv_b1);
END
$fixture$;

-- ─── 1. COLUMN shape ────────────────────────────────────────────────────────
DO $t1$
DECLARE v_type text; v_nullable text; v_default text; v_found boolean;
BEGIN
  SELECT true, data_type, is_nullable, column_default
    INTO v_found, v_type, v_nullable, v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'qbo_realm_id';

  IF NOT COALESCE(v_found, false) THEN RAISE EXCEPTION 'FAIL 1: payments.qbo_realm_id does not exist'; END IF;
  IF v_type <> 'text' THEN RAISE EXCEPTION 'FAIL 1: qbo_realm_id is %, expected text', v_type; END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'FAIL 1: qbo_realm_id is NOT NULL — the NULL-tolerant cleanup arm depends on nullable';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION
      'FAIL 1: qbo_realm_id carries default % — a default silently attributes rows to a realm nobody verified', v_default;
  END IF;
  RAISE NOTICE 'PASS 1 — payments.qbo_realm_id text, nullable, no default';
END
$t1$;

-- ─── 2. NO BACKFILL ─────────────────────────────────────────────────────────
-- The seed committed this row BEFORE the ALTER TABLE ran.
DO $t2$
DECLARE v_realm text; v_rows int;
BEGIN
  SELECT count(*), max(qbo_realm_id) INTO v_rows, v_realm
  FROM public.payments WHERE qbo_payment_id = 'QA-SEED-LEGACY-PAY';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'FAIL 2: expected the 1 committed pre-migration legacy payment, found % — did the seed run before the migration?', v_rows;
  END IF;
  IF v_realm IS NOT NULL THEN
    RAISE EXCEPTION
      'FAIL 2: a row that predates the column now carries realm % — this migration must NOT backfill, and a wrong stamp is indistinguishable from a real one', v_realm;
  END IF;
  RAISE NOTICE 'PASS 2 — the pre-migration legacy payment is still unattributed (NULL), exactly as designed';
END
$t2$;

-- ─── 3. reconcile STAMPS every projection it writes ─────────────────────────
DO $t3$
DECLARE v_a1 uuid; v_a2 uuid; v_rows int; v_stamped int;
BEGIN
  SELECT inv_a1, inv_a2 INTO v_a1, v_a2 FROM qa_fixture;
  PERFORM pg_temp.become('service_role');

  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '1111111111', 'qbo_payment_id', 'QA-RECONCILE-PAY', 'qbo_customer_id', '801',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA reconcile',
      'total_cents', 35000, 'applied_cents', 35000, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(
      jsonb_build_object('invoice_id', v_a1, 'qbo_invoice_id', '990101', 'amount_cents', 10000, 'payer_type', 'homeowner'),
      jsonb_build_object('invoice_id', v_a2, 'qbo_invoice_id', '990102', 'amount_cents', 25000, 'payer_type', 'homeowner')),
    'reconciled', 'qa-reconcile-event');

  SELECT count(*), count(*) FILTER (WHERE qbo_realm_id = '1111111111')
    INTO v_rows, v_stamped
  FROM public.payments WHERE qbo_payment_id = 'QA-RECONCILE-PAY';

  IF v_rows <> 2 THEN RAISE EXCEPTION 'FAIL 3: expected 2 projections across 2 invoices, got %', v_rows; END IF;
  IF v_stamped <> 2 THEN
    RAISE EXCEPTION
      'FAIL 3: only % of 2 projections carry realm 1111111111 — an unstamped projection matches the NULL-tolerant arm and defeats the whole fix', v_stamped;
  END IF;
  PERFORM pg_temp.unbecome();
  RAISE NOTICE 'PASS 3 — reconcile stamps the realm on every projection (2/2)';
END
$t3$;

-- ─── 4. finalize STAMPS every projection it writes ──────────────────────────
-- Driven through the real outbound sequence: reserve -> mark_created -> finalize.
DO $t4$
DECLARE v_a1 uuid; v_a2 uuid; v_reserve jsonb; v_attempt uuid; v_rows int; v_stamped int;
BEGIN
  SELECT inv_a1, inv_a2 INTO v_a1, v_a2 FROM qa_fixture;
  PERFORM pg_temp.become('service_role');

  v_reserve := public.reserve_qbo_payment_receipt(
    'qa-client-request-finalize', 'qa-intuit-request-finalize', '1111111111',
    'qa-fingerprint-finalize-0000000000', jsonb_build_object('probe', 'finalize'), NULL);
  v_attempt := (v_reserve->>'attempt_id')::uuid;

  PERFORM public.mark_qbo_payment_receipt_created(
    v_attempt, 'QA-FINALIZE-PAY', jsonb_build_object('Id', 'QA-FINALIZE-PAY'));

  PERFORM public.finalize_qbo_payment_receipt(
    v_attempt,
    jsonb_build_object(
      'qbo_realm_id', '1111111111', 'qbo_payment_id', 'QA-FINALIZE-PAY', 'qbo_customer_id', '801',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA finalize',
      'total_cents', 12000, 'applied_cents', 12000, 'unapplied_cents', 0, 'source', 'upr'),
    jsonb_build_array(
      jsonb_build_object('invoice_id', v_a1, 'qbo_invoice_id', '990101', 'amount_cents', 4000, 'payer_type', 'homeowner'),
      jsonb_build_object('invoice_id', v_a2, 'qbo_invoice_id', '990102', 'amount_cents', 8000, 'payer_type', 'homeowner')));

  SELECT count(*), count(*) FILTER (WHERE qbo_realm_id = '1111111111')
    INTO v_rows, v_stamped
  FROM public.payments WHERE qbo_payment_id = 'QA-FINALIZE-PAY';

  IF v_rows <> 2 THEN RAISE EXCEPTION 'FAIL 4: expected 2 finalize projections, got %', v_rows; END IF;
  IF v_stamped <> 2 THEN
    RAISE EXCEPTION 'FAIL 4: only % of 2 finalize projections carry the realm', v_stamped;
  END IF;
  PERFORM pg_temp.unbecome();
  RAISE NOTICE 'PASS 4 — finalize stamps the realm on every projection (2/2), via reserve -> mark_created -> finalize';
END
$t4$;

-- ─── 5. SELF-HEALING via ON CONFLICT DO UPDATE ──────────────────────────────
-- The migration ships no backfill, so the historical tail can only be corrected
-- by being re-reconciled. Prove that actually happens.
DO $t5$
DECLARE v_b1 uuid; v_job_b uuid; v_contact_b uuid; v_before text; v_after text; v_rows int;
BEGIN
  SELECT inv_b1, job_b, contact_b INTO v_b1, v_job_b, v_contact_b FROM qa_fixture;

  -- A legacy row shaped exactly like the 79 on production: source='qbo', a QBO
  -- payment id, no realm, no receipt link.
  INSERT INTO public.payments (invoice_id, job_id, contact_id, amount, payment_date,
    payer_type, payment_method, source, qbo_payment_id, qbo_synced_at)
  VALUES (v_b1, v_job_b, v_contact_b, 175.00, DATE '2025-11-02',
    'homeowner', 'other', 'qbo', 'QA-HEAL-PAY', now());

  SELECT qbo_realm_id INTO v_before FROM public.payments WHERE qbo_payment_id = 'QA-HEAL-PAY';
  IF v_before IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5: fixture precondition broken — the legacy row already carries realm %', v_before;
  END IF;

  PERFORM pg_temp.become('service_role');
  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '2222222222', 'qbo_payment_id', 'QA-HEAL-PAY', 'qbo_customer_id', '802',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA heal',
      'total_cents', 17500, 'applied_cents', 17500, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_b1, 'qbo_invoice_id', '990201', 'amount_cents', 17500, 'payer_type', 'homeowner')),
    'reconciled', 'qa-heal-event');

  SELECT count(*), max(qbo_realm_id) INTO v_rows, v_after
  FROM public.payments WHERE qbo_payment_id = 'QA-HEAL-PAY';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL 5: expected the collision to UPDATE one row, got % rows', v_rows;
  END IF;
  IF v_after IS DISTINCT FROM '2222222222' THEN
    RAISE EXCEPTION
      'FAIL 5: the ON CONFLICT DO UPDATE branch left realm % — without qbo_realm_id = EXCLUDED.qbo_realm_id the historical tail never heals',
      COALESCE(v_after, '<NULL>');
  END IF;
  PERFORM pg_temp.unbecome();
  RAISE NOTICE 'PASS 5 — a colliding NULL-realm legacy row is stamped by the ON CONFLICT branch';
END
$t5$;

-- ─── 6. ★ CROSS-REALM ISOLATION — the defect this migration exists to close ──
-- QuickBooks Payment ids are per-company counters. Company A's payment 482 and
-- company B's payment 482 are different money. Removing A must not touch B.
DO $t6$
DECLARE
  v_a1 uuid; v_b1 uuid;
  v_removed jsonb;
  v_a_rows int; v_b_rows int; v_b_realm text;
BEGIN
  SELECT inv_a1, inv_b1 INTO v_a1, v_b1 FROM qa_fixture;
  PERFORM pg_temp.become('service_role');

  -- SAME qbo_payment_id, two realms, two companies, two invoices.
  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '1111111111', 'qbo_payment_id', 'QA-COLLIDE-482', 'qbo_customer_id', '801',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA collide A',
      'total_cents', 10000, 'applied_cents', 10000, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_a1, 'qbo_invoice_id', '990101', 'amount_cents', 10000, 'payer_type', 'homeowner')),
    'reconciled', 'qa-collide-event-a');

  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '2222222222', 'qbo_payment_id', 'QA-COLLIDE-482', 'qbo_customer_id', '802',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA collide B',
      'total_cents', 17500, 'applied_cents', 17500, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_b1, 'qbo_invoice_id', '990201', 'amount_cents', 17500, 'payer_type', 'homeowner')),
    'reconciled', 'qa-collide-event-b');

  SELECT count(*) FILTER (WHERE qbo_realm_id = '1111111111'),
         count(*) FILTER (WHERE qbo_realm_id = '2222222222')
    INTO v_a_rows, v_b_rows
  FROM public.payments WHERE qbo_payment_id = 'QA-COLLIDE-482';
  IF v_a_rows <> 1 OR v_b_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL 6: collision fixture is wrong — realm A rows %, realm B rows %', v_a_rows, v_b_rows;
  END IF;

  -- ── 6b. The exact predicate removeQboPaymentFromUpr() used, measured. ──
  -- Before this migration a projection carried no realm, so the scoped arm
  -- below could not discriminate and the unscoped one deleted both companies'
  -- money. These are the row sets each DELETE would take.
  IF (SELECT count(*) FROM public.payments
      WHERE qbo_payment_id = 'QA-COLLIDE-482' AND source = 'qbo') <> 2 THEN
    RAISE EXCEPTION 'FAIL 6b: the UNSCOPED predicate should reach both realms; it did not — fixture drift';
  END IF;
  IF (SELECT count(*) FROM public.payments
      WHERE qbo_payment_id = 'QA-COLLIDE-482' AND source = 'qbo'
        AND (qbo_realm_id IS NULL OR qbo_realm_id = '1111111111')) <> 1 THEN
    RAISE EXCEPTION
      'FAIL 6b: the REALM-SCOPED predicate still reaches more than realm A — the stamping is not discriminating';
  END IF;
  -- ...and it must still reach the unattributed historical tail, or every void
  -- and delete on pre-migration data silently stops working.
  IF (SELECT count(*) FROM public.payments
      WHERE qbo_payment_id = 'QA-SEED-LEGACY-PAY' AND source = 'qbo'
        AND (qbo_realm_id IS NULL OR qbo_realm_id = '1111111111')) <> 1 THEN
    RAISE EXCEPTION
      'FAIL 6b: the NULL-tolerant arm no longer matches the legacy tail — historical voids would break';
  END IF;
  RAISE NOTICE 'PASS 6b — unscoped predicate reaches 2 realms, realm-scoped reaches 1, NULL tail still reachable';

  -- ── 6. Remove realm A only. ──
  v_removed := public.remove_qbo_payment_receipt('1111111111', 'QA-COLLIDE-482', 'deleted', 'qa-collide-remove-a');
  IF (v_removed->>'removed')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 6: removing realm A reported removed=%, expected 1', COALESCE(v_removed->>'removed', '<NULL>');
  END IF;

  SELECT count(*) FILTER (WHERE qbo_realm_id = '1111111111'),
         count(*) FILTER (WHERE qbo_realm_id = '2222222222'),
         max(qbo_realm_id) FILTER (WHERE qbo_realm_id = '2222222222')
    INTO v_a_rows, v_b_rows, v_b_realm
  FROM public.payments WHERE qbo_payment_id = 'QA-COLLIDE-482';

  IF v_a_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: realm A still has % projection(s) after its own removal', v_a_rows;
  END IF;
  IF v_b_rows <> 1 OR v_b_realm IS DISTINCT FROM '2222222222' THEN
    RAISE EXCEPTION
      'FAIL 6: realm B lost money to realm A''s removal — % row(s), realm %. This is the silent cross-company deletion the migration exists to close.',
      v_b_rows, COALESCE(v_b_realm, '<NULL>');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_receipts
    WHERE qbo_realm_id = '2222222222' AND qbo_payment_id = 'QA-COLLIDE-482' AND status = 'reconciled'
  ) THEN
    RAISE EXCEPTION 'FAIL 6: realm B''s receipt header is no longer reconciled — it was orphaned';
  END IF;

  PERFORM pg_temp.unbecome();
  RAISE NOTICE 'PASS 6 ★ — removing realm A deleted only realm A; realm B keeps its money and its attribution';
END
$t6$;

-- ─── 7. AUTH GATE survived the body replacement ─────────────────────────────
DO $t7$
DECLARE v_a1 uuid; v_role text; v_refused int := 0;
BEGIN
  SELECT inv_a1 INTO v_a1 FROM qa_fixture;
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM pg_temp.become(v_role);

    BEGIN
      PERFORM public.reconcile_qbo_payment_receipt(
        jsonb_build_object('qbo_realm_id', '3333333333', 'qbo_payment_id', 'QA-PAY-DENY',
          'qbo_customer_id', '801', 'txn_date', '2026-08-08', 'total_cents', 100,
          'applied_cents', 100, 'unapplied_cents', 0, 'source', 'qbo'),
        jsonb_build_array(jsonb_build_object(
          'invoice_id', v_a1, 'qbo_invoice_id', '990101', 'amount_cents', 100, 'payer_type', 'homeowner')),
        'reconciled', 'qa-realm-deny-reconcile-' || v_role);
      RAISE EXCEPTION 'FAIL 7: % was NOT refused by reconcile_qbo_payment_receipt', v_role;
    EXCEPTION
      WHEN insufficient_privilege THEN v_refused := v_refused + 1;
    END;

    BEGIN
      PERFORM public.finalize_qbo_payment_receipt(
        gen_random_uuid(),
        jsonb_build_object('qbo_realm_id', '3333333333', 'qbo_payment_id', 'QA-PAY-DENY',
          'qbo_customer_id', '801', 'txn_date', '2026-08-08', 'total_cents', 100,
          'applied_cents', 100, 'unapplied_cents', 0, 'source', 'qbo'),
        jsonb_build_array(jsonb_build_object(
          'invoice_id', v_a1, 'qbo_invoice_id', '990101', 'amount_cents', 100, 'payer_type', 'homeowner')));
      RAISE EXCEPTION 'FAIL 7: % was NOT refused by finalize_qbo_payment_receipt', v_role;
    EXCEPTION
      WHEN insufficient_privilege THEN v_refused := v_refused + 1;
    END;

    PERFORM pg_temp.unbecome();
  END LOOP;

  IF v_refused <> 4 THEN RAISE EXCEPTION 'FAIL 7: expected 4 refusals (2 functions x 2 roles), got %', v_refused; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE qbo_payment_id = 'QA-PAY-DENY') THEN
    RAISE EXCEPTION 'FAIL 7: a refused call still wrote a projection';
  END IF;
  RAISE NOTICE 'PASS 7 — auth.role() gate intact on both bodies (4 refusals, 0 rows)';
END
$t7$;

-- ─── 8. NULL-CLAIM behaviour: PINS A KNOWN PRE-EXISTING GAP ────────────────
-- This case does NOT assert a refusal, because there isn't one. The gate is
-- `IF auth.role() <> 'service_role'`, and with no request claims auth.role() is
-- NULL, so `NULL <> 'service_role'` is NULL and PL/pgSQL's IF treats NULL as
-- false — the RAISE is skipped and a claimless caller walks straight through.
--
-- Discovered by RUNNING this proof: an earlier draft asserted a 42501 refusal
-- and instead got INVALID_REQUEST from payload validation further down, i.e. the
-- call was stopped by accident, not by the gate.
--
-- It is NOT introduced by this migration — it is carried verbatim from the
-- applied 20260805010000 repair, and the same `<>` form is already recorded in
-- initiative-status.md for create_invoice_for_job / convert_estimate_to_invoice.
-- Fixing it means changing an applied predecessor's semantics, which is outside
-- the three-token scope this migration's safety argument rests on.
--
-- Reachability is genuinely narrow: EXECUTE is service_role-only, so no
-- PostgREST caller can get here at all. A superuser session (psql, pg_cron) can.
-- Pinned here so the gap is visible in CI instead of buried, and so that whoever
-- changes `<>` to `IS DISTINCT FROM` sees this case fail and updates it
-- deliberately rather than silently.
DO $t8$
DECLARE v_a1 uuid; v_rows int;
BEGIN
  SELECT inv_a1 INTO v_a1 FROM qa_fixture;
  PERFORM pg_temp.unbecome();   -- auth.role() IS NULL from here

  IF auth.role() IS NOT NULL THEN
    RAISE EXCEPTION 'CHANGED: auth.role() is % with no claims set; this case assumes NULL', auth.role();
  END IF;

  PERFORM public.reconcile_qbo_payment_receipt(
    jsonb_build_object(
      'qbo_realm_id', '4444444444', 'qbo_payment_id', 'QA-PAY-NULLCLAIM', 'qbo_customer_id', '801',
      'txn_date', '2026-08-08', 'payment_method', 'other', 'reference_number', 'QA nullclaim',
      'total_cents', 100, 'applied_cents', 100, 'unapplied_cents', 0, 'source', 'qbo'),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_a1, 'qbo_invoice_id', '990101', 'amount_cents', 100, 'payer_type', 'homeowner')),
    'reconciled', 'qa-realm-nullclaim');

  SELECT count(*) INTO v_rows FROM public.payments WHERE qbo_payment_id = 'QA-PAY-NULLCLAIM';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'CHANGED: a claimless caller no longer writes (got % rows). If the gate was hardened to IS DISTINCT FROM, that is GOOD — update this case to assert a 42501 refusal.', v_rows;
  END IF;
  RAISE NOTICE 'PASS 8 — pinned: claimless caller is NOT gated (pre-existing <> NULL-unsafety; service_role-only EXECUTE is what actually contains it)';
END
$t8$;

-- ─── 9. GRANTS ──────────────────────────────────────────────────────────────
DO $t9$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    n := n + 1;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 9: anon holds EXECUTE on %', r.proname;
    END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 9: authenticated holds EXECUTE on %', r.proname;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL 9: service_role LOST EXECUTE on % — the worker path is broken', r.proname;
    END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 9: expected exactly 2 functions, found %', n; END IF;
  RAISE NOTICE 'PASS 9 — anon/authenticated revoked, service_role granted on both';
END
$t9$;

-- ─── 10. SHAPE FREEZE ───────────────────────────────────────────────────────
DO $t10$
DECLARE r record; v_seen int := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS sig,
           pg_get_function_result(p.oid) AS ret,
           p.prosecdef,
           p.proconfig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('finalize_qbo_payment_receipt', 'reconcile_qbo_payment_receipt')
  LOOP
    v_seen := v_seen + 1;
    IF r.ret <> 'jsonb' THEN
      RAISE EXCEPTION 'FAIL 10: % returns %, expected jsonb', r.proname, r.ret;
    END IF;
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'FAIL 10: % is no longer SECURITY DEFINER', r.proname;
    END IF;
    IF NOT (r.proconfig @> ARRAY['search_path=pg_catalog, public']) THEN
      RAISE EXCEPTION 'FAIL 10: % lost its pinned search_path (proconfig %)', r.proname, r.proconfig;
    END IF;
    IF r.proname = 'reconcile_qbo_payment_receipt'
       AND r.sig <> 'p_receipt jsonb, p_allocations jsonb, p_event_type text, p_event_key text' THEN
      RAISE EXCEPTION 'FAIL 10: reconcile signature drifted — got (%)', r.sig;
    END IF;
    IF r.proname = 'finalize_qbo_payment_receipt'
       AND r.sig <> 'p_attempt_id uuid, p_receipt jsonb, p_allocations jsonb' THEN
      RAISE EXCEPTION 'FAIL 10: finalize signature drifted — got (%)', r.sig;
    END IF;
  END LOOP;
  IF v_seen <> 2 THEN RAISE EXCEPTION 'FAIL 10: expected 2 functions, found %', v_seen; END IF;
  RAISE NOTICE 'PASS 10 — signatures, jsonb returns, SECURITY DEFINER and pinned search_path all unchanged';
END
$t10$;

DO $done$ BEGIN RAISE NOTICE 'ALL PASS — payments_qbo_realm_scoping (forward)'; END $done$;

ROLLBACK;
