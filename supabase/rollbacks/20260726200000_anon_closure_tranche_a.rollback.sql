-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726200000_anon_closure_tranche_a
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts both tables back exactly as they were before the closure, and removes
--   the admin-only requirement from the customer-texting switch.
--
--   Be aware of what this restores: anyone on the internet could again switch
--   customer texting on or off, and delete the do-not-email list. Only run this
--   if the closure actually broke something, and treat it as temporary.
--
--   It also REMOVES the audit trail: after this, changing an automation setting
--   — including arming customer texting — records no actor and no timestamp.
--   Rows already written to system_events are kept; new changes stop being
--   logged. For a TCPA-relevant switch that is a real loss, so prefer fixing
--   forward over rolling back if the problem is not the gate itself.
--
-- VERIFIED-BEFORE STATE (live catalog, 2026-07-26):
--   automation_settings_all : ALL / {anon,authenticated} / USING true / WITH CHECK true
--   email_suppressions_all  : ALL / {anon,authenticated} / USING true / WITH CHECK true
--   both tables: anon + authenticated held all PostgreSQL 17 table privileges,
--   including MAINTAIN.
-- ════════════════════════════════════════════════

BEGIN;

DO $db1_tranche_a_rollback_preflight$
DECLARE
  v_table_name text;
  v_function_oid oid;
