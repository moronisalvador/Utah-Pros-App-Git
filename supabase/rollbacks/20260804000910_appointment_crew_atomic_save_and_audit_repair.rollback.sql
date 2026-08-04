-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260804000910_appointment_crew_atomic_save_and_audit_repair
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Pauses appointment/crew command writes if the forward successor must be
--   withdrawn. It deliberately keeps its safer enum conversion, all-internal
--   read policy, audit trigger, and accumulated activity history.
--
-- RECOVERY POSTURE:
--   Fail closed. Appointments and crew remain readable to authorized internal
--   employees, but direct appointment/crew writes and all eight deployed
--   command entry points remain unavailable until the exact reviewed forward
--   is reapplied.
-- ═══════════════════════════════════════════════════════════════════════════

DO $preflight$
BEGIN
  IF to_regprocedure(
       'public.sync_appointment_crew(uuid,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.sync_appointment_crew(uuid,jsonb,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.assign_tasks_to_appointment(uuid,uuid[])'
     ) IS NULL
     OR to_regprocedure(
       'public.delete_appointment(uuid,uuid,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.merge_jobs(uuid,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.can_current_employee_manage_appointment_crew(uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.audit_appointment_crew_change()'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid =
         'public.appointment_crew'::regclass
         AND trigger_record.tgname =
           'trg_appointment_crew_actor_audit'
         AND trigger_record.tgenabled = 'O'
         AND trigger_record.tgfoid = to_regprocedure(
           'public.audit_appointment_crew_change()'
         )
         AND NOT trigger_record.tgisinternal
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         to_regprocedure(
           'public.sync_appointment_crew(uuid,jsonb)'
         ),
         to_regprocedure(
           'public.sync_appointment_crew(uuid,jsonb,uuid)'
         ),
         to_regprocedure(
           'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)'
         ),
         to_regprocedure(
           'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
         ),
         to_regprocedure(
           'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)'
         ),
         to_regprocedure(
           'public.assign_tasks_to_appointment(uuid,uuid[])'
         ),
         to_regprocedure(
           'public.delete_appointment(uuid,uuid,text)'
         ),
         to_regprocedure(
           'public.merge_jobs(uuid,uuid)'
         )
       ]) function_oid
       JOIN pg_proc procedure
         ON procedure.oid = function_oid
       WHERE COALESCE(
         obj_description(procedure.oid, 'pg_proc'),
         ''
       ) NOT LIKE
         'UPR appointment crew atomic save/audit repair v1:%'
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic recovery refused: reviewed forward state absent'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointment_crew
  FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointments
  FROM authenticated, service_role;
-- A table-level REVOKE leaves independently granted column privileges intact.
-- Enumerate every current appointment column so recovery always closes all
-- browser/service write paths, including grants added after this source shipped.
DO $revoke_appointment_column_write_privileges$
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
      'appointment crew atomic recovery could not enumerate appointment columns'
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
$revoke_appointment_column_write_privileges$;

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
      'appointment crew atomic recovery could not enumerate crew columns'
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

REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(
  uuid,
  jsonb,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
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
REVOKE EXECUTE
  ON FUNCTION public.assign_tasks_to_appointment(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE
  ON FUNCTION public.delete_appointment(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE
  ON FUNCTION public.merge_jobs(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.sync_appointment_crew(uuid, jsonb)
  IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
COMMENT ON FUNCTION public.sync_appointment_crew(uuid, jsonb, uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
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
) IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
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
) IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
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
) IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
COMMENT ON FUNCTION
  public.assign_tasks_to_appointment(uuid, uuid[])
  IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
COMMENT ON FUNCTION public.delete_appointment(uuid, uuid, text)
  IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';
COMMENT ON FUNCTION public.merge_jobs(uuid, uuid)
  IS 'UPR appointment crew atomic save/audit repair v1: recovery-paused; reapply reviewed forward';

DO $postflight$
BEGIN
  IF has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'UPDATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointment_crew',
       'DELETE'
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
       'authenticated',
       'public.appointments',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointments',
       'UPDATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointments',
       'DELETE'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'INSERT'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.appointments',
       'DELETE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       CROSS JOIN (
         VALUES ('anon'), ('authenticated'), ('service_role')
       ) AS role_record(role_name)
       CROSS JOIN (
         VALUES ('INSERT'), ('UPDATE')
       ) AS privilege_record(privilege_name)
       WHERE column_record.attrelid =
         'public.appointments'::regclass
         AND column_record.attnum > 0
         AND NOT column_record.attisdropped
         AND has_column_privilege(
           role_record.role_name,
           column_record.attrelid,
           column_record.attnum,
           privilege_record.privilege_name
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute column_record
       CROSS JOIN (
         VALUES ('anon'), ('authenticated'), ('service_role')
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
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         to_regprocedure(
           'public.sync_appointment_crew(uuid,jsonb)'
         ),
         to_regprocedure(
           'public.sync_appointment_crew(uuid,jsonb,uuid)'
         ),
         to_regprocedure(
           'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)'
         ),
         to_regprocedure(
           'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
         ),
         to_regprocedure(
           'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)'
         ),
         to_regprocedure(
           'public.assign_tasks_to_appointment(uuid,uuid[])'
         ),
         to_regprocedure(
           'public.delete_appointment(uuid,uuid,text)'
         ),
         to_regprocedure(
           'public.merge_jobs(uuid,uuid)'
         )
       ]) function_oid
       WHERE has_function_privilege(
         'authenticated',
         function_oid,
         'EXECUTE'
       )
          OR has_function_privilege(
            'service_role',
            function_oid,
            'EXECUTE'
          )
          OR has_function_privilege(
            'anon',
            function_oid,
            'EXECUTE'
          )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid =
         'public.appointment_crew'::regclass
         AND trigger_record.tgname =
           'trg_appointment_crew_actor_audit'
         AND trigger_record.tgenabled = 'O'
         AND NOT trigger_record.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'appointment crew atomic recovery postflight failed'
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;
