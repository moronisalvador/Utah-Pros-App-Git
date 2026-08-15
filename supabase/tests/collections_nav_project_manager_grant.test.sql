-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: collections_nav_project_manager_grant.test.sql
-- Phase: n/a — Collections nav link for project_manager (20260808200000)
-- ═══════════════════════════════════════════════════════════════════════════
-- Role-perspective proof for the nav_permissions grant. Establishes EFFECT; the
-- credential-free source contract in
-- tests/qa/unit/collections-nav-project-manager-grant.test.js establishes INTENT.
--
-- One INSERT, executed anyway, for the reason the sibling overview_financials
-- proof exists: `nav_permissions.role` is free `text`, not the employee_role
-- enum, so nothing in the database rejects a typo. 'project_managers' or
-- 'Project_Manager' would apply cleanly, satisfy every static assertion, and
-- grant nobody anything. The only check that catches it is reading the row back
-- with the EXACT string AuthContext.loadPermissions() filters on —
-- `role=eq.<employee.role>`, where employee.role comes from the enum. So this
-- proof joins the inserted row against the enum itself.
--
-- ⚠ DEPENDS ON SEEDED CONTROL ROWS. db/baseline/schema.sql is schema-only, so on
-- a fresh local stack public.nav_permissions arrives EMPTY. The "nobody loses"
-- case below would then pass against an empty table and prove nothing — the
-- exact ambient-emptiness trap that made the first overview_financials qualifier
-- worthless. scripts/qa/qualify-collections-nav-grant-local.mjs therefore seeds
-- the three real pre-existing rows (admin, manager, office) plus two unrelated
-- nav keys BEFORE applying the migration, and this file fails loudly if that
-- seeding did not happen rather than quietly passing.
--
-- WHAT IT PROVES
--   1. GAINS — project_manager resolves `collections` to can_view = true through
--      the same predicate loadPermissions() uses, and 'project_manager' is a real
--      employee_role label, so an employee can actually hold it.
--   2. can_edit is false — this grants a link, not authority.
--   3. LOSES — nobody: the three pre-existing collections rows survive with their
--      exact can_view/can_edit values, and the unrelated nav keys are untouched.
--   4. UNTOUCHED — supervisor, estimator, field_tech and crm_partner still have
--      no collections row. The first two land on the office shell and must keep
--      seeing no Collections link; the last two never reach that shell at all.
--   5. `manager` survives AND is provably unreachable — it is not an
--      employee_role label, so that row grants nobody anything. Pinned as a test
--      so the finding stays visible instead of decaying into folklore.
--   6. Re-running the migration is a no-op (ON CONFLICT DO NOTHING).
--
-- Every case rolls back. No production row is created.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing collections-nav grant test: isolated database guard missing';
  END IF;
END;
$guard$;

BEGIN;

-- ── 0. The control rows must actually be here, or nothing below means anything ─
DO $t0$
DECLARE v_controls int;
BEGIN
  SELECT count(*) INTO v_controls
    FROM public.nav_permissions
   WHERE nav_key = 'collections' AND role IN ('admin', 'manager', 'office');

  IF v_controls <> 3 THEN
    RAISE EXCEPTION
      'hollow harness: expected 3 seeded collections control rows, found %. '
      'The qualifier must seed them BEFORE the migration or the no-loss case '
      'passes against an empty table and proves nothing.', v_controls;
  END IF;
  RAISE NOTICE 'ok: 3 control rows present — the no-loss case has something to measure';
END;
$t0$;

