-- ════════════════════════════════════════════════
-- MIGRATION: 20260726250000_notification_control_gates
-- Phase: Least-privilege — closes the two doors anon-grant-auditor found
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops any logged-in employee from rewriting other people's notification
--   settings.
--
--   Two problems, both found by review rather than by us:
--
--   1. A technician could switch the "email me every incoming text" setting back
--      on for their whole role — undoing the change made minutes earlier in
--      20260726211000, which claims it "cannot be switched back on by accident
--      later". That claim was false while this door was open.
--
--   2. A technician could silence ANY other person's alerts, including the
--      owner's. That defeats the point of 20260726193000, which routes system
--      health alerts to the owner: the routing can be perfectly correct and the
--      alert still gets muted at the per-person layer by someone else.
--
--   All three operations now require an admin, which is exactly what the screen
--   that uses them already requires. Nobody legitimate loses anything.
--
-- ADDITIVE-ONLY:
--   No — an authorization tightening (RED tier), the same class as
--   20260726220000. Three function-body-only CREATE OR REPLACE statements. No
--   table, column, index, policy or grant is created or dropped, and no row of
--   data changes.
--
-- EVIDENCE (live catalog, 2026-07-26):
--   All three are SECURITY DEFINER with search_path pinned to 'public', granted
--   to authenticated, and contain NO caller check of any kind:
--     set_notification_default(text, text, text, boolean, boolean)
--     set_employee_notification_override(uuid, text, text, boolean, uuid)
--     delete_employee_notification_override(uuid, text, text)
--   p_employee_id on the override pair is caller-supplied and unverified, so a
--   caller can name somebody else's employee id.
--
-- CALLER INVENTORY (why admin-only is the right gate, not a guess):
--   All three have exactly one caller: src/components/admin/NotificationDefaultsTab.jsx
--   (lines 155, 175, 338, 356, 378), rendered by src/pages/settings/NotificationDefaults
--   which src/App.jsx:495 already wraps in <AdminRoute>. So the database is being
--   brought into line with the gate the app has always intended. Personal
--   self-serve preferences live in a DIFFERENT table (notification_prefs) with
--   its own RPCs, untouched here — an employee can still manage their own.
--
-- DEPENDENCY:
--   Uses is_active_internal_admin(), created in 20260726220000. Timestamp
--   ordering applies that first; do not apply this one alone.
--
-- NOT byte-identical:
--   delete_employee_notification_override moves from LANGUAGE sql to plpgsql — a
--   pure-SQL function cannot RAISE conditionally. Signature, return type and
--   result are unchanged.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726250000_notification_control_gates.rollback.sql
--   (restores all three ungated bodies verbatim). Note this re-opens both doors
--   described above.
-- ════════════════════════════════════════════════

-- ─── 1. Role-wide defaults — admin only ───

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
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

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

-- ─── 2 & 3. Per-employee overrides — admin only ───
-- These name another person's employee id, so an unauthenticated-by-role caller
-- must never reach them. The actor is also resolved from auth.uid() rather than
-- trusted from p_actor_id, which was caller-supplied and spoofable.

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
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  SELECT e.id INTO v_actor FROM public.employees e WHERE e.auth_user_id = auth.uid();

  INSERT INTO public.notification_employee_overrides
    (employee_id, type_key, channel, enabled, updated_at, updated_by)
  VALUES
    (p_employee_id, p_type_key, p_channel, p_enabled, now(), COALESCE(v_actor, p_actor_id))
  ON CONFLICT (employee_id, type_key, channel) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        updated_at = now(),
        updated_by = COALESCE(v_actor, p_actor_id)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  DELETE FROM public.notification_employee_overrides
   WHERE employee_id = p_employee_id
     AND type_key    = p_type_key
     AND channel     = p_channel;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): EXECUTE TO PUBLIC is
-- re-applied to replaced functions, so revoke explicitly before granting.
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
