-- ════════════════════════════════════════════════
-- MIGRATION: 20260729220000_tech_onboarding_state
-- Phase: n/a (standalone — tech first-run onboarding, owner request 2026-07-29)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a tiny per-employee bookkeeping table that remembers which version of
--   the app's first-run welcome tour each employee has already seen, so the
--   tour shows exactly once per person (and can be shown again on purpose by
--   raising the version number in a future release). Two helper functions let
--   the signed-in employee read and record ONLY their own entry; nobody can
--   read or change anyone else's.
--
-- ADDITIVE-ONLY:
--   Yes — one new table and two new functions. No existing table, column,
--   policy, grant, or function is dropped, renamed, or altered. No data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260729220000_tech_onboarding_state.rollback.sql —
--   DROP FUNCTION public.get_my_onboarding_version_seen(text);
--   DROP FUNCTION public.ack_my_onboarding_seen(text, integer);
--   DROP TABLE public.employee_onboarding_state;
--   Safe to run at any time; the frontend fails closed (never shows the tour)
--   when the read function is missing, so rollback cannot re-trigger the tour
--   or break the shell.
-- ════════════════════════════════════════════════

CREATE TABLE public.employee_onboarding_state (
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  surface text NOT NULL
    CONSTRAINT employee_onboarding_state_surface_format
    CHECK (surface ~ '^[a-z_]{1,32}$'),
  version_seen integer NOT NULL
    CONSTRAINT employee_onboarding_state_version_seen_range
    CHECK (version_seen >= 0 AND version_seen <= 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, surface)
);

-- Deny-all posture: the table is reachable only through the two selector-free
-- SECURITY DEFINER functions below (same posture as device_tokens).
ALTER TABLE public.employee_onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_onboarding_state FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.employee_onboarding_state
  FROM PUBLIC, anon, authenticated;

-- Selector-free read: the caller's own version_seen for one surface, 0 when
-- they have no row yet. SECURITY DEFINER is required because browser roles
-- have no direct table access; the function validates the caller internally.
CREATE FUNCTION public.get_my_onboarding_version_seen(p_surface text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_employee_id uuid;
  v_version integer;
BEGIN
  IF p_surface IS NULL OR p_surface NOT IN ('tech') THEN
    RAISE EXCEPTION 'unknown onboarding surface'
      USING errcode = '22023';
  END IF;

  SELECT employee.id
  INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active IS TRUE
    AND employee.is_external IS FALSE
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    )
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  SELECT state.version_seen
  INTO v_version
  FROM public.employee_onboarding_state state
  WHERE state.employee_id = v_employee_id
    AND state.surface = p_surface;

  RETURN COALESCE(v_version, 0);
END;
$function$;

-- Selector-free acknowledgement: records that the caller has seen at least
-- p_version of one surface's onboarding. Monotonic (GREATEST) so a replayed or
-- stale acknowledgement can never re-arm a tour the employee already finished.
CREATE FUNCTION public.ack_my_onboarding_seen(
  p_surface text,
  p_version integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_employee_id uuid;
  v_version integer;
BEGIN
  IF p_surface IS NULL OR p_surface NOT IN ('tech') THEN
    RAISE EXCEPTION 'unknown onboarding surface'
      USING errcode = '22023';
  END IF;
  IF p_version IS NULL OR p_version < 1 OR p_version > 10000 THEN
    RAISE EXCEPTION 'onboarding version out of range'
      USING errcode = '22023';
  END IF;

  SELECT employee.id
  INTO v_employee_id
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active IS TRUE
    AND employee.is_external IS FALSE
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    )
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal employee required'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.employee_onboarding_state (
    employee_id,
    surface,
    version_seen
  )
  VALUES (v_employee_id, p_surface, p_version)
  ON CONFLICT (employee_id, surface)
  DO UPDATE SET
    version_seen = GREATEST(
      public.employee_onboarding_state.version_seen,
      EXCLUDED.version_seen
    ),
    updated_at = now()
  RETURNING version_seen INTO v_version;

  RETURN v_version;
END;
$function$;

ALTER FUNCTION public.get_my_onboarding_version_seen(text)
  OWNER TO postgres;
ALTER FUNCTION public.ack_my_onboarding_seen(text, integer)
  OWNER TO postgres;

-- Managed-Supabase function trap (database-standard.md §1): this project
-- re-applies EXECUTE TO PUBLIC to every new function, so the explicit revoke
-- must precede each grant.
REVOKE EXECUTE ON FUNCTION public.get_my_onboarding_version_seen(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_onboarding_version_seen(text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.ack_my_onboarding_seen(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ack_my_onboarding_seen(text, integer)
  TO authenticated, service_role;

DO $postcondition$
DECLARE
  v_relid oid := 'public.employee_onboarding_state'::regclass;
  v_rls boolean;
  v_forced boolean;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO v_rls, v_forced
  FROM pg_class
  WHERE oid = v_relid;

  IF v_rls IS DISTINCT FROM TRUE OR v_forced IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'employee_onboarding_state postcondition: RLS not enabled+forced';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'employee_onboarding_state'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION
      'employee_onboarding_state postcondition: browser-role table grant leaked';
  END IF;
END;
$postcondition$;