BEGIN
  IF current_setting(
       'upr.allow_unsafe_db1_tranche_a_rollback',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'unsafe DB-1 tranche A rollback refused; set upr.allow_unsafe_db1_tranche_a_rollback=on only with explicit owner approval';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM
       ARRAY[
         'allow_anon_read_employees',
         'allow_authenticated_employees'
       ]::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polcmd = 'r'
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR NOT has_table_privilege('anon', 'public.employees', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A rollback preflight: employee identity authority is absent or drifted';
  END IF;

  FOREACH v_table_name IN ARRAY
    ARRAY['automation_settings', 'email_suppressions']::text[]
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM pg_class relation
         JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND owner_role.rolname = 'postgres'
           AND relation.relrowsecurity
       )
       OR EXISTS (
         SELECT 1
         FROM pg_policy policy
         WHERE policy.polrelid =
               to_regclass(format('public.%I', v_table_name))
       )
       OR has_table_privilege(
            'anon',
            format('public.%I', v_table_name),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
       OR has_table_privilege(
            'authenticated',
            format('public.%I', v_table_name),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
       OR (
         SELECT COALESCE(
           array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
           ARRAY[]::text[]
         )
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND grantee_role.rolname = 'service_role'
       ) IS DISTINCT FROM
         ARRAY[
           'DELETE',
           'INSERT',
           'MAINTAIN',
           'REFERENCES',
           'SELECT',
           'TRIGGER',
           'TRUNCATE',
           'UPDATE'
         ]::text[] THEN
      RAISE EXCEPTION
        'DB-1 tranche A rollback preflight: %.% forward state drift',
        'public',
        v_table_name;
    END IF;
  END LOOP;

  v_function_oid :=
    to_regprocedure('public.set_automation_setting(text,boolean,uuid)');

  IF v_function_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_function_oid
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
         AND procedure.prosrc LIKE
               '%NOT_AUTHORIZED: sms_sending_enabled is admin only%'
         AND procedure.prosrc LIKE '%automation_setting_changed%'
         AND procedure.prosrc LIKE '%auth.role() <> ''service_role''%'
     )
     OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(
          'authenticated',
          v_function_oid,
          'EXECUTE'
        )
     OR NOT has_function_privilege(
          'service_role',
          v_function_oid,
          'EXECUTE'
        ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A rollback preflight: set_automation_setting forward state drift';
  END IF;
END;
$db1_tranche_a_rollback_preflight$;

-- ─── 1. automation_settings ───

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN
  ON TABLE public.automation_settings TO anon, authenticated;

CREATE POLICY automation_settings_all ON public.automation_settings
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.automation_settings IS NULL;

-- ─── 2. email_suppressions ───

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN
  ON TABLE public.email_suppressions TO anon, authenticated;

CREATE POLICY email_suppressions_all ON public.email_suppressions
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.email_suppressions IS NULL;

-- ─── 3. set_automation_setting — prior body, no authorization block ───

CREATE OR REPLACE FUNCTION public.set_automation_setting(
  p_key text,
  p_value boolean,
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS automation_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_row automation_settings;
BEGIN
  IF p_key NOT IN (
    'sms_sending_enabled', 'speed_to_lead_enabled', 'missed_call_textback_enabled',
    'no_response_followup_enabled', 'review_request_enabled'
  ) THEN
    RAISE EXCEPTION 'set_automation_setting: invalid key %', p_key;
  END IF;

  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'set_automation_setting: no org resolved';
  END IF;

  INSERT INTO automation_settings (org_id) VALUES (v_org) ON CONFLICT (org_id) DO NOTHING;

  EXECUTE format(
    'UPDATE automation_settings SET %I = $1, updated_at = now() WHERE org_id = $2 RETURNING *', p_key
  ) INTO v_row USING p_value, v_org;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) TO authenticated, service_role;

DO $db1_tranche_a_rollback_postcondition$
DECLARE
  v_table_name text;
  v_policy_name text;
  v_function_oid oid;
BEGIN
  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polcmd = 'r'
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A rollback postcondition: employee identity authority changed';
  END IF;

  FOR v_table_name, v_policy_name IN
    SELECT *
    FROM (
      VALUES
        ('automation_settings', 'automation_settings_all'),
        ('email_suppressions', 'email_suppressions_all')
    ) expected(table_name, policy_name)
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM pg_policy policy
         WHERE policy.polrelid =
               to_regclass(format('public.%I', v_table_name))
           AND policy.polname = v_policy_name
           AND policy.polcmd = '*'
           AND policy.polpermissive
           AND (
             SELECT array_agg(role_oid ORDER BY role_oid)
             FROM unnest(policy.polroles) role_oid
           ) = (
             SELECT array_agg(role_record.oid ORDER BY role_record.oid)
             FROM pg_roles role_record
             WHERE role_record.rolname IN ('anon', 'authenticated')
           )
           AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
           AND pg_get_expr(policy.polwithcheck, policy.polrelid, true) = 'true'
       )
       OR (
         SELECT COALESCE(
           array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
           ARRAY[]::text[]
         )
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND grantee_role.rolname = 'anon'
       ) IS DISTINCT FROM
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
       OR (
         SELECT COALESCE(
           array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
           ARRAY[]::text[]
         )
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND grantee_role.rolname = 'authenticated'
       ) IS DISTINCT FROM
         ARRAY[
           'DELETE',
           'INSERT',
           'MAINTAIN',
           'REFERENCES',
           'SELECT',
           'TRIGGER',
           'TRUNCATE',
           'UPDATE'
         ]::text[] THEN
      RAISE EXCEPTION
        'DB-1 tranche A rollback postcondition: %.% unsafe prior state not restored exactly',
        'public',
        v_table_name;
    END IF;
  END LOOP;

  v_function_oid :=
    to_regprocedure('public.set_automation_setting(text,boolean,uuid)');

  IF v_function_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_function_oid
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
         AND procedure.prosrc NOT LIKE '%NOT_AUTHORIZED:%'
         AND procedure.prosrc NOT LIKE '%automation_setting_changed%'
     )
     OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(
          'authenticated',
          v_function_oid,
          'EXECUTE'
        )
     OR NOT has_function_privilege(
          'service_role',
          v_function_oid,
          'EXECUTE'
        ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A rollback postcondition: set_automation_setting prior state failed';
  END IF;
END;
$db1_tranche_a_rollback_postcondition$;

COMMIT;
