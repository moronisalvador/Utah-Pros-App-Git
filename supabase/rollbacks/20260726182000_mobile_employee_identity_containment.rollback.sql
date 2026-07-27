-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260726182000_mobile_employee_identity_containment
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SECURITY WARNING:
--   This rollback deliberately restores the rejected 2026-07-26 live boundary:
--   anonymous and authenticated sessions regain whole-table employee reads and
--   writes, while commission and employee-directory definers again trust any
--   authenticated caller. Prefer a reviewed forward repair.
--
--   Run only after explicit owner acceptance and:
--
--     SET upr.allow_unsafe_employee_identity_containment_rollback = 'on';
--
-- DATA:
--   No employee row is changed.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $employee_identity_containment_rollback_guard$
DECLARE
  v_policy_names text[];
  v_postgres_privileges text[];
  v_anon_privileges text[];
  v_authenticated_privileges text[];
  v_service_privileges text[];
  v_public_privilege_count integer;
  v_unexpected_table_acl_count integer;
  v_authenticated_columns text[];
  v_unexpected_column_acl_count integer;
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_acl_entries text[];
BEGIN
  IF current_setting(
       'upr.allow_unsafe_employee_identity_containment_rollback',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'unsafe employee identity containment rollback refused; set upr.allow_unsafe_employee_identity_containment_rollback=on only with explicit owner approval';
  END IF;

  IF to_regclass('public.inbound_lead_recording_sources') IS NOT NULL
     OR to_regclass('public.notification_reads') IS NOT NULL
     OR to_regprocedure(
          'public.is_current_active_internal_employee(uuid)'
        ) IS NOT NULL THEN
    RAISE EXCEPTION
      'unsafe employee identity containment rollback refused: S1e, S1g, or S1h catalog state is still active';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_roles owner_role
      ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'employees'
      AND relation.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'employee identity containment rollback preflight: employee table owner/RLS drift';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'employees';

  SELECT
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'postgres'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'anon'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'authenticated'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'service_role'),
      ARRAY[]::text[]
    ),
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE grantor_role.rolname IS DISTINCT FROM 'postgres'
         OR acl.grantee = 0
         OR grantee_role.rolname IS NULL
         OR grantee_role.rolname NOT IN ('postgres', 'service_role')
         OR acl.is_grantable
    )
    INTO
      v_postgres_privileges,
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_public_privilege_count,
      v_unexpected_table_acl_count
  FROM pg_class relation
  JOIN pg_namespace namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      relation.relacl,
      acldefault('r', relation.relowner)
    )
  ) acl
  LEFT JOIN pg_roles grantor_role
    ON grantor_role.oid = acl.grantor
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'employees';

  SELECT
    array_agg(attribute.attname ORDER BY attribute.attname)
      FILTER (
        WHERE grantee_role.rolname = 'authenticated'
          AND acl.privilege_type = 'SELECT'
      ),
    count(*) FILTER (
      WHERE acl.grantee = 0
         OR grantor_role.rolname IS DISTINCT FROM 'postgres'
         OR grantee_role.rolname IS DISTINCT FROM 'authenticated'
         OR acl.privilege_type <> 'SELECT'
         OR attribute.attname NOT IN (
           'id',
           'auth_user_id',
           'role',
           'is_active'
         )
         OR acl.is_grantable
    )
    INTO
      v_authenticated_columns,
      v_unexpected_column_acl_count
  FROM pg_attribute attribute
  CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
  LEFT JOIN pg_roles grantor_role
    ON grantor_role.oid = acl.grantor
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE attribute.attrelid = 'public.employees'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attacl IS NOT NULL;

  IF v_policy_names IS DISTINCT FROM
       ARRAY['employees_self_identity_read']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'employees_self_identity_read'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'SELECT'
         AND qual = '(auth_user_id = auth.uid())'
         AND with_check IS NULL
     )
     OR v_postgres_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_anon_privileges IS DISTINCT FROM ARRAY[]::text[]
     OR v_authenticated_privileges IS DISTINCT FROM ARRAY[]::text[]
     OR v_service_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_public_privilege_count IS DISTINCT FROM 0
     OR v_unexpected_table_acl_count IS DISTINCT FROM 0
     OR v_authenticated_columns IS DISTINCT FROM
       ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[]
     OR v_unexpected_column_acl_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'employee identity containment rollback preflight: forward table boundary drift: policies=%, postgres=%, anon=%, authenticated=%, service=%, public=%, unexpected_table=%, columns=%, unexpected_column=%',
      v_policy_names,
      v_postgres_privileges,
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_public_privilege_count,
      v_unexpected_table_acl_count,
      v_authenticated_columns,
      v_unexpected_column_acl_count;
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.can_current_employee_access_settings()',
          'can_current_employee_access_settings',
          '',
          'boolean',
          's',
          '24f8db8b3486f47f6223d4f47cfe7800',
          ARRAY[
            'postgres>postgres:EXECUTE:not_grantable'
          ]::text[]
        ),
        (
          'public.get_all_employees()',
          'get_all_employees',
          '',
          'jsonb',
          'v',
          '160d3c16f2bbc24c5151f2e465d9f1f6',
          ARRAY[
            'postgres>authenticated:EXECUTE:not_grantable',
            'postgres>postgres:EXECUTE:not_grantable',
            'postgres>service_role:EXECUTE:not_grantable'
          ]::text[]
        ),
        (
          'public.get_employee_commissions()',
          'get_employee_commissions',
          '',
          'TABLE(id uuid, full_name text, role text, is_active boolean, commission_percent numeric, commission_flat numeric)',
          's',
          'ac13416910f68bea3e0f073db3fd1b09',
          ARRAY[
            'postgres>authenticated:EXECUTE:not_grantable',
            'postgres>postgres:EXECUTE:not_grantable',
            'postgres>service_role:EXECUTE:not_grantable'
          ]::text[]
        ),
        (
          'public.upsert_employee_commission(uuid,numeric,numeric)',
          'upsert_employee_commission',
          'p_employee_id uuid, p_percent numeric DEFAULT NULL::numeric, p_flat numeric DEFAULT NULL::numeric',
          'employees',
          'v',
          '4e8befd62b6cc5e06a4fc421fdb41fea',
          ARRAY[
            'postgres>authenticated:EXECUTE:not_grantable',
            'postgres>postgres:EXECUTE:not_grantable',
            'postgres>service_role:EXECUTE:not_grantable'
          ]::text[]
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type,
      volatility,
      body_md5,
      acl_entries
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

    IF v_oid IS NULL
       OR v_overload_count IS DISTINCT FROM 1
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
           AND procedure.provolatile = v_expected.volatility
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
       OR v_acl_entries IS DISTINCT FROM v_expected.acl_entries THEN
      RAISE EXCEPTION
        'employee identity containment rollback preflight: exact forward function drift: identity=%, overloads=%, ACL=%',
        v_expected.identity,
        v_overload_count,
        v_acl_entries;
    END IF;
  END LOOP;
END;
$employee_identity_containment_rollback_guard$;

DROP POLICY employees_self_identity_read ON public.employees;

REVOKE SELECT (id, auth_user_id, role, is_active)
  ON TABLE public.employees
  FROM authenticated;

CREATE POLICY allow_anon_read_employees
  ON public.employees
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY allow_authenticated_employees
  ON public.employees
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.employees
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_all_employees()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'auth_user_id', e.auth_user_id,
      'full_name', e.full_name,
      'display_name', e.display_name,
      'email', e.email,
      'phone', e.phone,
      'role', e.role,
      'hourly_rate', e.hourly_rate,
      'overtime_rate', e.overtime_rate,
      'is_active', e.is_active,
      'color', e.color,
      'created_at', e.created_at,
      'updated_at', e.updated_at
    ) ORDER BY e.full_name
  ), '[]'::jsonb)
  FROM employees e;
