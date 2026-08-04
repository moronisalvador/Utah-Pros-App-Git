-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260804153859_notification_producer_crew_phase_a_composition
-- Phase: Mobile readiness — notification producer / crew Phase-A composition
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Installs the still-disabled notification producer authorization contract
--   on either supported predecessor without replacing the now-live crew
--   Phase-A contract. Production may arrive with the notification objects
--   absent; QA may arrive with M1 + M2 already applied. Both finish with the
--   same producer functions while Phase-A functions, policies, triggers,
--   grants, audit history, and legacy installed-client bridge remain intact.
--
-- WHY THIS IS SAFE:
--   - Refuses partial notification state or unknown table/catalog drift.
--   - Fingerprints the complete Phase-A-owned surface before any change and
--     proves it byte-identical afterward.
--   - Uses the final M2 notify_emit event-id behavior directly; the historical
--     M1 crew/appointment RPC, RLS, trigger, and ACL replacements are omitted.
--   - Keeps all six related flags disabled and requires the reminder cron to
--     remain absent. This migration never activates or schedules anything.
--   - Adds only creator provenance, private occurrence/claim state, producer
--     functions, and missing foreign-key indexes.
--
-- PHASE-B BOUNDARY:
--   Authenticated appointment/crew DML retained by Phase A remains available
--   for supported installed native clients. Revocation is a separate,
--   adoption-gated Phase-B migration and is deliberately out of scope here.
--
-- ROLLBACK:
--   supabase/rollbacks/
--   20260804153859_notification_producer_crew_phase_a_composition.rollback.sql
--   Recovery disables and revokes producer capabilities while preserving
--   Phase-A and the durable occurrence/claim evidence.
-- ═══════════════════════════════════════════════════════════════════════════

DO $composition_preflight$
DECLARE
  v_required constant text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed',
    'appointment.reminder'
  ]::text[];
  v_producer_functions constant text[] := ARRAY[
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.release_notification_delivery_claim(uuid)',
    'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'
  ]::text[];
  v_phase_a_functions constant text[] := ARRAY[
    'public.is_trusted_appointment_command_caller()',
    'public.current_active_internal_appointment_employee()',
    'public.current_attributed_appointment_crew_actor()',
    'public.can_current_employee_create_appointment_command()',
    'public.can_current_employee_edit_appointment_command(uuid)',
    'public.can_current_employee_access_appointment_command(uuid)',
    'public.can_current_employee_access_appointment_row(uuid,boolean)',
    'public.can_current_employee_manage_appointment_privacy()',
    'public.can_current_employee_manage_appointment_crew(uuid)',
    'public.guard_appointment_command_write()',
    'public.merge_jobs(uuid,uuid)',
    'public.audit_appointment_crew_change()',
    'public.sync_appointment_crew(uuid,jsonb)',
    'public.sync_appointment_crew(uuid,jsonb,uuid)',
    'public.update_appointment(uuid,date,time without time zone,time without time zone,text,text,text,text,uuid)',
    'public.assign_tasks_to_appointment(uuid,uuid[])',
    'public.delete_appointment(uuid,uuid,text)',
    'public.create_appointment_with_crew(text,date,uuid,text,time without time zone,time without time zone,text,text,text,boolean,boolean,jsonb,uuid[],jsonb,uuid)',
    'public.update_appointment_with_crew(uuid,date,time without time zone,time without time zone,text,text,text,text,jsonb,boolean,boolean,uuid[],boolean,boolean,boolean,uuid)'
  ]::text[];
  v_missing text[];
  v_enabled text[];
  v_signature text;
  v_private_table_count integer;
  v_producer_function_count integer;
  v_created_column_present boolean;
  v_notify_oid oid := to_regprocedure('public.notify_emit(text,jsonb)');
  v_notify_hash text;
