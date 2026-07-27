-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260726182000_mobile_employee_identity_containment
-- Phase: Mobile Production Readiness S1h prerequisite — schema-last containment
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Closes the employee/payroll authority that remains after the additive
--   compatibility RPCs ship:
--
--   - browser sessions can read only their own id/Auth-binding/role/active
--     identity columns from public.employees and cannot write the table;
--   - roster callers use get_employee_directory(), and login uses
--     get_my_employee_profile();
--   - get_all_employees() becomes active-internal-admin/service only;
--   - commission reads/writes enforce the same server-side Settings capability
--     as the deployed UI, reject external/inactive/unmapped actors, and validate
--     rate invariants;
--   - the browser result of upsert_employee_commission keeps the existing
--     employees composite shape but redacts unrelated HR/pay/identity fields.
--
-- COMPATIBILITY / APPLY ORDER:
--   This migration MUST NOT apply with the additive contract. Sequence:
--
--   1. apply 20260726180000_mobile_employee_identity_authority;
--   2. deploy and verify every browser/PWA/Capacitor caller on the new RPCs,
--      including historical internal-note attribution;
--   3. resolve old cached/native client compatibility explicitly;
--   4. apply this migration in its own owner-authorized window;
--   5. then apply later S1e/S1g/S1h consumers in their separate windows.
--
--   A source commit, staging deploy, or green test does not authorize any step.
--
-- DATA / SHAPE:
--   No employee row or column is changed. Existing RPC signatures and return
--   shapes are preserved.
--
-- TIME-ENTRY COMPATIBILITY:
--   calc_time_entry_cost() reads employees.hourly_rate as a SECURITY INVOKER
--   row trigger. Current browser writes are RLS-denied, and every catalog routine
--   that legitimately writes job_time_entries is postgres-owned SECURITY DEFINER,
--   so the trigger executes with that effective user and retains its rate read.
--   The preflight pins that topology and refuses a new browser/invoker write path.
--
-- ROLLBACK:
--   supabase/rollbacks/
--   20260726182000_mobile_employee_identity_containment.rollback.sql restores
--   the exact captured 2026-07-26 live policies/grants/function bodies. It is an
--   unsafe security rollback and is guarded accordingly.
-- ═════════════════════════════════════════════════════════════════════════════

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction-control
--   statements here.

DO $employee_identity_containment_preflight$
DECLARE
  v_policy_names text[];
  v_anon_privileges text[];
  v_authenticated_privileges text[];
  v_service_privileges text[];
  v_public_privilege_count integer;
  v_unexpected_table_acl_count integer;
  v_column_privilege_count integer;
  v_acl_grantees text[];
  v_acl_entries text[];
  v_expected record;
  v_overload_count integer;
  v_oid oid;
