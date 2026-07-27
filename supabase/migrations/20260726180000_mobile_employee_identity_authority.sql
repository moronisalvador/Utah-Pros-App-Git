-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260726180000_mobile_employee_identity_authority
-- Phase: Mobile Production Readiness S1h prerequisite — compatibility contract
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds three selector-safe employee read contracts without changing the current
--   employees table policies or privileges:
--
--     get_my_employee_profile()
--       Maps auth.uid() to the caller's one active employee row and returns only
--       the fields AuthContext needs.
--
--     get_employee_directory(boolean)
--       Returns a non-sensitive roster to a mapped active employee. Inactive
--       names are available only to the existing internal time-admin roles.
--
--     get_message_author_directory(uuid[])
--       Preserves historical internal-note attribution after an author is
--       deactivated. It returns only id/name fields, only for supplied message
--       IDs that are actual internal notes, and only through the same
--       server-side Conversations capability that protects message reads.
--
-- WHY THIS IS ADDITIVE:
--   The deployed PWA and any previously installed Capacitor bundle still read
--   public.employees directly. Revoking that access in the same production
--   window would break those clients before replacement code is deployed. The
--   separately reviewed
--   20260726182000_mobile_employee_identity_containment.sql performs the later
--   schema-last revoke after compatible code is deployed and old-client risk is
--   explicitly resolved.
--
-- AUTHORIZATION:
--   All functions are SECURITY DEFINER because the later containment removes
--   broad employee-table reads. They resolve the actor/capability internally,
--   pin their search path, and explicitly revoke PUBLIC/anon before granting
--   authenticated/service_role. The historical-author selector is capped at 200
--   message IDs and resolves only the authors referenced by those exact notes.
--   Message visibility is company-wide behind messaging_can_access_conversations
--   today; this RPC must be revisited if message visibility becomes thread-scoped.
--
-- DATA / SHAPE:
--   No table, row, policy, grant, or existing RPC is changed.
--
-- ROLLBACK:
--   supabase/rollbacks/
--   20260726180000_mobile_employee_identity_authority.rollback.sql
--   drops only these additive RPCs and refuses while containment or a downstream
--   identity consumer remains active.
-- ═════════════════════════════════════════════════════════════════════════════

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction-control
--   statements here.

DO $employee_identity_contract_preflight$
DECLARE
  v_missing_columns text[];
  v_acl_grantees text[];
BEGIN
  IF to_regclass('public.employees') IS NULL THEN
    RAISE EXCEPTION
      'employee identity contract preflight: public.employees is absent';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO v_missing_columns
  FROM (
    VALUES
      ('id', 'uuid'),
      ('full_name', 'text'),
      ('display_name', 'text'),
      ('email', 'text'),
      ('auth_user_id', 'uuid'),
      ('role', 'employee_role'),
      ('is_active', 'bool'),
      ('is_external', 'bool'),
      ('default_division', 'text'),
      ('color', 'text'),
      ('avatar_url', 'text')
  ) AS required(column_name, data_type)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = 'public'
      AND column_record.table_name = 'employees'
      AND column_record.column_name = required.column_name
      AND column_record.udt_name = required.data_type
  );

  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'employee identity contract preflight: missing or mistyped employee columns: %',
      v_missing_columns;
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('auth.jwt()') IS NULL THEN
    RAISE EXCEPTION
      'employee identity contract preflight: Supabase auth helpers are absent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_my_employee_profile',
        'get_employee_directory',
        'get_message_author_directory'
      )
  ) THEN
    RAISE EXCEPTION
      'employee identity contract preflight: additive RPC identity already exists';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public.employees'::regclass
         AND constraint_record.contype = 'u'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'UNIQUE (auth_user_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = 'public.employees'::regclass
         AND attribute.attname = 'is_active'
         AND attribute.attnotnull
         AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = 'public.employees'::regclass
         AND attribute.attname = 'is_external'
         AND attribute.attnotnull
         AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION
      'employee identity contract preflight: Auth binding or active/external invariant drift';
  END IF;

  IF to_regclass('public.messages') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'messages'
         AND column_record.column_name = 'id'
         AND column_record.udt_name = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'messages'
         AND column_record.column_name = 'sent_by'
         AND column_record.udt_name = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'messages'
         AND column_record.column_name = 'type'
         AND column_record.udt_name = 'text'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public.messages'::regclass
         AND constraint_record.contype = 'p'
         AND constraint_record.conname = 'messages_pkey'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'PRIMARY KEY (id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public.messages'::regclass
         AND constraint_record.contype = 'f'
         AND constraint_record.conname = 'messages_sent_by_fkey'
         AND pg_get_constraintdef(constraint_record.oid, true) =
               'FOREIGN KEY (sent_by) REFERENCES employees(id)'
     ) THEN
    RAISE EXCEPTION
      'employee identity contract preflight: historical message-author relation drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       JOIN pg_language language_record
         ON language_record.oid = procedure.prolang
       WHERE procedure.oid =
               to_regprocedure(
                 'public.messaging_can_access_conversations()'
               )
         AND owner_role.rolname = 'postgres'
         AND language_record.lanname = 'sql'
         AND procedure.prosecdef
         AND procedure.provolatile = 's'
         AND procedure.proconfig =
               ARRAY['search_path=pg_catalog, public']::text[]
         AND pg_get_function_result(procedure.oid) = 'boolean'
         AND md5(procedure.prosrc) =
               '52eebbbee082292bbd650261d0adda17'
     ) THEN
    RAISE EXCEPTION
      'employee identity contract preflight: Conversations capability drift';
  END IF;

  SELECT array_agg(
           CASE
             WHEN acl.grantee = 0 THEN 'PUBLIC'
             ELSE grantee_role.rolname
           END
           ORDER BY
             CASE
               WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE grantee_role.rolname
             END
         )
    INTO v_acl_grantees
  FROM pg_proc procedure
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      procedure.proacl,
      acldefault('f', procedure.proowner)
    )
  ) acl
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE procedure.oid =
          to_regprocedure('public.messaging_can_access_conversations()')
    AND acl.privilege_type = 'EXECUTE';

  IF v_acl_grantees IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR has_function_privilege(
          'anon',
          'public.messaging_can_access_conversations()',
          'EXECUTE'
        ) THEN
    RAISE EXCEPTION
      'employee identity contract preflight: Conversations capability ACL drift: %',
      v_acl_grantees;
  END IF;
