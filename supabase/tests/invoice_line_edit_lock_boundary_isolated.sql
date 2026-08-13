-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: invoice_line_edit_lock_boundary_isolated.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Disposable-local, transaction-rolled-back behaviour proof for
-- 20260810010000_invoice_line_edit_lock_boundary.sql. It is deliberately not
-- named *.test.sql: only the paired qualifier runs it; CI's static db lane does
-- not execute SQL proofs.
--
-- Covers the direct-draft role perspective required by database-standard.md
-- §5b: active internal admin/office/project_manager may edit an unlocked line;
-- field roles, inactive and external editors may not. The companion reservation
-- proof covers the service-only mobile/QBO atomic writer. This script proves
-- direct desktop drafts still respect the lock and trigger-owned totals/status.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing invoice-line lock proof: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

CREATE TEMP TABLE actor (label text PRIMARY KEY, auth_id uuid, employee_id uuid);

INSERT INTO public.employees (id, auth_user_id, full_name, email, role, is_active, is_external) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001', 'ZZ line admin',    'zz-line-admin@example.invalid',    'admin',           true,  false),
  ('b1000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-000000000002', 'ZZ line office',   'zz-line-office@example.invalid',   'office',          true,  false),
  ('b1000000-0000-4000-8000-000000000003', 'b9000000-0000-4000-8000-000000000003', 'ZZ line pm',       'zz-line-pm@example.invalid',       'project_manager', true,  false),
  ('b1000000-0000-4000-8000-000000000004', 'b9000000-0000-4000-8000-000000000004', 'ZZ line tech',     'zz-line-tech@example.invalid',     'field_tech',      true,  false),
  ('b1000000-0000-4000-8000-000000000005', 'b9000000-0000-4000-8000-000000000005', 'ZZ inactive admin','zz-line-inactive@example.invalid', 'admin',           false, false),
  ('b1000000-0000-4000-8000-000000000006', 'b9000000-0000-4000-8000-000000000006', 'ZZ external admin','zz-line-external@example.invalid', 'admin',           true,  true),
  ('b1000000-0000-4000-8000-000000000007', 'b9000000-0000-4000-8000-000000000007', 'ZZ line estimator','zz-line-estimator@example.invalid','estimator',       true,  false),
  ('b1000000-0000-4000-8000-000000000008', 'b9000000-0000-4000-8000-000000000008', 'ZZ line supervisor','zz-line-supervisor@example.invalid','supervisor',     true,  false),
  ('b1000000-0000-4000-8000-000000000009', 'b9000000-0000-4000-8000-000000000009', 'ZZ line partner',  'zz-line-partner@example.invalid',  'crm_partner',     true,  false);

INSERT INTO actor
SELECT CASE role::text
  WHEN 'admin' THEN CASE WHEN is_active THEN CASE WHEN is_external THEN 'external_admin' ELSE 'admin' END ELSE 'inactive_admin' END
  WHEN 'office' THEN 'office' WHEN 'project_manager' THEN 'project_manager'
  WHEN 'field_tech' THEN 'field_tech' WHEN 'estimator' THEN 'estimator'
  WHEN 'supervisor' THEN 'supervisor' ELSE 'crm_partner' END,
  auth_user_id, id
FROM public.employees WHERE email LIKE 'zz-line-%@example.invalid';

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM actor WHERE label = p_label;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'unknown actor %', p_label; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE FUNCTION pg_temp.owner() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'none', true); RESET role;
END;
$$;

CREATE TEMP TABLE fixture (invoice_id uuid, line_id uuid, other_invoice_id uuid, other_line_id uuid);
INSERT INTO public.jobs (id) VALUES ('b2000000-0000-4000-8000-000000000001');
INSERT INTO public.invoices (id, job_id, invoice_number, status, invoice_type, qbo_invoice_id, total)
VALUES ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'ZZ-LINE-1', 'saved', 'standard', 'zz-qbo-1', 0),
       ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'ZZ-LINE-2', 'saved', 'standard', 'zz-qbo-2', 0);
