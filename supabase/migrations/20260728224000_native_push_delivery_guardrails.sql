-- ════════════════════════════════════════════════
-- MIGRATION: 20260728224000_native_push_delivery_guardrails
-- Phase: Mobile readiness — native push activation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Closes the remaining notification-preference ownership gap without applying
--   the broader deferred S1h migration, and gives native Push a durable
--   source-event/device claim before APNs is called. It also exposes one narrow
--   service-role cleanup RPC that compare-and-deletes only the exact stale token
--   version Apple rejected.
--
-- ADDITIVE-ONLY / function-body-only:
--   Adds one private claims table and three service-role-only RPCs. It replaces
--   three deployed notification preference RPC bodies without changing their
--   signatures or return shapes, then removes direct browser table access.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260728224000_native_push_delivery_guardrails.rollback.sql
--   disables new native delivery claims/provider cleanup while retaining the
--   preference ownership boundary and private claim history. Reopening the
--   cross-employee preference exposure is intentionally not a safe rollback.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_policy_names text[];
  v_expected record;
  v_oid oid;
  v_execute_grantees text[];
BEGIN
  IF to_regclass('public.native_push_delivery_claims') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_proc function_record
       JOIN pg_namespace namespace_record
         ON namespace_record.oid = function_record.pronamespace
       WHERE namespace_record.nspname = 'public'
         AND function_record.proname IN (
           'is_current_native_push_preferences_employee',
           'claim_native_push_delivery',
           'release_native_push_delivery_claim',
           'prune_stale_native_device_token'
         )
     ) THEN
    RAISE EXCEPTION
      'native Push preflight: additive table/helper/RPC identity already exists';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_effective_notification_prefs(uuid)',
          'get_effective_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'sql',
          's'::"char",
          ARRAY['search_path=public']::text[],
          '26265649c566f96b9609665bdcb9b681',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.get_my_notification_prefs(uuid)',
          'get_my_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'sql',
          's'::"char",
          ARRAY['search_path=public']::text[],
          '74a2cde903e4065bf77a5ee7e91136d3',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.set_my_notification_pref(uuid,text,text,boolean)',
          'set_my_notification_pref',
          'p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean',
          'notification_prefs',
          'plpgsql',
          'v'::"char",
          ARRAY['search_path=public']::text[],
          'ab61d17bdc3ee21db918ba630c84833d',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.notify_emit(text,jsonb)',
          'notify_emit',
          'p_type_key text, p_body jsonb',
          'void',
          'plpgsql',
          'v'::"char",
          ARRAY['search_path=public']::text[],
          '27d638e9e2681bf74f17fa255c7eaf04',
          ARRAY['postgres','service_role']::text[]
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type,
      language_name,
      volatility,
      runtime_config,
      body_md5,
      execute_grantees
    )
  LOOP
    IF (
      SELECT count(*)
      FROM pg_proc function_record
      JOIN pg_namespace namespace_record
        ON namespace_record.oid = function_record.pronamespace
      WHERE namespace_record.nspname = 'public'
        AND function_record.proname = v_expected.function_name
    ) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'native Push preflight: overload drift for %',
        v_expected.function_name;
    END IF;

    v_oid := to_regprocedure(v_expected.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'native Push preflight: missing %',
        v_expected.identity;
    END IF;

    SELECT array_agg(
             COALESCE(grantee_role.rolname, 'PUBLIC')
             ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
           )
      INTO v_execute_grantees
    FROM pg_proc function_record
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        function_record.proacl,
        acldefault('f', function_record.proowner)
      )
    ) acl
    LEFT JOIN pg_roles grantee_role
      ON grantee_role.oid = acl.grantee
    WHERE function_record.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc function_record
      JOIN pg_language language_record
        ON language_record.oid = function_record.prolang
      WHERE function_record.oid = v_oid
        AND pg_get_userbyid(function_record.proowner) = 'postgres'
        AND language_record.lanname = v_expected.language_name
        AND function_record.prosecdef
        AND NOT function_record.proisstrict
        AND NOT function_record.proleakproof
        AND function_record.provolatile = v_expected.volatility
        AND function_record.proparallel = 'u'::"char"
        AND function_record.prokind = 'f'::"char"
        AND function_record.proconfig = v_expected.runtime_config
        AND pg_get_function_arguments(function_record.oid)
              = v_expected.arguments
        AND pg_get_function_result(function_record.oid)
              = v_expected.result_type
        AND md5(function_record.prosrc) = v_expected.body_md5
    )
       OR v_execute_grantees IS DISTINCT FROM
            v_expected.execute_grantees
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege(
         'authenticated',
         v_oid,
         'EXECUTE'
       ) IS DISTINCT FROM (
         v_expected.function_name <> 'notify_emit'
       )
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'native Push preflight: deployed RPC contract drift for %',
        v_expected.identity;
    END IF;
  END LOOP;

  SELECT array_agg(policyname ORDER BY policyname)
  INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'notification_prefs';

  IF v_policy_names IS DISTINCT FROM ARRAY['notification_prefs_all']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'notification_prefs'
         AND policyname = 'notification_prefs_all'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'ALL'
         AND qual = 'true'
         AND with_check = 'true'
     ) THEN
    RAISE EXCEPTION
      'native Push preference preflight: policy drift %',
      v_policy_names;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.notify_emit(
  p_type_key text,
  p_body jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean;
  v_url text;
  v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled
  INTO v_enabled
  FROM public.notification_types
  WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;

  SELECT value
  INTO v_url
  FROM public.integration_config
  WHERE key = 'notify_worker_url';
  SELECT value
  INTO v_secret
  FROM public.integration_config
  WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object(
      'notification_event_id',
      gen_random_uuid(),
      'type_key',
      p_type_key
    ),
    headers := jsonb_build_object(
      'Content-Type',
      'application/json',
      'x-webhook-secret',
      COALESCE(v_secret, '')
    )
  );
