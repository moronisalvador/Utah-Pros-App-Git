-- ════════════════════════════════════════════════
-- MIGRATION: 20260730170000_device_token_apns_topic
-- Phase: Mobile readiness — per-token APNs topic (dev-app push routing)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Records which installed app (the Apple "bundle id") each iPhone
--   notification registration belongs to. With the side-by-side "UPR Dev" app
--   installed next to the production app, one server-wide topic setting can no
--   longer address every phone correctly — on 2026-07-30 that mismatch made
--   Apple reject every production-fleet push sent from the dev site
--   (DeviceTokenNotForTopic). After this change each registration remembers its
--   own app, and the delivery worker can address each token exactly.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Adds one nullable column and one check constraint (NOT VALID then
--   VALIDATE — millisecond locks). Replaces upsert_my_native_device_token in
--   the same transaction with a signature that adds ONE trailing
--   DEFAULT NULL parameter: the deployed two-argument named-parameter call
--   shape still resolves, and rows written by older clients keep NULL (the
--   worker falls back to the env APNS_TOPIC for those). The replacement is a
--   DROP + CREATE rather than CREATE OR REPLACE because adding a parameter via
--   CREATE OR REPLACE would create a SECOND overload, and two candidates for
--   the same named-argument call is exactly what breaks the deployed frontend
--   (PostgREST PGRST203 ambiguity). No table, column, policy, or data is
--   dropped, renamed, or mutated.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260730170000_device_token_apns_topic.rollback.sql
--   restores the prior function BODY under the SAME three-parameter signature
--   (the topic parameter is accepted and ignored), so both old and new
--   deployed clients keep enrolling while topic capture stops. The additive
--   column, constraint, and already-recorded values remain — dropping a live
--   column is the removal database-standard.md §3 forbids. The delivery
--   worker's own rollback is a code revert (env-topic fallback governs while
--   rows are NULL / the worker no longer selects the column).
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_oid oid;
  v_execute_grantees text[];
BEGIN
  IF to_regclass('public.device_tokens') IS NULL THEN
    RAISE EXCEPTION
      'device token apns topic preflight: device_tokens is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.device_tokens'::regclass
      AND attname = 'apns_topic'
      AND attnum > 0
      AND NOT attisdropped
  )
     OR EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.device_tokens'::regclass
         AND conname = 'device_tokens_apns_topic_check'
     ) THEN
    RAISE EXCEPTION
      'device token apns topic preflight: additive column/constraint already exists';
  END IF;

  -- The function being replaced must be byte-exact to the reviewed
  -- 20260728223000 definition (its live apply is recorded in
  -- docs/mobile/push-activation-owner-gate.md). Unexpected live drift means
  -- this migration was authored against the wrong body — stop and re-review,
  -- never overwrite an unreviewed change.
  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'upsert_my_native_device_token'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'device token apns topic preflight: overload drift for upsert_my_native_device_token';
  END IF;

  v_oid := to_regprocedure('public.upsert_my_native_device_token(text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'device token apns topic preflight: missing public.upsert_my_native_device_token(text,text)';
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
      AND language_record.lanname = 'plpgsql'
      AND function_record.prosecdef
      AND function_record.provolatile = 'v'::"char"
      AND function_record.prokind = 'f'::"char"
      AND function_record.proconfig = ARRAY['search_path=""']::text[]
      AND pg_get_function_arguments(function_record.oid)
            = 'p_token text, p_apns_environment text'
      AND pg_get_function_result(function_record.oid) = 'jsonb'
      AND md5(function_record.prosrc) = '27cedf4fb5c1a0786b1a29befbbdaadd'
  )
     OR v_execute_grantees IS DISTINCT FROM
          ARRAY['authenticated','postgres','service_role']::text[]
     OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'device token apns topic preflight: live RPC contract drift for public.upsert_my_native_device_token(text,text)';
  END IF;
END;
$preflight$;

ALTER TABLE public.device_tokens
  ADD COLUMN apns_topic text;