BEGIN
  IF to_regclass('public.appointments') IS NULL
     OR to_regclass('public.appointment_crew') IS NULL
     OR to_regclass('public.notification_types') IS NULL
     OR to_regclass('public.integration_config') IS NULL
     OR to_regclass('public.native_push_delivery_claims') IS NULL
     OR to_regclass('public.device_tokens') IS NULL
     OR to_regclass('public.push_subscriptions') IS NULL
     OR to_regclass('public.time_entry_change_requests') IS NULL
     OR to_regclass('cron.job') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('auth.jwt()') IS NULL
     OR v_notify_oid IS NULL THEN
    RAISE EXCEPTION
      'notification/crew composition found a missing deployed dependency'
      USING ERRCODE = '55000';
  END IF;

  SELECT array_agg(required.type_key ORDER BY required.type_key)
  INTO v_missing
  FROM unnest(v_required) AS required(type_key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notification_types catalog
    WHERE catalog.type_key = required.type_key
  );

  SELECT array_agg(catalog.type_key ORDER BY catalog.type_key)
  INTO v_enabled
  FROM public.notification_types catalog
  WHERE catalog.type_key = ANY (v_required)
    AND catalog.enabled IS TRUE;

  IF v_missing IS NOT NULL OR v_enabled IS NOT NULL THEN
    RAISE EXCEPTION
      'notification/crew composition requires present disabled flags (missing %, enabled %)',
      v_missing,
      v_enabled
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'upr_appointment_reminders'
  ) THEN
    RAISE EXCEPTION
      'notification/crew composition requires reminder cron containment'
      USING ERRCODE = '55000';
  END IF;

  FOREACH v_signature IN ARRAY v_phase_a_functions
  LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc procedure
         WHERE procedure.oid = to_regprocedure(v_signature)
           AND pg_get_userbyid(procedure.proowner) = 'postgres'
           AND procedure.prosecdef
           AND COALESCE(
             obj_description(procedure.oid, 'pg_proc'),
             ''
           ) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
       ) THEN
      RAISE EXCEPTION
        'notification/crew composition found Phase-A function drift: %',
        v_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename IN ('appointments', 'appointment_crew')
         AND 'anon'::name = ANY (policy.roles)
     )
     OR (
       SELECT count(*)
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename IN ('appointments', 'appointment_crew')
     ) IS DISTINCT FROM 8
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = 'public.appointments'::regclass
         AND trigger_record.tgname =
           'trg_appointments_atomic_command_guard'
         AND trigger_record.tgfoid =
           to_regprocedure('public.guard_appointment_command_write()')
         AND trigger_record.tgenabled = 'O'
         AND NOT trigger_record.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid =
         'public.appointment_crew'::regclass
         AND trigger_record.tgname =
           'trg_appointment_crew_actor_audit'
         AND trigger_record.tgfoid =
           to_regprocedure('public.audit_appointment_crew_change()')
         AND trigger_record.tgenabled = 'O'
         AND NOT trigger_record.tgisinternal
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointments',
       'INSERT'
     )
     OR NOT has_table_privilege(
       'authenticated',
       'public.appointments',
       'DELETE'
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
     OR has_function_privilege(
       'service_role',
       'public.sync_appointment_crew(uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.sync_appointment_crew(uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.sync_appointment_crew(uuid,jsonb,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.sync_appointment_crew(uuid,jsonb,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found Phase-A policy, trigger, or ACL drift'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)
  INTO v_private_table_count
  FROM unnest(ARRAY[
    to_regclass('public.notification_producer_occurrences'),
    to_regclass('public.notification_delivery_claims')
  ]) AS state(table_oid)
  WHERE state.table_oid IS NOT NULL;

  SELECT count(*)
  INTO v_producer_function_count
  FROM unnest(v_producer_functions) AS required(signature)
  WHERE to_regprocedure(required.signature) IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = 'public'
      AND column_record.table_name = 'appointments'
      AND column_record.column_name = 'created_by_employee_id'
  )
  INTO v_created_column_present;

  IF NOT (
       (
         v_private_table_count = 0
         AND v_producer_function_count = 0
         AND v_created_column_present IS FALSE
       )
       OR (
         v_private_table_count = 2
         AND v_producer_function_count =
           cardinality(v_producer_functions)
         AND v_created_column_present IS TRUE
       )
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found partial lineage state (tables %, functions %, creator %)',
      v_private_table_count,
      v_producer_function_count,
      v_created_column_present
      USING ERRCODE = '55000';
  END IF;

  IF v_private_table_count = 2 THEN
    IF (
         SELECT count(*)
         FROM information_schema.columns column_record
         WHERE column_record.table_schema = 'public'
           AND column_record.table_name =
             'notification_producer_occurrences'
       ) IS DISTINCT FROM 6
       OR (
         SELECT count(*)
         FROM information_schema.columns column_record
         WHERE column_record.table_schema = 'public'
           AND column_record.table_name =
             'notification_delivery_claims'
       ) IS DISTINCT FROM 7
       OR (
         SELECT count(*)
         FROM pg_constraint constraint_record
         WHERE constraint_record.conrelid =
           'public.notification_producer_occurrences'::regclass
       ) IS DISTINCT FROM 5
       OR (
         SELECT count(*)
         FROM pg_constraint constraint_record
         WHERE constraint_record.conrelid =
           'public.notification_delivery_claims'::regclass
       ) IS DISTINCT FROM 5
       OR NOT (
         SELECT relation.relrowsecurity AND relation.relforcerowsecurity
         FROM pg_class relation
         WHERE relation.oid =
           'public.notification_producer_occurrences'::regclass
       )
       OR NOT (
         SELECT relation.relrowsecurity AND relation.relforcerowsecurity
         FROM pg_class relation
         WHERE relation.oid =
           'public.notification_delivery_claims'::regclass
       )
       OR (
         SELECT count(*)
         FROM pg_policies policy
         WHERE policy.schemaname = 'public'
           AND policy.tablename IN (
             'notification_producer_occurrences',
             'notification_delivery_claims'
           )
       ) IS DISTINCT FROM 2
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
       OR has_table_privilege(
         'anon',
         'public.notification_delivery_claims',
         'SELECT'
       )
       OR has_table_privilege(
         'authenticated',
         'public.notification_delivery_claims',
         'SELECT'
       ) THEN
      RAISE EXCEPTION
        'notification/crew composition found private-table catalog drift'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'time_entry_change_requests'
         AND policy.policyname = 'tecr_read'
         AND policy.cmd = 'SELECT'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition requires tecr_read predecessor policy'
      USING ERRCODE = '55000';
  END IF;

  SELECT md5(procedure.prosrc)
  INTO v_notify_hash
  FROM pg_proc procedure
  WHERE procedure.oid = v_notify_oid;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid = v_notify_oid
         AND pg_get_userbyid(procedure.proowner) = 'postgres'
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
         AND md5(procedure.prosrc) IN (
           'c72e0f7fd40a4abec42cce1cd912a45b',
           'ea3a9b3b6cca96722c008d7e9b23f6bc'
         )
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
      'notification/crew composition found notify_emit drift (md5 %)',
      v_notify_hash
      USING ERRCODE = '55000';
  END IF;
END;
$composition_preflight$;

CREATE TEMP TABLE IF NOT EXISTS upr_phase_a_composition_snapshot (
  object_kind text NOT NULL,
  object_name text NOT NULL,
  fingerprint text NOT NULL,
  PRIMARY KEY (object_kind, object_name)
) ON COMMIT PRESERVE ROWS;

TRUNCATE TABLE pg_temp.upr_phase_a_composition_snapshot;

INSERT INTO pg_temp.upr_phase_a_composition_snapshot (
  object_kind,
  object_name,
  fingerprint
)
SELECT
  'function',
  procedure.oid::regprocedure::text,
  md5(concat_ws(
    '|',
    pg_get_functiondef(procedure.oid),
    procedure.proowner::text,
    procedure.prosecdef::text,
    procedure.proconfig::text,
    procedure.proacl::text,
    obj_description(procedure.oid, 'pg_proc')
  ))
FROM pg_proc procedure
WHERE COALESCE(
  obj_description(procedure.oid, 'pg_proc'),
  ''
) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
UNION ALL
SELECT
  'policy',
  policy.tablename || ':' || policy.policyname,
  md5(concat_ws(
    '|',
    policy.cmd,
    policy.permissive,
    policy.roles::text,
    policy.qual,
    policy.with_check
  ))
FROM pg_policies policy
WHERE policy.schemaname = 'public'
  AND policy.tablename IN ('appointments', 'appointment_crew')
UNION ALL
SELECT
  'trigger',
  relation.relname || ':' || trigger_record.tgname,
  md5(concat_ws(
    '|',
    trigger_record.tgfoid::text,
    trigger_record.tgtype::text,
    trigger_record.tgenabled::text,
    trigger_record.tgqual::text,
    trigger_record.tgattr::text,
    trigger_record.tgnargs::text,
    encode(trigger_record.tgargs, 'hex'),
    trigger_record.tgconstraint::text
  ))
FROM pg_trigger trigger_record
JOIN pg_class relation
  ON relation.oid = trigger_record.tgrelid
WHERE trigger_record.tgrelid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass
  )
  AND trigger_record.tgname IN (
    'trg_appointments_atomic_command_guard',
    'trg_appointment_crew_actor_audit'
  )
  AND NOT trigger_record.tgisinternal