-- ── 1/2. GAINS: project_manager resolves true, is a real role, view-only ─────
DO $t1$
BEGIN
  -- The exact shape AuthContext.loadPermissions() issues:
  --   nav_permissions?role=eq.project_manager&can_view=eq.true&select=nav_key,...
  IF NOT EXISTS (
    SELECT 1 FROM public.nav_permissions p
     WHERE p.role = 'project_manager' AND p.nav_key = 'collections' AND p.can_view IS TRUE
  ) THEN
    RAISE EXCEPTION 'no collections row resolves for project_manager';
  END IF;

  -- A free-text role that is not an enum label can never match employee.role.
  IF NOT EXISTS (
    SELECT 1 FROM unnest(enum_range(NULL::public.employee_role)) AS e(label)
     WHERE e.label::text = 'project_manager'
  ) THEN
    RAISE EXCEPTION 'project_manager is not a real employee_role — the grant is unreachable';
  END IF;

  -- (2) A link, not authority.
  IF EXISTS (
    SELECT 1 FROM public.nav_permissions p
     WHERE p.role = 'project_manager' AND p.nav_key = 'collections' AND p.can_edit IS TRUE
  ) THEN
    RAISE EXCEPTION 'collections grants can_edit to project_manager — it should grant the link only';
  END IF;

  RAISE NOTICE 'ok: project_manager resolves collections, real role, view-only';
END;
$t1$;

-- ── 3. LOSES: nobody. The pre-existing rows survive with exact values ────────
DO $t2$
DECLARE
  r record;
  v_checked int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('collections', 'admin'),
      ('collections', 'manager'),
      ('collections', 'office'),
      -- Unrelated keys: a migration that widened by nav_key or by role rather
      -- than by the exact pair would disturb one of these.
      ('dashboard',   'office'),
      ('dashboard',   'project_manager')
    ) AS t(nav_key, role)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.nav_permissions p
       WHERE p.nav_key = r.nav_key AND p.role = r.role
         AND p.can_view IS TRUE AND p.can_edit IS FALSE
    ) THEN
      RAISE EXCEPTION 'pre-existing row (%, %) was lost or altered', r.nav_key, r.role;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked <> 5 THEN
    RAISE EXCEPTION 'expected 5 surviving rows, checked %', v_checked;
  END IF;
  RAISE NOTICE 'ok: all 5 pre-existing rows survive unchanged — nobody lost anything';
END;
$t2$;

-- ── 4. UNTOUCHED: the roles this change is not about ────────────────────────
DO $t3$
DECLARE
  r record;
  v_checked int := 0;
BEGIN
  FOR r IN SELECT unnest(ARRAY['supervisor', 'estimator', 'field_tech', 'crm_partner']) AS role
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.nav_permissions p
       WHERE p.role = r.role AND p.nav_key = 'collections'
    ) THEN
      RAISE EXCEPTION 'LEAK: % gained a collections row', r.role;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked <> 4 THEN
    RAISE EXCEPTION 'expected 4 untouched roles, checked %', v_checked;
  END IF;
  RAISE NOTICE 'ok: supervisor, estimator, field_tech and crm_partner still have no collections link';
END;
$t3$;

-- ── 5. `manager` survives and is provably inert ─────────────────────────────
DO $t4$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.nav_permissions p
     WHERE p.nav_key = 'collections' AND p.role = 'manager'
  ) THEN
    RAISE EXCEPTION 'the manager row was removed — this migration is additive-only';
  END IF;

  -- The finding, pinned: no session can hold this role, so the row grants nobody
  -- anything. If `manager` is ever added to employee_role, this fails and forces
  -- a deliberate decision about what it should see.
  IF EXISTS (
    SELECT 1 FROM unnest(enum_range(NULL::public.employee_role)) AS e(label)
     WHERE e.label::text = 'manager'
  ) THEN
    RAISE EXCEPTION 'manager is now a real employee_role — its collections grant is live and needs a decision';
  END IF;
  RAISE NOTICE 'ok: manager row survives and remains unreachable (not an employee_role)';
END;
$t4$;

-- ── 6. Re-apply is a no-op ─────────────────────────────────────────────────
DO $t5$
DECLARE v_before bigint; v_after bigint;
BEGIN
  SELECT count(*) INTO v_before FROM public.nav_permissions;

  INSERT INTO public.nav_permissions (nav_key, role, can_view, can_edit)
  VALUES
    ('collections', 'project_manager', true, false)
  ON CONFLICT (nav_key, role) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.nav_permissions;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 're-applying the grant added % row(s); it must be idempotent', v_after - v_before;
  END IF;
  RAISE NOTICE 'ok: re-applying the grant is a no-op';
END;
$t5$;

ROLLBACK;
