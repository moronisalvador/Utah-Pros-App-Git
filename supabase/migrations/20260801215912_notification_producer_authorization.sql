-- ════════════════════════════════════════════════
-- MIGRATION: 20260801215912_notification_producer_authorization
-- Phase: Mobile readiness — notification producer authorization
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Repairs the five contained appointment/timesheet notification producers
--   without enabling them. Browser writes now require a mapped active internal
--   employee, supplied actor ids are bound to auth.uid(), crew replacement is
--   diff-based, timesheet retries/reviews are serialized, and each real event
--   receives one durable occurrence id. Bell/Web Push/email delivery gains the
--   same stable-claim posture already used by native APNs.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive private tables/column plus compatible function, policy, trigger,
--   and grant replacements; no table/column drop or rename and no flag enable.
--
-- DEPENDS ON:
--   Tables: appointments, appointment_crew, employees, notification_types,
--           integration_config, job_time_entries, time_entry_change_requests
--   Functions: notify_emit(text,jsonb), admin_upsert_time_entry(...),
--              update_appointment(...), sync_appointment_crew(...)
--
-- CONTRACTS PRESERVED:
--   - All deployed RPC signatures and return shapes remain unchanged.
--   - notify_emit(text,jsonb) keeps its service-only ACL, exact two-origin URL
--     allowlist, blank-secret refusal, pg_net transport, and void return.
--   - All five notification catalog flags remain disabled.
--   - Existing direct appointment create/edit callers remain compatible during
--     the code-first/schema-second window.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260801215912_notification_producer_authorization.rollback.sql
--   Recovery is fail-closed: it disables the five flags and preserves the
--   authorization boundary and retained occurrence evidence.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_required constant text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ]::text[];
  v_missing text[];
  v_enabled text[];
  v_notify_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_notify_source_hash text;
BEGIN
  SELECT array_agg(required.type_key ORDER BY required.type_key)
    INTO v_missing
  FROM unnest(v_required) AS required(type_key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notification_types catalog
    WHERE catalog.type_key = required.type_key
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'notification producer authorization preflight missing catalog keys: %',
      v_missing
      USING ERRCODE = '55000';
  END IF;

  SELECT array_agg(catalog.type_key ORDER BY catalog.type_key)
    INTO v_enabled
  FROM public.notification_types catalog
  WHERE catalog.type_key = ANY (v_required)
    AND catalog.enabled IS TRUE;

  IF v_enabled IS NOT NULL THEN
    RAISE EXCEPTION
      'notification producer authorization requires all five flags disabled: %',
      v_enabled
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.notification_producer_occurrences') IS NOT NULL
     OR to_regclass('public.notification_delivery_claims') IS NOT NULL
     OR to_regprocedure(
       'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'appointments'
         AND column_record.column_name = 'created_by_employee_id'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization preflight found unexpected prior candidate state'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.notify_emit(text,jsonb)') IS NULL
     OR to_regclass('public.native_push_delivery_claims') IS NULL
     OR to_regclass('public.push_subscriptions') IS NULL
     OR to_regprocedure(
       'public.claim_native_push_delivery(uuid,uuid,uuid,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.delete_appointment(uuid,uuid,text)'
     ) IS NULL
     OR to_regprocedure('public.sync_appointment_crew(uuid,jsonb)') IS NULL
     OR to_regprocedure(
       'public.submit_time_entry_change_request(uuid,jsonb,text,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.review_time_entry_change_request(uuid,boolean,uuid,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'notification producer authorization preflight found deployed RPC signature drift'
      USING ERRCODE = '55000';
  END IF;

  SELECT md5(function_record.prosrc)
    INTO v_notify_source_hash
  FROM pg_proc function_record
  WHERE function_record.oid = v_notify_oid;

  IF v_notify_oid IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc function_record
       JOIN pg_namespace namespace_record
         ON namespace_record.oid = function_record.pronamespace
       WHERE namespace_record.nspname = 'public'
         AND function_record.proname = 'notify_emit'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc function_record
       WHERE function_record.oid = v_notify_oid
         AND pg_get_userbyid(function_record.proowner) = 'postgres'
         AND function_record.prosecdef
         AND function_record.proconfig =
           ARRAY['search_path=public']::text[]
         AND md5(function_record.prosrc) =
           'c72e0f7fd40a4abec42cce1cd912a45b'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization notify_emit predecessor drift (md5 %)',
      v_notify_source_hash
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl
       WHERE function_record.oid = v_notify_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_notify_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       v_notify_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_notify_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization notify_emit execute-grant drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'time_entry_change_requests'
      AND indexname = 'uq_change_request_one_pending_per_entry'
      AND indexdef ILIKE '%UNIQUE INDEX%'
      AND indexdef ILIKE '%WHERE (status = ''pending''%'
  ) THEN
    RAISE EXCEPTION
      'notification producer authorization requires the one-pending-request index'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN ('appointments', 'appointment_crew')
  ) <> 8
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
        (
          'appointments',
          'all_select_appointments',
          'SELECT',
          ARRAY['anon'::name, 'authenticated'::name]
        ),
        (
          'appointments',
          'all_insert_appointments',
          'INSERT',
          ARRAY['anon'::name, 'authenticated'::name]
        ),
        (
          'appointments',
          'all_update_appointments',
          'UPDATE',
          ARRAY['anon'::name, 'authenticated'::name]
        ),
        (
          'appointments',
          'all_delete_appointments',
          'DELETE',
          ARRAY['anon'::name, 'authenticated'::name]
        ),
        (
          'appointment_crew',
          'all_select_appointment_crew',
          'SELECT',
          ARRAY['authenticated'::name]
        ),
        (
          'appointment_crew',
          'all_insert_appointment_crew',
          'INSERT',
          ARRAY['authenticated'::name]
        ),
        (
          'appointment_crew',
          'all_update_appointment_crew',
          'UPDATE',
          ARRAY['authenticated'::name]
        ),
        (
          'appointment_crew',
          'all_delete_appointment_crew',
          'DELETE',
          ARRAY['authenticated'::name]
        )
    ) AS expected(tablename, policyname, command, roles)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.tablename
        AND policy.policyname = expected.policyname
        AND policy.cmd = expected.command
        AND policy.permissive = 'PERMISSIVE'
        AND policy.roles = expected.roles
    )
  ) THEN
    RAISE EXCEPTION
      'notification producer authorization preflight found appointment policy drift'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'time_entry_change_requests'
  ) <> 1
     OR NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'time_entry_change_requests'
      AND policy.policyname = 'tecr_read'
      AND policy.cmd = 'SELECT'
      AND policy.permissive = 'PERMISSIVE'
      AND policy.roles = ARRAY['authenticated'::name]
  ) THEN
    RAISE EXCEPTION
      'notification producer authorization preflight found timesheet read policy drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'public.appointments'::regclass,
          'trg_enforce_private_appointment',
          'public.enforce_private_appointment_role()'::regprocedure,
          23::smallint
        ),
        (
          'public.appointments'::regclass,
          'trg_appointment_notify',
          'public.trg_appt_notify()'::regprocedure,
          17::smallint
        ),
        (
          'public.appointment_crew'::regclass,
          'trg_appointment_crew_notify',
          'public.trg_appt_crew_notify()'::regprocedure,
          5::smallint
        )
    ) AS expected(relation_id, trigger_name, function_id, trigger_type)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger
      WHERE trigger.tgrelid = expected.relation_id
        AND trigger.tgname = expected.trigger_name
        AND trigger.tgfoid = expected.function_id
        AND trigger.tgtype = expected.trigger_type
        AND trigger.tgenabled IN ('O', 'A')
        AND trigger.tgqual IS NULL
        AND trigger.tgattr = ''::int2vector
        AND trigger.tgnargs = 0
        AND NOT trigger.tgisinternal
    )
  ) THEN
    RAISE EXCEPTION
      'notification producer authorization requires exact enabled appointment triggers'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger trigger
    WHERE trigger.tgrelid IN (
      'public.appointments'::regclass,
      'public.appointment_crew'::regclass
    )
      AND trigger.tgname IN (
        'trg_appointments_notification_producer_authority',
        'trg_appointment_crew_notification_producer_authority',
        'trg_appointments_bind_creator'
      )
      AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'notification producer authorization preflight found prior guard triggers'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- ─── 1. Actor identity and direct-table authorization ──────────────────────

