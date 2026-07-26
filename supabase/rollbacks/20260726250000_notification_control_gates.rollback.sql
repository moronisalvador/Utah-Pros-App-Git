-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726250000_notification_control_gates
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the admin requirement from the three notification-settings
--   operations, restoring their exact previous bodies.
--
--   This re-opens both doors the migration closed: any logged-in employee could
--   again switch role-wide notification defaults (including "email me every
--   incoming text"), and could again silence any other person's alerts —
--   including the owner's system-health alerts.
--
--   Prefer fixing forward. Only run this if the gate itself is what broke
--   something.
--
-- VERIFIED-BEFORE STATE (live catalog, 2026-07-26):
--   All three were SECURITY DEFINER, search_path 'public', granted to
--   authenticated, with no caller check. delete_employee_notification_override
--   was LANGUAGE sql; the other two were already plpgsql.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_notification_default(
  p_role text, p_type_key text, p_channel text, p_enabled boolean,
  p_user_customizable boolean DEFAULT NULL::boolean
)
RETURNS notification_role_defaults
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.notification_role_defaults;
BEGIN
  INSERT INTO public.notification_role_defaults
    (role, type_key, channel, enabled, user_customizable, updated_at)
  VALUES
    (p_role, p_type_key, p_channel, p_enabled, COALESCE(p_user_customizable, true), now())
  ON CONFLICT (role, type_key, channel) DO UPDATE
    SET enabled           = EXCLUDED.enabled,
        user_customizable = COALESCE(p_user_customizable,
                                     public.notification_role_defaults.user_customizable),
        updated_at        = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS notification_employee_overrides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.notification_employee_overrides;
BEGIN
  INSERT INTO public.notification_employee_overrides
    (employee_id, type_key, channel, enabled, updated_at, updated_by)
  VALUES
    (p_employee_id, p_type_key, p_channel, p_enabled, now(), p_actor_id)
  ON CONFLICT (employee_id, type_key, channel) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        updated_at = now(),
        updated_by = p_actor_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.notification_employee_overrides
   WHERE employee_id = p_employee_id
     AND type_key    = p_type_key
     AND channel     = p_channel;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_notification_default(text, text, text, boolean, boolean)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_employee_notification_override(uuid, text, text, boolean, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_employee_notification_override(uuid, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_notification_default(text, text, text, boolean, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_employee_notification_override(uuid, text, text, boolean, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_employee_notification_override(uuid, text, text)
  TO authenticated, service_role;