BEGIN
  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'mobile_employee_identity_authority'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'employee identity containment preflight: additive identity contract is absent from the live ledger';
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
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles role_record
       WHERE role_record.rolname = 'service_role'
         AND role_record.rolbypassrls
     ) THEN
    RAISE EXCEPTION
      'employee identity containment preflight: owner/RLS/service-role drift';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'employees';

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
     ) THEN
    RAISE EXCEPTION
      'employee identity containment preflight: policy drift: %',
      v_policy_names;
  END IF;

  SELECT
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
      WHERE acl.grantor <> relation.relowner
         OR acl.grantee = 0
         OR COALESCE(grantee_role.rolname, '') NOT IN (
           'postgres',
           'anon',
           'authenticated',
           'service_role'
         )
         OR (
           acl.is_grantable
           AND acl.grantee <> relation.relowner
         )
    )
    INTO
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

  IF v_anon_privileges IS DISTINCT FROM
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
     OR v_public_privilege_count <> 0
     OR v_unexpected_table_acl_count <> 0
     OR v_column_privilege_count <> 0 THEN
    RAISE EXCEPTION
      'employee identity containment preflight: table/column ACL drift: anon=%, authenticated=%, service=%, public=%, unexpected_table=%, column=%',
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
        'employee identity containment preflight: exact additive RPC drift: identity=%, overloads=%, ACL=%',
        v_expected.identity,
        v_overload_count,
        v_acl_entries;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language_record
         ON language_record.oid = procedure.prolang
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
               to_regprocedure('public.calc_time_entry_cost()')
         AND language_record.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND NOT procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig =
               ARRAY['search_path=public']::text[]
         AND pg_get_function_result(procedure.oid) = 'trigger'
         AND md5(procedure.prosrc) =
               'a0d1719549f9fc5cff2e47c26aabe666'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid =
               'public.job_time_entries'::regclass
         AND trigger_record.tgname = 'trg_calc_time_entry_cost'
         AND NOT trigger_record.tgisinternal
         AND trigger_record.tgenabled = 'O'
         AND trigger_record.tgfoid =
               to_regprocedure('public.calc_time_entry_cost()')
         AND pg_get_triggerdef(trigger_record.oid, true) =
               'CREATE TRIGGER trg_calc_time_entry_cost BEFORE INSERT OR UPDATE OF hours, hourly_rate, employee_id ON job_time_entries FOR EACH ROW EXECUTE FUNCTION calc_time_entry_cost()'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'job_time_entries'
         AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
         AND (
           'authenticated' = ANY(policy.roles::text[])
           OR 'public' = ANY(policy.roles::text[])
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.prosrc ~*
               '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?job_time_entries'
         AND NOT procedure.prosecdef
     ) THEN
    RAISE EXCEPTION
      'employee identity containment preflight: time-entry rate-fill execution topology drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
               to_regprocedure('public.get_all_employees()')
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.proconfig =
               ARRAY[
                 'search_path=public, extensions, pg_temp'
               ]::text[]
         AND md5(procedure.prosrc) =
               'be7e057f6b8a1ae76beb17b63970c8fb'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
               to_regprocedure('public.get_employee_commissions()')
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.provolatile = 's'
         AND procedure.proconfig =
               ARRAY['search_path=public']::text[]
         AND md5(procedure.prosrc) =
               'b1a067b845248b9c96dcc533fe3938d8'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
               to_regprocedure(
                 'public.upsert_employee_commission(uuid,numeric,numeric)'
               )
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.proconfig =
               ARRAY['search_path=public']::text[]
         AND md5(procedure.prosrc) =
               '7efc239d1754cebe2648fd48298823fa'
     ) THEN
    RAISE EXCEPTION
      'employee identity containment preflight: captured employee RPC body drift';
  END IF;

  IF (
       SELECT count(*)
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = 'get_all_employees'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = 'get_employee_commissions'
     ) IS DISTINCT FROM 1
     OR (
       SELECT count(*)
       FROM pg_proc procedure
       JOIN pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = 'upsert_employee_commission'
     ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'employee identity containment preflight: captured employee RPC overload drift';
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    to_regprocedure('public.get_all_employees()')::oid,
    to_regprocedure('public.get_employee_commissions()')::oid,
    to_regprocedure(
      'public.upsert_employee_commission(uuid,numeric,numeric)'
    )::oid
  ]
  LOOP
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
    WHERE procedure.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR v_acl_grantees IS DISTINCT FROM
            ARRAY['authenticated', 'postgres', 'service_role']::text[]
       OR EXISTS (
         SELECT 1
         FROM pg_proc procedure
         CROSS JOIN LATERAL aclexplode(
           COALESCE(
             procedure.proacl,
             acldefault('f', procedure.proowner)
           )
         ) acl
         WHERE procedure.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'employee identity containment preflight: captured employee RPC ACL drift: %',
        v_oid::regprocedure;
    END IF;
  END LOOP;
END;
$employee_identity_containment_preflight$;

CREATE FUNCTION public.can_current_employee_access_settings()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_override boolean;
BEGIN
  SELECT employee.id, employee.role::text
    INTO v_actor_id, v_actor_role
  FROM public.employees employee
  WHERE employee.auth_user_id = auth.uid()
    AND employee.is_active
    AND NOT employee.is_external
    AND employee.role::text IN (
      'admin',
      'office',
      'project_manager',
      'field_tech',
      'estimator',
      'supervisor'
    );

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.feature_flags flag
    WHERE flag.key = 'page:settings'
      AND flag.force_disabled
  ) THEN
    RETURN false;
  END IF;

  SELECT access.can_view
    INTO v_override
  FROM public.employee_page_access access
  WHERE access.employee_id = v_actor_id
    AND access.nav_key = 'settings';

  IF FOUND THEN
    RETURN v_override;
  END IF;

  IF v_actor_role = 'admin' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.nav_permissions permission
    WHERE permission.role::text = v_actor_role
      AND permission.nav_key = 'settings'
      AND permission.can_view
  );
END;
$function$;

ALTER FUNCTION public.can_current_employee_access_settings() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.can_current_employee_access_settings()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_all_employees()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT COALESCE(
       auth.jwt() ->> 'role' = 'service_role',
       false
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.employees actor
       WHERE actor.auth_user_id = auth.uid()
         AND actor.is_active
         AND NOT actor.is_external
         AND actor.role::text = 'admin'
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: employee administration requires admin'
      USING errcode = '42501';
  END IF;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id', employee.id,
               'auth_user_id', employee.auth_user_id,
               'full_name', employee.full_name,
               'display_name', employee.display_name,
               'email', employee.email,
               'phone', employee.phone,
               'role', employee.role,
               'hourly_rate', employee.hourly_rate,
               'overtime_rate', employee.overtime_rate,
               'is_active', employee.is_active,
               'color', employee.color,
               'created_at', employee.created_at,
               'updated_at', employee.updated_at
             )
             ORDER BY employee.full_name
           ),
           '[]'::jsonb
         )
    INTO v_result
  FROM public.employees employee;

  RETURN v_result;