UNION ALL
SELECT
  'table-acl',
  relation.oid::regclass::text,
  md5(concat_ws(
    '|',
    relation.relowner::text,
    relation.relrowsecurity::text,
    relation.relforcerowsecurity::text,
    relation.relacl::text
  ))
FROM pg_class relation
WHERE relation.oid IN (
  'public.appointments'::regclass,
  'public.appointment_crew'::regclass,
  'public.system_events'::regclass
)
UNION ALL
SELECT
  'column-acl',
  attribute.attrelid::regclass::text || ':' || attribute.attname,
  md5(COALESCE(attribute.attacl::text, ''))
FROM pg_attribute attribute
WHERE attribute.attrelid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass,
    'public.system_events'::regclass
  )
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped;

DO $composition_snapshot_postflight$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_temp.upr_phase_a_composition_snapshot
    WHERE object_kind = 'function'
  ) < 19
     OR (
       SELECT count(*)
       FROM pg_temp.upr_phase_a_composition_snapshot
       WHERE object_kind = 'policy'
     ) IS DISTINCT FROM 8
     OR (
       SELECT count(*)
       FROM pg_temp.upr_phase_a_composition_snapshot
       WHERE object_kind = 'trigger'
     ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'notification/crew composition captured an incomplete Phase-A snapshot'
      USING ERRCODE = '55000';
  END IF;
END;
$composition_snapshot_postflight$;

-- ─── 1. Actor identity and direct-table authorization ──────────────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS created_by_employee_id uuid
  REFERENCES public.employees(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS appointments_created_by_employee_id_idx
  ON public.appointments(created_by_employee_id)
  WHERE created_by_employee_id IS NOT NULL;

-- Phase-A owns appointment and crew actor authorization.

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

-- Creator provenance uses the Phase-A actor guard plus this dedicated binder.

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

CREATE OR REPLACE TRIGGER trg_appointments_bind_creator
  BEFORE INSERT OR UPDATE
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_appointment_creator();

-- Phase-A remains the sole appointment/crew authorization contract.

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
      AND employee.is_external IS FALSE
      AND employee.role::text IS DISTINCT FROM 'crm_partner';

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

-- Phase-A guards, policies, ACLs, and audit triggers remain untouched.

-- ─── 2. Durable producer occurrences and per-channel delivery claims ───────

CREATE TABLE IF NOT EXISTS public.notification_producer_occurrences (
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

CREATE INDEX IF NOT EXISTS notification_producer_occurrences_created_at_idx
  ON public.notification_producer_occurrences(created_at);

CREATE INDEX IF NOT EXISTS notification_producer_occurrences_type_key_idx
  ON public.notification_producer_occurrences(type_key);

ALTER TABLE public.notification_producer_occurrences
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_producer_occurrences
  FORCE ROW LEVEL SECURITY;
DO $occurrence_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'notification_producer_occurrences'
      AND policy.policyname =
        'notification_producer_occurrences_service_role'
  ) THEN
    CREATE POLICY notification_producer_occurrences_service_role
      ON public.notification_producer_occurrences
      FOR SELECT
      TO service_role
      USING (true);
  END IF;
END;
$occurrence_policy$;
REVOKE ALL PRIVILEGES ON TABLE public.notification_producer_occurrences
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_producer_occurrences
  TO service_role;

CREATE TABLE IF NOT EXISTS public.notification_delivery_claims (
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

CREATE INDEX IF NOT EXISTS notification_delivery_claims_claimed_at_idx
  ON public.notification_delivery_claims(claimed_at);

CREATE INDEX IF NOT EXISTS notification_delivery_claims_event_id_idx
  ON public.notification_delivery_claims(notification_event_id);

CREATE INDEX IF NOT EXISTS notification_delivery_claims_employee_id_idx
  ON public.notification_delivery_claims(employee_id);

ALTER TABLE public.notification_delivery_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_claims
  FORCE ROW LEVEL SECURITY;
DO $delivery_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'notification_delivery_claims'
      AND policy.policyname =
        'notification_delivery_claims_service_role'
  ) THEN
    CREATE POLICY notification_delivery_claims_service_role
      ON public.notification_delivery_claims
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$delivery_policy$;
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

CREATE OR REPLACE FUNCTION public.claim_guarded_native_push_delivery(
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

CREATE OR REPLACE FUNCTION public.claim_guarded_notification_target_delivery(
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

-- Preserve M2's final event-id behavior directly. This retains a supplied
-- service-producer id for ordinary types and requires the five guarded types
-- to prove that id against the private occurrence ledger.
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
  v_body jsonb;
  v_event_id jsonb;
  v_guarded_event_id uuid;
  v_occurrence_valid boolean := false;
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

  IF v_url IS NULL OR v_url NOT IN (
    'https://dev.utahpros.app/api/notify',
    'https://utahpros.app/api/notify'
  ) OR NULLIF(btrim(v_secret), '') IS NULL THEN
    RETURN;
  END IF;

  v_body := COALESCE(p_body, '{}'::jsonb);
  v_event_id := v_body -> 'notification_event_id';

  IF p_type_key IN (
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ) THEN
    BEGIN
      v_guarded_event_id :=
        NULLIF(btrim(v_body ->> 'notification_event_id'), '')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN;
    END;

    IF v_guarded_event_id IS NULL
       OR to_regclass('public.notification_producer_occurrences') IS NULL THEN
      RETURN;
    END IF;

    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
        FROM public.notification_producer_occurrences occurrence
        WHERE occurrence.id = $1
          AND occurrence.type_key = $2
      )
    $query$
      INTO v_occurrence_valid
      USING v_guarded_event_id, p_type_key;

    IF v_occurrence_valid IS NOT TRUE THEN
      RETURN;
    END IF;

    v_event_id := to_jsonb(v_guarded_event_id::text);
  ELSIF v_event_id IS NULL
        OR jsonb_typeof(v_event_id) NOT IN ('string', 'number')
        OR NULLIF(btrim(v_body ->> 'notification_event_id'), '') IS NULL THEN
    v_event_id := to_jsonb(gen_random_uuid()::text);
  END IF;

  v_body := (v_body - 'type_key' - 'notification_event_id')
    || jsonb_build_object(
      'notification_event_id', v_event_id,
      'type_key', p_type_key
    );

  PERFORM net.http_post(
    url := v_url,
    body := v_body,
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
COMMENT ON FUNCTION public.notify_emit(text, jsonb)
  IS 'UPR notification producer/crew Phase-A composition v1: M2 event-id preservation with guarded producer occurrence validation';

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

-- Phase-A owns both crew RPC overloads and appointment mutation commands.

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

-- ─── 5. Composition postconditions and explicit containment ───────────────

CREATE TEMP TABLE IF NOT EXISTS upr_phase_a_composition_current (
  object_kind text NOT NULL,
  object_name text NOT NULL,
  fingerprint text NOT NULL,
  PRIMARY KEY (object_kind, object_name)
) ON COMMIT PRESERVE ROWS;

TRUNCATE TABLE pg_temp.upr_phase_a_composition_current;

INSERT INTO pg_temp.upr_phase_a_composition_current (
  object_kind,
  object_name,
  fingerprint
)
SELECT
  'function',
  procedure.oid::regprocedure::text,
  md5(concat_ws(
    '|',
    pg_get_functiondef(procedure.oid),
    procedure.proowner::text,
    procedure.prosecdef::text,
    procedure.proconfig::text,
    procedure.proacl::text,
    obj_description(procedure.oid, 'pg_proc')
  ))
FROM pg_proc procedure
WHERE COALESCE(
  obj_description(procedure.oid, 'pg_proc'),
  ''
) LIKE 'UPR appointment crew atomic save/audit repair v1:%'
UNION ALL
SELECT
  'policy',
  policy.tablename || ':' || policy.policyname,
  md5(concat_ws(
    '|',
    policy.cmd,
    policy.permissive,
    policy.roles::text,
    policy.qual,
    policy.with_check
  ))
FROM pg_policies policy
WHERE policy.schemaname = 'public'
  AND policy.tablename IN ('appointments', 'appointment_crew')
UNION ALL
SELECT
  'trigger',
  relation.relname || ':' || trigger_record.tgname,
  md5(concat_ws(
    '|',
    trigger_record.tgfoid::text,
    trigger_record.tgtype::text,
    trigger_record.tgenabled::text,
    trigger_record.tgqual::text,
    trigger_record.tgattr::text,
    trigger_record.tgnargs::text,
    encode(trigger_record.tgargs, 'hex'),
    trigger_record.tgconstraint::text
  ))
FROM pg_trigger trigger_record
JOIN pg_class relation
  ON relation.oid = trigger_record.tgrelid
WHERE trigger_record.tgrelid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass
  )
  AND trigger_record.tgname IN (
    'trg_appointments_atomic_command_guard',
    'trg_appointment_crew_actor_audit'
  )
  AND NOT trigger_record.tgisinternal
UNION ALL
SELECT
  'table-acl',
  relation.oid::regclass::text,
  md5(concat_ws(
    '|',
    relation.relowner::text,
    relation.relrowsecurity::text,
    relation.relforcerowsecurity::text,
    relation.relacl::text
  ))
FROM pg_class relation
WHERE relation.oid IN (
  'public.appointments'::regclass,
  'public.appointment_crew'::regclass,
  'public.system_events'::regclass
)
UNION ALL
SELECT
  'column-acl',
  attribute.attrelid::regclass::text || ':' || attribute.attname,
  md5(COALESCE(attribute.attacl::text, ''))
FROM pg_attribute attribute
WHERE attribute.attrelid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass,
    'public.system_events'::regclass
  )
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND EXISTS (
    SELECT 1
    FROM pg_temp.upr_phase_a_composition_snapshot snapshot
    WHERE snapshot.object_kind = 'column-acl'
      AND snapshot.object_name =
        attribute.attrelid::regclass::text || ':' || attribute.attname
  );

DO $composition_postflight$
DECLARE
  v_required constant text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed',
    'appointment.reminder'
  ]::text[];
  v_service_functions constant text[] := ARRAY[
    'public.notify_emit(text,jsonb)',
    'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
    'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
    'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
    'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
    'public.release_notification_delivery_claim(uuid)'
  ]::text[];
  v_signature text;
  v_function_oid oid;
  v_enabled text[];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      (
        SELECT
          snapshot.object_kind,
          snapshot.object_name,
          snapshot.fingerprint
        FROM pg_temp.upr_phase_a_composition_snapshot snapshot
        EXCEPT
        SELECT
          current_state.object_kind,
          current_state.object_name,
          current_state.fingerprint
        FROM pg_temp.upr_phase_a_composition_current current_state
      )
      UNION ALL
      (
        SELECT
          current_state.object_kind,
          current_state.object_name,
          current_state.fingerprint
        FROM pg_temp.upr_phase_a_composition_current current_state
        EXCEPT
        SELECT
          snapshot.object_kind,
          snapshot.object_name,
          snapshot.fingerprint
        FROM pg_temp.upr_phase_a_composition_snapshot snapshot
      )
    ) drift
  ) THEN
    RAISE EXCEPTION
      'notification/crew composition changed the Phase-A authority surface'
      USING ERRCODE = '55000';
  END IF;

  SELECT array_agg(catalog.type_key ORDER BY catalog.type_key)
  INTO v_enabled
  FROM public.notification_types catalog
  WHERE catalog.type_key = ANY (v_required)
    AND catalog.enabled IS TRUE;

  IF v_enabled IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM cron.job
       WHERE jobname = 'upr_appointment_reminders'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found activation drift (enabled %)',
      v_enabled
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       WHERE procedure.oid =
         to_regprocedure('public.notify_emit(text,jsonb)')
         AND pg_get_userbyid(procedure.proowner) = 'postgres'
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
         AND md5(procedure.prosrc) =
           'ea3a9b3b6cca96722c008d7e9b23f6bc'
         AND COALESCE(
           obj_description(procedure.oid, 'pg_proc'),
           ''
         ) LIKE
           'UPR notification producer/crew Phase-A composition v1:%'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found notify_emit source drift'
      USING ERRCODE = '55000';
  END IF;

  FOREACH v_signature IN ARRAY v_service_functions
  LOOP
    v_function_oid := to_regprocedure(v_signature);
    IF v_function_oid IS NULL
       OR has_function_privilege(
         'anon',
         v_function_oid,
         'EXECUTE'
       )
       OR has_function_privilege(
         'authenticated',
         v_function_oid,
         'EXECUTE'
       )
       OR NOT has_function_privilege(
         'service_role',
         v_function_oid,
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
         WHERE procedure.oid = v_function_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'notification/crew composition found service-function ACL drift: %',
        v_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF to_regprocedure(
       'public.emit_notification_producer_event(text,text,text,uuid,jsonb)'
     ) IS NULL
     OR has_function_privilege(
       'anon',
       'public.emit_notification_producer_event(text,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.emit_notification_producer_event(text,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.emit_notification_producer_event(text,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.require_notification_producer_actor(uuid,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition exposed an internal producer helper'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM (
         VALUES
           (
             'public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)',
             false,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)',
             false,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)',
             false,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)',
             false,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.release_notification_delivery_claim(uuid)',
             false,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.emit_notification_producer_event(text,text,text,uuid,jsonb)',
             true,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.require_notification_producer_actor(uuid,boolean)',
             true,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.bind_appointment_creator()',
             true,
             ARRAY['search_path=']::text[]
           ),
           (
             'public.trg_appt_notify()',
             true,
             ARRAY['search_path=public']::text[]
           ),
           (
             'public.trg_appt_crew_notify()',
             true,
             ARRAY['search_path=public']::text[]
           )
       ) AS expected(signature, security_definer, configuration)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_proc procedure
         WHERE procedure.oid = to_regprocedure(expected.signature)
           AND pg_get_userbyid(procedure.proowner) = 'postgres'
           AND procedure.prosecdef = expected.security_definer
           AND procedure.proconfig = expected.configuration
       )
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found producer function metadata drift'
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL
     OR NOT (
       SELECT relation.relrowsecurity AND relation.relforcerowsecurity
       FROM pg_class relation
       WHERE relation.oid =
         'public.notification_producer_occurrences'::regclass
     )
     OR NOT (
       SELECT relation.relrowsecurity AND relation.relforcerowsecurity
       FROM pg_class relation
       WHERE relation.oid =
         'public.notification_delivery_claims'::regclass
     )
     OR (
       SELECT count(*)
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name =
           'notification_producer_occurrences'
     ) IS DISTINCT FROM 6
     OR (
       SELECT count(*)
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name =
           'notification_delivery_claims'
     ) IS DISTINCT FROM 7
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('notification_producer_occurrences', 'id', 'uuid'),
           ('notification_producer_occurrences', 'type_key', 'text'),
           ('notification_producer_occurrences', 'occurrence_key', 'text'),
           ('notification_producer_occurrences', 'entity_type', 'text'),
           ('notification_producer_occurrences', 'entity_id', 'uuid'),
           (
             'notification_producer_occurrences',
             'created_at',
             'timestamptz'
           ),
           ('notification_delivery_claims', 'delivery_key', 'uuid'),
           (
             'notification_delivery_claims',
             'notification_event_id',
             'uuid'
           ),
           ('notification_delivery_claims', 'employee_id', 'uuid'),
           ('notification_delivery_claims', 'type_key', 'text'),
           ('notification_delivery_claims', 'channel', 'text'),
           (
             'notification_delivery_claims',
             'target_fingerprint',
             'uuid'
           ),
           (
             'notification_delivery_claims',
             'claimed_at',
             'timestamptz'
           )
       ) AS expected(table_name, column_name, udt_name)
       WHERE NOT EXISTS (
         SELECT 1
         FROM information_schema.columns column_record
         WHERE column_record.table_schema = 'public'
           AND column_record.table_name = expected.table_name
           AND column_record.column_name = expected.column_name
           AND column_record.udt_name = expected.udt_name
           AND column_record.is_nullable = 'NO'
       )
     )
     OR (
       SELECT count(*)
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
         'public.notification_producer_occurrences'::regclass
     ) IS DISTINCT FROM 5
     OR (
       SELECT count(*)
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid =
         'public.notification_delivery_claims'::regclass
     ) IS DISTINCT FROM 5
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           (
             'public.notification_producer_occurrences'::regclass,
             'notification_producer_occurrences_pkey'
           ),
           (
             'public.notification_producer_occurrences'::regclass,
             'notification_producer_occurrences_occurrence_key_key'
           ),
           (
             'public.notification_producer_occurrences'::regclass,
             'notification_producer_occurrences_type_key_fkey'
           ),
           (
             'public.notification_producer_occurrences'::regclass,
             'notification_producer_occurrences_type_check'
           ),
           (
             'public.notification_producer_occurrences'::regclass,
             'notification_producer_occurrences_key_check'
           ),
           (
             'public.notification_delivery_claims'::regclass,
             'notification_delivery_claims_pkey'
           ),
           (
             'public.notification_delivery_claims'::regclass,
             'notification_delivery_claims_notification_event_id_fkey'
           ),
           (
             'public.notification_delivery_claims'::regclass,
             'notification_delivery_claims_employee_id_fkey'
           ),
           (
             'public.notification_delivery_claims'::regclass,
             'notification_delivery_claims_channel_check'
           ),
           (
             'public.notification_delivery_claims'::regclass,
             'notification_delivery_claims_type_check'
           )
       ) AS expected(relation_id, constraint_name)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_constraint constraint_record
         WHERE constraint_record.conrelid = expected.relation_id
           AND constraint_record.conname = expected.constraint_name
       )
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found private-table shape drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'notification_producer_occurrences'
         AND policy.policyname =
           'notification_producer_occurrences_service_role'
         AND policy.cmd = 'SELECT'
         AND policy.roles = ARRAY['service_role'::name]
         AND policy.qual = 'true'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'notification_delivery_claims'
         AND policy.policyname =
           'notification_delivery_claims_service_role'
         AND policy.cmd = 'ALL'
         AND policy.roles = ARRAY['service_role'::name]
         AND policy.qual = 'true'
         AND policy.with_check = 'true'
     )
     OR (
       SELECT count(*)
       FROM pg_policies policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename IN (
           'notification_producer_occurrences',
           'notification_delivery_claims'
         )
     ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'notification/crew composition found private-table policy drift'
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege(
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
      'notification/crew composition found private-table ACL drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM information_schema.columns column_record
       WHERE column_record.table_schema = 'public'
         AND column_record.table_name = 'appointments'
         AND column_record.column_name = 'created_by_employee_id'
         AND column_record.data_type = 'uuid'
         AND column_record.is_nullable = 'YES'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint constraint_record
       WHERE constraint_record.conrelid = 'public.appointments'::regclass
         AND constraint_record.contype = 'f'
         AND constraint_record.confrelid = 'public.employees'::regclass
         AND pg_get_constraintdef(constraint_record.oid) ILIKE
           '%FOREIGN KEY (created_by_employee_id)%REFERENCES employees(id)%ON DELETE SET NULL%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_indexes index_record
       WHERE index_record.schemaname = 'public'
         AND index_record.tablename = 'appointments'
         AND index_record.indexname =
           'appointments_created_by_employee_id_idx'
         AND index_record.indexdef ILIKE
           '%(created_by_employee_id)%WHERE (created_by_employee_id IS NOT NULL)%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = 'public.appointments'::regclass
         AND trigger_record.tgname = 'trg_appointments_bind_creator'
         AND trigger_record.tgfoid =
           to_regprocedure('public.bind_appointment_creator()')
         AND trigger_record.tgtype = 23
         AND trigger_record.tgenabled IN ('O', 'A')
         AND NOT trigger_record.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found creator-provenance drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_indexes index_record
       WHERE index_record.schemaname = 'public'
         AND index_record.tablename =
           'notification_producer_occurrences'
         AND index_record.indexname =
           'notification_producer_occurrences_type_key_idx'
         AND index_record.indexdef ILIKE '%(type_key)%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_indexes index_record
       WHERE index_record.schemaname = 'public'
         AND index_record.tablename = 'notification_delivery_claims'
         AND index_record.indexname =
           'notification_delivery_claims_event_id_idx'
         AND index_record.indexdef ILIKE '%(notification_event_id)%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_indexes index_record
       WHERE index_record.schemaname = 'public'
         AND index_record.tablename = 'notification_delivery_claims'
         AND index_record.indexname =
           'notification_delivery_claims_employee_id_idx'
         AND index_record.indexdef ILIKE '%(employee_id)%'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found foreign-key index drift'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = 'public.appointments'::regclass
         AND trigger_record.tgname = 'trg_appointment_notify'
         AND trigger_record.tgfoid =
           to_regprocedure('public.trg_appt_notify()')
         AND trigger_record.tgtype = 17
         AND trigger_record.tgenabled IN ('O', 'A')
         AND NOT trigger_record.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid =
         'public.appointment_crew'::regclass
         AND trigger_record.tgname = 'trg_appointment_crew_notify'
         AND trigger_record.tgfoid =
           to_regprocedure('public.trg_appt_crew_notify()')
         AND trigger_record.tgtype = 5
         AND trigger_record.tgenabled IN ('O', 'A')
         AND NOT trigger_record.tgisinternal
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found producer-trigger drift'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.submit_time_entry_change_request(uuid,jsonb,text,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.submit_time_entry_change_request(uuid,jsonb,text,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.review_time_entry_change_request(uuid,boolean,uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.review_time_entry_change_request(uuid,boolean,uuid,text)',
       'EXECUTE'
     )
     OR has_table_privilege(
       'anon',
       'public.time_entry_change_requests',
       'SELECT'
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
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition found timesheet authorization drift'
      USING ERRCODE = '55000';
  END IF;
END;
$composition_postflight$;