END;
$employee_identity_contract_preflight$;

CREATE FUNCTION public.get_my_employee_profile()
RETURNS TABLE (
  id uuid,
  full_name text,
  display_name text,
  email text,
  role text,
  is_active boolean,
  is_external boolean,
  default_division text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_binding_count integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: authenticated employee required'
      USING errcode = '42501';
  END IF;

  SELECT count(*)
    INTO v_binding_count
  FROM public.employees employee
  WHERE employee.auth_user_id = v_actor_id
    AND employee.is_active;

  IF v_binding_count > 1 THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT: multiple active employee bindings'
      USING errcode = '21000';
  END IF;

  IF v_binding_count = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    employee.id,
    employee.full_name,
    employee.display_name,
    employee.email,
    employee.role::text,
    employee.is_active,
    employee.is_external,
    employee.default_division
  FROM public.employees employee
  WHERE employee.auth_user_id = v_actor_id
    AND employee.is_active;
END;
$function$;

ALTER FUNCTION public.get_my_employee_profile() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_my_employee_profile()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_employee_profile()
  TO authenticated, service_role;

CREATE FUNCTION public.get_employee_directory(
  p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  full_name text,
  display_name text,
  role text,
  color text,
  avatar_url text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_external boolean;
  v_is_service boolean := COALESCE(
    auth.jwt() ->> 'role' = 'service_role',
    false
  );
BEGIN
  IF NOT v_is_service THEN
    SELECT employee.role::text, employee.is_external
      INTO v_actor_role, v_actor_is_external
    FROM public.employees employee
    WHERE employee.auth_user_id = v_actor_id
      AND employee.is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: active employee required'
        USING errcode = '42501';
    END IF;

    IF p_include_inactive
       AND (
         v_actor_is_external
         OR v_actor_role NOT IN (
           'admin',
           'office',
           'project_manager',
           'supervisor'
         )
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: inactive employee directory requires time-admin access'
        USING errcode = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    employee.id,
    employee.full_name,
    employee.display_name,
    employee.role::text,
    employee.color,
    employee.avatar_url,
    employee.is_active
  FROM public.employees employee
  WHERE COALESCE(p_include_inactive, false)
     OR employee.is_active
  ORDER BY
    (employee.is_active IS NOT TRUE),
    COALESCE(employee.display_name, employee.full_name),
    employee.full_name;
END;
$function$;

ALTER FUNCTION public.get_employee_directory(boolean) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_employee_directory(boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_directory(boolean)
  TO authenticated, service_role;

CREATE FUNCTION public.get_message_author_directory(
  p_message_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  full_name text,
  display_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_is_service boolean := COALESCE(
    auth.jwt() ->> 'role' = 'service_role',
    false
  );
BEGIN
  IF NOT v_is_service
     AND NOT public.messaging_can_access_conversations() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: Conversations access required for message authors'
      USING errcode = '42501';
  END IF;

  IF p_message_ids IS NULL
     OR array_position(p_message_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION
      'INVALID_MESSAGE_AUTHORS: message IDs must be non-null'
      USING errcode = '22023';
  END IF;

  IF cardinality(p_message_ids) > 200 THEN
    RAISE EXCEPTION
      'INVALID_MESSAGE_AUTHORS: at most 200 message IDs are allowed'
      USING errcode = '22023';
  END IF;

  IF cardinality(p_message_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH requested_message AS (
    SELECT DISTINCT requested.message_id
    FROM unnest(p_message_ids) requested(message_id)
  ),
  author AS (
    SELECT DISTINCT
      employee.id,
      employee.full_name,
      employee.display_name
    FROM requested_message requested
    JOIN public.messages message
      ON message.id = requested.message_id
     AND message.type = 'internal_note'
    JOIN public.employees employee
      ON employee.id = message.sent_by
  )
  SELECT
    author.id,
    author.full_name,
    author.display_name
  FROM author
  ORDER BY
    COALESCE(author.display_name, author.full_name),
    author.full_name;
END;
$function$;

ALTER FUNCTION public.get_message_author_directory(uuid[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_message_author_directory(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_message_author_directory(uuid[])
  TO authenticated, service_role;

DO $employee_identity_contract_postcondition$
DECLARE
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_acl_entries text[];
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_my_employee_profile()',
          'get_my_employee_profile',
          '',
          'TABLE(id uuid, full_name text, display_name text, email text, role text, is_active boolean, is_external boolean, default_division text)',
          'b0df079edcab6eb4de1d7820663966e1'
        ),
        (
          'public.get_employee_directory(boolean)',
          'get_employee_directory',
          'p_include_inactive boolean DEFAULT false',
          'TABLE(id uuid, full_name text, display_name text, role text, color text, avatar_url text, is_active boolean)',
          '51bdc3ce561c947a55373090f8913446'
        ),
        (
          'public.get_message_author_directory(uuid[])',
          'get_message_author_directory',
          'p_message_ids uuid[]',
          'TABLE(id uuid, full_name text, display_name text)',
          'e2abe76a7795aaa4e084a5e6640918e2'
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type,
      body_md5
    )
  LOOP
    v_oid := to_regprocedure(v_expected.identity);

    SELECT count(*)
      INTO v_overload_count
    FROM pg_proc procedure
    JOIN pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = v_expected.function_name;

    SELECT array_agg(
             format(
               '%s>%s:%s:%s',
               COALESCE(grantor_role.rolname, '<missing>'),
               CASE
                 WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE COALESCE(grantee_role.rolname, '<missing>')
               END,
               acl.privilege_type,
               CASE
                 WHEN acl.is_grantable THEN 'grantable'
                 ELSE 'not_grantable'
               END
             )
             ORDER BY
               CASE
                 WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE COALESCE(grantee_role.rolname, '<missing>')
               END,
               acl.privilege_type
           )
      INTO v_acl_entries
    FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )
    ) acl
    LEFT JOIN pg_roles grantor_role
      ON grantor_role.oid = acl.grantor
    LEFT JOIN pg_roles grantee_role
      ON grantee_role.oid = acl.grantee
    WHERE procedure.oid = v_oid;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'employee identity contract postcondition: function is absent: %',
        v_expected.identity;
    ELSIF v_overload_count IS DISTINCT FROM 1
       OR NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      JOIN pg_namespace namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_roles owner_role
        ON owner_role.oid = procedure.proowner
      JOIN pg_language language_record
        ON language_record.oid = procedure.prolang
      WHERE procedure.oid = v_oid
        AND namespace.nspname = 'public'
        AND owner_role.rolname = 'postgres'
        AND language_record.lanname = 'plpgsql'
        AND procedure.prokind = 'f'
        AND procedure.prosecdef
        AND NOT procedure.proisstrict
        AND NOT procedure.proleakproof
        AND procedure.provolatile = 's'
        AND procedure.proparallel = 'u'
        AND procedure.proconfig =
              ARRAY[
                'search_path=public, extensions, pg_temp'
              ]::text[]
        AND pg_get_function_arguments(procedure.oid) =
              v_expected.arguments
        AND pg_get_function_result(procedure.oid) =
              v_expected.result_type
        AND md5(procedure.prosrc) = v_expected.body_md5
      )
       OR v_acl_entries IS DISTINCT FROM
            ARRAY[
              'postgres>authenticated:EXECUTE:not_grantable',
              'postgres>postgres:EXECUTE:not_grantable',
              'postgres>service_role:EXECUTE:not_grantable'
            ]::text[] THEN
      RAISE EXCEPTION
        'employee identity contract postcondition: exact function drift: identity=%, overloads=%, ACL=%',
        v_expected.identity,
        v_overload_count,
        v_acl_entries;
    END IF;
  END LOOP;
END;
$employee_identity_contract_postcondition$;

NOTIFY pgrst, 'reload schema';