INSERT INTO public.invoice_line_items (id, invoice_id, description, quantity, unit_price)
VALUES ('b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'ZZ original', 2, 10),
       ('b4000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002', 'ZZ other', 1, 4);
INSERT INTO fixture VALUES ('b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002');

-- The revision writer is trigger-only; 10000 intentionally exposes no mobile
-- line-edit RPC before the service-only reservation migration is applied.
DO $acl$
BEGIN
  IF to_regprocedure('public.update_invoice_line_item(uuid,uuid,text,text,text,text,text,numeric,numeric)') IS NOT NULL THEN
    RAISE EXCEPTION 'unfenced authenticated invoice-line RPC still exists';
  END IF;
  IF has_function_privilege('authenticated', 'public.mark_invoice_line_revision_draft()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.mark_invoice_line_revision_draft()', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.invoice_line_items'::regclass
                    AND tgname = 'trg_invoice_lines_revision_draft' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'revision draft writer must be trigger-only';
  END IF;
END;
$acl$;

-- Each allowed billing role can direct-REST-update an unlocked line. Every
-- nearby but unauthorized employee shape is denied by the same RLS policy.
DO $direct$
DECLARE r record; v_line uuid := 'b4000000-0000-4000-8000-000000000001'; v_rows integer;
  v_status text; v_total numeric; v_line_total numeric;
BEGIN
  FOR r IN SELECT unnest(ARRAY['admin','office','project_manager']) label LOOP
    PERFORM pg_temp.become(r.label);
    UPDATE public.invoice_line_items SET description = 'ZZ direct ' || r.label WHERE id = v_line;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM pg_temp.owner();
    IF v_rows <> 1 THEN RAISE EXCEPTION '% could not direct-update unlocked line', r.label; END IF;
  END LOOP;

  FOR r IN SELECT unnest(ARRAY[
    'field_tech', 'estimator', 'supervisor', 'crm_partner',
    'inactive_admin', 'external_admin'
  ]) label LOOP
    PERFORM pg_temp.become(r.label);
    UPDATE public.invoice_line_items SET description = 'ZZ forbidden ' || r.label WHERE id = v_line;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM pg_temp.owner();
    IF v_rows <> 0 THEN RAISE EXCEPTION '% direct update succeeded', r.label; END IF;
  END LOOP;

  UPDATE public.invoices SET locked = true WHERE id = 'b3000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.become('admin');
  UPDATE public.invoice_line_items SET description = 'ZZ locked direct' WHERE id = v_line;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.owner();
  IF v_rows <> 0 THEN RAISE EXCEPTION 'locked direct update succeeded'; END IF;
  SELECT status, total INTO v_status, v_total FROM public.invoices WHERE id = 'b3000000-0000-4000-8000-000000000001';
  SELECT line_total INTO v_line_total FROM public.invoice_line_items WHERE id = 'b4000000-0000-4000-8000-000000000001';
  IF v_line_total <> 20 OR v_total <> 20 OR v_status <> 'draft' THEN
    RAISE EXCEPTION 'direct draft total/status transition wrong: line %, invoice %, status %', v_line_total, v_total, v_status;
  END IF;

  -- Negative adjustments remain valid source data and parent totals stay trigger-owned.
  UPDATE public.invoices SET locked = false WHERE id = 'b3000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.become('office');
  UPDATE public.invoice_line_items SET quantity = -2, unit_price = 4.5 WHERE id = v_line;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.owner();
  IF v_rows <> 1 THEN RAISE EXCEPTION 'office could not write negative adjustment'; END IF;
  SELECT line_total, total INTO v_line_total, v_total FROM public.invoice_line_items l JOIN public.invoices i ON i.id = l.invoice_id WHERE l.id = v_line;
  IF v_line_total <> -9 OR v_total <> -9 THEN RAISE EXCEPTION 'negative adjustment did not roll up'; END IF;
END;
$direct$;

ROLLBACK;
DO $done$ BEGIN RAISE NOTICE 'invoice-line edit lock boundary isolated proof passed'; END; $done$;
