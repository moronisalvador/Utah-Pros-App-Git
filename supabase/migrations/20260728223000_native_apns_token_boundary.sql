-- ════════════════════════════════════════════════
-- MIGRATION: 20260728223000_native_apns_token_boundary
-- Phase: Mobile readiness — native push activation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Separates development and production iPhone notification registrations so
--   one environment can never invalidate the other's devices. Employees may
--   register or remove only the iPhone currently tied to their own account,
--   and the app receives no private notification token back from the database.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Adds one nullable column, one check constraint, and two selector-free
--   functions. It also tightens existing grants so browser roles cannot read
--   raw device tokens or call the legacy employee-selector functions. No table,
--   column, function, policy, or data is dropped or renamed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260728223000_native_apns_token_boundary.rollback.sql
--   disables new enrollment while preserving owner cleanup and the tightened
--   token secrecy boundary. The additive column and functions remain in place;
--   restoring raw browser access or the legacy selector functions is
--   intentionally not a safe rollback.
-- ════════════════════════════════════════════════

ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS apns_environment text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.device_tokens'::regclass
      AND conname = 'device_tokens_apns_environment_check'
  ) THEN
    ALTER TABLE public.device_tokens
      ADD CONSTRAINT device_tokens_apns_environment_check
      CHECK (
        apns_environment IS NULL
        OR apns_environment IN ('sandbox', 'production')
      );
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.upsert_my_native_device_token(
  p_token text,
  p_apns_environment text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_employee_id uuid;
  v_row public.device_tokens%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_token), '') IS NULL
     OR length(p_token) > 4096
     OR p_apns_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION
      'token and an exact APNs environment are required'
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

  INSERT INTO public.device_tokens (
    employee_id,
    token,
    platform,
    apns_environment
  )
  VALUES (
    v_employee_id,
    btrim(p_token),
    'ios',
    p_apns_environment
  )
  ON CONFLICT (token)
  DO UPDATE SET
    platform = 'ios',
    apns_environment = EXCLUDED.apns_environment,
    updated_at = now()
  WHERE device_tokens.employee_id = EXCLUDED.employee_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: device token belongs to another employee'
      USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'platform', v_row.platform,
    'apns_environment', v_row.apns_environment,
    'updated_at', v_row.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_native_device_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_employee_id uuid;
BEGIN
  IF NULLIF(btrim(p_token), '') IS NULL OR length(p_token) > 4096 THEN
    RAISE EXCEPTION 'token is required' USING errcode = '22023';
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

  IF EXISTS (
    SELECT 1
    FROM public.device_tokens token_row
    WHERE token_row.token = btrim(p_token)
      AND token_row.employee_id <> v_employee_id
  ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: device token belongs to another employee'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.device_tokens
  WHERE token = btrim(p_token)
    AND employee_id = v_employee_id;
END;
$function$;

ALTER FUNCTION public.upsert_my_native_device_token(text, text)
  OWNER TO postgres;
ALTER FUNCTION public.delete_my_native_device_token(text)
  OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_my_native_device_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_native_device_token(text)
  TO authenticated;

-- The legacy functions accept or expose employee-selected/raw token data. Keep
-- them for deployed server compatibility, but remove them from browser roles.
REVOKE EXECUTE ON FUNCTION public.upsert_device_token(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_device_token(uuid, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_device_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_device_token(text)
  TO service_role;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.device_tokens
  FROM PUBLIC, anon, authenticated;
