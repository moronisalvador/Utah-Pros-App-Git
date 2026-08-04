-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: invoice_activity_isolated.sql
-- Phase: Invoice send-review & activity history — P2
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back behaviour proof for 20260804210000.
--
-- NAMING: this is deliberately `_isolated.sql`, not `.test.sql`. The db-lane
-- inventory in tests/qa/unit/db-lane-coverage.test.js pins the exact set of
-- `*.test.sql` files, and nothing in CI executes a `.sql` proof at all. Naming
-- this `.test.sql` would register it as coverage that never runs -- exactly the
-- state qbo_multi_invoice_payment_receipts.test.sql is in today.
--
-- It runs only through scripts/qa/qualify-invoice-activity-local.mjs against a
-- disposable local stack. It proves database behaviour on a synthetic clone and
-- proves NOTHING about QuickBooks, the Worker byte-compare, or any deployment.

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing invoice activity proof: isolated database guard missing';
  END IF;
END;
$guard$;

-- ── Catalog posture (not transaction-dependent) ────────────────────────────
DO $acl$
DECLARE
  v_role text;
  v_priv text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.invoice_activity'::regclass AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'invoice_activity must have RLS enabled AND forced';
  END IF;

  -- No browser role may hold ANY privilege on the table.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, 'public.invoice_activity', v_priv) THEN
        RAISE EXCEPTION 'browser role % retained % on invoice_activity', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- service_role is append-only BY GRANT: it may read and insert, never mutate.
  IF NOT has_table_privilege('service_role', 'public.invoice_activity', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.invoice_activity', 'INSERT') THEN
    RAISE EXCEPTION 'service_role lost the reads/writes it needs';
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('service_role', 'public.invoice_activity', v_priv) THEN
      RAISE EXCEPTION 'service_role holds %, so the record is not append-only', v_priv;
    END IF;
  END LOOP;

  -- Function execution boundaries.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.record_invoice_activity(uuid,uuid,text,text,text,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'browser role % can execute the activity writer', v_role;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.get_invoice_activity(uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute the activity reader';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_invoice_activity(uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost the activity reader';
  END IF;

  -- search_path must be pinned on both definers.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (
      'public.record_invoice_activity(uuid,uuid,text,text,text,jsonb)'::regprocedure,
      'public.get_invoice_activity(uuid,integer,integer)'::regprocedure
    )
    AND NOT (p.prosecdef AND COALESCE(array_to_string(p.proconfig, ','), '') LIKE '%search_path=pg_catalog, public%')
  ) THEN
    RAISE EXCEPTION 'an activity function is not a definer with a pinned search_path';
  END IF;
END;
$acl$;

BEGIN;

-- ── Synthetic fixtures ─────────────────────────────────────────────────────
INSERT INTO public.employees (id, full_name, display_name, role, is_active, is_external, auth_user_id) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'ZZ Synthetic Admin',    'ZZ Admin',    'admin',      true,  false, 'a9000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002', 'ZZ Synthetic External', 'ZZ External', 'admin',      true,  true,  'a9000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003', 'ZZ Synthetic Inactive', 'ZZ Inactive', 'admin',      false, false, 'a9000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000004', 'ZZ Synthetic Tech',     'ZZ Tech',     'field_tech', true,  false, 'a9000000-0000-4000-8000-000000000004');

INSERT INTO public.jobs (id) VALUES ('a2000000-0000-4000-8000-000000000001');

INSERT INTO public.invoices (id, job_id, invoice_number)
VALUES ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'ZZ-SYNTHETIC-0001');

-- ── Writer behaviour ───────────────────────────────────────────────────────
DO $writer$
DECLARE
  v_id uuid;
  v_kind text;
BEGIN
  -- Unknown invoice is refused.
  BEGIN
    PERFORM public.record_invoice_activity('a3000000-0000-4000-8000-0000000000ff', NULL, 'invoice_sent');
    RAISE EXCEPTION 'writer accepted an unknown invoice';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- An external employee is not a valid actor, even though the id exists.
  BEGIN
    PERFORM public.record_invoice_activity('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'invoice_sent');
    RAISE EXCEPTION 'writer accepted an external actor';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  -- Nor is an inactive one.
  BEGIN
    PERFORM public.record_invoice_activity('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'invoice_sent');
    RAISE EXCEPTION 'writer accepted an inactive actor';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  -- A valid active internal employee is attributed as an employee.
  v_id := public.record_invoice_activity(
    'a3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'invoice_sent',
    'zz-synthetic@example.invalid',
    'zz-synthetic-cc@example.invalid',
    '{"stage":"send"}'::jsonb
  );
  SELECT actor_kind INTO v_kind FROM public.invoice_activity WHERE id = v_id;
  IF v_kind IS DISTINCT FROM 'employee' THEN RAISE EXCEPTION 'attributed actor_kind was %', v_kind; END IF;

  -- A NULL actor is recorded as system, never silently attributed to a person.
  v_id := public.record_invoice_activity('a3000000-0000-4000-8000-000000000001', NULL, 'provider_callback');
  SELECT actor_kind INTO v_kind FROM public.invoice_activity WHERE id = v_id;
  IF v_kind IS DISTINCT FROM 'system' THEN RAISE EXCEPTION 'unattributed actor_kind was %', v_kind; END IF;

  -- Free-form metadata cannot smuggle a credential or a message body.
  BEGIN
    PERFORM public.record_invoice_activity('a3000000-0000-4000-8000-000000000001', NULL, 'invoice_sent', NULL, NULL, '{"token":"zz"}'::jsonb);
    RAISE EXCEPTION 'metadata accepted a token key';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_invoice_activity('a3000000-0000-4000-8000-000000000001', NULL, 'invoice_sent', NULL, NULL, '{"body":"zz"}'::jsonb);
    RAISE EXCEPTION 'metadata accepted a body key';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$writer$;

-- ── Reader authorization ───────────────────────────────────────────────────
DO $reader$
DECLARE
  v_result jsonb;
BEGIN
  -- Logged out: no auth.uid(), no jwt role claim. Must fail closed.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.get_invoice_activity('a3000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'reader served a caller with no identity';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  -- A signed-in field_tech is not an authorized role for billing activity.
  PERFORM set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000004', true);
  BEGIN
    PERFORM public.get_invoice_activity('a3000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'reader served a field_tech';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  -- An external admin is refused despite the admin role.
  PERFORM set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.get_invoice_activity('a3000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'reader served an external admin';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  -- An active internal admin is served, and the page is bounded.
  PERFORM set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
  v_result := public.get_invoice_activity('a3000000-0000-4000-8000-000000000001');
  IF (v_result->>'total')::bigint <> 2 THEN
    RAISE EXCEPTION 'expected 2 retained rows, got %', v_result->>'total';
  END IF;
  IF jsonb_array_length(v_result->'rows') <> 2 THEN
    RAISE EXCEPTION 'reader returned the wrong row count';
  END IF;
  IF (v_result->'rows'->0->>'actor_name') IS NULL AND (v_result->'rows'->1->>'actor_name') IS NULL THEN
    RAISE EXCEPTION 'reader resolved no actor name; the employees join is wrong';
  END IF;

  BEGIN
    PERFORM public.get_invoice_activity('a3000000-0000-4000-8000-000000000001', 101, 0);
    RAISE EXCEPTION 'reader accepted an unbounded page size';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
END;
$reader$;

ROLLBACK;

DO $done$ BEGIN RAISE NOTICE 'invoice activity isolated proof passed'; END; $done$;
