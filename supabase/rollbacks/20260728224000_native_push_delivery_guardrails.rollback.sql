-- ════════════════════════════════════════════════
-- UNSAFE ROLLBACK: 20260728224000_native_push_delivery_guardrails
-- ════════════════════════════════════════════════
--
-- This restores the exact four deployed RPC bodies and ACLs captured before
-- the forward migration. For the three preference RPCs that deliberately
-- re-opens the employee-selector authorization defect. It is therefore guarded
-- by an explicit operator session setting and is not a routine rollback.
-- Prefer a reviewed forward repair.
--
-- The additive claim table and helper/RPC identities remain so replay history
-- is not destroyed. New claim and provider-prune execution is disabled; the
-- release helper remains service-only for operational cleanup. The private
-- table policies/grants and direct preference-table closure remain tightened.

DO $rollback_preflight$
DECLARE
  v_expected record;
BEGIN
  IF current_setting(
       'upr.allow_unsafe_native_push_delivery_rollback',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'unsafe native Push rollback requires upr.allow_unsafe_native_push_delivery_rollback=on';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_emit(text,jsonb)',
          '3f972d71b7995dd7787ef6ff2fb76872'
        ),
        (
          'public.get_effective_notification_prefs(uuid)',
          '7c1c124b63511c5d935d3afea934e01b'
        ),
        (
          'public.get_my_notification_prefs(uuid)',
          '8bd058c30b083320ac1474fe91437a8c'
        ),
        (
          'public.set_my_notification_pref(uuid,text,text,boolean)',
          '4989e0a513fe9a0c88ae91d5946b3008'
        )
    ) AS expected(identity, body_md5)
  LOOP
    IF md5((
         SELECT function_record.prosrc
         FROM pg_proc function_record
         WHERE function_record.oid =
                 to_regprocedure(v_expected.identity)
       )) IS DISTINCT FROM v_expected.body_md5 THEN
      RAISE EXCEPTION
        'unsafe native Push rollback preflight drift for %',
        v_expected.identity;
    END IF;
  END LOOP;
END;
$rollback_preflight$;

