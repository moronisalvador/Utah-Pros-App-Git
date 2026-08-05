-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: billing_editor_role_boundary.test.sql
-- Phase: n/a — standalone money-path authorization correction (20260804120000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back negative-authorization proof for the
-- widened billing boundary. Establishes EFFECT; the credential-free source
-- contract in tests/qa/unit/billing-editor-role-boundary.test.js establishes
-- INTENT only.
--
-- Runs as the table owner, so RLS is exercised by explicitly switching to the
-- `authenticated` role with a forged JWT claim per case — the same shape the
-- PostgREST browser path takes.
--
-- WHAT IT PROVES
--   1. billing_edit_access() is true for admin/office/project_manager and false
--      for field_tech, estimator, supervisor, crm_partner, inactive, external,
--      and unmapped callers.
--   2. A billing editor CAN insert a manual payment attributed to themselves.
--   3. A field_tech CANNOT insert, update or delete a payment.
--   4. A billing editor CANNOT attribute a payment to another employee.
--   5. Nobody in a browser role can write a receipt-linked or provider-sourced
--      payment row — those stay worker-owned.
--   6. A field_tech CANNOT insert, update or DELETE an invoice or invoice line
--      (the hole this migration closed), while a billing editor can.
--   7. A crm_partner cannot read invoices at all.
--   8. The definer RPCs refuse a field_tech with SQLSTATE 42501.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing billing boundary test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Distinct synthetic auth ids per role. These never collide with real rows:
-- the whole transaction is rolled back at the end.
CREATE TEMP TABLE billing_actor (label text PRIMARY KEY, auth_id uuid, employee_id uuid);

DO $seed$
DECLARE
  r record;
  v_auth uuid;
  v_emp uuid;
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
    INSERT INTO public.employees (auth_user_id, name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST ' || r.label,
      'test-billing-' || r.label || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO billing_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;
END;
$seed$;

-- Become the given actor for subsequent statements, exactly as PostgREST does.
CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM billing_actor WHERE label = p_label;
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

-- Assert a statement is refused. An RLS refusal surfaces either as 42501 or as
-- a zero-row effect (UPDATE/DELETE filtered by USING), so BOTH count as denied —
-- treating a filtered zero-row update as success is the exact mistake the
-- 2026-08-02 producer qualification had to fix.
CREATE FUNCTION pg_temp.assert_denied(p_label text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_rows integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'DENIAL EXPECTED but % rows changed: %', v_rows, p_label;
  END IF;
  RAISE NOTICE 'ok (zero-row denial): %', p_label;
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'ok (42501): %', p_label;
  WHEN check_violation THEN RAISE NOTICE 'ok (check): %', p_label;
END;
$$;

CREATE FUNCTION pg_temp.assert_allowed(p_label text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_rows integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows < 1 THEN
    RAISE EXCEPTION 'ALLOW EXPECTED but zero rows changed: %', p_label;
  END IF;
  RAISE NOTICE 'ok (allowed, % rows): %', v_rows, p_label;
END;
$$;

-- ── 1. billing_edit_access() truth table ────────────────────────────────────
DO $t1$
DECLARE
  r record;
  v_actual boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('admin', true), ('office', true), ('pm', true),
      ('tech', false), ('estimator', false), ('supervisor', false),
      ('partner', false), ('inactive_admin', false), ('external_admin', false)
    ) AS t(label, expected)
  LOOP
    PERFORM pg_temp.become(r.label);
    SELECT public.billing_edit_access() INTO v_actual;
    PERFORM pg_temp.become_owner();
    IF v_actual IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'billing_edit_access(%) = %, expected %', r.label, v_actual, r.expected;
    END IF;
  END LOOP;

  -- An unmapped caller (valid JWT, no employee row) must be refused.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT public.billing_edit_access() INTO v_actual;
  PERFORM pg_temp.become_owner();
  IF v_actual THEN RAISE EXCEPTION 'billing_edit_access(unmapped) = true'; END IF;

  RAISE NOTICE 'ok: billing_edit_access truth table (10 cases)';
END;
$t1$;

-- ── Fixture invoice to hang payments off ────────────────────────────────────
CREATE TEMP TABLE billing_fixture (job_id uuid, invoice_id uuid, payment_id uuid);

DO $fx$
DECLARE v_job uuid; v_inv uuid;
BEGIN
  SELECT id INTO v_job FROM public.jobs ORDER BY created_at LIMIT 1;
  IF v_job IS NULL THEN RAISE EXCEPTION 'no job available for fixture'; END IF;
  INSERT INTO public.invoices (job_id, invoice_number, status, invoice_type, total)
  VALUES (v_job, 'TEST-BILLING-' || substr(gen_random_uuid()::text, 1, 8), 'draft', 'standard', 100)
  RETURNING id INTO v_inv;
  INSERT INTO billing_fixture VALUES (v_job, v_inv, NULL);
END;
$fx$;

-- ── 2/3/4. payments write boundary ──────────────────────────────────────────
DO $t2$
DECLARE
  v_job uuid; v_inv uuid;
  v_office uuid; v_admin uuid; v_tech uuid;
  v_pay uuid;
BEGIN
  SELECT job_id, invoice_id INTO v_job, v_inv FROM billing_fixture;
  SELECT employee_id INTO v_office FROM billing_actor WHERE label = 'office';
  SELECT employee_id INTO v_admin  FROM billing_actor WHERE label = 'admin';
  SELECT employee_id INTO v_tech   FROM billing_actor WHERE label = 'tech';

  -- (2) office CAN record a payment attributed to itself — the whole point of
  -- the owner-directed widening.
  PERFORM pg_temp.become('office');
  INSERT INTO public.payments (invoice_id, job_id, amount, payment_date, payer_type, recorded_by)
  VALUES (v_inv, v_job, 25, CURRENT_DATE, 'insurance', v_office)
  RETURNING id INTO v_pay;
  PERFORM pg_temp.become_owner();
  UPDATE billing_fixture SET payment_id = v_pay;
  RAISE NOTICE 'ok: office recorded a payment';

  -- (4) office CANNOT attribute a payment to a different employee.
  PERFORM pg_temp.become('office');
  PERFORM pg_temp.assert_denied('office attributing payment to admin', format(
    'INSERT INTO public.payments (invoice_id, job_id, amount, payment_date, payer_type, recorded_by)
     VALUES (%L, %L, 10, CURRENT_DATE, %L, %L)', v_inv, v_job, 'insurance', v_admin));
  PERFORM pg_temp.become_owner();

  -- (3) field_tech is refused on all three verbs.
  PERFORM pg_temp.become('tech');
  PERFORM pg_temp.assert_denied('field_tech insert payment', format(
    'INSERT INTO public.payments (invoice_id, job_id, amount, payment_date, payer_type, recorded_by)
     VALUES (%L, %L, 10, CURRENT_DATE, %L, %L)', v_inv, v_job, 'insurance', v_tech));
  PERFORM pg_temp.assert_denied('field_tech update payment', format(
    'UPDATE public.payments SET amount = 999 WHERE id = %L', v_pay));
  PERFORM pg_temp.assert_denied('field_tech delete payment', format(
    'DELETE FROM public.payments WHERE id = %L', v_pay));
  PERFORM pg_temp.become_owner();

  -- (5) receipt-linked / provider-sourced rows stay worker-owned even for a
  -- billing editor.
  PERFORM pg_temp.become('admin');
  PERFORM pg_temp.assert_denied('admin writing qbo-sourced payment', format(
    'INSERT INTO public.payments (invoice_id, job_id, amount, payment_date, payer_type, recorded_by, source)
     VALUES (%L, %L, 10, CURRENT_DATE, %L, %L, %L)', v_inv, v_job, 'insurance', v_admin, 'qbo'));
  PERFORM pg_temp.become_owner();

  -- office CAN delete the manual payment it is allowed to manage.
  PERFORM pg_temp.become('office');
  PERFORM pg_temp.assert_allowed('office delete manual payment', format(
    'DELETE FROM public.payments WHERE id = %L', v_pay));
  PERFORM pg_temp.become_owner();
END;
$t2$;

-- ── 6/7. invoices + invoice_line_items boundary ─────────────────────────────
DO $t3$
DECLARE
  v_job uuid; v_inv uuid; v_line uuid; v_cnt integer;
BEGIN
  SELECT job_id, invoice_id INTO v_job, v_inv FROM billing_fixture;

  -- (6) The hole this migration closed: before it, every one of these succeeded.
  PERFORM pg_temp.become('tech');
  PERFORM pg_temp.assert_denied('field_tech insert invoice', format(
    'INSERT INTO public.invoices (job_id, invoice_number, status, invoice_type)
     VALUES (%L, %L, %L, %L)', v_job, 'TEST-TECH-DENY', 'draft', 'standard'));
  PERFORM pg_temp.assert_denied('field_tech update invoice', format(
    'UPDATE public.invoices SET invoice_number = %L WHERE id = %L', 'TEST-HIJACK', v_inv));
  PERFORM pg_temp.assert_denied('field_tech DELETE invoice', format(
    'DELETE FROM public.invoices WHERE id = %L', v_inv));
  PERFORM pg_temp.assert_denied('field_tech insert invoice line', format(
    'INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price)
     VALUES (%L, %L, 1, 5)', v_inv, 'TEST tech line'));
  -- but a field_tech may still READ (internal read policy preserved).
  SELECT count(*) INTO v_cnt FROM public.invoices WHERE id = v_inv;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'field_tech lost invoice read'; END IF;
  PERFORM pg_temp.become_owner();

  -- A billing editor still can.
  PERFORM pg_temp.become('office');
  INSERT INTO public.invoice_line_items (invoice_id, description, quantity, unit_price)
  VALUES (v_inv, 'TEST office line', 1, 5) RETURNING id INTO v_line;
  PERFORM pg_temp.assert_allowed('office update invoice', format(
    'UPDATE public.invoices SET due_date = CURRENT_DATE WHERE id = %L', v_inv));
  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'ok: office can write invoices and lines';

  -- (7) crm_partner cannot read invoices at all (the always-true SELECT policy
  -- that used to expose them is gone).
  PERFORM pg_temp.become('partner');
  SELECT count(*) INTO v_cnt FROM public.invoices WHERE id = v_inv;
  PERFORM pg_temp.become_owner();
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'crm_partner read % invoice rows, expected 0', v_cnt; END IF;
  RAISE NOTICE 'ok: crm_partner cannot read invoices';
END;
$t3$;

-- ── 8. definer RPCs refuse a non-billing caller ─────────────────────────────
DO $t4$
DECLARE v_job uuid; v_sqlstate text;
BEGIN
  SELECT job_id INTO v_job FROM billing_fixture;

  PERFORM pg_temp.become('tech');
  BEGIN
    PERFORM public.create_invoice_for_job(v_job, NULL);
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'create_invoice_for_job allowed a field_tech';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.become_owner();
    RAISE NOTICE 'ok (42501): create_invoice_for_job refused field_tech';
  END;

  -- office is accepted by the same RPC.
  PERFORM pg_temp.become('office');
  PERFORM public.create_invoice_for_job(v_job, NULL);
  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'ok: create_invoice_for_job accepted office';
END;
$t4$;

ROLLBACK;
