-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: 20260804000042_sync_appointment_crew_enum_authorization_hotfix.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Repairs the deployed appointment-crew RPC that currently sends text into
--   the crew_role enum, while closing the RPC's missing object-authorization
--   boundary. The public RPC signature and return shape stay unchanged.
--
-- WHY THIS IS SAFE:
--   - CREATE OR REPLACE only; no table or data rewrite.
--   - Existing crew rows are diffed, so unchanged row ids are preserved.
--   - Browser callers must be active internal employees allowed to manage the
--     selected appointment. anon/PUBLIC remain revoked.
--   - A preflight refuses to overwrite the later notification-producer repair.
--
-- DEPENDS ON:
--   public.appointments, public.appointment_crew, public.employees,
--   public.crew_role, auth.uid(), auth.jwt()
--
-- ROLLBACK:
--   supabase/rollbacks/
--   20260804000042_sync_appointment_crew_enum_authorization_hotfix.rollback.sql
--   The rollback is intentionally fail-closed because restoring the deployed
--   predecessor would restore both the enum crash and the authorization hole.
-- ═══════════════════════════════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_body text;
BEGIN
  SELECT procedure.prosrc
    INTO v_body
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'sync_appointment_crew'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      = 'p_appointment_id uuid, p_crew jsonb';

  IF v_body IS NULL THEN
    RAISE EXCEPTION
      'sync_appointment_crew hotfix requires the deployed RPC predecessor';
  END IF;

  IF position(
       'sync-crew-hotfix-20260804000042' IN v_body
     ) = 0
     AND position(
       'NULLIF(elem->>''role'', '''')' IN v_body
     ) = 0 THEN
    RAISE EXCEPTION
      'sync_appointment_crew hotfix refuses to replace an unknown/newer body';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.can_current_employee_manage_appointment_crew(
  p_appointment_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  -- sync-crew-hotfix-20260804000042
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    JOIN public.appointments appointment
      ON appointment.id = p_appointment_id
    WHERE employee.auth_user_id = (SELECT auth.uid())
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
      AND (
        (
          employee.role::text IN (
            'admin',
            'office',
            'project_manager',
            'supervisor'
          )
          AND appointment.is_private IS FALSE
        )
        OR (
          employee.role::text IN ('field_tech', 'estimator')
          AND appointment.is_private IS FALSE
          AND EXISTS (
            SELECT 1
            FROM public.appointment_crew crew
            WHERE crew.appointment_id = appointment.id
              AND crew.employee_id = employee.id
          )
        )
        OR employee.role::text IN ('admin', 'project_manager')
      )
  );
$function$;

ALTER FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_appointment_crew(
  p_appointment_id uuid,
  p_crew jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF public.appointment_crew
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request_role text := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    )
  );
  v_is_trusted boolean;
BEGIN
  -- sync-crew-hotfix-20260804000042
  v_is_trusted :=
    v_request_role = 'service_role'
    OR (
      v_request_role IS NULL
      AND session_user IN ('postgres', 'supabase_admin')
    );

  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'sync_appointment_crew: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_typeof(COALESCE(p_crew, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'sync_appointment_crew: p_crew must be an array'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_appointment_crew: appointment not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_trusted
     AND NOT public.can_current_employee_manage_appointment_crew(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: appointment crew management required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    WHERE COALESCE(element ->> 'employee_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(NULLIF(element ->> 'role', ''), 'tech')
          NOT IN ('lead', 'tech', 'helper')
  ) THEN
    RAISE EXCEPTION 'sync_appointment_crew: invalid crew member'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    GROUP BY element ->> 'employee_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'sync_appointment_crew: duplicate crew member'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = (element ->> 'employee_id')::uuid
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  ) THEN
    RAISE EXCEPTION 'sync_appointment_crew: active internal crew required'
      USING ERRCODE = '42501';
  END IF;

  WITH desired AS (
    SELECT DISTINCT ON ((element ->> 'employee_id')::uuid)
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(
        NULLIF(element ->> 'role', ''),
        'tech'
      )::public.crew_role AS role
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    ORDER BY (element ->> 'employee_id')::uuid
  )
  DELETE FROM public.appointment_crew existing
  WHERE existing.appointment_id = p_appointment_id
    AND NOT EXISTS (
      SELECT 1
      FROM desired
      WHERE desired.employee_id = existing.employee_id
    );

  WITH desired AS (
    SELECT DISTINCT ON ((element ->> 'employee_id')::uuid)
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(
        NULLIF(element ->> 'role', ''),
        'tech'
      )::public.crew_role AS role
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    ORDER BY (element ->> 'employee_id')::uuid
  )
  UPDATE public.appointment_crew existing
  SET role = desired.role
  FROM desired
  WHERE existing.appointment_id = p_appointment_id
    AND existing.employee_id = desired.employee_id
    AND existing.role IS DISTINCT FROM desired.role;

  WITH desired AS (
    SELECT DISTINCT ON ((element ->> 'employee_id')::uuid)
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(
        NULLIF(element ->> 'role', ''),
        'tech'
      )::public.crew_role AS role
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    ORDER BY (element ->> 'employee_id')::uuid
  )
  INSERT INTO public.appointment_crew (
    appointment_id,
    employee_id,
    role
  )
  SELECT
    p_appointment_id,
    desired.employee_id,
    desired.role
  FROM desired
  ON CONFLICT (appointment_id, employee_id) DO NOTHING;

  RETURN QUERY
  SELECT crew.*
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = p_appointment_id
  ORDER BY crew.created_at, crew.id;
END;
$function$;

ALTER FUNCTION public.sync_appointment_crew(uuid, jsonb)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  TO authenticated, service_role;
