-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260804000910_appointment_crew_atomic_save_and_audit_repair
-- Phase: Mobile readiness — appointment crew Production regression recovery
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Finishes the crew-role Production repair without changing applied history.
--   Every active internal UPR employee can manage appointment crew, every real
--   add/remove/role change is attributed in system_events, and additive create
--   and update commands keep the appointment, crew, tasks, and reschedule
--   history in one database transaction.
--
-- WHY THIS IS SAFE:
--   - Refuses any predecessor except the exact Production hotfix, exact QA
--     notification-producer body, or this migration's recovery marker.
--   - Keeps deployed sync_appointment_crew(uuid,jsonb) backward compatible;
--     its required-third-argument overload is service-only.
--   - Validates the complete desired crew before the first crew mutation.
--   - Rejects anonymous, disabled, external, CRM-partner, and unmapped callers.
--   - Uses explicit public.crew_role casts for every JSON role write.
--   - Retains RLS- and trigger-guarded legacy table writes for already-installed
--     native clients; a later adoption-gated successor removes that bridge.
--
-- ROLLBACK:
--   supabase/rollbacks/
--   20260804000910_appointment_crew_atomic_save_and_audit_repair.rollback.sql
--   Recovery keeps the safer functions, policies, audit trigger, and history,
--   but revokes all appointment-crew mutation capabilities until reapplication.
-- ═══════════════════════════════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_sync_oid oid := to_regprocedure(
    'public.sync_appointment_crew(uuid,jsonb)'
  );
  v_manage_oid oid := to_regprocedure(
    'public.can_current_employee_manage_appointment_crew(uuid)'
  );
  v_update_oid oid := to_regprocedure(
    'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)'
  );
  v_assign_oid oid := to_regprocedure(
    'public.assign_tasks_to_appointment(uuid,uuid[])'
  );
  v_delete_oid oid := to_regprocedure(
    'public.delete_appointment(uuid,uuid,text)'
  );
  v_sync_hash text;
  v_manage_hash text;
  v_update_hash text;
  v_assign_hash text;
  v_delete_hash text;
  v_sync_comment text;
  v_manage_comment text;
  v_update_comment text;
  v_assign_comment text;
  v_delete_comment text;