-- An APNs topic is the receiving app's bundle identifier: alphanumerics,
-- hyphens, and periods (Apple's legal set), bounded at 255 characters. The
-- value set is deliberately open — a future app variant must not need a
-- migration to enroll — while garbage is refused at the boundary.
ALTER TABLE public.device_tokens
  ADD CONSTRAINT device_tokens_apns_topic_check
  CHECK (
    apns_topic IS NULL
    OR apns_topic ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$'
  ) NOT VALID;

ALTER TABLE public.device_tokens
  VALIDATE CONSTRAINT device_tokens_apns_topic_check;

DO $constraint_postcondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute attribute_record
    LEFT JOIN pg_attrdef default_record
      ON default_record.adrelid = attribute_record.attrelid
     AND default_record.adnum = attribute_record.attnum
    WHERE attribute_record.attrelid = 'public.device_tokens'::regclass
      AND attribute_record.attname = 'apns_topic'
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
      AND conname = 'device_tokens_apns_topic_check'
      AND contype = 'c'
      AND convalidated
      AND strpos(
        pg_get_constraintdef(oid, true),
        '[A-Za-z0-9][A-Za-z0-9.-]{0,254}'
      ) > 0
  ) THEN
    RAISE EXCEPTION
      'device token apns topic postcondition: column/constraint drift';
  END IF;
END;
$constraint_postcondition$;

-- Same-transaction replacement. The Supabase migration executor wraps this
-- file in one transaction, so no caller can observe the gap between DROP and
-- CREATE. The deployed frontend calls with named parameters
-- {p_token, p_apns_environment}; the DEFAULT below keeps that exact call
-- shape resolving to this single function.
DROP FUNCTION public.upsert_my_native_device_token(text, text);

CREATE FUNCTION public.upsert_my_native_device_token(
  p_token text,
  p_apns_environment text,
  p_apns_topic text DEFAULT NULL
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

  IF p_apns_topic IS NOT NULL
     AND p_apns_topic !~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$' THEN
    RAISE EXCEPTION
      'apns topic must be an app bundle identifier'
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
    apns_environment,
    apns_topic
  )
  VALUES (
    v_employee_id,
    btrim(p_token),
    'ios',
    p_apns_environment,
    p_apns_topic
  )
  ON CONFLICT (token)
  DO UPDATE SET
    platform = 'ios',
    apns_environment = EXCLUDED.apns_environment,
    -- A device token is minted per app install, so its bundle id never
    -- changes. An older deployed client that omits the parameter re-upserts
    -- with NULL and must not erase a topic a newer build already recorded.
    apns_topic = COALESCE(EXCLUDED.apns_topic, device_tokens.apns_topic),
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
    'apns_topic', v_row.apns_topic,
    'updated_at', v_row.updated_at
  );
END;
$function$;

ALTER FUNCTION public.upsert_my_native_device_token(text, text, text)
  OWNER TO postgres;

-- This managed project re-grants EXECUTE TO PUBLIC on every new function at
-- ddl_command_end, so the explicit REVOKE must immediately precede the GRANT.
REVOKE EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text, text)
  TO authenticated, service_role;

DO $postcondition$
DECLARE
  v_oid oid;
  v_execute_grantees text[];
BEGIN
  IF (
    SELECT count(*)
    FROM pg_proc function_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = function_record.pronamespace
    WHERE namespace_record.nspname = 'public'
      AND function_record.proname = 'upsert_my_native_device_token'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'device token apns topic postcondition: overload drift for upsert_my_native_device_token';
  END IF;

  v_oid := to_regprocedure(
    'public.upsert_my_native_device_token(text,text,text)'
  );

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
         AND function_record.provolatile = 'v'::"char"
         AND function_record.prokind = 'f'::"char"
         AND function_record.proconfig = ARRAY['search_path=""']::text[]
         -- pronargdefaults = 1 is the deployed-caller compatibility proof:
         -- the two-argument named-parameter call still resolves.
         AND function_record.pronargdefaults = 1
         AND pg_get_function_arguments(function_record.oid)
               = 'p_token text, p_apns_environment text, p_apns_topic text DEFAULT NULL::text'
         AND pg_get_function_result(function_record.oid) = 'jsonb'
     )
     OR v_execute_grantees IS DISTINCT FROM
          ARRAY['authenticated','postgres','service_role']::text[]
     OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'device token apns topic postcondition: new RPC contract drift';
  END IF;
END;
$postcondition$;
