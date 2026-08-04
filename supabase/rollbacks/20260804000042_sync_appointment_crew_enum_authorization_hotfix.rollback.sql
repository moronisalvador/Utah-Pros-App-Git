-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: sync_appointment_crew_enum_authorization_hotfix.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Contains appointment-crew writes if the forward hotfix must be withdrawn.
--   It preserves the deployed RPC signature but refuses mutations.
--
-- IMPORTANT:
--   The predecessor cannot be restored safely: it crashes on crew_role writes
--   and lets any authenticated caller replace any appointment's crew. This
--   rollback therefore fails closed until a corrected forward migration lands.
--   It also refuses to overwrite a newer repair.
-- ═══════════════════════════════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_sync_body text;
  v_guard_body text;
BEGIN
  SELECT procedure.prosrc
    INTO v_sync_body
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'sync_appointment_crew'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      = 'p_appointment_id uuid, p_crew jsonb';

  SELECT procedure.prosrc
    INTO v_guard_body
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname =
      'can_current_employee_manage_appointment_crew'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      = 'p_appointment_id uuid';

  IF position(
       'sync-crew-hotfix-20260804000042' IN COALESCE(v_sync_body, '')
     ) = 0
     OR position(
       'sync-crew-hotfix-20260804000042' IN COALESCE(v_guard_body, '')
     ) = 0 THEN
    RAISE EXCEPTION
      'sync_appointment_crew rollback refuses to replace an unknown/newer body';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.sync_appointment_crew(
  p_appointment_id uuid,
  p_crew jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF public.appointment_crew
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- sync-crew-containment-20260804000042
  RAISE EXCEPTION
    'sync_appointment_crew temporarily disabled during rollback containment'
    USING ERRCODE = '55000';
END;
$function$;

ALTER FUNCTION public.sync_appointment_crew(uuid, jsonb)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  TO authenticated, service_role;

DROP FUNCTION public.can_current_employee_manage_appointment_crew(uuid);