END;
$function$;

ALTER FUNCTION public.notify_emit(text, jsonb)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  TO service_role;

CREATE FUNCTION public.is_current_native_push_preferences_employee(
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = p_employee_id
      AND employee.auth_user_id = auth.uid()
      AND employee.is_active
      AND NOT employee.is_external
      AND employee.role::text IN (
        'admin',
        'office',
        'project_manager',
        'field_tech',
        'estimator',
        'supervisor'
      )
  );
$function$;

ALTER FUNCTION public.is_current_native_push_preferences_employee(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_current_native_push_preferences_employee(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_effective_notification_prefs(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification preferences only'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH employee_scope AS (
    SELECT employee.id, employee.role
    FROM public.employees employee
    WHERE employee.id = p_employee_id
  ),
  channels(channel) AS (
    VALUES ('bell'), ('push'), ('email')
  ),
  matrix AS (
    SELECT
      notification_type.type_key,
      notification_type.label,
      notification_type.category,
      notification_type.sort_order,
      notification_type.enabled AS type_enabled,
      channels.channel,
      CASE channels.channel
        WHEN 'bell' THEN notification_type.bell_default
        WHEN 'push' THEN notification_type.push_default
        ELSE notification_type.email_default
      END AS type_channel_default
    FROM public.notification_types notification_type
    CROSS JOIN channels
  )
  SELECT json_build_object(
    'type_key', matrix.type_key,
    'label', matrix.label,
    'category', matrix.category,
    'channel', matrix.channel,
    'type_enabled', matrix.type_enabled,
    'user_customizable',
      COALESCE(role_default.user_customizable, true),
    'enabled',
      CASE
        WHEN COALESCE(role_default.user_customizable, true)
             AND personal_pref.enabled IS NOT NULL
          THEN personal_pref.enabled
        ELSE COALESCE(
          employee_override.enabled,
          role_default.enabled,
          matrix.type_channel_default
        )
      END
  )
  FROM matrix
  CROSS JOIN employee_scope
  LEFT JOIN public.notification_role_defaults role_default
    ON role_default.role = employee_scope.role::text
   AND role_default.type_key = matrix.type_key
   AND role_default.channel = matrix.channel
  LEFT JOIN public.notification_employee_overrides employee_override
    ON employee_override.employee_id = employee_scope.id
   AND employee_override.type_key = matrix.type_key
   AND employee_override.channel = matrix.channel
  LEFT JOIN public.notification_prefs personal_pref
    ON personal_pref.employee_id = employee_scope.id
   AND personal_pref.type_key = matrix.type_key
   AND personal_pref.channel = matrix.channel
  ORDER BY matrix.sort_order, matrix.type_key, matrix.channel;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_notification_prefs(
  p_employee_id uuid
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification preferences only'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT resolved_pref
  FROM public.get_effective_notification_prefs(p_employee_id) AS resolved_pref
  WHERE COALESCE((resolved_pref->>'type_enabled')::boolean, false);
END;
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
  v_role text;
  v_customizable boolean;
  v_row public.notification_prefs;
BEGIN
  IF NOT COALESCE(
       (SELECT auth.jwt() ->> 'role' = 'service_role'),
       false
     )
     AND NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification preferences only'
      USING errcode = '42501';
  END IF;

  IF p_channel NOT IN ('bell', 'push', 'email') THEN
    RAISE EXCEPTION 'invalid channel: %', p_channel;
  END IF;

  SELECT employee.role::text
  INTO v_role
  FROM public.employees employee
  WHERE employee.id = p_employee_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unknown employee: %', p_employee_id;
  END IF;

  SELECT role_default.user_customizable
  INTO v_customizable
  FROM public.notification_role_defaults role_default
  WHERE role_default.role = v_role
    AND role_default.type_key = p_type_key
    AND role_default.channel = p_channel;

  IF v_customizable IS FALSE THEN
    RAISE EXCEPTION
      'notification preference locked by an administrator (% / %)',
      p_type_key,
      p_channel;
  END IF;

  INSERT INTO public.notification_prefs (
    employee_id,
    type_key,
    channel,
    enabled
  )
  VALUES (
    p_employee_id,
    p_type_key,
    p_channel,
    p_enabled
  )
  ON CONFLICT (employee_id, type_key, channel)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

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
ALTER POLICY notification_prefs_all
  ON public.notification_prefs
  TO authenticated
  USING (false)
  WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.notification_prefs
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.native_push_delivery_claims (
  delivery_key uuid PRIMARY KEY,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  device_fingerprint uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX native_push_delivery_claims_claimed_at_idx
  ON public.native_push_delivery_claims (claimed_at);

ALTER TABLE public.native_push_delivery_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_push_delivery_claims
  FORCE ROW LEVEL SECURITY;
CREATE POLICY native_push_delivery_claims_service_role
  ON public.native_push_delivery_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL PRIVILEGES ON TABLE public.native_push_delivery_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE
  ON TABLE public.native_push_delivery_claims
  TO service_role;

CREATE FUNCTION public.claim_native_push_delivery(
  p_delivery_key uuid,
  p_employee_id uuid,
  p_device_token_id uuid,
  p_device_fingerprint uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_claimed boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING errcode = '42501';
  END IF;

  -- The claim prevents duplicate retries, but it is not permanent business
  -- history. Retain a 90-day replay window and remove at most 1,000 expired
  -- rows per delivery so an active device cannot grow this table forever.
  WITH expired_claims AS (
    SELECT existing_claim.delivery_key
    FROM public.native_push_delivery_claims existing_claim
    WHERE existing_claim.claimed_at < now() - interval '90 days'
    ORDER BY existing_claim.claimed_at
    LIMIT 1000
  )
  DELETE FROM public.native_push_delivery_claims existing_claim
  USING expired_claims
  WHERE existing_claim.delivery_key = expired_claims.delivery_key;

  INSERT INTO public.native_push_delivery_claims (
    delivery_key,
    employee_id,
    device_fingerprint
  )
  SELECT
    p_delivery_key,
    p_employee_id,
    p_device_fingerprint
  WHERE EXISTS (
    SELECT 1
    FROM public.device_tokens token_row
    WHERE token_row.id = p_device_token_id
      AND token_row.employee_id = p_employee_id
  )
  ON CONFLICT (delivery_key) DO NOTHING
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$function$;

CREATE FUNCTION public.release_native_push_delivery_claim(
  p_delivery_key uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_released_count integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.native_push_delivery_claims
  WHERE delivery_key = p_delivery_key;

  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  RETURN v_released_count > 0;
END;
$function$;

CREATE FUNCTION public.prune_stale_native_device_token(
  p_device_token_id uuid,
  p_token text,
  p_apns_environment text,
  p_observed_updated_at timestamptz,
  p_invalidated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.device_tokens token_row
  WHERE token_row.id = p_device_token_id
    AND token_row.token = p_token
    AND token_row.platform = 'ios'
    AND token_row.apns_environment = p_apns_environment
    AND token_row.updated_at = p_observed_updated_at
    AND (
      p_invalidated_at IS NULL
      OR token_row.updated_at <= p_invalidated_at
    )
  RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$function$;

ALTER FUNCTION public.claim_native_push_delivery(
  uuid,
  uuid,
  uuid,
  uuid
) OWNER TO postgres;
ALTER FUNCTION public.release_native_push_delivery_claim(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.prune_stale_native_device_token(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.claim_native_push_delivery(
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_native_push_delivery(
  uuid,
  uuid,
  uuid,
  uuid
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_native_push_delivery_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_native_push_delivery_claim(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.prune_stale_native_device_token(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_stale_native_device_token(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) TO service_role;

DO $postcondition$
DECLARE
  v_expected record;
  v_oid oid;
  v_execute_grantees text[];
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.notify_emit(text,jsonb)',
          'notify_emit',
          'p_type_key text, p_body jsonb',
          'void',
          'plpgsql',
          'v'::"char",
          true,
          ARRAY['search_path=public']::text[],
          '3f972d71b7995dd7787ef6ff2fb76872',
          ARRAY['postgres','service_role']::text[]
        ),
        (
          'public.is_current_native_push_preferences_employee(uuid)',
          'is_current_native_push_preferences_employee',
          'p_employee_id uuid',
          'boolean',
          'sql',
          's'::"char",
          true,
          ARRAY['search_path=public']::text[],
          'fa283855321fd2e67af47311ab28b4c1',
          ARRAY['postgres']::text[]
        ),
        (
          'public.get_effective_notification_prefs(uuid)',
          'get_effective_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'plpgsql',
          's'::"char",
          true,
          ARRAY['search_path=public']::text[],
          '7c1c124b63511c5d935d3afea934e01b',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.get_my_notification_prefs(uuid)',
          'get_my_notification_prefs',
          'p_employee_id uuid',
          'SETOF json',
          'plpgsql',
          's'::"char",
          true,
          ARRAY['search_path=public']::text[],
          '8bd058c30b083320ac1474fe91437a8c',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.set_my_notification_pref(uuid,text,text,boolean)',
          'set_my_notification_pref',
          'p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean',
          'notification_prefs',
          'plpgsql',
          'v'::"char",
          true,
          ARRAY['search_path=public']::text[],
          '4989e0a513fe9a0c88ae91d5946b3008',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.claim_native_push_delivery(uuid,uuid,uuid,uuid)',
          'claim_native_push_delivery',
          'p_delivery_key uuid, p_employee_id uuid, p_device_token_id uuid, p_device_fingerprint uuid',
          'boolean',
          'plpgsql',
          'v'::"char",
          false,
          ARRAY['search_path=""']::text[],
          '29ae318e17063990fce5b0500b89e025',
          ARRAY['postgres','service_role']::text[]
        ),
        (
          'public.release_native_push_delivery_claim(uuid)',
          'release_native_push_delivery_claim',
          'p_delivery_key uuid',
          'boolean',
          'plpgsql',
          'v'::"char",
          false,
          ARRAY['search_path=""']::text[],
          '4fed945afa98da7c6ec18aef88d1fea7',
          ARRAY['postgres','service_role']::text[]
        ),
        (
          'public.prune_stale_native_device_token(uuid,text,text,timestamptz,timestamptz)',
          'prune_stale_native_device_token',
          'p_device_token_id uuid, p_token text, p_apns_environment text, p_observed_updated_at timestamp with time zone, p_invalidated_at timestamp with time zone DEFAULT NULL::timestamp with time zone',
          'boolean',
          'plpgsql',
          'v'::"char",
          false,
          ARRAY['search_path=""']::text[],
          'b61c6492b5a9869dc0ac754c65bdf48e',
          ARRAY['postgres','service_role']::text[]
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type,
      language_name,
      volatility,
      security_definer,
      runtime_config,
      body_md5,
      execute_grantees
    )
  LOOP
    IF (
      SELECT count(*)
      FROM pg_proc function_record
      JOIN pg_namespace namespace_record
        ON namespace_record.oid = function_record.pronamespace
      WHERE namespace_record.nspname = 'public'
        AND function_record.proname = v_expected.function_name
    ) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'native Push postcondition: overload drift for %',
        v_expected.function_name;
    END IF;

    v_oid := to_regprocedure(v_expected.identity);

    SELECT array_agg(
             COALESCE(grantee_role.rolname, 'PUBLIC')
             ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
           )
      INTO v_execute_grantees
    FROM pg_proc function_record
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        function_record.proacl,
        acldefault('f', function_record.proowner)
      )
    ) acl
    LEFT JOIN pg_roles grantee_role
      ON grantee_role.oid = acl.grantee
    WHERE function_record.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF v_oid IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc function_record
         JOIN pg_language language_record
           ON language_record.oid = function_record.prolang
         WHERE function_record.oid = v_oid
           AND pg_get_userbyid(function_record.proowner) = 'postgres'
           AND language_record.lanname = v_expected.language_name
           AND function_record.prosecdef = v_expected.security_definer
           AND NOT function_record.proisstrict
           AND NOT function_record.proleakproof
           AND function_record.provolatile = v_expected.volatility
           AND function_record.proparallel = 'u'::"char"
           AND function_record.prokind = 'f'::"char"
           AND function_record.proconfig = v_expected.runtime_config
           AND pg_get_function_arguments(function_record.oid)
                 = v_expected.arguments
           AND pg_get_function_result(function_record.oid)
                 = v_expected.result_type
           AND md5(function_record.prosrc) = v_expected.body_md5
       )
       OR v_execute_grantees IS DISTINCT FROM
            v_expected.execute_grantees
       OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'native Push postcondition: RPC contract drift for %',
        v_expected.identity;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_class relation_record
       WHERE relation_record.oid =
               'public.native_push_delivery_claims'::regclass
         AND relation_record.relrowsecurity
         AND relation_record.relforcerowsecurity
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'native_push_delivery_claims'
         AND policyname =
               'native_push_delivery_claims_service_role'
         AND permissive = 'PERMISSIVE'
         AND roles = ARRAY['service_role']::name[]
         AND cmd = 'ALL'
         AND qual = 'true'
         AND with_check = 'true'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'notification_prefs'
         AND policyname = 'notification_prefs_all'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'ALL'
         AND qual = 'false'
         AND with_check = 'false'
     )
     OR has_table_privilege(
       'authenticated',
       'public.notification_prefs',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.native_push_delivery_claims',
       'SELECT'
     )
     OR has_table_privilege(
       'anon',
       'public.native_push_delivery_claims',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.native_push_delivery_claims',
       'SELECT,INSERT,DELETE'
     ) THEN
    RAISE EXCEPTION
      'native Push postcondition: table policy/ACL boundary drift';
  END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