BEGIN
  IF to_regclass('public.appointment_crew') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.appointment_status_history') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.job_tasks') IS NULL
     OR to_regclass('public.system_events') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('auth.jwt()') IS NULL
     OR v_sync_oid IS NULL
     OR v_manage_oid IS NULL
     OR v_update_oid IS NULL
     OR v_assign_oid IS NULL
     OR v_delete_oid IS NULL THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found a missing deployed dependency'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    md5(procedure.prosrc),
    obj_description(procedure.oid, 'pg_proc')
  INTO v_sync_hash, v_sync_comment
  FROM pg_proc procedure
  WHERE procedure.oid = v_sync_oid;

  -- Exact current predecessors:
  --   Production 20260804003152 hotfix = 1b5cde73...
  --   QA 20260803182131 M1 body         = 2f615878...
  IF v_sync_hash NOT IN (
       '1b5cde73aaf7c910461f6c4c8447029e',
       '2f615878d384051b1dec92b0b57845a9'
     )
     AND COALESCE(v_sync_comment, '') NOT LIKE
       'UPR appointment crew atomic save/audit repair v1:%' THEN
    RAISE EXCEPTION
      'appointment crew atomic repair sync predecessor drift (md5 %)',
      v_sync_hash
      USING ERRCODE = '55000';
  END IF;

  SELECT
    md5(procedure.prosrc),
    obj_description(procedure.oid, 'pg_proc')
  INTO v_manage_hash, v_manage_comment
  FROM pg_proc procedure
  WHERE procedure.oid = v_manage_oid;

  -- Exact current predecessors:
  --   Production hotfix helper = c5f0ea1f...
  --   QA M1 helper             = addbcf6e...
  IF v_manage_hash NOT IN (
       'c5f0ea1f1167ef1274c70e0091af6c13',
       'addbcf6ebd592da9c92a8dffdacd5b96'
     )
     AND COALESCE(v_manage_comment, '') NOT LIKE
       'UPR appointment crew atomic save/audit repair v1:%' THEN
    RAISE EXCEPTION
      'appointment crew atomic repair management predecessor drift (md5 %)',
      v_manage_hash
      USING ERRCODE = '55000';
  END IF;

  SELECT
    md5(procedure.prosrc),
    obj_description(procedure.oid, 'pg_proc')
  INTO v_update_hash, v_update_comment
  FROM pg_proc procedure
  WHERE procedure.oid = v_update_oid;

  -- Production keeps the July history body; QA has M1's actor-authorized body.
  IF v_update_hash NOT IN (
       '9ca5bc7f25cbfb0121c299946118a5ee',
       'df0283b20ef8fef0f68028259ab7fd8f'
     )
     AND COALESCE(v_update_comment, '') NOT LIKE
       'UPR appointment crew atomic save/audit repair v1:%' THEN
    RAISE EXCEPTION
      'appointment crew atomic repair update predecessor drift (md5 %)',
      v_update_hash
      USING ERRCODE = '55000';
  END IF;

  SELECT
    md5(procedure.prosrc),
    obj_description(procedure.oid, 'pg_proc')
  INTO v_assign_hash, v_assign_comment
  FROM pg_proc procedure
  WHERE procedure.oid = v_assign_oid;

  IF v_assign_hash <> '3c1d404cd65307c3de8db2ec7bab2914'
     AND COALESCE(v_assign_comment, '') NOT LIKE
       'UPR appointment crew atomic save/audit repair v1:%' THEN
    RAISE EXCEPTION
      'appointment crew atomic repair task predecessor drift (md5 %)',
      v_assign_hash
      USING ERRCODE = '55000';
  END IF;

  SELECT
    md5(procedure.prosrc),
    obj_description(procedure.oid, 'pg_proc')
  INTO v_delete_hash, v_delete_comment
  FROM pg_proc procedure
  WHERE procedure.oid = v_delete_oid;

  IF v_delete_hash NOT IN (
       'e8b67031d148d07efd6fbfd4bb72524a',
       '0c126177d2b677c11c3c878ae2920a17'
     )
     AND COALESCE(v_delete_comment, '') NOT LIKE
       'UPR appointment crew atomic save/audit repair v1:%' THEN
    RAISE EXCEPTION
      'appointment crew atomic repair delete predecessor drift (md5 %)',
      v_delete_hash
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT array_agg(
      enum_value.enumlabel::text
      ORDER BY enum_value.enumsortorder
    )
    FROM pg_type type_record
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = type_record.typnamespace
    JOIN pg_enum enum_value
      ON enum_value.enumtypid = type_record.oid
    WHERE namespace_record.nspname = 'public'
      AND type_record.typname = 'crew_role'
  ) IS DISTINCT FROM ARRAY['lead', 'tech', 'helper']::text[] THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found crew_role label drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute column_record
    JOIN pg_attrdef default_record
      ON default_record.adrelid = column_record.attrelid
     AND default_record.adnum = column_record.attnum
    WHERE column_record.attrelid = 'public.appointment_crew'::regclass
      AND column_record.attname = 'role'
      AND NOT column_record.attisdropped
      AND column_record.attnotnull
      AND format_type(
        column_record.atttypid,
        column_record.atttypmod
      ) = 'crew_role'
      AND pg_get_expr(
        default_record.adbin,
        default_record.adrelid
      ) = '''tech''::crew_role'
  ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found appointment_crew.role drift'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'appointment_crew'
  ) IS DISTINCT FROM 4
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class table_record
       WHERE table_record.oid =
         'public.appointment_crew'::regclass
         AND table_record.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('all_select_appointment_crew', 'SELECT'),
           ('all_insert_appointment_crew', 'INSERT'),
           ('all_update_appointment_crew', 'UPDATE'),
           ('all_delete_appointment_crew', 'DELETE')
       ) expected(policy_name, command_name)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_policies policy
         WHERE policy.schemaname = 'public'
           AND policy.tablename = 'appointment_crew'
           AND policy.policyname = expected.policy_name
           AND policy.cmd = expected.command_name
           AND policy.roles = ARRAY['authenticated'::name]
       )
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found policy-shape drift'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'appointments'
  ) IS DISTINCT FROM 4
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class table_record
       WHERE table_record.oid = 'public.appointments'::regclass
         AND table_record.relrowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('all_select_appointments', 'SELECT'),
           ('all_insert_appointments', 'INSERT'),
           ('all_update_appointments', 'UPDATE'),
           ('all_delete_appointments', 'DELETE')
       ) expected(policy_name, command_name)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_policies policy
         WHERE policy.schemaname = 'public'
           AND policy.tablename = 'appointments'
           AND policy.policyname = expected.policy_name
           AND policy.cmd = expected.command_name
       )
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found appointment policy-shape drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class table_record
    WHERE table_record.oid = 'public.system_events'::regclass
      AND table_record.relrowsecurity
  )
     OR EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'system_events'
         AND (
           'anon'::name = ANY(policy.roles)
           OR 'authenticated'::name = ANY(policy.roles)
           OR 'public'::name = ANY(policy.roles)
         )
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair requires browser-denied system_events'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.current_active_internal_appointment_employee()'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.current_active_internal_appointment_employee()'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected actor helper'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.current_attributed_appointment_crew_actor()'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.current_attributed_appointment_crew_actor()'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected audit actor helper'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.is_trusted_appointment_command_caller()'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.is_trusted_appointment_command_caller()'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected trust helper'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.can_current_employee_edit_appointment_command(uuid)'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.can_current_employee_edit_appointment_command(uuid)'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected edit helper'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.can_current_employee_create_appointment_command()'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.can_current_employee_create_appointment_command()'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected create helper'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.audit_appointment_crew_change()'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.audit_appointment_crew_change()'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected audit function'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected create command'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected update command'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
       'public.sync_appointment_crew(uuid,jsonb,uuid)'
     ) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.sync_appointment_crew(uuid,jsonb,uuid)'
       )
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found an unexpected service sync command'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid = 'public.appointment_crew'::regclass
      AND trigger_record.tgname = 'trg_appointment_crew_actor_audit'
      AND NOT trigger_record.tgisinternal
  )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = 'public.appointment_crew'::regclass
         AND trigger_record.tgname = 'trg_appointment_crew_actor_audit'
         AND trigger_record.tgenabled = 'O'
         AND trigger_record.tgfoid = to_regprocedure(
           'public.audit_appointment_crew_change()'
         )
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found audit-trigger drift'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

DO $merge_jobs_preflight$
DECLARE
  v_merge_oid oid := to_regprocedure(
    'public.merge_jobs(uuid,uuid)'
  );
BEGIN
  IF v_merge_oid IS NULL THEN
    RAISE EXCEPTION
      'appointment crew atomic repair requires merge_jobs(uuid,uuid)'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = v_merge_oid
      AND (
        COALESCE(
          obj_description(procedure.oid, 'pg_proc'),
          ''
        ) LIKE
          'UPR appointment crew atomic save/audit repair v1:%'
        OR (
          procedure.prosrc LIKE
            '%UPDATE appointments SET job_id = p_keep_id WHERE job_id = p_merge_id%'
          AND procedure.prosrc LIKE
            '%DELETE FROM jobs WHERE id = p_merge_id%'
          AND procedure.prosrc LIKE
            '%Both jobs have payment records%'
          AND procedure.prosrc LIKE
            '%job.merged%'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found merge_jobs source drift'
      USING ERRCODE = '55000';
  END IF;
END;
$merge_jobs_preflight$;

CREATE OR REPLACE FUNCTION
  public.is_trusted_appointment_command_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(auth.jwt() ->> 'role' = 'service_role', false)
    OR (
      NULLIF(auth.jwt() ->> 'role', '') IS NULL
      AND session_user IN ('postgres', 'supabase_admin')
    );
$function$;

ALTER FUNCTION public.is_trusted_appointment_command_caller()
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.is_trusted_appointment_command_caller()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.is_trusted_appointment_command_caller()
  IS 'UPR appointment crew atomic save/audit repair v1: private service/database trust predicate';

CREATE OR REPLACE FUNCTION
  public.current_active_internal_appointment_employee()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.auth_user_id = (SELECT auth.uid())
    AND employee.is_active IS TRUE
    AND employee.is_external IS FALSE
    AND employee.role::text IS DISTINCT FROM 'crm_partner'
  ORDER BY employee.id
  LIMIT 1;
$function$;

ALTER FUNCTION public.current_active_internal_appointment_employee()
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.current_active_internal_appointment_employee()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.current_active_internal_appointment_employee()
  IS 'UPR appointment crew atomic save/audit repair v1: private authenticated active-internal actor resolver';

CREATE OR REPLACE FUNCTION
  public.current_attributed_appointment_crew_actor()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH requested_actor AS (
    SELECT CASE
      WHEN public.is_trusted_appointment_command_caller() THEN
        NULLIF(
          btrim(
            current_setting(
              'upr.appointment_crew_actor_id',
              true
            )
          ),
          ''
        )
      ELSE
        public.current_active_internal_appointment_employee()::text
    END AS actor_id_text
  )
  SELECT employee.id
  FROM requested_actor
  JOIN public.employees employee
    ON employee.id = CASE
      WHEN requested_actor.actor_id_text ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN requested_actor.actor_id_text::uuid
      ELSE NULL::uuid
    END
  WHERE employee.is_active IS TRUE
    AND employee.is_external IS FALSE
    AND employee.role::text IS DISTINCT FROM 'crm_partner'
  ORDER BY employee.id
  LIMIT 1;
$function$;

ALTER FUNCTION public.current_attributed_appointment_crew_actor()
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.current_attributed_appointment_crew_actor()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.current_attributed_appointment_crew_actor()
  IS 'UPR appointment crew atomic save/audit repair v1: private employee attribution resolver; trusted callers require SET LOCAL upr.appointment_crew_actor_id';

CREATE OR REPLACE FUNCTION
  public.can_current_employee_create_appointment_command()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id =
      public.current_active_internal_appointment_employee()
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

ALTER FUNCTION public.can_current_employee_create_appointment_command()
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.can_current_employee_create_appointment_command()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.can_current_employee_create_appointment_command()
  TO authenticated;
COMMENT ON FUNCTION
  public.can_current_employee_create_appointment_command()
  IS 'UPR appointment crew atomic save/audit repair v1: private deployed appointment-creator role predicate';

CREATE OR REPLACE FUNCTION
  public.can_current_employee_edit_appointment_command(
    p_appointment_id uuid
  )
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    JOIN public.appointments appointment
      ON appointment.id = p_appointment_id
    WHERE employee.id =
      public.current_active_internal_appointment_employee()
      AND employee.role::text IN (
        'admin',
        'office',
        'project_manager',
        'field_tech',
        'estimator',
        'supervisor'
      )
      AND (
        (
          employee.role::text IN (
            'admin',
            'office',
            'project_manager',
            'supervisor'
          )
          AND (
            appointment.is_private IS FALSE
            OR employee.role::text IN ('admin', 'project_manager')
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.appointment_crew crew
          WHERE crew.appointment_id = appointment.id
            AND crew.employee_id = employee.id
        )
        OR (
          appointment.is_private IS FALSE
          AND (
            appointment.created_by = employee.id
            OR NULLIF(
              to_jsonb(appointment) ->> 'created_by_employee_id',
              ''
            )::uuid = employee.id
          )
        )
      )
  );
$function$;

ALTER FUNCTION
  public.can_current_employee_edit_appointment_command(uuid)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION
    public.can_current_employee_edit_appointment_command(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION
    public.can_current_employee_edit_appointment_command(uuid)
  TO authenticated;
COMMENT ON FUNCTION
  public.can_current_employee_edit_appointment_command(uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: private Production/QA-compatible appointment edit predicate';

CREATE OR REPLACE FUNCTION
  public.can_current_employee_access_appointment_command(
    p_appointment_id uuid
  )
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    JOIN public.appointments appointment
      ON appointment.id = p_appointment_id
    WHERE employee.id =
      public.current_active_internal_appointment_employee()
      AND (
        appointment.is_private IS FALSE
        OR employee.role::text IN ('admin', 'project_manager')
        OR EXISTS (
          SELECT 1
          FROM public.appointment_crew crew
          WHERE crew.appointment_id = appointment.id
            AND crew.employee_id = employee.id
        )
      )
  );
$function$;

ALTER FUNCTION
  public.can_current_employee_access_appointment_command(uuid)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION
    public.can_current_employee_access_appointment_command(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION
    public.can_current_employee_access_appointment_command(uuid)
  TO authenticated;
COMMENT ON FUNCTION
  public.can_current_employee_access_appointment_command(uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: private-row-safe appointment read predicate';

CREATE OR REPLACE FUNCTION
  public.can_current_employee_access_appointment_row(
    p_appointment_id uuid,
    p_is_private boolean
  )
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id =
      public.current_active_internal_appointment_employee()
      AND (
        p_is_private IS FALSE
        OR employee.role::text IN ('admin', 'project_manager')
        OR EXISTS (
          SELECT 1
          FROM public.appointment_crew crew
          WHERE crew.appointment_id = p_appointment_id
            AND crew.employee_id = employee.id
        )
      )
  );
$function$;

ALTER FUNCTION
  public.can_current_employee_access_appointment_row(uuid, boolean)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION
    public.can_current_employee_access_appointment_row(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION
    public.can_current_employee_access_appointment_row(uuid, boolean)
  TO authenticated;
COMMENT ON FUNCTION
  public.can_current_employee_access_appointment_row(uuid, boolean)
  IS 'UPR appointment crew atomic save/audit repair v1: row-value appointment RLS read predicate';

CREATE OR REPLACE FUNCTION
  public.can_current_employee_manage_appointment_privacy()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id =
      public.current_active_internal_appointment_employee()
      AND employee.role::text IN ('admin', 'project_manager')
  );
$function$;

ALTER FUNCTION
  public.can_current_employee_manage_appointment_privacy()
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION
    public.can_current_employee_manage_appointment_privacy()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION
    public.can_current_employee_manage_appointment_privacy()
  TO authenticated;
COMMENT ON FUNCTION
  public.can_current_employee_manage_appointment_privacy()
  IS 'UPR appointment crew atomic save/audit repair v1: private appointment privacy manager predicate';

CREATE OR REPLACE FUNCTION
  public.can_current_employee_manage_appointment_crew(
    p_appointment_id uuid
  )
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_appointment_id IS NOT NULL
    AND public.current_active_internal_appointment_employee() IS NOT NULL;
$function$;

ALTER FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  TO authenticated;
COMMENT ON FUNCTION
  public.can_current_employee_manage_appointment_crew(uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: every active internal employee may manage every appointment crew';

CREATE OR REPLACE FUNCTION public.guard_appointment_command_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
BEGIN
  IF public.is_trusted_appointment_command_caller() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_actor_id :=
    public.current_active_internal_appointment_employee();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal appointment employee required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL
       AND NEW.created_by IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment creator does not match caller'
        USING ERRCODE = '42501';
    END IF;
    NEW.created_by := v_actor_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment identity is immutable'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.is_private IS DISTINCT FROM OLD.is_private
       AND NOT public.can_current_employee_manage_appointment_privacy() THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment privacy manager required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_appointment_command_write()
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.guard_appointment_command_write()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.guard_appointment_command_write()
  IS 'UPR appointment crew atomic save/audit repair v1: trigger-only browser actor, identity, and privacy guard';

CREATE OR REPLACE TRIGGER trg_appointments_atomic_command_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_appointment_command_write();

CREATE OR REPLACE FUNCTION public.merge_jobs(
  p_keep_id uuid,
  p_merge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_keep public.jobs%ROWTYPE;
  v_merge public.jobs%ROWTYPE;
  v_keep_has_payments boolean;
  v_merge_has_payments boolean;
  v_docs_moved integer := 0;
  v_time_entries_moved integer := 0;
  v_appointments_moved integer := 0;
BEGIN
  SELECT employee.id
  INTO v_actor_id
  FROM public.employees employee
  WHERE employee.auth_user_id = (SELECT auth.uid())
    AND employee.is_active IS TRUE
    AND employee.is_external IS FALSE
    AND employee.role::text = 'admin'
  ORDER BY employee.id
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal admin required to merge jobs'
      USING ERRCODE = '42501';
  END IF;

  IF p_keep_id IS NULL
     OR p_merge_id IS NULL
     OR p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'Cannot merge a job with itself'
      USING ERRCODE = '22023';
  END IF;

  -- Lock in UUID order so opposite merge requests cannot deadlock.
  PERFORM 1
  FROM public.jobs job
  WHERE job.id IN (p_keep_id, p_merge_id)
  ORDER BY job.id
  FOR UPDATE;

  SELECT *
  INTO v_keep
  FROM public.jobs job
  WHERE job.id = p_keep_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keep job not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_merge
  FROM public.jobs job
  WHERE job.id = p_merge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Merge job not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payments payment
    WHERE payment.job_id = p_keep_id
  )
  INTO v_keep_has_payments;
  SELECT EXISTS (
    SELECT 1
    FROM public.payments payment
    WHERE payment.job_id = p_merge_id
  )
  INTO v_merge_has_payments;

  IF v_keep_has_payments AND v_merge_has_payments THEN
    RAISE EXCEPTION
      'Both jobs have payment records. Manual reconciliation required — choose the job with the correct payment history as the keeper.';
  END IF;

  UPDATE public.jobs job
  SET insured_name = COALESCE(job.insured_name, v_merge.insured_name),
      address = COALESCE(job.address, v_merge.address),
      city = COALESCE(job.city, v_merge.city),
      state = COALESCE(job.state, v_merge.state),
      zip = COALESCE(job.zip, v_merge.zip),
      client_email = COALESCE(job.client_email, v_merge.client_email),
      client_phone = COALESCE(job.client_phone, v_merge.client_phone),
      insurance_company = COALESCE(
        job.insurance_company,
        v_merge.insurance_company
      ),
      claim_number = COALESCE(job.claim_number, v_merge.claim_number),
      adjuster_name = COALESCE(job.adjuster_name, v_merge.adjuster_name),
      adjuster_phone = COALESCE(job.adjuster_phone, v_merge.adjuster_phone),
      adjuster_email = COALESCE(job.adjuster_email, v_merge.adjuster_email),
      policy_number = COALESCE(job.policy_number, v_merge.policy_number),
      cat_code = COALESCE(job.cat_code, v_merge.cat_code),
      date_of_loss = COALESCE(job.date_of_loss, v_merge.date_of_loss),
      type_of_loss = COALESCE(job.type_of_loss, v_merge.type_of_loss),
      broker_agent = COALESCE(job.broker_agent, v_merge.broker_agent),
      project_manager = COALESCE(
        job.project_manager,
        v_merge.project_manager
      ),
      encircle_summary = COALESCE(
        job.encircle_summary,
        v_merge.encircle_summary
      ),
      encircle_claim_id = COALESCE(
        job.encircle_claim_id,
        v_merge.encircle_claim_id
      ),
      carrier_identifier = COALESCE(
        job.carrier_identifier,
        v_merge.carrier_identifier
      ),
      assignment_identifier = COALESCE(
        job.assignment_identifier,
        v_merge.assignment_identifier
      ),
      claim_id = COALESCE(job.claim_id, v_merge.claim_id),
      primary_contact_id = COALESCE(
        job.primary_contact_id,
        v_merge.primary_contact_id
      ),
      lead_source = COALESCE(job.lead_source, v_merge.lead_source),
      lead_source_detail = COALESCE(
        job.lead_source_detail,
        v_merge.lead_source_detail
      ),
      estimator = COALESCE(job.estimator, v_merge.estimator),
      lead_tech = COALESCE(job.lead_tech, v_merge.lead_tech),
      supervisor = COALESCE(job.supervisor, v_merge.supervisor),
      internal_notes = CASE
        WHEN job.internal_notes IS NULL THEN v_merge.internal_notes
        WHEN v_merge.internal_notes IS NOT NULL THEN
          job.internal_notes || E'\n---\nMerged from '
          || COALESCE(v_merge.job_number, v_merge.id::text)
          || E':\n' || v_merge.internal_notes
        ELSE job.internal_notes
      END,
      estimated_value = COALESCE(job.estimated_value, 0)
        + COALESCE(v_merge.estimated_value, 0),
      approved_value = COALESCE(job.approved_value, 0)
        + COALESCE(v_merge.approved_value, 0),
      invoiced_value = COALESCE(job.invoiced_value, 0)
        + COALESCE(v_merge.invoiced_value, 0),
      collected_value = COALESCE(job.collected_value, 0)
        + COALESCE(v_merge.collected_value, 0),
      supplement_value = COALESCE(job.supplement_value, 0)
        + COALESCE(v_merge.supplement_value, 0),
      total_labor_cost = COALESCE(job.total_labor_cost, 0)
        + COALESCE(v_merge.total_labor_cost, 0),
      total_material_cost = COALESCE(job.total_material_cost, 0)
        + COALESCE(v_merge.total_material_cost, 0),
      total_equipment_cost = COALESCE(job.total_equipment_cost, 0)
        + COALESCE(v_merge.total_equipment_cost, 0),
      total_sub_cost = COALESCE(job.total_sub_cost, 0)
        + COALESCE(v_merge.total_sub_cost, 0),
      total_other_cost = COALESCE(job.total_other_cost, 0)
        + COALESCE(v_merge.total_other_cost, 0),
      updated_at = now()
  WHERE job.id = p_keep_id;

  UPDATE public.payments SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.invoices SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.estimates SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.job_costs SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.job_supplements SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.vendor_invoices SET job_id = p_keep_id
  WHERE job_id = p_merge_id;

  UPDATE public.job_documents SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  GET DIAGNOSTICS v_docs_moved = ROW_COUNT;
  UPDATE public.job_notes SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.job_checklists SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.forms SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.sign_requests SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.document_requests SET job_id = p_keep_id
  WHERE job_id = p_merge_id;

  UPDATE public.appointments SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  GET DIAGNOSTICS v_appointments_moved = ROW_COUNT;

  DELETE FROM public.job_assignments assignment
  WHERE assignment.job_id = p_merge_id
    AND (assignment.employee_id, assignment.scheduled_date) IN (
      SELECT kept.employee_id, kept.scheduled_date
      FROM public.job_assignments kept
      WHERE kept.job_id = p_keep_id
    );
  UPDATE public.job_assignments SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.job_schedules SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.schedule_blocks SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.job_time_entries SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  GET DIAGNOSTICS v_time_entries_moved = ROW_COUNT;
  UPDATE public.job_equipment SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.job_tasks SET job_id = p_keep_id
  WHERE job_id = p_merge_id;

  UPDATE public.conversations SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.notification_queue SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.selection_dispatches SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.selection_responses SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.sub_confirmations SET job_id = p_keep_id
  WHERE job_id = p_merge_id;

  UPDATE public.job_phase_history SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  UPDATE public.system_events SET job_id = p_keep_id
  WHERE job_id = p_merge_id;
  DELETE FROM public.dispatch_board_jobs
  WHERE job_id = p_merge_id;
  DELETE FROM public.contact_jobs link
  WHERE link.job_id = p_merge_id
    AND (link.contact_id, link.role) IN (
      SELECT kept.contact_id, kept.role
      FROM public.contact_jobs kept
      WHERE kept.job_id = p_keep_id
    );
  UPDATE public.contact_jobs SET job_id = p_keep_id
  WHERE job_id = p_merge_id;

  INSERT INTO public.system_events (
    event_type,
    entity_type,
    entity_id,
    actor_id,
    job_id,
    payload
  )
  VALUES (
    'job.merged',
    'job',
    p_keep_id,
    v_actor_id,
    p_keep_id,
    jsonb_build_object(
      'kept_id', p_keep_id,
      'kept_job_number', v_keep.job_number,
      'merged_id', p_merge_id,
      'merged_job_number', v_merge.job_number,
      'appointments_moved', v_appointments_moved,
      'docs_moved', v_docs_moved,
      'time_entries_moved', v_time_entries_moved,
      'changed_at', now()
    )
  );

  DELETE FROM public.jobs
  WHERE id = p_merge_id;

  RETURN jsonb_build_object(
    'ok', true,
    'kept_id', p_keep_id,
    'kept_job_number', v_keep.job_number,
    'merged_id', p_merge_id,
    'merged_job_number', v_merge.job_number,
    'appointments_moved', v_appointments_moved,
    'docs_moved', v_docs_moved,
    'time_entries_moved', v_time_entries_moved
  );
END;
$function$;

ALTER FUNCTION public.merge_jobs(uuid, uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.merge_jobs(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merge_jobs(uuid, uuid)
  TO authenticated;
COMMENT ON FUNCTION public.merge_jobs(uuid, uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: admin-only atomic merge with audited appointment reparent';

CREATE OR REPLACE FUNCTION public.audit_appointment_crew_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_kind text;
  v_is_trusted boolean :=
    public.is_trusted_appointment_command_caller();
  v_appointment_id uuid;
  v_job_id uuid;
  v_old_assignment jsonb;
  v_new_assignment jsonb;
BEGIN
  v_actor_id :=
    public.current_attributed_appointment_crew_actor();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: attributed active internal appointment actor required'
      USING ERRCODE = '42501';
  END IF;

  IF v_is_trusted THEN
    v_actor_kind := CASE
      WHEN auth.jwt() ->> 'role' = 'service_role' THEN 'service_role'
      ELSE 'database_owner'
    END;
  ELSE
    v_actor_kind := 'employee';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NOT EXISTS (
       SELECT 1
       FROM public.employees employee
       WHERE employee.id = NEW.employee_id
         AND employee.is_active IS TRUE
         AND employee.is_external IS FALSE
         AND employee.role::text IS DISTINCT FROM 'crm_partner'
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal appointment crew required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment crew identity is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_appointment_id := OLD.appointment_id;
    v_old_assignment := jsonb_build_object(
      'employee_id', OLD.employee_id,
      'role', OLD.role::text
    );
  ELSIF TG_OP = 'INSERT' THEN
    v_appointment_id := NEW.appointment_id;
    v_new_assignment := jsonb_build_object(
      'employee_id', NEW.employee_id,
      'role', NEW.role::text
    );
  ELSE
    v_appointment_id := NEW.appointment_id;
    v_old_assignment := jsonb_build_object(
      'employee_id', OLD.employee_id,
      'role', OLD.role::text
    );
    v_new_assignment := jsonb_build_object(
      'employee_id', NEW.employee_id,
      'role', NEW.role::text
    );
  END IF;

  SELECT appointment.job_id
  INTO v_job_id
  FROM public.appointments appointment
  WHERE appointment.id = v_appointment_id;

  INSERT INTO public.system_events (
    event_type,
    entity_type,
    entity_id,
    actor_id,
    job_id,
    payload
  )
  VALUES (
    'appointment.crew_changed',
    'appointment',
    v_appointment_id,
    v_actor_id,
    v_job_id,
    jsonb_build_object(
      'operation', lower(TG_OP),
      'actor_kind', v_actor_kind,
      'old_assignment', v_old_assignment,
      'new_assignment', v_new_assignment,
      'changed_at', statement_timestamp()
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.audit_appointment_crew_change()
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.audit_appointment_crew_change()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.audit_appointment_crew_change()
  IS 'UPR appointment crew atomic save/audit repair v1: trigger-only immutable actor and before/after assignment history';

CREATE OR REPLACE TRIGGER trg_appointment_crew_actor_audit
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.appointment_crew
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_appointment_crew_change();

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_crew ENABLE ROW LEVEL SECURITY;

ALTER POLICY all_select_appointments
  ON public.appointments
  TO authenticated
  USING (
    (
      SELECT public.can_current_employee_access_appointment_row(
        id,
        is_private
      )
    )
  );

ALTER POLICY all_insert_appointments
  ON public.appointments
  TO authenticated
  WITH CHECK (
    (SELECT public.can_current_employee_create_appointment_command())
    AND (
      is_private IS FALSE
      OR (
        SELECT public.can_current_employee_manage_appointment_privacy()
      )
    )
  );

ALTER POLICY all_update_appointments
  ON public.appointments
  TO authenticated
  USING (
    (SELECT public.can_current_employee_edit_appointment_command(id))
  )
  WITH CHECK (
    (SELECT public.can_current_employee_edit_appointment_command(id))
  );

ALTER POLICY all_delete_appointments
  ON public.appointments
  TO authenticated
  USING (
    (SELECT public.can_current_employee_edit_appointment_command(id))
  );

REVOKE ALL PRIVILEGES ON TABLE public.appointments
  FROM PUBLIC, anon, authenticated, service_role;
-- Table-level REVOKE does not remove an independently granted column
-- privilege. Clear every inherited appointment UPDATE column before rebuilding
-- the exact Phase-A browser/service posture below.
DO $revoke_appointment_column_update_privileges$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(
    pg_catalog.quote_ident(column_record.column_name),
    ', '
    ORDER BY column_record.ordinal_position
  )
  INTO v_columns
  FROM information_schema.columns column_record
  WHERE column_record.table_schema = 'public'
    AND column_record.table_name = 'appointments';

  IF v_columns IS NULL THEN
    RAISE EXCEPTION
      'appointment crew atomic repair could not enumerate appointment columns'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s) ON TABLE public.appointments FROM PUBLIC, anon, authenticated, service_role',
    v_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE UPDATE (%s) ON TABLE public.appointments FROM PUBLIC, anon, authenticated, service_role',
    v_columns
  );
END;
$revoke_appointment_column_update_privileges$;
-- Phase A compatibility: installed native builds still create appointments and
-- patch privacy/notification fields through PostgREST. RLS plus the command
-- write trigger constrains those rows until an adoption-gated Phase B removes
-- browser DML.
GRANT SELECT, INSERT, DELETE
  ON TABLE public.appointments
  TO authenticated;
-- The job merge RPC is the only current path that reparents an appointment.
-- Direct/browser UPDATE remains compatible for every non-identity column, but
-- cannot change id, job_id, kind, either lineage's creator identity, or the
-- creation timestamp. QA's additive created_by_employee_id is conditional here
-- so the same successor remains valid on the Production lineage where the
-- column does not exist.
DO $grant_appointment_mutable_column_updates$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(
    pg_catalog.quote_ident(column_record.column_name),
    ', '
    ORDER BY column_record.ordinal_position
  )
  INTO v_columns
  FROM information_schema.columns column_record
  WHERE column_record.table_schema = 'public'
    AND column_record.table_name = 'appointments'
    AND column_record.column_name NOT IN (
      'id',
      'job_id',
      'kind',
      'created_by',
      'created_by_employee_id',
      'created_at'
    );

  IF v_columns IS NULL THEN
    RAISE EXCEPTION
      'appointment crew atomic repair found no mutable appointment columns'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT UPDATE (%s) ON TABLE public.appointments TO authenticated',
    v_columns
  );
END;
$grant_appointment_mutable_column_updates$;
-- The current calendar/client-notification worker uses a service-role
-- compare-and-set on client_notified_at/client_time_sig. Preserve UPDATE for
-- that deployed metadata claim; service INSERT/DELETE and all raw crew DML
-- remain denied.
GRANT SELECT
  ON TABLE public.appointments
  TO service_role;
GRANT UPDATE (client_notified_at, client_time_sig)
  ON TABLE public.appointments
  TO service_role;

ALTER POLICY all_select_appointment_crew
  ON public.appointment_crew
  TO authenticated
  USING (
    (SELECT public.can_current_employee_manage_appointment_crew(
      appointment_id
    ))
  );

ALTER POLICY all_insert_appointment_crew
  ON public.appointment_crew
  TO authenticated
  WITH CHECK (
    (SELECT public.can_current_employee_manage_appointment_crew(
      appointment_id
    ))
  );

ALTER POLICY all_update_appointment_crew
  ON public.appointment_crew
  TO authenticated
  USING (
    (SELECT public.can_current_employee_manage_appointment_crew(
      appointment_id
    ))
  )
  WITH CHECK (
    (SELECT public.can_current_employee_manage_appointment_crew(
      appointment_id
    ))
  );

ALTER POLICY all_delete_appointment_crew
  ON public.appointment_crew
  TO authenticated
  USING (
    (SELECT public.can_current_employee_manage_appointment_crew(
      appointment_id
    ))
  );

REVOKE ALL PRIVILEGES ON TABLE public.appointment_crew
  FROM PUBLIC, anon, authenticated, service_role;
DO $revoke_appointment_crew_column_write_privileges$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(
    pg_catalog.quote_ident(column_record.column_name),
    ', '
    ORDER BY column_record.ordinal_position
  )
  INTO v_columns
  FROM information_schema.columns column_record
  WHERE column_record.table_schema = 'public'
    AND column_record.table_name = 'appointment_crew';

  IF v_columns IS NULL THEN
    RAISE EXCEPTION
      'appointment crew atomic repair could not enumerate crew columns'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s) ON TABLE public.appointment_crew FROM PUBLIC, anon, authenticated, service_role',
    v_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE UPDATE (%s) ON TABLE public.appointment_crew FROM PUBLIC, anon, authenticated, service_role',
    v_columns
  );
END;
$revoke_appointment_crew_column_write_privileges$;
-- Phase A compatibility: installed native builds still write crew rows
-- directly. RLS enforces the all-active-internal product policy and the audit
-- trigger records every real add/remove/role change. Phase B removes this
-- grant only after supported-native adoption is evidenced.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.appointment_crew
  TO authenticated;
GRANT SELECT
  ON TABLE public.appointment_crew
  TO service_role;

-- system_events is append-only evidence. RLS does not constrain TRUNCATE, so
-- inherited destructive table privileges must be removed explicitly.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.system_events
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_appointment_crew(
  p_appointment_id uuid,
  p_crew jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF public.appointment_crew
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_kind text;
  v_job_id uuid;
  v_old_crew jsonb;
  v_new_crew jsonb;
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION
      'sync_appointment_crew: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(p_crew, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION
      'sync_appointment_crew: p_crew must be an array'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_trusted_appointment_command_caller()
     AND NOT public.can_current_employee_manage_appointment_crew(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: active internal appointment employee required'
      USING ERRCODE = '42501';
  END IF;

  SELECT appointment.job_id
  INTO v_job_id
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'sync_appointment_crew: appointment not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    WHERE jsonb_typeof(element) IS DISTINCT FROM 'object'
       OR COALESCE(element ->> 'employee_id', '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(
            NULLIF(btrim(element ->> 'role'), ''),
            'tech'
          ) NOT IN ('lead', 'tech', 'helper')
  ) THEN
    RAISE EXCEPTION
      'sync_appointment_crew: invalid crew member'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    GROUP BY (element ->> 'employee_id')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'sync_appointment_crew: duplicate crew member'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = (element ->> 'employee_id')::uuid
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
        AND employee.role::text IS DISTINCT FROM 'crm_partner'
    )
  ) THEN
    RAISE EXCEPTION
      'sync_appointment_crew: active internal crew required'
      USING ERRCODE = '42501';
  END IF;

  v_actor_id :=
    public.current_attributed_appointment_crew_actor();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: attributed active internal appointment actor required'
      USING ERRCODE = '42501';
  END IF;

  IF public.is_trusted_appointment_command_caller() THEN
    v_actor_kind := CASE
      WHEN auth.jwt() ->> 'role' = 'service_role' THEN 'service_role'
      ELSE 'database_owner'
    END;
  ELSE
    v_actor_kind := 'employee';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', crew.employee_id,
        'role', crew.role::text
      )
      ORDER BY crew.employee_id
    ),
    '[]'::jsonb
  )
  INTO v_old_crew
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = p_appointment_id;

  WITH desired AS (
    SELECT
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(
        NULLIF(btrim(element ->> 'role'), ''),
        'tech'
      )::public.crew_role AS role
    FROM jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
  )
  DELETE FROM public.appointment_crew existing
  WHERE existing.appointment_id = p_appointment_id
    AND NOT EXISTS (
      SELECT 1
      FROM desired
      WHERE desired.employee_id = existing.employee_id
    );

  WITH desired AS (
    SELECT
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(
        NULLIF(btrim(element ->> 'role'), ''),
        'tech'
      )::public.crew_role AS role
    FROM jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
  )
  UPDATE public.appointment_crew existing
  SET role = desired.role
  FROM desired
  WHERE existing.appointment_id = p_appointment_id
    AND existing.employee_id = desired.employee_id
    AND existing.role IS DISTINCT FROM desired.role;

  WITH desired AS (
    SELECT
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(
        NULLIF(btrim(element ->> 'role'), ''),
        'tech'
      )::public.crew_role AS role
    FROM jsonb_array_elements(
      COALESCE(p_crew, '[]'::jsonb)
    ) element
  )
  INSERT INTO public.appointment_crew (
    appointment_id,
    employee_id,
    role
  )
  SELECT
    p_appointment_id,
    desired.employee_id,
    desired.role
  FROM desired
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.appointment_crew existing
    WHERE existing.appointment_id = p_appointment_id
      AND existing.employee_id = desired.employee_id
  )
  ON CONFLICT (appointment_id, employee_id) DO NOTHING;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', crew.employee_id,
        'role', crew.role::text
      )
      ORDER BY crew.employee_id
    ),
    '[]'::jsonb
  )
  INTO v_new_crew
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = p_appointment_id;

  IF v_new_crew IS DISTINCT FROM v_old_crew THEN
    INSERT INTO public.system_events (
      event_type,
      entity_type,
      entity_id,
      actor_id,
      job_id,
      payload
    )
    VALUES (
      'appointment.crew_changed',
      'appointment',
      p_appointment_id,
      v_actor_id,
      v_job_id,
      jsonb_build_object(
        'operation', 'set_diff',
        'actor_kind', v_actor_kind,
        'old_crew', v_old_crew,
        'new_crew', v_new_crew,
        'changed_at', statement_timestamp()
      )
    );
  END IF;

  RETURN QUERY
  SELECT crew.*
  FROM public.appointment_crew crew
  WHERE crew.appointment_id = p_appointment_id
  ORDER BY crew.created_at, crew.id;
END;
$function$;

ALTER FUNCTION public.sync_appointment_crew(uuid, jsonb)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  TO authenticated;
COMMENT ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  IS 'UPR appointment crew atomic save/audit repair v1: enum-safe locked audited set diff';

CREATE OR REPLACE FUNCTION public.sync_appointment_crew(
  p_appointment_id uuid,
  p_crew jsonb,
  p_actor_id uuid
)
RETURNS SETOF public.appointment_crew
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_trusted_appointment_command_caller()
     OR p_actor_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.employees employee
       WHERE employee.id = p_actor_id
         AND employee.is_active IS TRUE
         AND employee.is_external IS FALSE
         AND employee.role::text IS DISTINCT FROM 'crm_partner'
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: attributed service appointment actor required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config(
    'upr.appointment_crew_actor_id',
    p_actor_id::text,
    true
  );

  RETURN QUERY
  SELECT crew.*
  FROM public.sync_appointment_crew(
    p_appointment_id,
    p_crew
  ) crew;
END;
$function$;

ALTER FUNCTION public.sync_appointment_crew(uuid, jsonb, uuid)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.sync_appointment_crew(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.sync_appointment_crew(uuid, jsonb, uuid)
  TO service_role;
COMMENT ON FUNCTION public.sync_appointment_crew(uuid, jsonb, uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: service-only explicit employee-attributed set diff';

CREATE OR REPLACE FUNCTION public.update_appointment(
  p_appointment_id uuid,
  p_date date DEFAULT NULL::date,
  p_time_start time without time zone
    DEFAULT NULL::time without time zone,
  p_time_end time without time zone
    DEFAULT NULL::time without time zone,
  p_title text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_is_trusted boolean :=
    public.is_trusted_appointment_command_caller();
  v_result jsonb;
  v_old_date date;
  v_old_time_start time;
  v_old_time_end time;
  v_old_status text;
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION
      'update_appointment: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_is_trusted THEN
    IF p_actor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.employees employee
         WHERE employee.id = p_actor_id
           AND employee.is_active IS TRUE
           AND employee.is_external IS FALSE
           AND employee.role::text IS DISTINCT FROM 'crm_partner'
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: active internal appointment actor required'
        USING ERRCODE = '42501';
    END IF;
    v_actor_id := p_actor_id;
  ELSE
    v_actor_id :=
      public.current_active_internal_appointment_employee();
    IF v_actor_id IS NULL
       OR (
         p_actor_id IS NOT NULL
         AND p_actor_id IS DISTINCT FROM v_actor_id
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment actor does not match caller'
      USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM pg_catalog.set_config(
    'upr.appointment_crew_actor_id',
    v_actor_id::text,
    true
  );

  SELECT
    appointment.date,
    appointment.time_start,
    appointment.time_end,
    appointment.status::text
  INTO
    v_old_date,
    v_old_time_start,
    v_old_time_end,
    v_old_status
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'update_appointment: appointment not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_trusted
     AND NOT public.can_current_employee_edit_appointment_command(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment mutation access required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.appointments appointment
  SET
    date = COALESCE(p_date, appointment.date),
    time_start = COALESCE(
      p_time_start,
      appointment.time_start
    ),
    time_end = COALESCE(p_time_end, appointment.time_end),
    title = COALESCE(p_title, appointment.title),
    type = COALESCE(
      p_type::public.appointment_type,
      appointment.type
    ),
    status = COALESCE(
      p_status::public.appointment_status,
      appointment.status
    ),
    notes = COALESCE(p_notes, appointment.notes)
  WHERE appointment.id = p_appointment_id
  RETURNING jsonb_build_object(
    'id', appointment.id,
    'date', appointment.date,
    'time_start', appointment.time_start,
    'time_end', appointment.time_end,
    'title', appointment.title,
    'status', appointment.status
  )
  INTO v_result;

  IF (v_result ->> 'date')::date IS DISTINCT FROM v_old_date
     OR (v_result ->> 'time_start')::time
        IS DISTINCT FROM v_old_time_start
     OR (v_result ->> 'time_end')::time
        IS DISTINCT FROM v_old_time_end THEN
    INSERT INTO public.appointment_status_history (
      appointment_id,
      event_type,
      old_date,
      old_time_start,
      old_time_end,
      old_status,
      new_date,
      new_time_start,
      new_time_end,
      new_status,
      actor_id
    )
    VALUES (
      p_appointment_id,
      'rescheduled',
      v_old_date,
      v_old_time_start,
      v_old_time_end,
      v_old_status,
      (v_result ->> 'date')::date,
      (v_result ->> 'time_start')::time,
      (v_result ->> 'time_end')::time,
      v_result ->> 'status',
      v_actor_id
    );
  ELSIF (v_result ->> 'status') IS DISTINCT FROM v_old_status THEN
    INSERT INTO public.appointment_status_history (
      appointment_id,
      event_type,
      old_status,
      new_status,
      actor_id
    )
    VALUES (
      p_appointment_id,
      CASE
        WHEN v_result ->> 'status' = 'cancelled'
          THEN 'cancelled'
        ELSE 'status_changed'
      END,
      v_old_status,
      v_result ->> 'status',
      v_actor_id
    );
  END IF;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.update_appointment(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  uuid
) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.update_appointment(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_appointment(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  uuid
) TO authenticated, service_role;
COMMENT ON FUNCTION public.update_appointment(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  uuid
) IS 'UPR appointment crew atomic save/audit repair v1: legacy-compatible actor-bound appointment update';

CREATE OR REPLACE FUNCTION public.assign_tasks_to_appointment(
  p_appointment_id uuid,
  p_task_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_trusted boolean :=
    public.is_trusted_appointment_command_caller();
  v_job_id uuid;
  v_count integer := 0;
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION
      'assign_tasks_to_appointment: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT appointment.job_id
  INTO v_job_id
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'assign_tasks_to_appointment: appointment not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_trusted
     AND (
       public.current_active_internal_appointment_employee() IS NULL
       OR NOT public.can_current_employee_edit_appointment_command(
         p_appointment_id
       )
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment task access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_task_ids IS NULL THEN
    RETURN jsonb_build_object(
      'appointment_id',
      p_appointment_id,
      'tasks_assigned',
      0
    );
  END IF;

  PERFORM 1
  FROM public.job_tasks task
  WHERE task.id = ANY(p_task_ids)
  ORDER BY task.id
  FOR UPDATE;

  IF cardinality(p_task_ids) IS DISTINCT FROM (
    SELECT count(*)::integer
    FROM public.job_tasks task
    WHERE task.id = ANY(p_task_ids)
      AND task.job_id = v_job_id
      AND (
        task.appointment_id IS NULL
        OR task.appointment_id = p_appointment_id
      )
  ) THEN
    RAISE EXCEPTION
      'assign_tasks_to_appointment: task IDs must be unique, unassigned/current, and belong to the appointment job'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.job_tasks task
  SET appointment_id = NULL
  WHERE task.appointment_id = p_appointment_id
    AND NOT (task.id = ANY(p_task_ids))
    AND task.is_completed IS FALSE;

  UPDATE public.job_tasks task
  SET appointment_id = p_appointment_id
  WHERE task.id = ANY(p_task_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'appointment_id',
    p_appointment_id,
    'tasks_assigned',
    v_count
  );
END;
$function$;

ALTER FUNCTION public.assign_tasks_to_appointment(uuid, uuid[])
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.assign_tasks_to_appointment(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.assign_tasks_to_appointment(uuid, uuid[])
  TO authenticated, service_role;
COMMENT ON FUNCTION
  public.assign_tasks_to_appointment(uuid, uuid[])
  IS 'UPR appointment crew atomic save/audit repair v1: legacy-compatible actor, object, and same-job task replacement';

CREATE OR REPLACE FUNCTION public.delete_appointment(
  p_appointment_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_is_trusted boolean :=
    public.is_trusted_appointment_command_caller();
  v_date date;
  v_time_start time;
  v_time_end time;
  v_status text;
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION
      'delete_appointment: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_is_trusted THEN
    IF p_actor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.employees employee
         WHERE employee.id = p_actor_id
           AND employee.is_active IS TRUE
           AND employee.is_external IS FALSE
           AND employee.role::text IS DISTINCT FROM 'crm_partner'
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: active internal appointment actor required'
        USING ERRCODE = '42501';
    END IF;
    v_actor_id := p_actor_id;
  ELSE
    v_actor_id :=
      public.current_active_internal_appointment_employee();
    IF v_actor_id IS NULL
       OR (
         p_actor_id IS NOT NULL
         AND p_actor_id IS DISTINCT FROM v_actor_id
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment actor does not match caller'
      USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM pg_catalog.set_config(
    'upr.appointment_crew_actor_id',
    v_actor_id::text,
    true
  );

  SELECT
    appointment.date,
    appointment.time_start,
    appointment.time_end,
    appointment.status::text
  INTO
    v_date,
    v_time_start,
    v_time_end,
    v_status
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT v_is_trusted
     AND NOT public.can_current_employee_edit_appointment_command(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment mutation access required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.appointment_status_history (
    appointment_id,
    event_type,
    old_date,
    old_time_start,
    old_time_end,
    old_status,
    actor_id,
    reason
  )
  VALUES (
    p_appointment_id,
    'deleted',
    v_date,
    v_time_start,
    v_time_end,
    v_status,
    v_actor_id,
    p_reason
  );

  UPDATE public.job_tasks task
  SET appointment_id = NULL
  WHERE task.appointment_id = p_appointment_id;

  DELETE FROM public.appointment_crew crew
  WHERE crew.appointment_id = p_appointment_id;

  DELETE FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id;
END;
$function$;

ALTER FUNCTION public.delete_appointment(uuid, uuid, text)
  OWNER TO postgres;
REVOKE EXECUTE
  ON FUNCTION public.delete_appointment(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE
  ON FUNCTION public.delete_appointment(uuid, uuid, text)
  TO authenticated, service_role;
COMMENT ON FUNCTION public.delete_appointment(uuid, uuid, text)
  IS 'UPR appointment crew atomic save/audit repair v1: legacy-compatible actor-bound atomic appointment deletion';

CREATE OR REPLACE FUNCTION public.create_appointment_with_crew(
  p_title text,
  p_date date,
  p_job_id uuid DEFAULT NULL::uuid,
  p_kind text DEFAULT 'job'::text,
  p_time_start time without time zone
    DEFAULT NULL::time without time zone,
  p_time_end time without time zone
    DEFAULT NULL::time without time zone,
  p_type text DEFAULT 'mitigation'::text,
  p_status text DEFAULT 'scheduled'::text,
  p_notes text DEFAULT NULL::text,
  p_is_private boolean DEFAULT false,
  p_notify_client boolean DEFAULT true,
  p_crew jsonb DEFAULT '[]'::jsonb,
  p_task_ids uuid[] DEFAULT NULL::uuid[],
  p_task_templates jsonb DEFAULT '[]'::jsonb,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_is_trusted boolean :=
    public.is_trusted_appointment_command_caller();
  v_appointment public.appointments%ROWTYPE;
BEGIN
  IF v_is_trusted THEN
    IF p_actor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.employees employee
         WHERE employee.id = p_actor_id
           AND employee.is_active IS TRUE
           AND employee.is_external IS FALSE
           AND employee.role::text IS DISTINCT FROM 'crm_partner'
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: active internal appointment creator required'
        USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.set_config(
      'upr.appointment_crew_actor_id',
      p_actor_id::text,
      true
    );
  ELSE
    v_actor_id :=
      public.current_active_internal_appointment_employee();
    IF p_actor_id IS NOT NULL
       AND p_actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment creator does not match caller'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_actor_id :=
    public.current_attributed_appointment_crew_actor();
  IF v_actor_id IS NULL
     OR (
       NOT v_is_trusted
       AND NOT public.can_current_employee_create_appointment_command()
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: attributed active internal appointment creator required'
      USING ERRCODE = '42501';
  END IF;
  SELECT employee.role::text
  INTO v_actor_role
  FROM public.employees employee
  WHERE employee.id = v_actor_id;
  PERFORM pg_catalog.set_config(
    'upr.appointment_crew_actor_id',
    v_actor_id::text,
    true
  );

  IF NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL
     OR p_date IS NULL THEN
    RAISE EXCEPTION
      'create_appointment_with_crew: title and date are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_kind NOT IN ('job', 'event')
     OR (p_kind = 'job' AND p_job_id IS NULL)
     OR (p_kind = 'event' AND p_job_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'create_appointment_with_crew: invalid appointment kind/job shape'
      USING ERRCODE = '22023';
  END IF;

  IF p_job_id IS NOT NULL THEN
    PERFORM 1
    FROM public.jobs job
    WHERE job.id = p_job_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'create_appointment_with_crew: job not found'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_time_start IS NOT NULL
     AND p_time_end IS NOT NULL
     AND p_time_end <= p_time_start THEN
    RAISE EXCEPTION
      'create_appointment_with_crew: end time must follow start time'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(NULLIF(btrim(p_type), ''), 'mitigation')
       NOT IN (
         'monitoring',
         'mitigation',
         'inspection',
         'reconstruction',
         'estimate',
         'delivery',
         'mold_remediation',
         'content_cleaning',
         'other'
       )
     OR COALESCE(NULLIF(btrim(p_status), ''), 'scheduled')
       NOT IN (
         'scheduled',
         'en_route',
         'in_progress',
         'paused',
         'completed',
         'cancelled'
       ) THEN
    RAISE EXCEPTION
      'create_appointment_with_crew: invalid type or status'
      USING ERRCODE = '22023';
  END IF;

  IF p_is_private
     AND NOT v_is_trusted
     AND v_actor_role NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment privacy manager required'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(COALESCE(p_task_templates, '[]'::jsonb))
       <> 'array'
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         COALESCE(p_task_templates, '[]'::jsonb)
       ) template
       WHERE jsonb_typeof(template) IS DISTINCT FROM 'object'
          OR NULLIF(
            btrim(COALESCE(template ->> 'title', '')),
            ''
          ) IS NULL
     ) THEN
    RAISE EXCEPTION
      'create_appointment_with_crew: invalid task templates'
      USING ERRCODE = '22023';
  END IF;

  IF p_job_id IS NULL
     AND jsonb_array_length(
       COALESCE(p_task_templates, '[]'::jsonb)
     ) > 0 THEN
    RAISE EXCEPTION
      'create_appointment_with_crew: events cannot clone job tasks'
      USING ERRCODE = '22023';
  END IF;

  IF p_task_ids IS NOT NULL THEN
    PERFORM 1
    FROM public.job_tasks task
    WHERE task.id = ANY(p_task_ids)
    ORDER BY task.id
    FOR UPDATE;

    IF cardinality(p_task_ids) IS DISTINCT FROM (
      SELECT count(*)::integer
      FROM public.job_tasks task
      WHERE task.id = ANY(p_task_ids)
        AND task.job_id = p_job_id
        AND task.appointment_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'create_appointment_with_crew: task IDs must be unique, unassigned, and belong to the appointment job'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.appointments (
    job_id,
    title,
    date,
    time_start,
    time_end,
    type,
    status,
    notes,
    created_by,
    kind,
    is_private,
    notify_client
  )
  VALUES (
    p_job_id,
    btrim(p_title),
    p_date,
    p_time_start,
    p_time_end,
    COALESCE(
      NULLIF(btrim(p_type), ''),
      'mitigation'
    )::public.appointment_type,
    COALESCE(
      NULLIF(btrim(p_status), ''),
      'scheduled'
    )::public.appointment_status,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_actor_id,
    p_kind,
    p_is_private,
    p_notify_client
  )
  RETURNING *
  INTO v_appointment;

  PERFORM *
  FROM public.sync_appointment_crew(
    v_appointment.id,
    COALESCE(p_crew, '[]'::jsonb)
  );

  IF p_task_ids IS NOT NULL THEN
    PERFORM public.assign_tasks_to_appointment(
      v_appointment.id,
      p_task_ids
    );
  END IF;

  INSERT INTO public.job_tasks (
    job_id,
    appointment_id,
    title,
    phase_name,
    phase_color,
    is_completed
  )
  SELECT
    v_appointment.job_id,
    v_appointment.id,
    btrim(template ->> 'title'),
    NULLIF(btrim(COALESCE(template ->> 'phase_name', '')), ''),
    NULLIF(btrim(COALESCE(template ->> 'phase_color', '')), ''),
    false
  FROM jsonb_array_elements(
    COALESCE(p_task_templates, '[]'::jsonb)
  ) template;

  RETURN jsonb_build_object(
    'id', v_appointment.id,
    'job_id', v_appointment.job_id,
    'kind', v_appointment.kind,
    'date', v_appointment.date,
    'time_start', v_appointment.time_start,
    'time_end', v_appointment.time_end,
    'title', v_appointment.title,
    'status', v_appointment.status
  );
END;
$function$;

ALTER FUNCTION public.create_appointment_with_crew(
  text,
  date,
  uuid,
  text,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  boolean,
  boolean,
  jsonb,
  uuid[],
  jsonb,
  uuid
) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_appointment_with_crew(
  text,
  date,
  uuid,
  text,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  boolean,
  boolean,
  jsonb,
  uuid[],
  jsonb,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_crew(
  text,
  date,
  uuid,
  text,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  boolean,
  boolean,
  jsonb,
  uuid[],
  jsonb,
  uuid
) TO authenticated, service_role;
COMMENT ON FUNCTION public.create_appointment_with_crew(
  text,
  date,
  uuid,
  text,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  boolean,
  boolean,
  jsonb,
  uuid[],
  jsonb,
  uuid
) IS 'UPR appointment crew atomic save/audit repair v1: atomic appointment, crew, assigned-task, and cloned-task creation';

CREATE OR REPLACE FUNCTION public.update_appointment_with_crew(
  p_appointment_id uuid,
  p_date date DEFAULT NULL::date,
  p_time_start time without time zone
    DEFAULT NULL::time without time zone,
  p_time_end time without time zone
    DEFAULT NULL::time without time zone,
  p_title text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_crew jsonb DEFAULT NULL::jsonb,
  p_is_private boolean DEFAULT NULL::boolean,
  p_notify_client boolean DEFAULT NULL::boolean,
  p_task_ids uuid[] DEFAULT NULL::uuid[],
  p_set_time_start boolean DEFAULT false,
  p_set_time_end boolean DEFAULT false,
  p_set_notes boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_is_trusted boolean :=
    public.is_trusted_appointment_command_caller();
  v_existing public.appointments%ROWTYPE;
  v_result jsonb;
  v_has_core_change boolean;
  v_has_noncrew_intent boolean;
  v_can_access boolean := false;
  v_set_time_start boolean;
  v_set_time_end boolean;
  v_set_notes boolean;
  v_target_time_start time without time zone;
  v_target_time_end time without time zone;
  v_target_notes text;
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION
      'update_appointment_with_crew: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_is_trusted THEN
    IF p_actor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.employees employee
         WHERE employee.id = p_actor_id
           AND employee.is_active IS TRUE
           AND employee.is_external IS FALSE
           AND employee.role::text IS DISTINCT FROM 'crm_partner'
       ) THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: active internal appointment actor required'
        USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.set_config(
      'upr.appointment_crew_actor_id',
      p_actor_id::text,
      true
    );
  ELSE
    v_actor_id :=
      public.current_active_internal_appointment_employee();
    IF p_actor_id IS NOT NULL
       AND p_actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: appointment actor does not match caller'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_actor_id :=
    public.current_attributed_appointment_crew_actor();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: attributed active internal appointment actor required'
      USING ERRCODE = '42501';
  END IF;
  SELECT employee.role::text
  INTO v_actor_role
  FROM public.employees employee
  WHERE employee.id = v_actor_id;
  PERFORM pg_catalog.set_config(
    'upr.appointment_crew_actor_id',
    v_actor_id::text,
    true
  );

  SELECT appointment.*
  INTO v_existing
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'update_appointment_with_crew: appointment not found'
      USING ERRCODE = 'P0001';
  END IF;

  v_set_time_start :=
    COALESCE(p_set_time_start, false) OR p_time_start IS NOT NULL;
  v_set_time_end :=
    COALESCE(p_set_time_end, false) OR p_time_end IS NOT NULL;
  v_set_notes :=
    COALESCE(p_set_notes, false) OR p_notes IS NOT NULL;
  v_target_time_start := CASE
    WHEN v_set_time_start THEN p_time_start
    ELSE v_existing.time_start
  END;
  v_target_time_end := CASE
    WHEN v_set_time_end THEN p_time_end
    ELSE v_existing.time_end
  END;
  v_target_notes := CASE
    WHEN v_set_notes THEN
      NULLIF(btrim(COALESCE(p_notes, '')), '')
    ELSE v_existing.notes
  END;

  IF v_target_time_start IS NOT NULL
     AND v_target_time_end IS NOT NULL
     AND v_target_time_end <= v_target_time_start THEN
    RAISE EXCEPTION
      'update_appointment_with_crew: end time must follow start time'
      USING ERRCODE = '22023';
  END IF;

  v_has_core_change :=
    (p_date IS NOT NULL AND p_date IS DISTINCT FROM v_existing.date)
    OR v_target_time_start IS DISTINCT FROM v_existing.time_start
    OR v_target_time_end IS DISTINCT FROM v_existing.time_end
    OR (
      p_title IS NOT NULL
      AND p_title IS DISTINCT FROM v_existing.title
    )
    OR (
      p_type IS NOT NULL
      AND p_type IS DISTINCT FROM v_existing.type::text
    )
    OR (
      p_status IS NOT NULL
      AND p_status IS DISTINCT FROM v_existing.status::text
    )
    OR v_target_notes IS DISTINCT FROM v_existing.notes;

  v_has_noncrew_intent :=
    p_date IS NOT NULL
    OR v_set_time_start
    OR v_set_time_end
    OR p_title IS NOT NULL
    OR p_type IS NOT NULL
    OR p_status IS NOT NULL
    OR v_set_notes
    OR p_is_private IS NOT NULL
    OR p_notify_client IS NOT NULL
    OR p_task_ids IS NOT NULL;

  IF NOT v_is_trusted THEN
    v_can_access :=
      public.can_current_employee_access_appointment_command(
        p_appointment_id
      );
  END IF;

  IF NOT v_is_trusted
     AND v_has_noncrew_intent
     AND NOT public.can_current_employee_edit_appointment_command(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment mutation access required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_trusted
     AND NOT v_has_noncrew_intent
     AND p_crew IS NULL
     AND NOT v_can_access THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_private IS NOT NULL
     AND p_is_private IS DISTINCT FROM v_existing.is_private
     AND NOT v_is_trusted
     AND v_actor_role NOT IN ('admin', 'project_manager') THEN
    RAISE EXCEPTION
      'NOT_AUTHORIZED: appointment privacy manager required'
      USING ERRCODE = '42501';
  END IF;

  IF p_task_ids IS NOT NULL THEN
    PERFORM 1
    FROM public.job_tasks task
    WHERE task.id = ANY(p_task_ids)
    ORDER BY task.id
    FOR UPDATE;

    IF cardinality(p_task_ids) IS DISTINCT FROM (
      SELECT count(*)::integer
      FROM public.job_tasks task
      WHERE task.id = ANY(p_task_ids)
        AND task.job_id = v_existing.job_id
        AND (
          task.appointment_id IS NULL
          OR task.appointment_id = p_appointment_id
        )
    ) THEN
      RAISE EXCEPTION
        'update_appointment_with_crew: task IDs must be unique, unassigned/current, and belong to the appointment job'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Preserve the existing notify-before-reschedule ordering so downstream
  -- client-notification triggers see the checkbox chosen in this save.
  IF p_notify_client IS NOT NULL
     AND p_notify_client IS DISTINCT FROM v_existing.notify_client THEN
    UPDATE public.appointments
    SET notify_client = p_notify_client
    WHERE id = p_appointment_id;
  END IF;

  IF v_has_core_change THEN
    UPDATE public.appointments appointment
    SET
      date = COALESCE(p_date, appointment.date),
      time_start = v_target_time_start,
      time_end = v_target_time_end,
      title = COALESCE(p_title, appointment.title),
      type = COALESCE(
        p_type::public.appointment_type,
        appointment.type
      ),
      status = COALESCE(
        p_status::public.appointment_status,
        appointment.status
      ),
      notes = v_target_notes
    WHERE appointment.id = p_appointment_id
    RETURNING jsonb_build_object(
      'id', appointment.id,
      'date', appointment.date,
      'time_start', appointment.time_start,
      'time_end', appointment.time_end,
      'title', appointment.title,
      'status', appointment.status
    )
    INTO v_result;

    IF (v_result ->> 'date')::date
         IS DISTINCT FROM v_existing.date
       OR (v_result ->> 'time_start')::time
         IS DISTINCT FROM v_existing.time_start
       OR (v_result ->> 'time_end')::time
         IS DISTINCT FROM v_existing.time_end THEN
      INSERT INTO public.appointment_status_history (
        appointment_id,
        event_type,
        old_date,
        old_time_start,
        old_time_end,
        old_status,
        new_date,
        new_time_start,
        new_time_end,
        new_status,
        actor_id
      )
      VALUES (
        p_appointment_id,
        'rescheduled',
        v_existing.date,
        v_existing.time_start,
        v_existing.time_end,
        v_existing.status::text,
        (v_result ->> 'date')::date,
        (v_result ->> 'time_start')::time,
        (v_result ->> 'time_end')::time,
        v_result ->> 'status',
        v_actor_id
      );
    ELSIF (v_result ->> 'status')
      IS DISTINCT FROM v_existing.status::text THEN
      INSERT INTO public.appointment_status_history (
        appointment_id,
        event_type,
        old_status,
        new_status,
        actor_id
      )
      VALUES (
        p_appointment_id,
        CASE
          WHEN v_result ->> 'status' = 'cancelled'
            THEN 'cancelled'
          ELSE 'status_changed'
        END,
        v_existing.status::text,
        v_result ->> 'status',
        v_actor_id
      );
    END IF;
  ELSE
    v_result := jsonb_build_object(
      'id', v_existing.id,
      'date', v_existing.date,
      'time_start', v_existing.time_start,
      'time_end', v_existing.time_end,
      'title', v_existing.title,
      'status', v_existing.status
    );
  END IF;

  IF p_is_private IS NOT NULL
     AND p_is_private IS DISTINCT FROM v_existing.is_private THEN
    UPDATE public.appointments
    SET is_private = p_is_private
    WHERE id = p_appointment_id;
  END IF;

  IF p_crew IS NOT NULL THEN
    PERFORM *
    FROM public.sync_appointment_crew(
      p_appointment_id,
      p_crew
    );
  END IF;

  IF p_task_ids IS NOT NULL THEN
    PERFORM public.assign_tasks_to_appointment(
      p_appointment_id,
      p_task_ids
    );
  END IF;

  IF NOT v_is_trusted AND NOT v_can_access THEN
    RETURN jsonb_build_object(
      'id',
      p_appointment_id,
      'crew_changed',
      p_crew IS NOT NULL
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'is_private', COALESCE(p_is_private, v_existing.is_private),
    'notify_client', COALESCE(
      p_notify_client,
      v_existing.notify_client
    )
  );
END;
$function$;

ALTER FUNCTION public.update_appointment_with_crew(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  jsonb,
  boolean,
  boolean,
  uuid[],
  boolean,
  boolean,
  boolean,
  uuid
) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.update_appointment_with_crew(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  jsonb,
  boolean,
  boolean,
  uuid[],
  boolean,
  boolean,
  boolean,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_appointment_with_crew(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  jsonb,
  boolean,
  boolean,
  uuid[],
  boolean,
  boolean,
  boolean,
  uuid
) TO authenticated, service_role;
COMMENT ON FUNCTION public.update_appointment_with_crew(
  uuid,
  date,
  time without time zone,
  time without time zone,
  text,
  text,
  text,
  text,
  jsonb,
  boolean,
  boolean,
  uuid[],
  boolean,
  boolean,
  boolean,
  uuid
) IS 'UPR appointment crew atomic save/audit repair v1: atomic appointment, history, crew, privacy, preference, and task assignment update';

DO $postflight$
DECLARE
  v_sync_oid oid := to_regprocedure(
    'public.sync_appointment_crew(uuid,jsonb)'
  );
  v_service_sync_oid oid := to_regprocedure(
    'public.sync_appointment_crew(uuid,jsonb,uuid)'
  );
  v_create_oid oid := to_regprocedure(
    'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)'
  );
  v_update_oid oid := to_regprocedure(
    'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
  );
  v_legacy_update_oid oid := to_regprocedure(
    'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)'
  );
  v_assign_oid oid := to_regprocedure(
    'public.assign_tasks_to_appointment(uuid,uuid[])'
  );
  v_delete_oid oid := to_regprocedure(
    'public.delete_appointment(uuid,uuid,text)'
  );
BEGIN
  IF v_sync_oid IS NULL
     OR v_service_sync_oid IS NULL
     OR v_create_oid IS NULL
     OR v_update_oid IS NULL
     OR v_legacy_update_oid IS NULL
     OR v_assign_oid IS NULL
     OR v_delete_oid IS NULL
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         v_sync_oid,
         v_service_sync_oid,
         v_create_oid,
         v_update_oid,
         v_legacy_update_oid,
         v_assign_oid,
         v_delete_oid
       ]) function_oid
       JOIN pg_proc procedure
         ON procedure.oid = function_oid
       WHERE pg_get_userbyid(procedure.proowner) <> 'postgres'
          OR NOT procedure.prosecdef
          OR procedure.proconfig
             IS DISTINCT FROM ARRAY['search_path=""']::text[]
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         v_sync_oid,
         v_service_sync_oid,
         v_create_oid,
         v_update_oid,
         v_legacy_update_oid,
         v_assign_oid,
         v_delete_oid
       ]) function_oid
       JOIN pg_proc procedure
         ON procedure.oid = function_oid
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           procedure.proacl,
           acldefault('f', procedure.proowner)
         )
       ) acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_sync_oid, 'EXECUTE')
     OR has_function_privilege(
       'anon',
       v_service_sync_oid,
       'EXECUTE'
     )
     OR has_function_privilege('anon', v_create_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_update_oid, 'EXECUTE')
     OR has_function_privilege(
       'anon',
       v_legacy_update_oid,
       'EXECUTE'
     )
     OR has_function_privilege('anon', v_assign_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_delete_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       v_sync_oid,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       v_service_sync_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       v_create_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       v_update_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       v_legacy_update_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       v_assign_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       v_delete_oid,
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       v_sync_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_service_sync_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_create_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_update_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_legacy_update_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_assign_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_delete_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair RPC postflight failed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = v_sync_oid
      AND procedure.prosrc LIKE '%::public.crew_role AS role%'
      AND procedure.prosrc LIKE
        '%active internal appointment employee required%'
      AND procedure.prosrc LIKE
        '%existing.role IS DISTINCT FROM desired.role%'
  )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_service_sync_oid
         AND procedure.prosrc LIKE
           '%upr.appointment_crew_actor_id%'
         AND procedure.prosrc LIKE
           '%attributed service appointment actor required%'
         AND procedure.prosrc LIKE
           '%public.sync_appointment_crew(%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_create_oid
         AND procedure.prosrc LIKE
           '%FROM public.sync_appointment_crew(%'
         AND procedure.prosrc LIKE
           '%public.assign_tasks_to_appointment(%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_update_oid
         AND procedure.prosrc LIKE
           '%UPDATE public.appointments appointment%'
         AND procedure.prosrc LIKE '%v_has_noncrew_intent%'
         AND procedure.prosrc LIKE '%v_target_time_start%'
         AND procedure.prosrc LIKE '%v_target_notes%'
         AND procedure.prosrc LIKE
           '%FROM public.sync_appointment_crew(%'
         AND procedure.prosrc LIKE
           '%public.assign_tasks_to_appointment(%'
         AND procedure.prosrc LIKE
           '%NOT v_can_access%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_legacy_update_oid
         AND procedure.prosrc LIKE
           '%appointment actor does not match caller%'
         AND procedure.prosrc LIKE
           '%can_current_employee_edit_appointment_command(%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_assign_oid
         AND procedure.prosrc LIKE
           '%task IDs must be unique, unassigned/current%'
         AND procedure.prosrc LIKE
           '%can_current_employee_edit_appointment_command(%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_delete_oid
         AND procedure.prosrc LIKE
           '%appointment actor does not match caller%'
         AND procedure.prosrc LIKE
           '%DELETE FROM public.appointment_crew%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair source contract postflight failed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.oid = to_regprocedure(
      'public.can_current_employee_manage_appointment_crew(uuid)'
    )
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.proconfig = ARRAY['search_path=""']::text[]
      AND procedure.prosrc LIKE
        '%current_active_internal_appointment_employee()%'
  )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = to_regprocedure(
         'public.current_attributed_appointment_crew_actor()'
       )
         AND pg_get_userbyid(procedure.proowner) = 'postgres'
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=""']::text[]
         AND procedure.prosrc LIKE
           '%upr.appointment_crew_actor_id%'
         AND procedure.prosrc LIKE
           '%current_active_internal_appointment_employee()%'
     )
     OR has_function_privilege(
       'anon',
       'public.current_attributed_appointment_crew_actor()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.current_attributed_appointment_crew_actor()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.current_attributed_appointment_crew_actor()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair authority postflight failed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid = 'public.appointments'::regclass
      AND trigger_record.tgname =
        'trg_appointments_atomic_command_guard'
      AND trigger_record.tgenabled = 'O'
      AND trigger_record.tgfoid = to_regprocedure(
        'public.guard_appointment_command_write()'
      )
      AND NOT trigger_record.tgisinternal
  )
     OR has_function_privilege(
       'anon',
       'public.guard_appointment_command_write()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.guard_appointment_command_write()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.guard_appointment_command_write()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair appointment guard postflight failed'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid = 'public.appointment_crew'::regclass
      AND trigger_record.tgname = 'trg_appointment_crew_actor_audit'
      AND trigger_record.tgenabled = 'O'
      AND trigger_record.tgfoid = to_regprocedure(
        'public.audit_appointment_crew_change()'
      )
      AND NOT trigger_record.tgisinternal
  )
     OR has_function_privilege(
       'anon',
       'public.audit_appointment_crew_change()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.audit_appointment_crew_change()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.audit_appointment_crew_change()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair audit postflight failed'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'appointment_crew'
      AND policy.roles = ARRAY['authenticated'::name]
      AND (
        COALESCE(policy.qual, '') LIKE
          '%can_current_employee_manage_appointment_crew%'
        OR COALESCE(policy.with_check, '') LIKE
          '%can_current_employee_manage_appointment_crew%'
      )
  ) IS DISTINCT FROM 4
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class table_record
       WHERE table_record.oid =
         'public.appointment_crew'::regclass
         AND table_record.relrowsecurity
     )
     OR has_table_privilege(
       'anon',
       'public.appointment_crew',
       'SELECT'
     )
     OR has_table_privilege(
       'anon',
       'public.appointment_crew',
       'INSERT'
     )
     OR has_table_privilege(
       'anon',
       'public.appointment_crew',
       'UPDATE'
     )
     OR has_table_privilege(
       'anon',
       'public.appointment_crew',
       'DELETE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'UPDATE'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'DELETE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'TRUNCATE'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.appointment_crew',
       'SELECT'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointment_crew',
       'INSERT'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointment_crew',
       'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointment_crew',
       'DELETE'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointment_crew',
       'TRUNCATE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       CROSS JOIN (
         VALUES ('anon'), ('service_role')
       ) AS role_record(role_name)
       CROSS JOIN (
         VALUES ('INSERT'), ('UPDATE')
       ) AS privilege_record(privilege_name)
       WHERE column_record.attrelid =
         'public.appointment_crew'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND has_column_privilege(
           role_record.role_name,
           column_record.attrelid,
           column_record.attnum,
           privilege_record.privilege_name
         )
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair policy/ACL postflight failed'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'appointments'
      AND policy.roles = ARRAY['authenticated'::name]
      AND (
        COALESCE(policy.qual, '') LIKE
          '%can_current_employee_%appointment_command%'
        OR COALESCE(policy.with_check, '') LIKE
          '%can_current_employee_%appointment_command%'
        OR COALESCE(policy.qual, '') LIKE
          '%can_current_employee_access_appointment_row%'
      )
  ) IS DISTINCT FROM 4
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class table_record
       WHERE table_record.oid = 'public.appointments'::regclass
         AND table_record.relrowsecurity
     )
     OR has_table_privilege(
       'anon',
       'public.appointments',
       'SELECT'
     )
     OR has_table_privilege(
       'anon',
       'public.appointments',
       'INSERT'
     )
     OR has_table_privilege(
       'anon',
       'public.appointments',
       'UPDATE'
     )
     OR has_table_privilege(
       'anon',
       'public.appointments',
       'DELETE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       CROSS JOIN (
         VALUES
           ('anon', 'INSERT'),
           ('anon', 'UPDATE'),
           ('service_role', 'INSERT')
       ) AS privilege_record(role_name, privilege_name)
       WHERE column_record.attrelid =
         'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND has_column_privilege(
           privilege_record.role_name,
           column_record.attrelid,
           column_record.attnum,
           privilege_record.privilege_name
         )
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointments',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointments',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointments',
       'UPDATE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND column_record.attname IN (
           'id',
           'job_id',
           'kind',
           'created_by',
           'created_by_employee_id',
           'created_at'
         )
         AND has_column_privilege(
           'authenticated',
           column_record.attrelid,
           column_record.attnum,
           'UPDATE'
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND column_record.attname NOT IN (
           'id',
           'job_id',
           'kind',
           'created_by',
           'created_by_employee_id',
           'created_at'
         )
         AND NOT has_column_privilege(
           'authenticated',
           column_record.attrelid,
           column_record.attnum,
           'UPDATE'
         )
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointments',
       'DELETE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointments',
       'TRUNCATE'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.appointments',
       'SELECT'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'UPDATE'
     )
     OR NOT has_column_privilege(
       'service_role',
       'public.appointments',
       'client_notified_at',
       'UPDATE'
     )
     OR NOT has_column_privilege(
       'service_role',
       'public.appointments',
       'client_time_sig',
       'UPDATE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       WHERE column_record.attrelid = 'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND column_record.attname NOT IN (
           'client_notified_at',
           'client_time_sig'
         )
         AND has_column_privilege(
           'service_role',
           column_record.attrelid,
           column_record.attnum,
           'UPDATE'
         )
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'INSERT'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'DELETE'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.system_events',
       'UPDATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.system_events',
       'DELETE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.system_events',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.system_events',
       'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.system_events',
       'DELETE'
     )
     OR has_table_privilege(
       'service_role',
       'public.system_events',
       'TRUNCATE'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair appointment/audit ACL postflight failed'
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

DO $merge_jobs_postflight$
DECLARE
  v_merge_oid oid := to_regprocedure(
    'public.merge_jobs(uuid,uuid)'
  );
BEGIN
  IF v_merge_oid IS NULL
     OR NOT has_function_privilege(
       'authenticated',
       v_merge_oid,
       'EXECUTE'
     )
     OR has_function_privilege('anon', v_merge_oid, 'EXECUTE')
     OR has_function_privilege(
       'service_role',
       v_merge_oid,
       'EXECUTE'
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
       WHERE procedure.oid = v_merge_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_merge_oid
         AND pg_get_userbyid(procedure.proowner) = 'postgres'
         AND procedure.prosecdef
         AND procedure.proconfig =
           ARRAY['search_path=""']::text[]
         AND procedure.prosrc LIKE
           '%active internal admin required to merge jobs%'
         AND procedure.prosrc LIKE
           '%UPDATE public.appointments SET job_id = p_keep_id%'
         AND procedure.prosrc LIKE
           '%v_appointments_moved%'
         AND procedure.prosrc LIKE
           '%actor_id%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic repair merge_jobs postflight failed'
      USING ERRCODE = '55000';
  END IF;
END;
$merge_jobs_postflight$;