$function$;

ALTER FUNCTION public.get_all_employees() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_all_employees()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_all_employees()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_employee_commissions()
RETURNS TABLE (
  id uuid,
  full_name text,
  role text,
  is_active boolean,
  commission_percent numeric,
  commission_flat numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id, e.full_name, e.role::text, e.is_active, e.commission_percent, e.commission_flat
  FROM public.employees e
  ORDER BY (e.is_active IS NOT TRUE), e.full_name;
$function$;

ALTER FUNCTION public.get_employee_commissions() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_employee_commissions()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_commissions()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_employee_commission(
  p_employee_id uuid,
  p_percent numeric DEFAULT NULL,
  p_flat numeric DEFAULT NULL
)
RETURNS public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DECLARE r public.employees;
BEGIN
  UPDATE public.employees
     SET commission_percent = p_percent,
         commission_flat    = p_flat,
         updated_at         = now()
   WHERE id = p_employee_id
   RETURNING * INTO r;
  RETURN r;
END; $function$;

ALTER FUNCTION public.upsert_employee_commission(uuid, numeric, numeric)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.upsert_employee_commission(uuid, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.upsert_employee_commission(uuid, numeric, numeric)
  TO authenticated, service_role;

DROP FUNCTION public.can_current_employee_access_settings();

DO $employee_identity_containment_rollback_postcondition$
DECLARE
  v_policy_names text[];
  v_postgres_privileges text[];
  v_anon_privileges text[];
  v_authenticated_privileges text[];
  v_service_privileges text[];
  v_public_privilege_count integer;
  v_unexpected_table_acl_count integer;
  v_column_privilege_count integer;
  v_expected record;
  v_oid oid;
  v_overload_count integer;
  v_acl_entries text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_roles owner_role
      ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'employees'
      AND relation.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'employee identity containment rollback postcondition: employee table owner/RLS drift';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'employees';

  SELECT
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'postgres'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'anon'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'authenticated'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'service_role'),
      ARRAY[]::text[]
    ),
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE grantor_role.rolname IS DISTINCT FROM 'postgres'
         OR acl.grantee = 0
         OR grantee_role.rolname IS NULL
         OR grantee_role.rolname NOT IN (
           'postgres',
           'anon',
           'authenticated',
           'service_role'
         )
         OR acl.is_grantable
    )
    INTO
      v_postgres_privileges,
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_public_privilege_count,
      v_unexpected_table_acl_count
  FROM pg_class relation
  JOIN pg_namespace namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      relation.relacl,
      acldefault('r', relation.relowner)
    )
  ) acl
  LEFT JOIN pg_roles grantor_role
    ON grantor_role.oid = acl.grantor
  LEFT JOIN pg_roles grantee_role
    ON grantee_role.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'employees';

  SELECT count(*)
    INTO v_column_privilege_count
  FROM pg_attribute attribute
  CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
  WHERE attribute.attrelid = 'public.employees'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attacl IS NOT NULL;

  IF v_policy_names IS DISTINCT FROM
       ARRAY[
         'allow_anon_read_employees',
         'allow_authenticated_employees'
       ]::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'allow_anon_read_employees'
         AND roles = ARRAY['anon']::name[]
         AND cmd = 'SELECT'
         AND qual = 'true'
         AND with_check IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'employees'
         AND policyname = 'allow_authenticated_employees'
         AND roles = ARRAY['authenticated']::name[]
         AND cmd = 'ALL'
         AND qual = 'true'
         AND with_check = 'true'
     )
     OR v_postgres_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_anon_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_authenticated_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_service_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_public_privilege_count IS DISTINCT FROM 0
     OR v_unexpected_table_acl_count IS DISTINCT FROM 0
     OR v_column_privilege_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'employee identity containment rollback postcondition: table boundary drift: policies=%, postgres=%, anon=%, authenticated=%, service=%, public=%, unexpected_table=%, column_acl=%',
      v_policy_names,
      v_postgres_privileges,
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_public_privilege_count,
      v_unexpected_table_acl_count,
      v_column_privilege_count;
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.get_all_employees()',
          'get_all_employees',
          '',
          'jsonb',
          'sql',
          'v',
          ARRAY[
            'search_path=public, extensions, pg_temp'
          ]::text[],
          'be7e057f6b8a1ae76beb17b63970c8fb'
        ),
        (
          'public.get_employee_commissions()',
          'get_employee_commissions',
          '',
          'TABLE(id uuid, full_name text, role text, is_active boolean, commission_percent numeric, commission_flat numeric)',
          'sql',
          's',
          ARRAY['search_path=public']::text[],
          'b1a067b845248b9c96dcc533fe3938d8'
        ),
        (
          'public.upsert_employee_commission(uuid,numeric,numeric)',
          'upsert_employee_commission',
          'p_employee_id uuid, p_percent numeric DEFAULT NULL::numeric, p_flat numeric DEFAULT NULL::numeric',
          'employees',
          'plpgsql',
          'v',
          ARRAY['search_path=public']::text[],
          '7efc239d1754cebe2648fd48298823fa'
        )
    ) AS expected(
      identity,
      function_name,
      arguments,
      result_type,
      language_name,
      volatility,
      config,
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

    IF v_oid IS NULL
       OR v_overload_count IS DISTINCT FROM 1
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
           AND language_record.lanname = v_expected.language_name
           AND procedure.prokind = 'f'
           AND procedure.prosecdef
           AND NOT procedure.proisstrict
           AND NOT procedure.proleakproof
           AND procedure.provolatile = v_expected.volatility
           AND procedure.proparallel = 'u'
           AND procedure.proconfig = v_expected.config
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
        'employee identity containment rollback postcondition: exact restored function drift: identity=%, overloads=%, ACL=%',
        v_expected.identity,
        v_overload_count,
        v_acl_entries;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'can_current_employee_access_settings'
  ) THEN
    RAISE EXCEPTION
      'employee identity containment rollback postcondition: private helper or overload remains';
  END IF;
END;
$employee_identity_containment_rollback_postcondition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
