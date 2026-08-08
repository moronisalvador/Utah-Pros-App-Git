-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: office_financial_read_boundary.test.sql
-- Phase: n/a — standalone money-read authorization boundary (20260807230000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back role-perspective proof for the five money
-- reports. Establishes EFFECT; the credential-free source contract in
-- tests/qa/unit/office-financial-read-boundary.test.js establishes INTENT only.
--
-- Mirrors supabase/tests/estimate_create_rpc_billing_boundary.test.sql — same
-- isolated-database guard, same pg_temp.become() forged-JWT role switch, same
-- rollback. That file proves a WRITE boundary; this one proves a READ boundary,
-- and a read boundary fails differently: a WHERE-clause guard would return an
-- empty result instead of an error, and every caller would render "no invoices"
-- for what is actually a refusal (loading-error-states.md §1). So every DENY
-- case here asserts SQLSTATE 42501 was RAISED, and every ALLOW case asserts the
-- exact fixture numbers came back — "raises" and "returns nothing" must not be
-- confusable.
--
-- WHAT IT PROVES
--   1. ALLOW — admin, office and project_manager get real numbers from all five
--      reports, and the numbers are the ones the pre-migration bodies produced.
--      The LANGUAGE sql -> plpgsql conversion is the risk here: a RETURNS TABLE
--      function converted to RETURN QUERY can break on OUT-parameter/column
--      ambiguity, which no static check catches.
--   2. DENY — field_tech, estimator, supervisor, crm_partner, an INACTIVE admin
--      and an EXTERNAL admin are each refused by all five, with 42501.
--      supervisor and estimator are the roles this change is NOT about and are
--      the whole point of database-standard.md §5b: they reach /collections
--      today (the route carries a feature flag, no role gate).
--   3. An unmapped auth user (valid JWT, no employee row) is refused by all five.
--   4. service_role still passes all five — functions/api/collections-chat.js
--      reads two of them over the service-role transport.
--   5. A caller with NO request claims (auth.role() IS NULL — direct psql,
--      pg_cron, a future internal caller) is REFUSED by all five. This is the
--      case the `<>` form silently lets through: (NULL <> 'service_role') AND
--      TRUE is NULL, and PL/pgSQL's IF treats NULL as false, skipping the guard.
--   6. UNTOUCHED — get_pipeline_summary still answers field_tech, supervisor and
--      estimator. src/pages/Dashboard.jsx calls usePipeline() with no canFin
--      argument, so that card fetches for every role landing on '/'. It was in
--      this migration until the caller trace caught it; this case is the pin.
--   7. Signature freeze — get_payments_ledger() is still callable with no
--      argument, and get_ar_invoices() still returns its 22 named columns.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing money-read boundary test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Fixtures: actors ────────────────────────────────────────────────────────
CREATE TEMP TABLE money_actor (label text PRIMARY KEY, auth_id uuid, employee_id uuid);

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
    -- `full_name`, NOT `name` — public.employees has full_name (NOT NULL) and
    -- display_name; there is no `name` column.
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST money ' || r.label,
      'test-money-' || r.label || '-' || substr(v_auth::text, 1, 8) || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO money_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;
END;
$seed$;

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM money_actor WHERE label = p_label;
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

-- ── Fixtures: money ─────────────────────────────────────────────────────────
-- Dated into MARCH 2019 on purpose. Three of the five reports aggregate over a
-- caller-supplied window with no other filter, so an absolute assertion is only
-- safe in a period the real data cannot occupy — this repository's first job is
-- years later. The preceding equal-length window (2019-01-29..2019-02-28) is
-- therefore empty too, which is what makes prev_total = 0 assertable.
CREATE TEMP TABLE money_fixture (contact_id uuid, claim_id uuid, claim_number text,
                                 job_water uuid, job_mold uuid, invoice_a uuid, invoice_b uuid);

DO $fx$
DECLARE
  v_contact uuid; v_claim uuid; v_claim_no text;
  v_job_w uuid; v_job_m uuid; v_inv_a uuid; v_inv_b uuid;
BEGIN
  -- contacts.phone is NOT NULL.
  INSERT INTO public.contacts (name, phone)
  VALUES ('TEST money fixture', '+1555' || substr(gen_random_uuid()::text, 1, 7))
  RETURNING id INTO v_contact;

  -- claims.claim_number defaults through generate_claim_number().
  INSERT INTO public.claims DEFAULT VALUES RETURNING id, claim_number INTO v_claim, v_claim_no;

  -- Two divisions under ONE claim: dash_division_bucket() maps water ->
  -- 'mitigation' and mold -> 'mold', and the shared claim is what makes
  -- get_avg_ticket's avg_per_claim a sum rather than an average of two.
  INSERT INTO public.jobs (division, phase, claim_id, primary_contact_id, address, city)
  VALUES ('water'::public.job_division, 'job_received', v_claim, v_contact, '1 TEST Water Way', 'Provo')
  RETURNING id INTO v_job_w;

  INSERT INTO public.jobs (division, phase, claim_id, primary_contact_id, address, city)
  VALUES ('mold'::public.job_division, 'reconstruction_in_progress', v_claim, v_contact, '2 TEST Mold Mews', 'Orem')
  RETURNING id INTO v_job_m;

  -- qbo_invoice_id NOT NULL is what get_avg_ticket and get_revenue_by_division
  -- require ("committed" revenue). status/amount_paid are trigger-owned and are
  -- deliberately NOT written here (AGENTS.md §15).
  INSERT INTO public.invoices (job_id, contact_id, invoice_number, total, invoice_date, qbo_invoice_id, qbo_doc_number, due_date)
  VALUES (v_job_w, v_contact, 'TEST-MONEY-A', 1000.00, DATE '2019-03-10', 'TEST-QBO-A', '9001', DATE '2019-04-10')
  RETURNING id INTO v_inv_a;

  INSERT INTO public.invoices (job_id, contact_id, invoice_number, total, invoice_date, qbo_invoice_id, qbo_doc_number, due_date)
  VALUES (v_job_m, v_contact, 'TEST-MONEY-B', 500.00, DATE '2019-03-20', 'TEST-QBO-B', '9002', DATE '2019-04-20')
  RETURNING id INTO v_inv_b;

  -- The refund on the second payment is deliberate: get_payments_received nets
  -- refunded_amount out, and update_invoice_paid() computes amount_paid the same
  -- way, so 100 - 25 must show up as 75 in BOTH.
  INSERT INTO public.payments (job_id, invoice_id, contact_id, amount, payment_date, payer_type, payer_name, payment_method)
  VALUES (v_job_w, v_inv_a, v_contact, 400.00, DATE '2019-03-12', 'homeowner', 'TEST money payer', 'check');

  INSERT INTO public.payments (job_id, invoice_id, contact_id, amount, refunded_amount, payment_date, payer_type, payer_name, payment_method)
  VALUES (v_job_m, v_inv_b, v_contact, 100.00, 25.00, DATE '2019-03-22', 'homeowner', 'TEST money payer', 'check');

  INSERT INTO money_fixture VALUES (v_contact, v_claim, v_claim_no, v_job_w, v_job_m, v_inv_a, v_inv_b);
END;
$fx$;

-- The five guarded reports, as complete statements. Held as statement text so
-- the DENY sweep can loop uniformly over five different signatures.
CREATE TEMP TABLE money_report (fn text PRIMARY KEY, call_sql text);
INSERT INTO money_report VALUES
  ('get_ar_invoices',         $q$SELECT count(*) FROM public.get_ar_invoices()$q$),
  ('get_payments_ledger',     $q$SELECT count(*) FROM public.get_payments_ledger(500)$q$),
  ('get_payments_received',   $q$SELECT count(*) FROM public.get_payments_received(DATE '2019-03-01', DATE '2019-03-31')$q$),
  ('get_avg_ticket',          $q$SELECT count(*) FROM public.get_avg_ticket(DATE '2019-03-01', DATE '2019-03-31')$q$),
  ('get_revenue_by_division', $q$SELECT count(*) FROM public.get_revenue_by_division(DATE '2019-03-01', DATE '2019-03-31')$q$);

-- ── 1. ALLOW: the billing three get the RIGHT numbers, not merely no error ──
DO $t1$
DECLARE
  r record;
  f money_fixture%ROWTYPE;
  v_json jsonb;
  v_rows bigint;
  v_total numeric;
  v_paid numeric;
  v_balance numeric;
  v_division text;
  v_claim_no text;
  v_client text;
BEGIN
  SELECT * INTO f FROM money_fixture;

  FOR r IN SELECT label FROM money_actor WHERE label IN ('admin', 'office', 'pm') ORDER BY label
  LOOP
    PERFORM pg_temp.become(r.label);

    -- get_ar_invoices — a RETURNS TABLE body converted to RETURN QUERY. Scoped
    -- to the fixture rows so a seeded clone cannot change the answer.
    SELECT count(*) INTO v_rows FROM public.get_ar_invoices() a
     WHERE a.invoice_number LIKE 'TEST-MONEY-%';
    IF v_rows <> 2 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_ar_invoices returned % fixture rows for %, expected 2', v_rows, r.label;
    END IF;

    SELECT a.total, a.amount_paid, a.balance, a.division, a.claim_number, a.client_name
      INTO v_total, v_paid, v_balance, v_division, v_claim_no, v_client
      FROM public.get_ar_invoices() a WHERE a.invoice_number = 'TEST-MONEY-A';
    IF v_total <> 1000.00 OR v_paid <> 400.00 OR v_balance <> 600.00 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_ar_invoices money is wrong for %: total=% paid=% balance=%', r.label, v_total, v_paid, v_balance;
    END IF;
    -- The joins are the half of this body a permission guard could quietly
    -- break; assert they still resolve to the right job, claim and customer.
    IF v_division <> 'water' OR v_claim_no <> f.claim_number OR v_client <> 'TEST money fixture' THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_ar_invoices joins are wrong for %: division=% claim=% client=%', r.label, v_division, v_claim_no, v_client;
    END IF;

    -- The refunded payment: 100 - 25 = 75 paid, 500 - 75 = 425 outstanding.
    SELECT a.amount_paid, a.balance INTO v_paid, v_balance
      FROM public.get_ar_invoices() a WHERE a.invoice_number = 'TEST-MONEY-B';
    IF v_paid <> 75.00 OR v_balance <> 425.00 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_ar_invoices did not net the refund for %: paid=% balance=%', r.label, v_paid, v_balance;
    END IF;

    -- get_payments_ledger — the other RETURNS TABLE conversion. DESC by
    -- payment_date, so the 03-22 row leads.
    SELECT count(*) INTO v_rows FROM public.get_payments_ledger(500) p
     WHERE p.payer_name = 'TEST money payer';
    IF v_rows <> 2 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_payments_ledger returned % fixture rows for %, expected 2', v_rows, r.label;
    END IF;
    SELECT p.amount, p.division, p.claim_number, p.invoice_number
      INTO v_total, v_division, v_claim_no, v_client
      FROM public.get_payments_ledger(500) p
     WHERE p.payer_name = 'TEST money payer'
     ORDER BY p.payment_date DESC LIMIT 1;
    IF v_total <> 100.00 OR v_division <> 'mold' OR v_claim_no <> f.claim_number OR v_client <> 'TEST-MONEY-B' THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_payments_ledger newest row is wrong for %: amount=% division=% claim=% invoice=%',
        r.label, v_total, v_division, v_claim_no, v_client;
    END IF;

    -- get_revenue_by_division — 1000 mitigation + 500 mold, prior window empty.
    v_json := public.get_revenue_by_division(DATE '2019-03-01', DATE '2019-03-31');
    IF (v_json->>'total')::numeric <> 1500.00 OR (v_json->>'prev_total')::numeric <> 0 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_revenue_by_division totals are wrong for %: %', r.label, v_json;
    END IF;
    IF (SELECT (s->>'value')::numeric FROM jsonb_array_elements(v_json->'segments') s
         WHERE s->>'key' = 'mitigation') <> 1000.00
       OR (SELECT (s->>'value')::numeric FROM jsonb_array_elements(v_json->'segments') s
            WHERE s->>'key' = 'mold') <> 500.00 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_revenue_by_division segments are wrong for %: %', r.label, v_json;
    END IF;

    -- get_payments_received — 400 mitigation + (100-25) mold = 475.
    v_json := public.get_payments_received(DATE '2019-03-01', DATE '2019-03-31');
    IF (v_json->>'total')::numeric <> 475.00 OR (v_json->>'prev_total')::numeric <> 0 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_payments_received totals are wrong for %: %', r.label, v_json;
    END IF;
    IF (SELECT (s->>'value')::numeric FROM jsonb_array_elements(v_json->'segments') s
         WHERE s->>'key' = 'mold') <> 75.00 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_payments_received did not net the refund for %: %', r.label, v_json;
    END IF;

    -- get_avg_ticket — one invoice per division, and BOTH under one claim, so
    -- avg_per_claim is 1500, not 750.
    v_json := public.get_avg_ticket(DATE '2019-03-01', DATE '2019-03-31');
    IF (v_json->>'avg_per_claim')::numeric <> 1500.00 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_avg_ticket avg_per_claim is wrong for %: %', r.label, v_json;
    END IF;
    IF (SELECT (d->>'avg')::numeric FROM jsonb_array_elements(v_json->'divisions') d
         WHERE d->>'key' = 'mitigation') <> 1000.00 THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'get_avg_ticket divisions are wrong for %: %', r.label, v_json;
    END IF;

    PERFORM pg_temp.become_owner();
  END LOOP;

  RAISE NOTICE 'ok: admin, office and project_manager read all five reports, with the pre-migration numbers';
END;
$t1$;

-- ── 2. DENY: every other role, every report, 42501 — never an empty result ──
DO $t2$
DECLARE
  a record;
  rep record;
  v_refusals int := 0;
BEGIN
  FOR a IN SELECT label FROM money_actor
            WHERE label IN ('tech', 'estimator', 'supervisor', 'partner',
                            'inactive_admin', 'external_admin')
            ORDER BY label
  LOOP
    FOR rep IN SELECT fn, call_sql FROM money_report ORDER BY fn
    LOOP
      PERFORM pg_temp.become(a.label);
      BEGIN
        EXECUTE rep.call_sql;
        PERFORM pg_temp.become_owner();
        RAISE EXCEPTION 'LEAK: % read %', a.label, rep.fn;
      EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.become_owner();
        v_refusals := v_refusals + 1;
      END;
    END LOOP;
  END LOOP;

  IF v_refusals <> 30 THEN
    RAISE EXCEPTION 'expected 30 refusals (6 roles x 5 reports), counted %', v_refusals;
  END IF;
  RAISE NOTICE 'ok (42501): 30 refusals — field_tech, estimator, supervisor, crm_partner, inactive admin, external admin';
END;
$t2$;

-- ── 3. DENY: a valid JWT with no employee row ───────────────────────────────
DO $t3$
DECLARE
  rep record;
  v_refusals int := 0;
BEGIN
  FOR rep IN SELECT fn, call_sql FROM money_report ORDER BY fn
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      EXECUTE rep.call_sql;
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'LEAK: an unmapped auth user read %', rep.fn;
    EXCEPTION WHEN insufficient_privilege THEN
      PERFORM pg_temp.become_owner();
      v_refusals := v_refusals + 1;
    END;
  END LOOP;

  IF v_refusals <> 5 THEN
    RAISE EXCEPTION 'expected 5 unmapped-user refusals, counted %', v_refusals;
  END IF;
  RAISE NOTICE 'ok (42501): an unmapped auth user is refused by all five';
END;
$t3$;

-- ── 4. ALLOW: service_role — collections-chat.js reads two of these ─────────
DO $t4$
DECLARE
  rep record;
  v_ok int := 0;
BEGIN
  FOR rep IN SELECT fn, call_sql FROM money_report ORDER BY fn
  LOOP
    -- No auth.uid(), so billing_edit_access() would be false. The short-circuit
    -- is the only thing keeping the Worker alive.
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    EXECUTE rep.call_sql;
    v_ok := v_ok + 1;
  END LOOP;
  PERFORM pg_temp.become_owner();

  IF v_ok <> 5 THEN
    RAISE EXCEPTION 'service_role was refused by % of the five reports', 5 - v_ok;
  END IF;
  RAISE NOTICE 'ok: service_role still reads all five';
END;
$t4$;

-- ── 5. DENY: no claims at all — the IS DISTINCT FROM case ──────────────────
DO $t5$
DECLARE
  rep record;
  v_refusals int := 0;
BEGIN
  FOR rep IN SELECT fn, call_sql FROM money_report ORDER BY fn
  LOOP
    PERFORM set_config('request.jwt.claims', NULL, true);
    BEGIN
      EXECUTE rep.call_sql;
      RAISE EXCEPTION 'REGRESSION: a claimless session read % — the guard is not NULL-safe', rep.fn;
    EXCEPTION WHEN insufficient_privilege THEN
      v_refusals := v_refusals + 1;
    END;
  END LOOP;

  IF v_refusals <> 5 THEN
    RAISE EXCEPTION 'expected 5 claimless refusals, counted %', v_refusals;
  END IF;
  RAISE NOTICE 'ok (42501): a claimless session is refused by all five (NULL-safe guard)';
END;
$t5$;

-- ── 6. UNTOUCHED: get_pipeline_summary still answers the ops roles ──────────
DO $t6$
DECLARE
  a record;
  v_json jsonb;
  v_ok int := 0;
BEGIN
  FOR a IN SELECT label FROM money_actor
            WHERE label IN ('tech', 'estimator', 'supervisor', 'admin') ORDER BY label
  LOOP
    PERFORM pg_temp.become(a.label);
    v_json := public.get_pipeline_summary();
    PERFORM pg_temp.become_owner();
    IF jsonb_array_length(v_json->'stages') <> 4 THEN
      RAISE EXCEPTION 'get_pipeline_summary returned an unexpected shape for %: %', a.label, v_json;
    END IF;
    v_ok := v_ok + 1;
  END LOOP;

  IF v_ok <> 4 THEN
    RAISE EXCEPTION 'get_pipeline_summary refused an ops role — it is fetched ungated on the Dashboard';
  END IF;
  RAISE NOTICE 'ok: get_pipeline_summary is untouched and still answers field_tech, estimator and supervisor';
END;
$t6$;

-- ── 7. Signature freeze — the deployed callers still resolve ────────────────
DO $t7$
DECLARE
  v_rows bigint;
  v_cols text[];
BEGIN
  PERFORM pg_temp.become('admin');

  -- PaymentsLedger.jsx passes { p_limit: 1000 }; the admin-mobile dash and the
  -- Worker pass their own. The DEFAULT must survive so a no-argument PostgREST
  -- call still binds.
  SELECT count(*) INTO v_rows FROM public.get_payments_ledger() p
   WHERE p.payer_name = 'TEST money payer';
  IF v_rows <> 2 THEN
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'get_payments_ledger() lost its p_limit DEFAULT';
  END IF;

  PERFORM pg_temp.become_owner();

  -- database-standard.md §3: a deployed frontend reads these column names.
  SELECT array_agg(a.name ORDER BY a.ord) INTO v_cols
    FROM unnest(
      (SELECT proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_ar_invoices')
    ) WITH ORDINALITY AS a(name, ord);
  IF v_cols IS NULL OR array_length(v_cols, 1) <> 22 THEN
    RAISE EXCEPTION 'get_ar_invoices no longer returns 22 named columns: %', v_cols;
  END IF;
  IF NOT (v_cols @> ARRAY['invoice_id','invoice_number','balance','job_number','claim_number','client_name']) THEN
    RAISE EXCEPTION 'get_ar_invoices lost a column a deployed screen reads: %', v_cols;
  END IF;

  RAISE NOTICE 'ok: signatures and return shapes are unchanged';
END;
$t7$;

ROLLBACK;