REVOKE EXECUTE ON FUNCTION public.claim_native_push_delivery(
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.prune_stale_native_device_token(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.release_native_push_delivery_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_native_push_delivery_claim(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.notify_emit(p_type_key text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enabled boolean; v_url text; v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled INTO v_enabled FROM public.notification_types WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;
  SELECT value INTO v_url    FROM public.integration_config WHERE key = 'notify_worker_url';
  SELECT value INTO v_secret FROM public.integration_config WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object('type_key', p_type_key),
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', COALESCE(v_secret,''))
  );
END; $$;

CREATE OR REPLACE FUNCTION public.get_effective_notification_prefs(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH emp AS (SELECT id, role FROM public.employees WHERE id = p_employee_id),
  channels(channel) AS (VALUES ('bell'), ('push'), ('email')),
  matrix AS (
    SELECT t.type_key, t.label, t.category, t.sort_order, t.enabled AS type_enabled, c.channel,
           CASE c.channel WHEN 'bell' THEN t.bell_default WHEN 'push' THEN t.push_default ELSE t.email_default END AS type_channel_default
      FROM public.notification_types t CROSS JOIN channels c
  )
  SELECT json_build_object(
    'type_key', m.type_key, 'label', m.label, 'category', m.category, 'channel', m.channel,
    'type_enabled', m.type_enabled, 'user_customizable', COALESCE(rd.user_customizable, true),
    'enabled',
      CASE WHEN COALESCE(rd.user_customizable, true) AND mp.enabled IS NOT NULL THEN mp.enabled
           ELSE COALESCE(ov.enabled, rd.enabled, m.type_channel_default) END
  )
  FROM matrix m
  CROSS JOIN emp e
  LEFT JOIN public.notification_role_defaults rd
    ON rd.role = e.role::text AND rd.type_key = m.type_key AND rd.channel = m.channel
  LEFT JOIN public.notification_employee_overrides ov
    ON ov.employee_id = e.id AND ov.type_key = m.type_key AND ov.channel = m.channel
  LEFT JOIN public.notification_prefs mp
    ON mp.employee_id = e.id AND mp.type_key = m.type_key AND mp.channel = m.channel
  ORDER BY m.sort_order, m.type_key, m.channel;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_notification_prefs(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r
    FROM public.get_effective_notification_prefs(p_employee_id) AS r
   WHERE COALESCE((r->>'type_enabled')::boolean, false) = true;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_notification_pref(
  p_employee_id uuid,
  p_type_key text,
  p_channel text,
  p_enabled boolean
)
RETURNS public.notification_prefs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role        text;
  v_customizable boolean;
  v_row         public.notification_prefs;
BEGIN
  IF p_channel NOT IN ('bell', 'push', 'email') THEN
    RAISE EXCEPTION 'invalid channel: %', p_channel;
  END IF;

  SELECT role::text INTO v_role FROM public.employees WHERE id = p_employee_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unknown employee: %', p_employee_id;
  END IF;

  SELECT user_customizable INTO v_customizable
    FROM public.notification_role_defaults
   WHERE role = v_role AND type_key = p_type_key AND channel = p_channel;
  IF v_customizable IS FALSE THEN
    RAISE EXCEPTION 'notification preference locked by an administrator (% / %)', p_type_key, p_channel;
  END IF;

  INSERT INTO public.notification_prefs (employee_id, type_key, channel, enabled)
  VALUES (p_employee_id, p_type_key, p_channel, p_enabled)
  ON CONFLICT (employee_id, type_key, channel) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

ALTER FUNCTION public.notify_emit(text, jsonb)
  OWNER TO postgres;
ALTER FUNCTION public.get_effective_notification_prefs(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.get_my_notification_prefs(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.set_my_notification_pref(
  uuid,
  text,
  text,
  boolean
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_notification_prefs(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_notification_prefs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_notification_prefs(uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_my_notification_pref(
  uuid,
  text,
  text,
  boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_notification_pref(
  uuid,
  text,
  text,
  boolean
) TO authenticated, service_role;

ALTER TABLE public.notification_prefs
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs
  FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.notification_prefs
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.native_push_delivery_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_push_delivery_claims
  FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.native_push_delivery_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE
  ON TABLE public.native_push_delivery_claims
  TO service_role;

DO $rollback_postcondition$
DECLARE
  v_expected record;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_emit(text,jsonb)',
          '27d638e9e2681bf74f17fa255c7eaf04',
          false
        ),
        (
          'public.get_effective_notification_prefs(uuid)',
          '26265649c566f96b9609665bdcb9b681',
          true
        ),
        (
          'public.get_my_notification_prefs(uuid)',
          '74a2cde903e4065bf77a5ee7e91136d3',
          true
        ),
        (
          'public.set_my_notification_pref(uuid,text,text,boolean)',
          'ab61d17bdc3ee21db918ba630c84833d',
          true
        )
    ) AS expected(identity, body_md5, authenticated_execute)
  LOOP
    IF md5((
         SELECT function_record.prosrc
         FROM pg_proc function_record
         WHERE function_record.oid =
                 to_regprocedure(v_expected.identity)
       )) IS DISTINCT FROM v_expected.body_md5
       OR has_function_privilege(
         'authenticated',
         to_regprocedure(v_expected.identity),
         'EXECUTE'
       ) IS DISTINCT FROM v_expected.authenticated_execute
       OR NOT has_function_privilege(
         'service_role',
         to_regprocedure(v_expected.identity),
         'EXECUTE'
       )
       OR has_function_privilege(
         'anon',
         to_regprocedure(v_expected.identity),
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'unsafe native Push rollback postcondition drift for %',
        v_expected.identity;
    END IF;
  END LOOP;
END;
$rollback_postcondition$;

NOTIFY pgrst, 'reload schema';