END;
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NOT COALESCE(
       auth.jwt() ->> 'role' = 'service_role',
       false
     )
     AND NOT public.can_current_employee_access_settings() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: commission settings access required'
      USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    employee.id,
    employee.full_name,
    employee.role::text,
    employee.is_active,
    employee.commission_percent,
    employee.commission_flat
  FROM public.employees employee
  ORDER BY
    (employee.is_active IS NOT TRUE),
    employee.full_name;
END;
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
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_is_service boolean := COALESCE(
    auth.jwt() ->> 'role' = 'service_role',
    false
  );
  v_stored public.employees;
  v_result public.employees;
BEGIN
  IF NOT v_is_service
     AND NOT public.can_current_employee_access_settings() THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: commission settings access required'
      USING errcode = '42501';
  END IF;

  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_COMMISSION: employee is required'
      USING errcode = '22023';
  END IF;

  IF p_percent IS NOT NULL AND p_flat IS NOT NULL THEN
    RAISE EXCEPTION
      'INVALID_COMMISSION: percent and flat are mutually exclusive'
      USING errcode = '22023';
  END IF;

  IF p_percent IS NOT NULL
     AND (
       p_percent::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_percent < 0
       OR p_percent > 100
     ) THEN
    RAISE EXCEPTION
      'INVALID_COMMISSION: percent must be between 0 and 100'
      USING errcode = '22023';
  END IF;

  IF p_flat IS NOT NULL
     AND (
       p_flat::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_flat < 0
     ) THEN
    RAISE EXCEPTION
      'INVALID_COMMISSION: flat amount must be nonnegative'
      USING errcode = '22023';
  END IF;

  UPDATE public.employees employee
     SET commission_percent = p_percent,
         commission_flat = p_flat,
         updated_at = now()
   WHERE employee.id = p_employee_id
   RETURNING employee.* INTO v_stored;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_COMMISSION: employee not found'
      USING errcode = '22023';
  END IF;

  IF v_is_service THEN
    RETURN v_stored;
  END IF;

  -- Preserve the employees composite result contract while returning only the
  -- fields this browser capability legitimately owns.
  v_result.id := v_stored.id;
  v_result.full_name := v_stored.full_name;
  v_result.display_name := v_stored.display_name;
  v_result.role := v_stored.role;
  v_result.is_active := v_stored.is_active;
  v_result.commission_percent := v_stored.commission_percent;
  v_result.commission_flat := v_stored.commission_flat;
  v_result.updated_at := v_stored.updated_at;
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.upsert_employee_commission(uuid, numeric, numeric)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.upsert_employee_commission(uuid, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.upsert_employee_commission(uuid, numeric, numeric)
  TO authenticated, service_role;

DROP POLICY allow_anon_read_employees ON public.employees;
DROP POLICY allow_authenticated_employees ON public.employees;

CREATE POLICY employees_self_identity_read
  ON public.employees
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

REVOKE ALL PRIVILEGES ON TABLE public.employees
  FROM PUBLIC, anon, authenticated;

-- `is_external` is a NAMED CARVE-OUT, not a widening of the identity set.
-- Do not remove it, and do not treat it as licence to add more.
--
-- WHY IT IS REQUIRED: the sibling migrations 20260726183409 (inbound_leads) and
-- 20260726260000 (notifications) add ROW-LEVEL POLICIES whose predicates read
-- `employees.is_external`. A policy predicate is evaluated with the CALLING
-- role's privileges, so with the column ungranted every authenticated SELECT on
-- those tables fails with "permission denied for table employees" — taking out
-- the CRM Leads board, the task link-picker, the forecast widget and Realtime
-- notification delivery, for every user.
--
-- WHY IT IS SAFE: the self-identity policy immediately above restricts rows to
-- `auth_user_id = auth.uid()`. A caller can therefore only read their OWN
-- external flag. Unlike full_name/email/phone/hourly_rate, this leaks nothing
-- about anyone else, which is why it is separable from the sensitive set that
-- tests/qa/unit/mobile-employee-identity-authority.test.js still forbids.
--
-- WHY NOTHING CAUGHT IT: both sibling migrations preflight that the column
-- EXISTS with the right type (e.g. 20260726260000:237-245). Existence is not
-- access. Nothing asserted the GRANT, and the failure only appears once this
-- migration and one of them are BOTH live — i.e. it would have detonated after
-- the production promotion, not during it. Found in review 2026-07-27, unshipped.
--
-- THE STRUCTURAL FIX IS DEFERRED, NOT DONE: routing those policies through a
-- SECURITY DEFINER helper (the pattern can_current_employee_access_settings()
-- already establishes in this same migration) would keep is_external ungranted
-- entirely. Tracked in docs/mobile-production-readiness-roadmap.md. When that
-- lands, this carve-out should be removed.
GRANT SELECT (id, auth_user_id, role, is_active, is_external)
  ON TABLE public.employees
  TO authenticated;

DO $employee_identity_containment_postcondition$
DECLARE
  v_policy_names text[];
  v_anon_privileges text[];
  v_authenticated_privileges text[];
  v_service_privileges text[];
  v_public_privilege_count integer;
  v_unexpected_table_acl_count integer;
  v_authenticated_columns text[];
  v_unexpected_column_acl_count integer;
  v_acl_grantees text[];
  v_oid oid;
BEGIN
  SELECT array_agg(policyname ORDER BY policyname)
    INTO v_policy_names
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'employees';

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
     ) THEN
    RAISE EXCEPTION
      'employee identity containment postcondition: policy drift: %',
      v_policy_names;
  END IF;

  SELECT
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
      WHERE acl.grantor <> relation.relowner
         OR acl.grantee = 0
         OR COALESCE(grantee_role.rolname, '') NOT IN (
           'postgres',
           'service_role'
         )
         OR (
           acl.is_grantable
           AND acl.grantee <> relation.relowner
         )
    )
    INTO
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
           'is_active',
           -- Named carve-out; see the GRANT above.
           'is_external'
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

  IF v_anon_privileges IS DISTINCT FROM ARRAY[]::text[]
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
     OR v_public_privilege_count <> 0
     OR v_unexpected_table_acl_count <> 0
     OR v_authenticated_columns IS DISTINCT FROM
       ARRAY['auth_user_id', 'id', 'is_active', 'is_external', 'role']::text[]
     OR v_unexpected_column_acl_count <> 0
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
        )
     OR has_table_privilege('anon', 'public.employees', 'SELECT') THEN
    RAISE EXCEPTION
      'employee identity containment postcondition: ACL drift: anon=%, authenticated=%, service=%, public=%, unexpected_table=%, columns=%, unexpected_column=%',
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_public_privilege_count,
      v_unexpected_table_acl_count,
      v_authenticated_columns,
      v_unexpected_column_acl_count;
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    to_regprocedure('public.get_all_employees()')::oid,
    to_regprocedure('public.get_employee_commissions()')::oid,
    to_regprocedure(
      'public.upsert_employee_commission(uuid,numeric,numeric)'
    )::oid
  ]
  LOOP
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
    WHERE procedure.oid = v_oid
      AND acl.privilege_type = 'EXECUTE';

    IF v_oid IS NULL
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR v_acl_grantees IS DISTINCT FROM
            ARRAY['authenticated', 'postgres', 'service_role']::text[]
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc procedure
         JOIN pg_roles owner_role
           ON owner_role.oid = procedure.proowner
         WHERE procedure.oid = v_oid
           AND owner_role.rolname = 'postgres'
           AND procedure.prosecdef
           AND procedure.proconfig =
                 ARRAY[
                   'search_path=public, extensions, pg_temp'
                 ]::text[]
           AND procedure.prosrc LIKE '%NOT_AUTHORIZED:%'
       )
       OR EXISTS (
         SELECT 1
         FROM pg_proc procedure
         CROSS JOIN LATERAL aclexplode(
           COALESCE(
             procedure.proacl,
             acldefault('f', procedure.proowner)
           )
         ) acl
         WHERE procedure.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'employee identity containment postcondition: RPC boundary drift: %',
        v_oid::regprocedure;
    END IF;
  END LOOP;

  v_oid := to_regprocedure(
    'public.can_current_employee_access_settings()'
  );
  IF v_oid IS NULL
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           procedure.proacl,
           acldefault('f', procedure.proowner)
         )
       ) acl
       WHERE procedure.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_roles owner_role
         ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = v_oid
         AND owner_role.rolname = 'postgres'
         AND procedure.prosecdef
         AND procedure.provolatile = 's'
         AND procedure.proconfig =
               ARRAY[
                 'search_path=public, extensions, pg_temp'
               ]::text[]
         AND procedure.prosrc LIKE '%page:settings%'
         AND procedure.prosrc LIKE '%employee_page_access%'
         AND procedure.prosrc LIKE '%nav_permissions%'
     ) THEN
    RAISE EXCEPTION
      'employee identity containment postcondition: settings capability helper drift';
  END IF;
END;
$employee_identity_containment_postcondition$;

NOTIFY pgrst, 'reload schema';