ALTER TABLE public.appointments
  ADD COLUMN created_by_employee_id uuid
  REFERENCES public.employees(id)
  ON DELETE SET NULL;

CREATE INDEX appointments_created_by_employee_id_idx
  ON public.appointments(created_by_employee_id)
  WHERE created_by_employee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_current_notification_producer_actor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.auth_user_id = (SELECT auth.uid())
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
  );
$function$;

ALTER FUNCTION public.is_current_notification_producer_actor()
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_current_notification_producer_actor()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_notification_producer_actor()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.can_current_employee_read_time_entry_change_request(
  p_requested_by uuid
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
    WHERE employee.auth_user_id = (SELECT auth.uid())
      AND employee.is_active IS TRUE
      AND employee.is_external IS FALSE
      AND (
        employee.id = p_requested_by
        OR employee.role::text IN (
          'admin',
          'office',
          'project_manager',
          'supervisor'
        )
      )
  );
$function$;

ALTER FUNCTION public.can_current_employee_read_time_entry_change_request(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.can_current_employee_read_time_entry_change_request(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_current_employee_read_time_entry_change_request(uuid)
  TO authenticated, service_role;

ALTER TABLE public.time_entry_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.time_entry_change_requests FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.time_entry_change_requests
  FROM authenticated;
GRANT SELECT ON TABLE public.time_entry_change_requests TO authenticated;

ALTER POLICY tecr_read
  ON public.time_entry_change_requests
  TO authenticated
  USING (
    (
      SELECT public.can_current_employee_read_time_entry_change_request(
        requested_by
      )
    )
  );

CREATE OR REPLACE FUNCTION public.is_current_appointment_creator(
  p_employee_id uuid
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
    WHERE employee.id = p_employee_id
      AND employee.auth_user_id = (SELECT auth.uid())
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
  );
$function$;

ALTER FUNCTION public.is_current_appointment_creator(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_current_appointment_creator(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_appointment_creator(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bind_appointment_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_request_role text := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(current_setting('request.jwt.claim.role', true), '')
  );
BEGIN
  IF v_request_role = 'service_role'
     OR (
       v_request_role IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RETURN NEW;
  END IF;

  SELECT employee.id
    INTO v_actor_id
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
    );

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: active internal appointment creator required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by_employee_id IS NOT NULL
       AND NEW.created_by_employee_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: appointment creator does not match caller'
        USING ERRCODE = '42501';
    END IF;
    NEW.created_by_employee_id := v_actor_id;
  ELSIF NEW.created_by_employee_id IS DISTINCT FROM OLD.created_by_employee_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: appointment creator is immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.bind_appointment_creator()
  OWNER TO postgres;
-- Trigger-only owner binding; no role receives direct execution.
REVOKE EXECUTE ON FUNCTION public.bind_appointment_creator()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_appointments_bind_creator
  BEFORE INSERT OR UPDATE
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_appointment_creator();

CREATE OR REPLACE FUNCTION public.can_current_employee_access_appointment(
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
    WHERE employee.auth_user_id = (SELECT auth.uid())
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

ALTER FUNCTION public.can_current_employee_access_appointment(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.can_current_employee_access_appointment(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_current_employee_access_appointment(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.can_current_employee_mutate_appointment(
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
    WHERE employee.auth_user_id = (SELECT auth.uid())
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
          AND appointment.created_by_employee_id = employee.id
        )
      )
  );
$function$;

ALTER FUNCTION public.can_current_employee_mutate_appointment(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.can_current_employee_mutate_appointment(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_current_employee_mutate_appointment(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_current_appointment_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.auth_user_id = (SELECT auth.uid())
      AND employee.is_active IS TRUE
      AND employee.is_external IS FALSE
      AND employee.role::text IN ('admin', 'project_manager')
  );
$function$;

ALTER FUNCTION public.is_current_appointment_manager()
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_current_appointment_manager()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_appointment_manager()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.can_current_employee_manage_appointment_crew(
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
    WHERE employee.auth_user_id = (SELECT auth.uid())
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
      AND (
        (
          employee.role::text IN (
            'admin',
            'office',
            'project_manager',
            'supervisor'
          )
          AND appointment.is_private IS FALSE
        )
        OR (
          employee.role::text IN ('field_tech', 'estimator')
          AND appointment.is_private IS FALSE
          AND (
            appointment.created_by_employee_id = employee.id
            OR EXISTS (
              SELECT 1
              FROM public.appointment_crew crew
              WHERE crew.appointment_id = appointment.id
                AND crew.employee_id = employee.id
            )
          )
        )
        OR employee.role::text IN ('admin', 'project_manager')
      )
  );
$function$;

ALTER FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_current_employee_manage_appointment_crew(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_private_appointment_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (
       TG_OP = 'INSERT'
       AND NEW.is_private
     )
     OR (
       TG_OP = 'UPDATE'
       AND OLD.is_private IS DISTINCT FROM NEW.is_private
     )
  THEN
    IF NOT public.is_current_appointment_manager() THEN
      RAISE EXCEPTION
        'NOT_AUTHORIZED: only active internal admins or project managers may change appointment privacy'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_private_appointment_role()
  OWNER TO postgres;
-- Trigger-only privacy elevation guard; no role receives direct execution.
REVOKE EXECUTE ON FUNCTION public.enforce_private_appointment_role()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_trusted_notification_producer_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    COALESCE(request_context.request_role = 'service_role', false)
    OR (
      request_context.request_role IS NULL
      AND session_user IN ('postgres', 'supabase_admin')
    )
  FROM (
    SELECT COALESCE(
      NULLIF(auth.jwt() ->> 'role', ''),
      NULLIF(current_setting('request.jwt.claim.role', true), '')
    ) AS request_role
  ) request_context;
$function$;

ALTER FUNCTION public.is_trusted_notification_producer_caller()
  OWNER TO postgres;
-- Internal RPC branch discriminator; no role receives direct execution.
REVOKE EXECUTE ON FUNCTION public.is_trusted_notification_producer_caller()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_notification_producer_actor(
  p_supplied_actor_id uuid DEFAULT NULL,
  p_require_time_admin boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor public.employees%ROWTYPE;
  v_request_role text := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(current_setting('request.jwt.claim.role', true), '')
  );
BEGIN
  -- Trusted service/database callers have no human auth.uid(). When they supply
  -- an actor for audit compatibility, it must still name an active internal
  -- employee with the required role.
  IF v_request_role = 'service_role'
     OR (
       v_request_role IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    IF p_supplied_actor_id IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT employee.*
      INTO v_actor
    FROM public.employees employee
    WHERE employee.id = p_supplied_actor_id
      AND employee.is_active IS TRUE
      AND employee.is_external IS FALSE;

    IF v_actor.id IS NULL
       OR (
         p_require_time_admin
         AND v_actor.role::text NOT IN (
           'admin',
           'office',
           'project_manager',
           'supervisor'
         )
       ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: active internal employee required'
        USING ERRCODE = '42501';
    END IF;

    RETURN v_actor.id;
  END IF;

  SELECT employee.*
    INTO v_actor
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
    );

  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: active internal employee required'
      USING ERRCODE = '42501';
  END IF;

  IF p_supplied_actor_id IS NOT NULL
     AND p_supplied_actor_id IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: actor does not match authenticated employee'
      USING ERRCODE = '42501';
  END IF;

  IF p_require_time_admin
     AND v_actor.role::text NOT IN (
       'admin',
       'office',
       'project_manager',
       'supervisor'
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: time administrator required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_actor.id;
END;
$function$;

ALTER FUNCTION public.require_notification_producer_actor(uuid, boolean)
  OWNER TO postgres;
-- Internal authorization helper only; deployed RPCs call it as their owner.
REVOKE EXECUTE ON FUNCTION public.require_notification_producer_actor(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_notification_producer_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request_role text := COALESCE(
    NULLIF(auth.jwt() ->> 'role', ''),
    NULLIF(current_setting('request.jwt.claim.role', true), '')
  );
BEGIN
  IF TG_TABLE_NAME = 'appointment_crew' THEN
    IF TG_OP IN ('INSERT', 'UPDATE')
       AND NOT EXISTS (
         SELECT 1
         FROM public.employees employee
         WHERE employee.id = NEW.employee_id
           AND employee.is_active IS TRUE
           AND employee.is_external IS FALSE
       ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: active internal appointment crew required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_request_role = 'service_role'
     OR (
       v_request_role IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    RETURN NEW;
  END IF;

  IF NOT public.is_current_notification_producer_actor() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: active internal appointment employee required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'appointment_crew' THEN
    IF TG_OP = 'UPDATE'
       AND (
         NEW.id IS DISTINCT FROM OLD.id
         OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
         OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: appointment crew identity is immutable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.assert_notification_producer_write()
  OWNER TO postgres;
-- Trigger-only guard; no role receives direct execution.
REVOKE EXECUTE ON FUNCTION public.assert_notification_producer_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_appointments_notification_producer_authority
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_notification_producer_write();

CREATE TRIGGER trg_appointment_crew_notification_producer_authority
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.appointment_crew
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_notification_producer_write();

ALTER POLICY all_select_appointments
  ON public.appointments
  TO authenticated
  USING (
    (SELECT public.can_current_employee_access_appointment(id))
  );
ALTER POLICY all_insert_appointments
  ON public.appointments
  TO authenticated
  WITH CHECK (
    (SELECT public.is_current_notification_producer_actor())
    AND (
      SELECT public.is_current_appointment_creator(
        created_by_employee_id
      )
    )
    AND (
      is_private IS FALSE
      OR (SELECT public.is_current_appointment_manager())
    )
  );
ALTER POLICY all_update_appointments
  ON public.appointments
  TO authenticated
  USING (
    (SELECT public.can_current_employee_mutate_appointment(id))
  )
  WITH CHECK (
    (SELECT public.can_current_employee_mutate_appointment(id))
    AND (
      is_private IS FALSE
      OR (SELECT public.is_current_appointment_manager())
    )
  );
ALTER POLICY all_delete_appointments
  ON public.appointments
  TO authenticated
  USING (
    (SELECT public.can_current_employee_mutate_appointment(id))
  );

ALTER POLICY all_select_appointment_crew
  ON public.appointment_crew
  TO authenticated
  USING (
    (SELECT public.can_current_employee_access_appointment(appointment_id))
  );
ALTER POLICY all_insert_appointment_crew
  ON public.appointment_crew
  TO authenticated
  WITH CHECK (
    (SELECT public.can_current_employee_manage_appointment_crew(appointment_id))
  );
ALTER POLICY all_update_appointment_crew
  ON public.appointment_crew
  TO authenticated
  USING (
    (SELECT public.can_current_employee_manage_appointment_crew(appointment_id))
  )
  WITH CHECK (
    (SELECT public.can_current_employee_manage_appointment_crew(appointment_id))
  );
ALTER POLICY all_delete_appointment_crew
  ON public.appointment_crew
  TO authenticated
  USING (
    (SELECT public.can_current_employee_manage_appointment_crew(appointment_id))
  );

REVOKE ALL PRIVILEGES ON TABLE public.appointments
  FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON TABLE public.appointment_crew
  FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.appointments
  FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.appointment_crew
  FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointments
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointment_crew
  TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.appointments
  TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.appointment_crew
  TO service_role;

-- ─── 2. Durable producer occurrences and per-channel delivery claims ───────

CREATE TABLE public.notification_producer_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key text NOT NULL
    REFERENCES public.notification_types(type_key),
  occurrence_key text NOT NULL UNIQUE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_producer_occurrences_type_check
    CHECK (
      type_key IN (
        'appointment.assigned',
        'appointment.updated',
        'appointment.canceled',
        'timesheet.change_requested',
        'timesheet.change_reviewed'
      )
    ),
  CONSTRAINT notification_producer_occurrences_key_check
    CHECK (char_length(occurrence_key) BETWEEN 1 AND 300)
);

CREATE INDEX notification_producer_occurrences_created_at_idx
  ON public.notification_producer_occurrences(created_at);

ALTER TABLE public.notification_producer_occurrences
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_producer_occurrences
  FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_producer_occurrences_service_role
  ON public.notification_producer_occurrences
  FOR SELECT
  TO service_role
  USING (true);
REVOKE ALL PRIVILEGES ON TABLE public.notification_producer_occurrences
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_producer_occurrences
  TO service_role;

CREATE TABLE public.notification_delivery_claims (
  delivery_key uuid PRIMARY KEY,
  notification_event_id uuid NOT NULL
    REFERENCES public.notification_producer_occurrences(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  channel text NOT NULL,
  target_fingerprint uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_delivery_claims_channel_check
    CHECK (channel IN ('bell', 'pwa_push', 'email')),
  CONSTRAINT notification_delivery_claims_type_check
    CHECK (
      type_key IN (
        'appointment.assigned',
        'appointment.updated',
        'appointment.canceled',
        'timesheet.change_requested',
        'timesheet.change_reviewed'
      )
    )
);

CREATE INDEX notification_delivery_claims_claimed_at_idx
  ON public.notification_delivery_claims(claimed_at);

ALTER TABLE public.notification_delivery_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_claims
  FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_delivery_claims_service_role
  ON public.notification_delivery_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL PRIVILEGES ON TABLE public.notification_delivery_claims
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.notification_delivery_claims
  TO service_role;

CREATE OR REPLACE FUNCTION public.validate_notification_producer_delivery(
  p_notification_event_id uuid,
  p_type_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT current_user = 'service_role'
    AND EXISTS (
      SELECT 1
      FROM public.notification_producer_occurrences occurrence
      WHERE occurrence.id = p_notification_event_id
        AND occurrence.type_key = p_type_key
        AND occurrence.entity_type = p_entity_type
        AND occurrence.entity_id = p_entity_id
    )
    AND (
      p_employee_id IS NULL
      OR (
        EXISTS (
          SELECT 1
          FROM public.employees employee
          WHERE employee.id = p_employee_id
            AND employee.is_active IS TRUE
            AND employee.is_external IS FALSE
        )
        AND CASE p_type_key
          WHEN 'appointment.assigned' THEN
            p_entity_type = 'appointment_crew'
            AND EXISTS (
              SELECT 1
              FROM public.appointment_crew crew
              WHERE crew.id = p_entity_id
                AND crew.employee_id = p_employee_id
            )
          WHEN 'appointment.updated' THEN
            p_entity_type = 'appointment'
            AND EXISTS (
              SELECT 1
              FROM public.appointment_crew crew
              WHERE crew.appointment_id = p_entity_id
                AND crew.employee_id = p_employee_id
            )
          WHEN 'appointment.canceled' THEN
            p_entity_type = 'appointment'
            AND EXISTS (
              SELECT 1
              FROM public.appointment_crew crew
              WHERE crew.appointment_id = p_entity_id
                AND crew.employee_id = p_employee_id
            )
          WHEN 'timesheet.change_requested' THEN
            p_entity_type = 'time_entry_change_request'
            AND EXISTS (
              SELECT 1
              FROM public.time_entry_change_requests request
              JOIN public.employees employee
                ON employee.id = p_employee_id
              WHERE request.id = p_entity_id
                AND employee.role::text = 'admin'
            )
          WHEN 'timesheet.change_reviewed' THEN
            p_entity_type = 'time_entry_change_request'
            AND EXISTS (
              SELECT 1
              FROM public.time_entry_change_requests request
              WHERE request.id = p_entity_id
                AND request.requested_by = p_employee_id
            )
          ELSE false
        END
      )
    );
$function$;

CREATE FUNCTION public.claim_guarded_native_push_delivery(
  p_delivery_key uuid,
  p_notification_event_id uuid,
  p_employee_id uuid,
  p_type_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_device_token_id uuid,
  p_device_fingerprint uuid,
  p_token text,
  p_apns_environment text
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
      USING ERRCODE = '42501';
  END IF;

  WITH expired_claims AS (
    SELECT existing.delivery_key
    FROM public.native_push_delivery_claims existing
    WHERE existing.claimed_at < now() - interval '90 days'
    ORDER BY existing.claimed_at
    LIMIT 1000
  )
  DELETE FROM public.native_push_delivery_claims existing
  USING expired_claims
  WHERE existing.delivery_key = expired_claims.delivery_key;

  INSERT INTO public.native_push_delivery_claims (
    delivery_key,
    employee_id,
    device_fingerprint
  )
  SELECT
    p_delivery_key,
    p_employee_id,
    p_device_fingerprint
  WHERE public.validate_notification_producer_delivery(
    p_notification_event_id,
    p_type_key,
    p_entity_type,
    p_entity_id,
    p_employee_id
  )
    AND EXISTS (
      SELECT 1
      FROM public.device_tokens token
      WHERE token.id = p_device_token_id
        AND token.employee_id = p_employee_id
        AND token.token = p_token
        AND token.platform = 'ios'
        AND token.apns_environment = p_apns_environment
    )
  ON CONFLICT (delivery_key) DO NOTHING
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$function$;

CREATE FUNCTION public.claim_guarded_notification_target_delivery(
  p_delivery_key uuid,
  p_notification_event_id uuid,
  p_employee_id uuid,
  p_type_key text,
  p_channel text,
  p_target_fingerprint uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_source_id uuid,
  p_target text
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
      USING ERRCODE = '42501';
  END IF;

  IF p_channel NOT IN ('pwa_push', 'email') THEN
    RAISE EXCEPTION 'unsupported guarded notification target channel'
      USING ERRCODE = '22023';
  END IF;

  WITH expired_claims AS (
    SELECT existing.delivery_key
    FROM public.notification_delivery_claims existing
    WHERE existing.claimed_at < now() - interval '90 days'
    ORDER BY existing.claimed_at
    LIMIT 1000
  )
  DELETE FROM public.notification_delivery_claims existing
  USING expired_claims
  WHERE existing.delivery_key = expired_claims.delivery_key;

  INSERT INTO public.notification_delivery_claims (
    delivery_key,
    notification_event_id,
    employee_id,
    type_key,
    channel,
    target_fingerprint
  )
  SELECT
    p_delivery_key,
    p_notification_event_id,
    p_employee_id,
    p_type_key,
    p_channel,
    p_target_fingerprint
  WHERE public.validate_notification_producer_delivery(
    p_notification_event_id,
    p_type_key,
    p_entity_type,
    p_entity_id,
    p_employee_id
  )
    AND (
      (
        p_channel = 'pwa_push'
        AND p_source_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.push_subscriptions subscription
          WHERE subscription.id = p_source_id
            AND subscription.employee_id = p_employee_id
            AND subscription.endpoint = p_target
        )
      )
      OR (
        p_channel = 'email'
        AND p_source_id IS NULL
        AND NULLIF(btrim(p_target), '') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.employees employee
          WHERE employee.id = p_employee_id
            AND lower(btrim(employee.email)) = lower(btrim(p_target))
        )
      )
    )
  ON CONFLICT (delivery_key) DO NOTHING
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(
  p_delivery_key uuid,
  p_notification_event_id uuid,
  p_employee_id uuid,
  p_type_key text,
  p_channel text,
  p_target_fingerprint uuid,
  p_entity_type text,
  p_entity_id uuid
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
      USING ERRCODE = '42501';
  END IF;

  IF p_channel NOT IN ('bell', 'pwa_push', 'email') THEN
    RAISE EXCEPTION 'unsupported notification delivery channel'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.validate_notification_producer_delivery(
    p_notification_event_id,
    p_type_key,
    p_entity_type,
    p_entity_id,
    p_employee_id
  ) THEN
    RETURN false;
  END IF;

  WITH expired_claims AS (
    SELECT existing.delivery_key
    FROM public.notification_delivery_claims existing
    WHERE existing.claimed_at < now() - interval '90 days'
    ORDER BY existing.claimed_at
    LIMIT 1000
  )
  DELETE FROM public.notification_delivery_claims existing
  USING expired_claims
  WHERE existing.delivery_key = expired_claims.delivery_key;

  INSERT INTO public.notification_delivery_claims (
    delivery_key,
    notification_event_id,
    employee_id,
    type_key,
    channel,
    target_fingerprint
  )
  SELECT
    p_delivery_key,
    p_notification_event_id,
    p_employee_id,
    p_type_key,
    p_channel,
    p_target_fingerprint
  ON CONFLICT (delivery_key) DO NOTHING
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_notification_delivery_claim(
  p_delivery_key uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted_count integer;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.notification_delivery_claims
  WHERE delivery_key = p_delivery_key;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count > 0;
END;
$function$;

ALTER FUNCTION public.claim_notification_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid
) OWNER TO postgres;
ALTER FUNCTION public.validate_notification_producer_delivery(
  uuid,
  text,
  text,
  uuid,
  uuid
) OWNER TO postgres;
ALTER FUNCTION public.claim_guarded_native_push_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text
) OWNER TO postgres;
ALTER FUNCTION public.claim_guarded_notification_target_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid,
  uuid,
  text
) OWNER TO postgres;
ALTER FUNCTION public.release_notification_delivery_claim(uuid)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.claim_notification_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.validate_notification_producer_delivery(
  uuid,
  text,
  text,
  uuid,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_notification_producer_delivery(
  uuid,
  text,
  text,
  uuid,
  uuid
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_guarded_native_push_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_guarded_native_push_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_guarded_notification_target_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_guarded_notification_target_delivery(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  uuid,
  uuid,
  text
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.release_notification_delivery_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_notification_delivery_claim(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.emit_notification_producer_event(
  p_type_key text,
  p_occurrence_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_body jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean;
  v_url text;
  v_secret text;
  v_occurrence_id uuid;
BEGIN
  IF p_type_key NOT IN (
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  )
     OR NULLIF(btrim(p_occurrence_key), '') IS NULL
     OR NULLIF(btrim(p_entity_type), '') IS NULL
     OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'invalid notification producer occurrence'
      USING ERRCODE = '22023';
  END IF;

  SELECT catalog.enabled
    INTO v_enabled
  FROM public.notification_types catalog
  WHERE catalog.type_key = p_type_key;

  IF v_enabled IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT config.value
    INTO v_url
  FROM public.integration_config config
  WHERE config.key = 'notify_worker_url';
  SELECT config.value
    INTO v_secret
  FROM public.integration_config config
  WHERE config.key = 'notify_webhook_secret';

  IF v_url IS NULL
     OR v_url NOT IN (
       'https://dev.utahpros.app/api/notify',
       'https://utahpros.app/api/notify'
     )
     OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notification_producer_occurrences (
    type_key,
    occurrence_key,
    entity_type,
    entity_id
  )
  VALUES (
    p_type_key,
    p_occurrence_key,
    p_entity_type,
    p_entity_id
  )
  ON CONFLICT (occurrence_key) DO NOTHING
  RETURNING id INTO v_occurrence_id;

  IF v_occurrence_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.notify_emit(
    p_type_key,
    COALESCE(p_body, '{}'::jsonb)
      || jsonb_build_object('notification_event_id', v_occurrence_id)
  );

  RETURN v_occurrence_id;
END;
$function$;

ALTER FUNCTION public.emit_notification_producer_event(
  text,
  text,
  text,
  uuid,
  jsonb
) OWNER TO postgres;
-- Producer trigger/RPC helper only; it is deliberately not a public RPC.
REVOKE EXECUTE ON FUNCTION public.emit_notification_producer_event(
  text,
  text,
  text,
  uuid,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the deployed pg_net contract while requiring a ledger-backed
-- occurrence id for the five repaired producer types.
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
  v_notification_event_id uuid;
BEGIN
  IF p_type_key IS NULL THEN
    RETURN;
  END IF;

  SELECT enabled
    INTO v_enabled
  FROM public.notification_types
  WHERE type_key = p_type_key;

  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  IF p_type_key IN (
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ) THEN
    BEGIN
      v_notification_event_id :=
        NULLIF(p_body ->> 'notification_event_id', '')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN;
    END;

    IF v_notification_event_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.notification_producer_occurrences occurrence
         WHERE occurrence.id = v_notification_event_id
           AND occurrence.type_key = p_type_key
       ) THEN
      RETURN;
    END IF;
  ELSE
    v_notification_event_id := gen_random_uuid();
  END IF;

  SELECT value
    INTO v_url
  FROM public.integration_config
  WHERE key = 'notify_worker_url';
  SELECT value
    INTO v_secret
  FROM public.integration_config
  WHERE key = 'notify_webhook_secret';

  IF v_url IS NULL
     OR v_url NOT IN (
       'https://dev.utahpros.app/api/notify',
       'https://utahpros.app/api/notify'
     )
     OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := COALESCE(p_body, '{}'::jsonb) || jsonb_build_object(
      'notification_event_id',
      v_notification_event_id,
      'type_key',
      p_type_key
    ),
    headers := jsonb_build_object(
      'Content-Type',
      'application/json',
      'x-webhook-secret',
      v_secret
    )
  );
END;
$function$;

ALTER FUNCTION public.notify_emit(text, jsonb)
  OWNER TO postgres;
-- Worker/owner-chain capability only; browser roles cannot mint events.
REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)
  TO service_role;

-- ─── 3. Appointment producers and crew diffing ─────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_appt_crew_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.emit_notification_producer_event(
    'appointment.assigned',
    'appointment.assigned:' || NEW.id::text,
    'appointment_crew',
    NEW.id,
    jsonb_build_object(
      'appointment_crew_id', NEW.id,
      'appointment_id', NEW.appointment_id,
      'employee_id', NEW.employee_id
    )
  );
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.trg_appt_crew_notify()
  OWNER TO postgres;
-- Trigger function only; no direct role grant.
REVOKE EXECUTE ON FUNCTION public.trg_appt_crew_notify()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_appt_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_type_key text;
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_type_key := 'appointment.canceled';
  ELSIF (
    NEW.title,
    NEW.date,
    NEW.time_start,
    NEW.time_end,
    NEW.status,
    NEW.job_id
  ) IS DISTINCT FROM (
    OLD.title,
    OLD.date,
    OLD.time_start,
    OLD.time_end,
    OLD.status,
    OLD.job_id
  ) THEN
    v_type_key := 'appointment.updated';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.emit_notification_producer_event(
    v_type_key,
    concat_ws(
      ':',
      v_type_key,
      NEW.id::text,
      txid_current()::text,
      statement_timestamp()::text
    ),
    'appointment',
    NEW.id,
    jsonb_build_object('appointment_id', NEW.id)
  );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.trg_appt_notify()
  OWNER TO postgres;
-- Trigger function only; no direct role grant.
REVOKE EXECUTE ON FUNCTION public.trg_appt_notify()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_appointment_crew(
  p_appointment_id uuid,
  p_crew jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF public.appointment_crew
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.require_notification_producer_actor(NULL, false);

  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'sync_appointment_crew: p_appointment_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(p_crew, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'sync_appointment_crew: p_crew must be an array'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_appointment_crew: appointment not found'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_actor IS NOT NULL
     AND NOT public.can_current_employee_manage_appointment_crew(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: appointment crew management required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) element
    WHERE COALESCE(element ->> 'employee_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(NULLIF(element ->> 'role', ''), 'tech')
          NOT IN ('lead', 'tech', 'helper')
  ) THEN
    RAISE EXCEPTION 'sync_appointment_crew: invalid crew member'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) element
    GROUP BY element ->> 'employee_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'sync_appointment_crew: duplicate crew member'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) element
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = (element ->> 'employee_id')::uuid
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    )
  ) THEN
    RAISE EXCEPTION 'sync_appointment_crew: active internal crew required'
      USING ERRCODE = '42501';
  END IF;

  WITH desired AS (
    SELECT DISTINCT ON ((element ->> 'employee_id')::uuid)
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(NULLIF(element ->> 'role', ''), 'tech')::public.crew_role
        AS role
    FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) element
    ORDER BY (element ->> 'employee_id')::uuid
  )
  DELETE FROM public.appointment_crew existing
  WHERE existing.appointment_id = p_appointment_id
    AND NOT EXISTS (
      SELECT 1
      FROM desired
      WHERE desired.employee_id = existing.employee_id
    );

  WITH desired AS (
    SELECT DISTINCT ON ((element ->> 'employee_id')::uuid)
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(NULLIF(element ->> 'role', ''), 'tech')::public.crew_role
        AS role
    FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) element
    ORDER BY (element ->> 'employee_id')::uuid
  )
  UPDATE public.appointment_crew existing
  SET role = desired.role
  FROM desired
  WHERE existing.appointment_id = p_appointment_id
    AND existing.employee_id = desired.employee_id
    AND existing.role IS DISTINCT FROM desired.role;

  WITH desired AS (
    SELECT DISTINCT ON ((element ->> 'employee_id')::uuid)
      (element ->> 'employee_id')::uuid AS employee_id,
      COALESCE(NULLIF(element ->> 'role', ''), 'tech')::public.crew_role
        AS role
    FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) element
    ORDER BY (element ->> 'employee_id')::uuid
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
  ON CONFLICT (appointment_id, employee_id) DO NOTHING;

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
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_appointment(
  p_appointment_id uuid,
  p_date date DEFAULT NULL::date,
  p_time_start time without time zone DEFAULT NULL::time without time zone,
  p_time_end time without time zone DEFAULT NULL::time without time zone,
  p_title text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid;
  v_result jsonb;
  v_old_date date;
  v_old_time_start time;
  v_old_time_end time;
  v_old_status text;
BEGIN
  v_actor_id :=
    public.require_notification_producer_actor(p_actor_id, false);

  SELECT date, time_start, time_end, status::text
    INTO v_old_date, v_old_time_start, v_old_time_end, v_old_status
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;

  IF NOT public.is_trusted_notification_producer_caller()
     AND NOT public.can_current_employee_mutate_appointment(p_appointment_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: appointment mutation access required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.appointments
  SET
    date = COALESCE(p_date, date),
    time_start = COALESCE(p_time_start, time_start),
    time_end = COALESCE(p_time_end, time_end),
    title = COALESCE(p_title, title),
    type = COALESCE(p_type::public.appointment_type, type),
    status = COALESCE(p_status::public.appointment_status, status),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_appointment_id
  RETURNING jsonb_build_object(
    'id', id,
    'date', date,
    'time_start', time_start,
    'time_end', time_end,
    'title', title,
    'status', status
  ) INTO v_result;

  IF (v_result ->> 'date')::date IS DISTINCT FROM v_old_date
     OR (v_result ->> 'time_start')::time IS DISTINCT FROM v_old_time_start
     OR (v_result ->> 'time_end')::time IS DISTINCT FROM v_old_time_end THEN
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
        WHEN v_result ->> 'status' = 'cancelled' THEN 'cancelled'
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
  v_date date;
  v_time_start time;
  v_time_end time;
  v_status text;
BEGIN
  v_actor_id :=
    public.require_notification_producer_actor(p_actor_id, false);

  SELECT
    appointment.date,
    appointment.time_start,
    appointment.time_end,
    appointment.status::text
    INTO v_date, v_time_start, v_time_end, v_status
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.is_trusted_notification_producer_caller()
     AND NOT public.can_current_employee_mutate_appointment(
       p_appointment_id
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: appointment mutation access required'
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

  UPDATE public.job_tasks
  SET appointment_id = NULL
  WHERE appointment_id = p_appointment_id;

  DELETE FROM public.appointment_crew
  WHERE appointment_id = p_appointment_id;

  DELETE FROM public.appointments
  WHERE id = p_appointment_id;
END;
$function$;

ALTER FUNCTION public.delete_appointment(uuid, uuid, text)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.delete_appointment(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_appointment(uuid, uuid, text)
  TO authenticated, service_role;

-- ─── 4. Timesheet producer caller binding and serialization ────────────────

CREATE OR REPLACE FUNCTION public.submit_time_entry_change_request(
  p_entry_id uuid,
  p_proposed jsonb,
  p_tech_note text,
  p_actor_id uuid
)
RETURNS public.time_entry_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid;
  v_entry public.job_time_entries%ROWTYPE;
  v_request public.time_entry_change_requests%ROWTYPE;
  v_employee_name text;
  v_proposed jsonb := COALESCE(p_proposed, '{}'::jsonb);
BEGIN
  v_actor_id :=
    public.require_notification_producer_actor(p_actor_id, false);

  SELECT entry.*
    INTO v_entry
  FROM public.job_time_entries entry
  WHERE entry.id = p_entry_id
  FOR UPDATE;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_entry.employee_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'NOT_OWNER'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
    INTO v_request
  FROM public.time_entry_change_requests request
  WHERE request.entry_id = p_entry_id
    AND request.status = 'pending'
  FOR UPDATE;

  IF v_request.id IS NOT NULL THEN
    IF v_request.requested_by = v_actor_id
       AND v_request.proposed = v_proposed
       AND v_request.tech_note IS NOT DISTINCT FROM p_tech_note THEN
      RETURN v_request;
    END IF;

    RAISE EXCEPTION 'PENDING_REQUEST_EXISTS'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.time_entry_change_requests (
    entry_id,
    requested_by,
    proposed,
    tech_note
  )
  VALUES (
    p_entry_id,
    v_actor_id,
    v_proposed,
    p_tech_note
  )
  RETURNING * INTO v_request;

  SELECT employee.full_name
    INTO v_employee_name
  FROM public.employees employee
  WHERE employee.id = v_actor_id;

  PERFORM public.emit_notification_producer_event(
    'timesheet.change_requested',
    'timesheet.change_requested:' || v_request.id::text,
    'time_entry_change_request',
    v_request.id,
    jsonb_build_object(
      'title', 'Timesheet change requested',
      'body',
        COALESCE(v_employee_name, 'A tech')
          || ' requested a correction to a time entry.',
      'link', '/time-tracking',
      'entity_type', 'time_entry_change_request',
      'entity_id', v_request.id,
      'job_id', v_entry.job_id,
      'payload',
        jsonb_build_object(
          'entry_id', p_entry_id,
          'proposed', v_proposed
        )
    )
  );

  RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_time_entry_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_actor_id uuid,
  p_review_note text DEFAULT NULL::text
)
RETURNS public.time_entry_change_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid;
  v_request public.time_entry_change_requests%ROWTYPE;
  v_entry public.job_time_entries%ROWTYPE;
  v_proposed jsonb;
BEGIN
  v_actor_id :=
    public.require_notification_producer_actor(p_actor_id, true);

  SELECT request.*
    INTO v_request
  FROM public.time_entry_change_requests request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_REVIEWED'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_approve THEN
    SELECT entry.*
      INTO v_entry
    FROM public.job_time_entries entry
    WHERE entry.id = v_request.entry_id;

    IF v_entry.id IS NULL THEN
      RAISE EXCEPTION 'ENTRY_NOT_FOUND'
        USING ERRCODE = 'P0001';
    END IF;

    v_proposed := v_request.proposed;
    PERFORM public.admin_upsert_time_entry(
      p_actor_id => v_actor_id,
      p_id => v_entry.id,
      p_employee_id => v_entry.employee_id,
      p_job_id => v_entry.job_id,
      p_work_date =>
        COALESCE((v_proposed ->> 'work_date')::date, v_entry.work_date),
      p_hours =>
        COALESCE((v_proposed ->> 'hours')::numeric, v_entry.hours),
      p_clock_in =>
        COALESCE((v_proposed ->> 'clock_in')::timestamptz, v_entry.clock_in),
      p_clock_out =>
        COALESCE((v_proposed ->> 'clock_out')::timestamptz, v_entry.clock_out),
      p_travel_start => v_entry.travel_start,
      p_on_site_end => v_entry.on_site_end,
      p_travel_minutes =>
        COALESCE(
          (v_proposed ->> 'travel_minutes')::numeric,
          v_entry.travel_minutes
        ),
      p_total_paused_minutes => v_entry.total_paused_minutes,
      p_work_type => v_entry.work_type,
      p_description =>
        COALESCE(v_proposed ->> 'description', v_entry.description),
      p_notes =>
        COALESCE(v_proposed ->> 'notes', v_entry.notes),
      p_override_approved => true
    );
  END IF;

  UPDATE public.time_entry_change_requests
  SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by = v_actor_id,
    review_note = p_review_note,
    reviewed_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  PERFORM public.emit_notification_producer_event(
    'timesheet.change_reviewed',
    'timesheet.change_reviewed:' || v_request.id::text,
    'time_entry_change_request',
    v_request.id,
    jsonb_build_object(
      'employee_id', v_request.requested_by,
      'title',
        CASE
          WHEN p_approve THEN 'Timesheet change approved'
          ELSE 'Timesheet change rejected'
        END,
      'body',
        COALESCE(
          NULLIF(p_review_note, ''),
          CASE
            WHEN p_approve
              THEN 'Your requested correction was approved.'
            ELSE 'Your requested correction was declined.'
          END
        ),
      'link', '/time-tracking',
      'entity_type', 'time_entry_change_request',
      'entity_id', v_request.id,
      'payload',
        jsonb_build_object(
          'entry_id', v_request.entry_id,
          'approved', p_approve
        )
    )
  );

  INSERT INTO public.system_events (
    event_type,
    entity_type,
    entity_id,
    actor_id,
    job_id,
    payload
  )
  VALUES (
    'time_entry.change_reviewed',
    'time_entry_change_request',
    v_request.id,
    v_actor_id,
    NULL,
    jsonb_build_object(
      'approved', p_approve,
      'entry_id', v_request.entry_id
    )
  );

  RETURN v_request;
END;
$function$;

ALTER FUNCTION public.submit_time_entry_change_request(
  uuid,
  jsonb,
  text,
  uuid
) OWNER TO postgres;
ALTER FUNCTION public.review_time_entry_change_request(
  uuid,
  boolean,
  uuid,
  text
) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.submit_time_entry_change_request(
  uuid,
  jsonb,
  text,
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_time_entry_change_request(
  uuid,
  jsonb,
  text,
  uuid
) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.review_time_entry_change_request(
  uuid,
  boolean,
  uuid,
  text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_time_entry_change_request(
  uuid,
  boolean,
  uuid,
  text
) TO authenticated, service_role;

-- ─── 5. Postconditions and explicit containment ────────────────────────────

DO $postflight$
DECLARE
  v_required constant text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ]::text[];
  v_enabled text[];
  v_notify_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
BEGIN
  SELECT array_agg(catalog.type_key ORDER BY catalog.type_key)
    INTO v_enabled
  FROM public.notification_types catalog
  WHERE catalog.type_key = ANY (v_required)
    AND catalog.enabled IS TRUE;

  IF v_enabled IS NOT NULL THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found enabled flags: %',
      v_enabled
      USING ERRCODE = '55000';
  END IF;

  IF v_notify_oid IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc function_record
       JOIN pg_namespace namespace_record
         ON namespace_record.oid = function_record.pronamespace
       WHERE namespace_record.nspname = 'public'
         AND function_record.proname = 'notify_emit'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc function_record
       WHERE function_record.oid = v_notify_oid
         AND pg_get_userbyid(function_record.proowner) = 'postgres'
         AND function_record.prosecdef
         AND function_record.proconfig =
           ARRAY['search_path=public']::text[]
         AND md5(function_record.prosrc) =
           '72d1973cff37b95c7149700a7c5bb5b7'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization notify_emit replacement drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl
       WHERE function_record.oid = v_notify_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_notify_oid, 'EXECUTE')
     OR has_function_privilege(
       'authenticated',
       v_notify_oid,
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       v_notify_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization notify_emit postflight grant drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN (
        'appointments',
        'appointment_crew',
        'time_entry_change_requests'
      )
      AND 'anon' = ANY (policy.roles)
  )
     OR has_table_privilege('anon', 'public.appointments', 'SELECT')
     OR has_table_privilege('anon', 'public.appointments', 'INSERT')
     OR has_table_privilege('anon', 'public.appointments', 'UPDATE')
     OR has_table_privilege('anon', 'public.appointments', 'DELETE')
     OR has_table_privilege('anon', 'public.appointment_crew', 'SELECT')
     OR has_table_privilege('anon', 'public.appointment_crew', 'INSERT')
     OR has_table_privilege('anon', 'public.appointment_crew', 'UPDATE')
     OR has_table_privilege('anon', 'public.appointment_crew', 'DELETE')
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'INSERT'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'UPDATE'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'DELETE'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'REFERENCES'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found anonymous source access'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    WHERE relation.oid = 'public.time_entry_change_requests'::regclass
      AND relation.relrowsecurity IS TRUE
  )
     OR NOT has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'INSERT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'UPDATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'DELETE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'REFERENCES'
     )
     OR has_table_privilege(
       'authenticated',
       'public.time_entry_change_requests',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found timesheet request ACL drift'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN ('appointments', 'appointment_crew')
  ) <> 8 THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found unexpected appointment policies'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('appointments', 'all_select_appointments', 'SELECT'),
        ('appointments', 'all_insert_appointments', 'INSERT'),
        ('appointments', 'all_update_appointments', 'UPDATE'),
        ('appointments', 'all_delete_appointments', 'DELETE'),
        ('appointment_crew', 'all_select_appointment_crew', 'SELECT'),
        ('appointment_crew', 'all_insert_appointment_crew', 'INSERT'),
        ('appointment_crew', 'all_update_appointment_crew', 'UPDATE'),
        ('appointment_crew', 'all_delete_appointment_crew', 'DELETE')
    ) AS expected(tablename, policyname, command)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.tablename
        AND policy.policyname = expected.policyname
        AND policy.cmd = expected.command
        AND policy.permissive = 'PERMISSIVE'
        AND policy.roles = ARRAY['authenticated'::name]
    )
  )
     OR (
       SELECT count(*)
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'time_entry_change_requests'
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'time_entry_change_requests'
         AND policy.policyname = 'tecr_read'
         AND policy.cmd = 'SELECT'
         AND policy.permissive = 'PERMISSIVE'
         AND policy.roles = ARRAY['authenticated'::name]
         AND policy.qual ILIKE
           '%can_current_employee_read_time_entry_change_request%'
         AND policy.qual ILIKE '%requested_by%'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found policy-shape drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'public.appointments'::regclass,
          'trg_enforce_private_appointment',
          'public.enforce_private_appointment_role()'::regprocedure,
          23::smallint
        ),
        (
          'public.appointments'::regclass,
          'trg_appointment_notify',
          'public.trg_appt_notify()'::regprocedure,
          17::smallint
        ),
        (
          'public.appointment_crew'::regclass,
          'trg_appointment_crew_notify',
          'public.trg_appt_crew_notify()'::regprocedure,
          5::smallint
        ),
        (
          'public.appointments'::regclass,
          'trg_appointments_bind_creator',
          'public.bind_appointment_creator()'::regprocedure,
          23::smallint
        ),
        (
          'public.appointments'::regclass,
          'trg_appointments_notification_producer_authority',
          'public.assert_notification_producer_write()'::regprocedure,
          31::smallint
        ),
        (
          'public.appointment_crew'::regclass,
          'trg_appointment_crew_notification_producer_authority',
          'public.assert_notification_producer_write()'::regprocedure,
          31::smallint
        )
    ) AS expected(relation_id, trigger_name, function_id, trigger_type)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger
      WHERE trigger.tgrelid = expected.relation_id
        AND trigger.tgname = expected.trigger_name
        AND trigger.tgfoid = expected.function_id
        AND trigger.tgtype = expected.trigger_type
        AND trigger.tgenabled IN ('O', 'A')
        AND trigger.tgqual IS NULL
        AND trigger.tgattr = ''::int2vector
        AND trigger.tgnargs = 0
        AND NOT trigger.tgisinternal
    )
  ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found trigger drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.notification_producer_occurrences'::regclass
  )
     OR NOT (
       SELECT relrowsecurity AND relforcerowsecurity
       FROM pg_class
       WHERE oid = 'public.notification_delivery_claims'::regclass
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight requires forced RLS on private state'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_class relation_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           relation_record.relacl,
           acldefault('r', relation_record.relowner)
         )
       ) acl_record
       WHERE relation_record.oid IN (
         'public.notification_producer_occurrences'::regclass,
         'public.notification_delivery_claims'::regclass
       )
         AND acl_record.grantee = 0
     )
     OR has_table_privilege(
       'anon',
       'public.notification_producer_occurrences',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.notification_producer_occurrences',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.notification_producer_occurrences',
       'SELECT'
     )
     OR has_table_privilege(
       'service_role',
       'public.notification_producer_occurrences',
       'INSERT'
     )
     OR has_table_privilege(
       'anon',
       'public.notification_delivery_claims',
       'SELECT'
     )
     OR has_table_privilege(
       'authenticated',
       'public.notification_delivery_claims',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'DELETE'
     )
     OR has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'UPDATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'TRUNCATE'
     )
     OR has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'REFERENCES'
     )
     OR has_table_privilege(
       'service_role',
       'public.notification_delivery_claims',
       'TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found private table ACL drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = 'public'
      AND column_record.table_name = 'appointments'
      AND column_record.column_name = 'created_by_employee_id'
  )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger
       WHERE trigger.tgrelid = 'public.appointments'::regclass
         AND trigger.tgname = 'trg_appointments_bind_creator'
         AND trigger.tgfoid =
           'public.bind_appointment_creator()'::regprocedure
         AND trigger.tgtype = 23
         AND trigger.tgenabled IN ('O', 'A')
         AND trigger.tgqual IS NULL
         AND trigger.tgattr = ''::int2vector
         AND trigger.tgnargs = 0
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight requires appointment creator binding'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.notify_emit(text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.notify_emit(text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.notify_emit(text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.delete_appointment(uuid,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.can_current_employee_read_time_entry_change_request(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.can_current_employee_read_time_entry_change_request(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.delete_appointment(uuid,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification producer authorization postflight found function ACL drift'
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

-- Reassert containment explicitly. This is intentionally redundant with the
-- preflight: a future edit cannot quietly turn authoring into activation.
UPDATE public.notification_types
SET enabled = false
WHERE type_key IN (
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
  'timesheet.change_requested',
  'timesheet.change_reviewed'
);
