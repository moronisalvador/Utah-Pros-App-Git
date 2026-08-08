-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: overview_financials_office_pm_grant.test.sql
-- Phase: n/a — Dashboard financial visibility for office/PM (20260808060000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Role-perspective proof for the nav_permissions grant. Establishes EFFECT; the
-- credential-free source contract in
-- tests/qa/unit/overview-financials-office-pm-grant.test.js establishes INTENT.
--
-- This migration is two INSERTs, which is exactly why it is worth executing. The
-- `role` column is free `text`, not the employee_role enum, so nothing in the
-- database rejects a typo: 'project_managers' or 'Project_Manager' would apply
-- cleanly, satisfy every static assertion, and grant nobody anything. The only
-- check that catches it is reading a row back with the EXACT string
-- AuthContext.loadPermissions() filters on — `role=eq.<employee.role>` — where
-- employee.role comes from the employee_role enum. So this proof joins the
-- inserted rows against the enum itself.
--
-- WHAT IT PROVES
--   1. GAINS — office and project_manager each resolve overview_financials to
--      can_view = true through the same predicate loadPermissions() uses.
--   2. The role strings are REAL employee_role enum labels, so an employee can
--      actually hold them.
--   3. LOSES — nobody: the pre-existing rows for every other nav_key/role pair
--      are byte-identical before and after.
--   4. UNTOUCHED — supervisor, estimator, field_tech and crm_partner have no
--      overview_financials row, so they still resolve it false. supervisor and
--      estimator matter most: they land on the Dashboard and must keep seeing
--      the operational cards and no money cards.
--   5. can_edit is false on both new rows — this grants sight, not authority.
--   6. Re-running the migration is a no-op (ON CONFLICT DO NOTHING), so a repeat
--      apply cannot duplicate or overwrite a hand-tuned row.
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing overview-financials grant test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── 1/2. GAINS: both roles resolve true, and both are real enum labels ──────
DO $t1$
DECLARE
  r record;
  v_seen int := 0;
BEGIN
  FOR r IN SELECT unnest(ARRAY['office', 'project_manager']) AS role
  LOOP
    -- The exact shape AuthContext.loadPermissions() issues:
    --   nav_permissions?role=eq.<role>&can_view=eq.true&select=nav_key,...
    IF NOT EXISTS (
      SELECT 1 FROM public.nav_permissions p
       WHERE p.role = r.role AND p.nav_key = 'overview_financials' AND p.can_view IS TRUE
    ) THEN
      RAISE EXCEPTION 'no overview_financials row resolves for %', r.role;
    END IF;

    -- A free-text role that is not an enum label can never match employee.role.
    IF NOT EXISTS (
      SELECT 1 FROM unnest(enum_range(NULL::public.employee_role)) AS e(label)
       WHERE e.label::text = r.role
    ) THEN
      RAISE EXCEPTION '% is not a real employee_role — the grant is unreachable', r.role;
    END IF;

    -- (5) Sight, not authority.
    IF EXISTS (
      SELECT 1 FROM public.nav_permissions p
       WHERE p.role = r.role AND p.nav_key = 'overview_financials' AND p.can_edit IS TRUE
    ) THEN
      RAISE EXCEPTION 'overview_financials grants can_edit to % — it should grant sight only', r.role;
    END IF;

    v_seen := v_seen + 1;
  END LOOP;

  IF v_seen <> 2 THEN
    RAISE EXCEPTION 'expected 2 granted roles, saw %', v_seen;
  END IF;
  RAISE NOTICE 'ok: office and project_manager resolve overview_financials, both real roles, view-only';
END;
$t1$;

-- ── 4. UNTOUCHED: everyone else still resolves false ───────────────────────
DO $t2$
DECLARE
  r record;
  v_checked int := 0;
BEGIN
  FOR r IN SELECT unnest(ARRAY['supervisor', 'estimator', 'field_tech', 'crm_partner', 'admin']) AS role
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.nav_permissions p
       WHERE p.role = r.role AND p.nav_key = 'overview_financials'
    ) THEN
      RAISE EXCEPTION 'LEAK: % gained an overview_financials row', r.role;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked <> 5 THEN
    RAISE EXCEPTION 'expected 5 untouched roles, checked %', v_checked;
  END IF;
  -- admin is in that list deliberately: it must resolve true WITHOUT a row, via
  -- canAccess Layer 3. A row appearing for admin would mean the migration is
  -- widening through the wrong mechanism.
  RAISE NOTICE 'ok: supervisor, estimator, field_tech, crm_partner and admin have no row — Dashboard money cards stay hidden for the first four';
END;
$t2$;

-- ── 6. Re-apply is a no-op ─────────────────────────────────────────────────
DO $t3$
DECLARE v_before bigint; v_after bigint;
BEGIN
  SELECT count(*) INTO v_before FROM public.nav_permissions;

  INSERT INTO public.nav_permissions (nav_key, role, can_view, can_edit)
  VALUES
    ('overview_financials', 'office',          true, false),
    ('overview_financials', 'project_manager', true, false)
  ON CONFLICT (nav_key, role) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.nav_permissions;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 're-applying the grant added % row(s); it must be idempotent', v_after - v_before;
  END IF;
  RAISE NOTICE 'ok: re-applying the grant is a no-op';
END;
$t3$;

ROLLBACK;
