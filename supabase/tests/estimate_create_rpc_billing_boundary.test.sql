-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: estimate_create_rpc_billing_boundary.test.sql
-- Phase: n/a — standalone money-path authorization correction (20260805020000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Synthetic, transaction-rolled-back negative-authorization proof for the
-- estimate-create RPC boundary. Establishes EFFECT; the credential-free source
-- contract in tests/qa/unit/estimate-create-rpc-billing-boundary.test.js
-- establishes INTENT only.
--
-- Mirrors supabase/tests/billing_editor_role_boundary.test.sql — same isolated
-- database guard, same pg_temp.become() forged-JWT role switch, same rollback.
-- That file proves the boundary for create_invoice_for_job; this one proves it
-- for the two estimate-create definers that migration deliberately left alone.
--
-- WHAT IT PROVES
--   1. A billing editor (admin, office, project_manager) can still call BOTH
--      RPCs and get an estimates row back — the shipped NewEstimateModal
--      contract, which the guard must not break (database-standard.md §3).
--   2. field_tech, estimator, supervisor, crm_partner, an INACTIVE admin and an
--      EXTERNAL admin are each refused with SQLSTATE 42501, by both RPCs.
--   3. The refusal happens BEFORE any insert — no orphan estimate row and no
--      consumed estimate number are left behind by a refused call.
--   4. A service_role caller with no auth.uid() still succeeds, proving the
--      short-circuit keeps workers working.
--   5. A caller with NO request claims at all (auth.role() IS NULL — a direct
--      psql session, pg_cron, a future internal caller) is REFUSED. This is the
--      case the `<>` form silently let through: (NULL <> 'service_role') AND TRUE
--      evaluates to NULL, and PL/pgSQL's IF treats NULL as false, so the guard
--      would be skipped entirely. It is why this migration uses IS DISTINCT FROM.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing estimate boundary test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE estimate_actor (label text PRIMARY KEY, auth_id uuid, employee_id uuid);

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
    -- display_name; there is no `name` column. The sibling billing-boundary proof
    -- carried `name` from the day it was written and could never have executed;
    -- it was caught 2026-08-05 the first time it was actually run.
    INSERT INTO public.employees (auth_user_id, full_name, email, role, is_active, is_external)
    VALUES (
      v_auth,
      'TEST estimate ' || r.label,
      'test-estimate-' || r.label || '-' || substr(v_auth::text, 1, 8) || '@example.invalid',
      r.role::public.employee_role,
      r.is_active,
      r.is_external
    )
    RETURNING id INTO v_emp;
    INSERT INTO estimate_actor VALUES (r.label, v_auth, v_emp);
  END LOOP;
END;
$seed$;

CREATE FUNCTION pg_temp.become(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_id INTO v_auth FROM estimate_actor WHERE label = p_label;
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

-- Anchor rows the two RPCs need. Prefer existing seed data so the insert
-- exercises real column constraints, but CREATE the rows when the database has
-- none: the isolation guard above means a clean disposable clone is the only
-- place this may run, and assuming a seeded database is exactly the defect that
-- made the sibling billing-boundary proof unrunnable until 2026-08-05.
CREATE TEMP TABLE estimate_fixture (contact_id uuid, job_id uuid);

DO $fx$
DECLARE v_contact uuid; v_job uuid;
BEGIN
  SELECT id INTO v_contact FROM public.contacts ORDER BY created_at LIMIT 1;
  IF v_contact IS NULL THEN
    INSERT INTO public.contacts (name, phone)
    VALUES ('TEST estimate fixture', '+1555' || substr(gen_random_uuid()::text, 1, 7))
    RETURNING id INTO v_contact;
  END IF;
  IF v_contact IS NULL THEN RAISE EXCEPTION 'no contact available for fixture'; END IF;

  SELECT id INTO v_job FROM public.jobs ORDER BY created_at LIMIT 1;
  -- Every FK on public.jobs is nullable, so a bare row is sufficient.
  IF v_job IS NULL THEN
    INSERT INTO public.jobs DEFAULT VALUES RETURNING id INTO v_job;
  END IF;
  IF v_job IS NULL THEN RAISE EXCEPTION 'no job available for fixture'; END IF;

  INSERT INTO estimate_fixture VALUES (v_contact, v_job);
END;
$fx$;

-- ── 1. Billing editors keep working — the shipped caller contract ───────────
DO $t1$
DECLARE
  r record;
  v_contact uuid; v_job uuid;
  v_row public.estimates;
BEGIN
  SELECT contact_id, job_id INTO v_contact, v_job FROM estimate_fixture;

  FOR r IN SELECT label, employee_id FROM estimate_actor
            WHERE label IN ('admin', 'office', 'pm') ORDER BY label
  LOOP
    PERFORM pg_temp.become(r.label);

    v_row := public.create_estimate_for_contact(v_contact, 'water', 'initial', NULL, NULL, NULL, NULL, r.employee_id);
    IF v_row.id IS NULL OR v_row.status <> 'draft' OR v_row.estimate_number IS NULL THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'create_estimate_for_contact returned an unexpected shape for %', r.label;
    END IF;

    v_row := public.create_estimate_for_job(v_job, 'initial', r.employee_id);
    IF v_row.id IS NULL OR v_row.status <> 'draft' THEN
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'create_estimate_for_job returned an unexpected shape for %', r.label;
    END IF;

    PERFORM pg_temp.become_owner();
  END LOOP;

  RAISE NOTICE 'ok: both estimate-create RPCs accept admin, office and project_manager';
END;
$t1$;

-- ── 2/3. Everyone else is refused, before any row is written ────────────────
DO $t2$
DECLARE
  r record;
  v_contact uuid; v_job uuid; v_emp uuid;
  v_before bigint; v_after bigint;
BEGIN
  SELECT contact_id, job_id INTO v_contact, v_job FROM estimate_fixture;
  SELECT count(*) INTO v_before FROM public.estimates;

  FOR r IN SELECT label, employee_id FROM estimate_actor
            WHERE label IN ('tech', 'estimator', 'supervisor', 'partner',
                            'inactive_admin', 'external_admin')
  LOOP
    v_emp := r.employee_id;

    PERFORM pg_temp.become(r.label);
    BEGIN
      PERFORM public.create_estimate_for_contact(v_contact, 'water', 'initial', NULL, NULL, NULL, NULL, v_emp);
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'create_estimate_for_contact allowed %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN
      PERFORM pg_temp.become_owner();
      RAISE NOTICE 'ok (42501): create_estimate_for_contact refused %', r.label;
    END;

    PERFORM pg_temp.become(r.label);
    BEGIN
      PERFORM public.create_estimate_for_job(v_job, 'initial', v_emp);
      PERFORM pg_temp.become_owner();
      RAISE EXCEPTION 'create_estimate_for_job allowed %', r.label;
    EXCEPTION WHEN insufficient_privilege THEN
      PERFORM pg_temp.become_owner();
      RAISE NOTICE 'ok (42501): create_estimate_for_job refused %', r.label;
    END;
  END LOOP;

  -- (3) The guard runs before the INSERT, so twelve refused calls must leave
  -- the table exactly as they found it.
  SELECT count(*) INTO v_after FROM public.estimates;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'refused calls wrote % estimate row(s)', v_after - v_before;
  END IF;
  RAISE NOTICE 'ok: 12 refusals left zero rows behind';
END;
$t2$;

-- ── 4. An unmapped caller (valid JWT, no employee row) is refused ───────────
DO $t3$
DECLARE v_contact uuid;
BEGIN
  SELECT contact_id INTO v_contact FROM estimate_fixture;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.create_estimate_for_contact(v_contact, 'water', 'initial', NULL, NULL, NULL, NULL, NULL);
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'create_estimate_for_contact allowed an unmapped auth user';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.become_owner();
    RAISE NOTICE 'ok (42501): create_estimate_for_contact refused an unmapped auth user';
  END;
END;
$t3$;

-- ── 5. service_role still passes; a claimless session does NOT ──────────────
DO $t4$
DECLARE v_contact uuid; v_row public.estimates;
BEGIN
  SELECT contact_id INTO v_contact FROM estimate_fixture;

  -- service_role: no auth.uid(), so billing_edit_access() would be false. The
  -- short-circuit is what keeps workers working.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v_row := public.create_estimate_for_contact(v_contact, 'water', 'initial', NULL, NULL, NULL, NULL, NULL);
  IF v_row.id IS NULL THEN
    PERFORM pg_temp.become_owner();
    RAISE EXCEPTION 'service_role was refused by create_estimate_for_contact';
  END IF;
  PERFORM pg_temp.become_owner();
  RAISE NOTICE 'ok: service_role still accepted';

  -- NULL auth.role(): the IS DISTINCT FROM case. With the `<>` form the guard
  -- expression is NULL, IF treats it as false, and this call would SUCCEED
  -- unchecked. It must be refused.
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM public.create_estimate_for_contact(v_contact, 'water', 'initial', NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'REGRESSION: a claimless session created an estimate — the guard is not NULL-safe';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok (42501): a claimless session is refused (NULL-safe guard)';
  END;
END;
$t4$;

ROLLBACK;
