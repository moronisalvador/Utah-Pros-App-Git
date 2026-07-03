-- ═════════════════════════════════════════════════════════════════════════════
-- Notification Center — Session D: admin defaults RPC bodies
--   docs/notify-roadmap.md, "Session D — Admin defaults UI".
--
-- Body-only CREATE OR REPLACE fills for the FIVE Session-D frozen stubs shipped
-- by 20260703_notify_f2_foundation.sql. Signatures are FROZEN — unchanged here
-- (migration-safety-checker enforces). Zero schema: no new tables/columns/policies.
-- Never re-REPLACEs get_effective_notification_prefs (F2-owned resolver) — these
-- RPCs mirror its precedence math so the admin "effective" column matches the
-- resolver exactly.
--
-- One shared Supabase across dev + main — live in both the moment it applies.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── get_notification_defaults() — the full role × type × channel matrix ───
-- One json row per (role, type_key, channel) across the app's fixed role set ×
-- the whole catalog × the three channels. Where no role-default row exists the
-- value falls back to the catalog channel default and user_customizable=true, so
-- the admin UI can render (and set) every cell without a client-side merge.
CREATE OR REPLACE FUNCTION public.get_notification_defaults()
RETURNS SETOF json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH roles(role) AS (
    VALUES ('admin'), ('office'), ('project_manager'), ('supervisor'),
           ('field_tech'), ('crm_partner')
  ),
  channels(channel) AS (VALUES ('bell'), ('push'), ('email')),
  matrix AS (
    SELECT r.role, t.type_key, t.label, t.category, t.sort_order,
           t.enabled AS type_enabled, c.channel,
           CASE c.channel WHEN 'bell'  THEN t.bell_default
                          WHEN 'push'  THEN t.push_default
                          ELSE              t.email_default END AS type_channel_default
      FROM public.notification_types t
      CROSS JOIN roles r
      CROSS JOIN channels c
  )
  SELECT json_build_object(
    'role',                 m.role,
    'type_key',             m.type_key,
    'label',                m.label,
    'category',             m.category,
    'sort_order',           m.sort_order,
    'channel',              m.channel,
    'type_enabled',         m.type_enabled,
    'type_channel_default', m.type_channel_default,
    'enabled',             COALESCE(rd.enabled, m.type_channel_default),
    'user_customizable',   COALESCE(rd.user_customizable, true),
    'has_default',         (rd.id IS NOT NULL)
  )
  FROM matrix m
  LEFT JOIN public.notification_role_defaults rd
    ON rd.role = m.role AND rd.type_key = m.type_key AND rd.channel = m.channel
  ORDER BY m.sort_order, m.type_key, m.role, m.channel;
$$;

-- ─── set_notification_default(...) — upsert one role×type×channel default ───
-- p_user_customizable NULL = leave the existing lock unchanged (new rows default
-- to customizable=true). The admin UI flips a per-role×type lock by calling this
-- once per channel carrying that channel's current enabled value.
CREATE OR REPLACE FUNCTION public.set_notification_default(
  p_role text, p_type_key text, p_channel text, p_enabled boolean,
  p_user_customizable boolean DEFAULT NULL)
RETURNS public.notification_role_defaults
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- ─── get_employee_notification_overrides(p_employee_id) — per-employee tri-state ─
-- One json row per (type_key, channel) for the employee, exposing every layer the
-- admin UI shows: the role default, whether an admin override exists (+ its value),
-- and the resolver-identical effective value (role default → override → my-pref,
-- lock wins). 'effective' MUST equal get_effective_notification_prefs's 'enabled'.
CREATE OR REPLACE FUNCTION public.get_employee_notification_overrides(p_employee_id uuid)
RETURNS SETOF json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emp AS (
    SELECT id, role::text AS role FROM public.employees WHERE id = p_employee_id
  ),
  channels(channel) AS (VALUES ('bell'), ('push'), ('email')),
  matrix AS (
    SELECT t.type_key, t.label, t.category, t.sort_order,
           t.enabled AS type_enabled, c.channel,
           CASE c.channel WHEN 'bell'  THEN t.bell_default
                          WHEN 'push'  THEN t.push_default
                          ELSE              t.email_default END AS type_channel_default
      FROM public.notification_types t
      CROSS JOIN channels c
  )
  SELECT json_build_object(
    'type_key',          m.type_key,
    'label',             m.label,
    'category',          m.category,
    'sort_order',        m.sort_order,
    'channel',           m.channel,
    'type_enabled',      m.type_enabled,
    'role_default',      COALESCE(rd.enabled, m.type_channel_default),
    'user_customizable', COALESCE(rd.user_customizable, true),
    'has_override',      (ov.id IS NOT NULL),
    'override_enabled',  ov.enabled,
    'has_my_pref',       (mp.id IS NOT NULL),
    'effective',
      CASE
        WHEN COALESCE(rd.user_customizable, true) AND mp.enabled IS NOT NULL
          THEN mp.enabled
        ELSE COALESCE(ov.enabled, rd.enabled, m.type_channel_default)
      END
  )
  FROM matrix m
  CROSS JOIN emp e
  LEFT JOIN public.notification_role_defaults rd
    ON rd.role = e.role AND rd.type_key = m.type_key AND rd.channel = m.channel
  LEFT JOIN public.notification_employee_overrides ov
    ON ov.employee_id = e.id AND ov.type_key = m.type_key AND ov.channel = m.channel
  LEFT JOIN public.notification_prefs mp
    ON mp.employee_id = e.id AND mp.type_key = m.type_key AND mp.channel = m.channel
  ORDER BY m.sort_order, m.type_key, m.channel;
$$;

-- ─── set_employee_notification_override(...) — upsert one employee override ───
CREATE OR REPLACE FUNCTION public.set_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean,
  p_actor_id uuid DEFAULT NULL)
RETURNS public.notification_employee_overrides
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- ─── delete_employee_notification_override(...) — clear one override ───
CREATE OR REPLACE FUNCTION public.delete_employee_notification_override(
  p_employee_id uuid, p_type_key text, p_channel text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.notification_employee_overrides
   WHERE employee_id = p_employee_id
     AND type_key    = p_type_key
     AND channel     = p_channel;
$$;

-- GRANTs survive CREATE OR REPLACE, but re-affirm them (idempotent, defensive).
GRANT EXECUTE ON FUNCTION public.get_notification_defaults()                                       TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_notification_default(text, text, text, boolean, boolean)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_notification_overrides(uuid)                         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_employee_notification_override(uuid, text, text, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_employee_notification_override(uuid, text, text)           TO anon, authenticated, service_role;

SELECT public.bust_postgrest_cache();
