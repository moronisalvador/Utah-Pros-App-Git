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

DO $preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_execute_grantees text[];
BEGIN
  IF to_regclass('public.device_tokens') IS NULL THEN
    RAISE EXCEPTION
      'native APNs token preflight: device_tokens is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.device_tokens'::regclass
      AND attname = 'apns_environment'
      AND attnum > 0
      AND NOT attisdropped
  )
     OR EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.device_tokens'::regclass
         AND conname = 'device_tokens_apns_environment_check'
     ) THEN
    RAISE EXCEPTION
      'native APNs token preflight: additive column/constraint already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname IN (
        'upsert_my_native_device_token',
        'delete_my_native_device_token'
      )
  ) THEN
    RAISE EXCEPTION
      'native APNs token preflight: new RPC identity already exists';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.upsert_device_token(uuid,text,text)',
          'upsert_device_token',
          'p_employee_id uuid, p_token text, p_platform text',
          'device_tokens',
          'plpgsql',
          'v'::"char",
          ARRAY['search_path=public']::text[],
          '5d5a405a4f83b0bceeada7c1e68f9759',
          ARRAY['authenticated','postgres','service_role']::text[]
        ),
        (
          'public.delete_device_token(text)',
          'delete_device_token',
          'p_token text',
          'void',
          'plpgsql',
          'v'::"char",
          ARRAY['search_path=public']::text[],
          '08f895e2f310f23e1ca131a527a0d358',
          ARRAY['authenticated','postgres','service_role']::text[]
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
        'native APNs token preflight: overload drift for %',
        v_expected.function_name;
    END IF;

    v_oid := to_regprocedure(v_expected.identity);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'native APNs token preflight: missing %',
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
       OR NOT has_function_privilege(
         'authenticated',
         v_oid,
         'EXECUTE'
       )
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'native APNs token preflight: legacy RPC contract drift for %',
        v_expected.identity;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE public.device_tokens
  ADD COLUMN apns_environment text;

ALTER TABLE public.device_tokens
  ADD CONSTRAINT device_tokens_apns_environment_check
  CHECK (
    apns_environment IS NULL
    OR apns_environment IN ('sandbox', 'production')
  ) NOT VALID;

ALTER TABLE public.device_tokens
  VALIDATE CONSTRAINT device_tokens_apns_environment_check;

DO $constraint_postcondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute attribute_record
    LEFT JOIN pg_attrdef default_record
      ON default_record.adrelid = attribute_record.attrelid
     AND default_record.adnum = attribute_record.attnum
    WHERE attribute_record.attrelid = 'public.device_tokens'::regclass
      AND attribute_record.attname = 'apns_environment'
      AND attribute_record.attnum > 0
      AND NOT attribute_record.attisdropped
      AND format_type(
        attribute_record.atttypid,
        attribute_record.atttypmod
      ) = 'text'
      AND NOT attribute_record.attnotnull
      AND default_record.oid IS NULL
  )
     OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.device_tokens'::regclass
      AND conname = 'device_tokens_apns_environment_check'
      AND contype = 'c'
      AND convalidated
      AND pg_get_constraintdef(oid, true)
            = 'CHECK (apns_environment IS NULL OR (apns_environment = ANY (ARRAY[''sandbox''::text, ''production''::text])))'
  ) THEN
    RAISE EXCEPTION
      'native APNs token postcondition: column/constraint drift';
  END IF;
END;
$constraint_postcondition$;

CREATE FUNCTION public.upsert_my_native_device_token(
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
     OR p_apns_environment IS NULL
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

  -- Bound one employee/environment to the five newest installations. The
  -- delivery worker uses the same cap, so one account cannot hold a Worker open
  -- across an unbounded sequence of APNs calls.
  DELETE FROM public.device_tokens stale_token
  WHERE stale_token.id IN (
    SELECT ranked.id
    FROM (
      SELECT
        token_row.id,
        row_number() OVER (
          ORDER BY token_row.updated_at DESC, token_row.id DESC
        ) AS position
      FROM public.device_tokens token_row
      WHERE token_row.employee_id = v_employee_id
        AND token_row.platform = 'ios'
        AND token_row.apns_environment = p_apns_environment
    ) ranked
    WHERE ranked.position > 5
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'platform', v_row.platform,
    'apns_environment', v_row.apns_environment,
    'updated_at', v_row.updated_at
  );
END;
$function$;

CREATE FUNCTION public.delete_my_native_device_token(p_token text)
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
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_my_native_device_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_native_device_token(text)
  TO authenticated, service_role;

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
          'public.upsert_my_native_device_token(text,text)',
          'upsert_my_native_device_token',
          'p_token text, p_apns_environment text',
          'jsonb'
        ),
        (
          'public.delete_my_native_device_token(text)',
          'delete_my_native_device_token',
          'p_token text',
          'void'
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type
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
        'native APNs token postcondition: overload drift for %',
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
           AND language_record.lanname = 'plpgsql'
           AND function_record.prosecdef
           AND NOT function_record.proisstrict
           AND NOT function_record.proleakproof
           AND function_record.provolatile = 'v'::"char"
           AND function_record.proparallel = 'u'::"char"
           AND function_record.prokind = 'f'::"char"
           AND function_record.proconfig = ARRAY['search_path=""']::text[]
           AND pg_get_function_arguments(function_record.oid)
                 = v_expected.arguments
           AND pg_get_function_result(function_record.oid)
                 = v_expected.result_type
       )
       OR v_execute_grantees IS DISTINCT FROM
            ARRAY['authenticated','postgres','service_role']::text[]
       OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION
        'native APNs token postcondition: new RPC contract drift for %',
        v_expected.identity;
    END IF;
  END LOOP;

  IF has_function_privilege(
       'authenticated',
       'public.upsert_device_token(uuid,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.delete_device_token(text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.upsert_device_token(uuid,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.delete_device_token(text)',
       'EXECUTE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.device_tokens',
       'SELECT'
     )
     OR has_table_privilege('anon', 'public.device_tokens', 'SELECT') THEN
    RAISE EXCEPTION
      'native APNs token postcondition: legacy/table ACL boundary drift';
  END IF;
END;
$postcondition$;
