-- ════════════════════════════════════════════════
-- MIGRATION: 20260803223000_appointment_reminder_delivery_claims
-- Phase: MOB-PUSH-017 appointment-reminder activation containment
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Gives appointment.reminder its own durable occurrence identity and atomic
--   current-target claims for bell, Web Push, email, and native Push. It does
--   not widen the exact-five guarded producer tables or type set.
--
--   Production already has the original reminder foundation. The seeded QA
--   branch and disposable qualification seed deliberately do not. This
--   migration accepts only those two exact predecessor shapes and creates the
--   same inert foundation when absent.
--
-- DEPENDS ON:
--   20260801215912_notification_producer_authorization
--   20260802040935_preserve_notify_emit_event_id
--   20260803221500_notification_activation_prerequisites
--
-- SAFETY:
--   appointment.reminder remains disabled and upr_appointment_reminders remains
--   unscheduled. All claim state is forced-RLS and service-only. Every claim
--   rechecks the stored occurrence, current scheduled start, current crew,
--   active/internal employee, and exact current delivery target atomically.
--
-- ROLLBACK:
--   The paired rollback disables/unschedules first, removes the new claim
--   boundary, restores the original dispatcher body, and preserves the inert
--   reminder foundation plus historical scheduler evidence.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_foundation_objects integer;
BEGIN
  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL
     OR to_regclass('public.native_push_delivery_claims') IS NULL
     OR to_regprocedure(
       'public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)'
     ) IS NULL
     OR to_regprocedure('public.notify_emit(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION
      'appointment reminder claims: notification producer predecessor missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid = to_regprocedure('public.notify_emit(text,jsonb)')
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) = 'ea3a9b3b6cca96722c008d7e9b23f6bc'
      AND obj_description(function_record.oid, 'pg_proc') IN (
        'upr:20260802040935:predecessor=baseline',
        'upr:20260802040935:predecessor=guarded'
      )
  ) THEN
    RAISE EXCEPTION
      'appointment reminder claims: notify_emit predecessor drift';
  END IF;

  IF to_regclass('public.notification_producer_occurrences_type_key_idx') IS NULL
     OR to_regclass('public.notification_delivery_claims_event_idx') IS NULL
     OR to_regclass('public.notification_delivery_claims_employee_idx') IS NULL THEN
    RAISE EXCEPTION
      'appointment reminder claims: prerequisite indexes missing';
  END IF;

  SELECT
    (to_regclass('public.notification_quiet_time_preferences') IS NOT NULL)::integer
    + (to_regclass('public.appointment_reminder_claims') IS NOT NULL)::integer
    + (to_regprocedure(
      'public.get_my_notification_quiet_time(uuid)'
    ) IS NOT NULL)::integer
    + (to_regprocedure(
      'public.set_my_notification_quiet_time(uuid,boolean)'
    ) IS NOT NULL)::integer
    + (to_regprocedure(
      'public.dispatch_due_appointment_reminders()'
    ) IS NOT NULL)::integer
    + EXISTS (
      SELECT 1
      FROM public.notification_types
      WHERE type_key = 'appointment.reminder'
    )::integer
  INTO v_foundation_objects;

  IF v_foundation_objects NOT IN (0, 6) THEN
    RAISE EXCEPTION
      'appointment reminder claims: partial reminder foundation (%)',
      v_foundation_objects;
  END IF;

  IF v_foundation_objects = 6 THEN
    IF NOT EXISTS (
         SELECT 1
         FROM pg_proc function_record
         WHERE function_record.oid =
           to_regprocedure('public.get_my_notification_quiet_time(uuid)')
           AND pg_get_userbyid(function_record.proowner) = 'postgres'
           AND function_record.prosecdef
           AND function_record.proconfig = ARRAY['search_path=public']::text[]
           AND md5(function_record.prosrc) =
             '3fd37ee2fdc99adbf560b1151d210492'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc function_record
         WHERE function_record.oid =
           to_regprocedure('public.set_my_notification_quiet_time(uuid,boolean)')
           AND pg_get_userbyid(function_record.proowner) = 'postgres'
           AND function_record.prosecdef
           AND function_record.proconfig = ARRAY['search_path=public']::text[]
           AND md5(function_record.prosrc) =
             '0fcb61523d6d8bd67a09cbfa021ff985'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc function_record
         WHERE function_record.oid =
           to_regprocedure('public.dispatch_due_appointment_reminders()')
           AND pg_get_userbyid(function_record.proowner) = 'postgres'
           AND function_record.prosecdef
           AND function_record.proconfig = ARRAY['search_path=public']::text[]
           AND md5(function_record.prosrc) =
             'c010eb4a4cab2f0d00ede467a47e4148'
       ) THEN
      RAISE EXCEPTION
        'appointment reminder claims: reminder function predecessor drift';
    END IF;

    IF (
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'appointment_reminder_claims'
        AND column_name IN (
          'appointment_id',
          'employee_id',
          'appointment_starts_at',
          'claimed_at'
        )
    ) IS DISTINCT FROM 4
       OR (
         SELECT count(*)
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'appointment_reminder_claims'
       ) IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION
        'appointment reminder claims: source table predecessor drift';
    END IF;
  END IF;

  IF EXISTS (
       SELECT 1
       FROM public.notification_types
       WHERE type_key = 'appointment.reminder'
         AND enabled
     )
     OR EXISTS (
       SELECT 1
       FROM cron.job
       WHERE jobname = 'upr_appointment_reminders'
     ) THEN
    RAISE EXCEPTION
      'appointment reminder claims: containment predecessor drift';
  END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.notification_quiet_time_preferences (
  employee_id uuid PRIMARY KEY
    REFERENCES public.employees(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_quiet_time_preferences
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_quiet_time_preferences
  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_quiet_time_preferences_service_only
  ON public.notification_quiet_time_preferences;
CREATE POLICY notification_quiet_time_preferences_service_only
  ON public.notification_quiet_time_preferences
  FOR ALL
  TO service_role, postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL PRIVILEGES ON TABLE
  public.notification_quiet_time_preferences
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.notification_quiet_time_preferences
TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_notification_quiet_time(
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification quiet time only' USING errcode = '42501';
  END IF;
  RETURN COALESCE((SELECT enabled FROM public.notification_quiet_time_preferences WHERE employee_id = p_employee_id), false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_notification_quiet_time(
  p_employee_id uuid,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification quiet time only' USING errcode = '42501';
  END IF;
  INSERT INTO public.notification_quiet_time_preferences (employee_id, enabled)
  VALUES (p_employee_id, p_enabled)
  ON CONFLICT (employee_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN p_enabled;
END;
$function$;

ALTER FUNCTION public.get_my_notification_quiet_time(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.set_my_notification_quiet_time(uuid, boolean)
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.get_my_notification_quiet_time(uuid),
  public.set_my_notification_quiet_time(uuid, boolean)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_my_notification_quiet_time(uuid),
  public.set_my_notification_quiet_time(uuid, boolean)
TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.appointment_reminder_claims (
  appointment_id uuid NOT NULL
    REFERENCES public.appointments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  appointment_starts_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, employee_id, appointment_starts_at)
);
ALTER TABLE public.appointment_reminder_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_reminder_claims
  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointment_reminder_claims_service_only
  ON public.appointment_reminder_claims;
CREATE POLICY appointment_reminder_claims_service_only
  ON public.appointment_reminder_claims
  FOR ALL
  TO service_role, postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL PRIVILEGES ON TABLE public.appointment_reminder_claims
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.appointment_reminder_claims
  TO service_role;

ALTER TABLE public.appointment_reminder_claims
  ADD COLUMN notification_event_id text NOT NULL
    DEFAULT gen_random_uuid()::text;
UPDATE public.appointment_reminder_claims
SET notification_event_id = concat(
  appointment_id,
  ':',
  employee_id,
  ':',
  appointment_starts_at
);
ALTER TABLE public.appointment_reminder_claims
  ALTER COLUMN notification_event_id DROP DEFAULT;
ALTER TABLE public.appointment_reminder_claims
  ADD CONSTRAINT appointment_reminder_claims_event_id_key
    UNIQUE (notification_event_id);
ALTER TABLE public.appointment_reminder_claims
  ADD CONSTRAINT appointment_reminder_claims_event_id_check
    CHECK (char_length(notification_event_id) BETWEEN 1 AND 300);
CREATE INDEX appointment_reminder_claims_employee_idx
  ON public.appointment_reminder_claims(employee_id);

INSERT INTO public.notification_types (
  type_key,
  label,
  description,
  category,
  audience,
  bell_default,
  push_default,
  email_default,
  enabled,
  sort_order
)
VALUES (
  'appointment.reminder',
  'Appointment in one hour',
  'A reminder one hour before an assigned appointment starts.',
  'appointments',
  'The assigned crew member',
  true,
  true,
  false,
  false,
  23
)
ON CONFLICT (type_key) DO UPDATE
SET enabled = false;

DO $unschedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'upr_appointment_reminders'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$unschedule$;

CREATE TABLE public.appointment_reminder_delivery_claims (
  delivery_key uuid PRIMARY KEY,
  notification_event_id text NOT NULL
    REFERENCES public.appointment_reminder_claims(notification_event_id)
      ON DELETE CASCADE,
  employee_id uuid NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  channel text NOT NULL,
  target_fingerprint uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_reminder_delivery_claims_channel_check
    CHECK (channel IN ('bell', 'pwa_push', 'email'))
);
CREATE INDEX appointment_reminder_delivery_claims_event_idx
  ON public.appointment_reminder_delivery_claims(notification_event_id);
CREATE INDEX appointment_reminder_delivery_claims_employee_idx
  ON public.appointment_reminder_delivery_claims(employee_id);
ALTER TABLE public.appointment_reminder_delivery_claims
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_reminder_delivery_claims
  FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_reminder_delivery_claims_service_role
  ON public.appointment_reminder_delivery_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL PRIVILEGES ON TABLE
  public.appointment_reminder_delivery_claims
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE
  public.appointment_reminder_delivery_claims
TO service_role;

CREATE FUNCTION public.validate_appointment_reminder_delivery(
  p_notification_event_id text,
  p_appointment_id uuid,
  p_employee_id uuid
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
      FROM public.notification_types notification_type
      WHERE notification_type.type_key = 'appointment.reminder'
        AND notification_type.enabled IS TRUE
    )
    AND EXISTS (
      SELECT 1
      FROM public.appointment_reminder_claims reminder
      JOIN public.appointments appointment
        ON appointment.id = reminder.appointment_id
      JOIN public.appointment_crew crew
        ON crew.appointment_id = reminder.appointment_id
       AND crew.employee_id = reminder.employee_id
      JOIN public.employees employee
        ON employee.id = reminder.employee_id
      WHERE reminder.notification_event_id = p_notification_event_id
        AND reminder.appointment_id = p_appointment_id
        AND reminder.employee_id = p_employee_id
        AND appointment.status = 'scheduled'
        AND appointment.time_start IS NOT NULL
        AND (
          (appointment.date + appointment.time_start)
            AT TIME ZONE 'America/Denver'
        ) = reminder.appointment_starts_at
        AND reminder.appointment_starts_at >=
          now() + interval '50 minutes'
        AND reminder.appointment_starts_at <
          now() + interval '70 minutes'
        AND employee.is_active IS TRUE
        AND employee.is_external IS FALSE
    );
$function$;

CREATE FUNCTION public.claim_appointment_reminder_delivery(
  p_delivery_key uuid,
  p_notification_event_id text,
  p_employee_id uuid,
  p_appointment_id uuid,
  p_channel text,
  p_target_fingerprint uuid,
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

  IF p_channel NOT IN ('bell', 'pwa_push', 'email') THEN
    RAISE EXCEPTION 'unsupported appointment reminder channel'
      USING ERRCODE = '22023';
  END IF;

  -- Bounded expiry sweep, mirroring the sibling claim functions in
  -- 20260801215912 — nothing else will ever prune this reminder-specific
  -- table, so without it the claims grow unbounded once reminders activate.
  WITH expired_claims AS (
    SELECT existing.delivery_key
    FROM public.appointment_reminder_delivery_claims existing
    WHERE existing.claimed_at < now() - interval '90 days'
    ORDER BY existing.claimed_at
    LIMIT 1000
  )
  DELETE FROM public.appointment_reminder_delivery_claims existing
  USING expired_claims
  WHERE existing.delivery_key = expired_claims.delivery_key;

  INSERT INTO public.appointment_reminder_delivery_claims (
    delivery_key,
    notification_event_id,
    employee_id,
    channel,
    target_fingerprint
  )
  SELECT
    p_delivery_key,
    p_notification_event_id,
    p_employee_id,
    p_channel,
    p_target_fingerprint
  WHERE public.validate_appointment_reminder_delivery(
    p_notification_event_id,
    p_appointment_id,
    p_employee_id
  )
    AND (
      (
        p_channel = 'bell'
        AND p_source_id IS NULL
        AND p_target = p_employee_id::text
      )
      OR (
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

CREATE FUNCTION public.release_appointment_reminder_delivery_claim(
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

  DELETE FROM public.appointment_reminder_delivery_claims
  WHERE delivery_key = p_delivery_key;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count > 0;
END;
$function$;

CREATE FUNCTION public.claim_appointment_reminder_native_delivery(
  p_delivery_key uuid,
  p_notification_event_id text,
  p_employee_id uuid,
  p_appointment_id uuid,
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

  INSERT INTO public.native_push_delivery_claims (
    delivery_key,
    employee_id,
    device_fingerprint
  )
  SELECT
    p_delivery_key,
    p_employee_id,
    p_device_fingerprint
  WHERE public.validate_appointment_reminder_delivery(
    p_notification_event_id,
    p_appointment_id,
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

ALTER FUNCTION public.validate_appointment_reminder_delivery(text, uuid, uuid)
  OWNER TO postgres;
ALTER FUNCTION public.claim_appointment_reminder_delivery(
  uuid,
  text,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text
) OWNER TO postgres;
ALTER FUNCTION public.release_appointment_reminder_delivery_claim(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.claim_appointment_reminder_native_delivery(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION
  public.validate_appointment_reminder_delivery(text, uuid, uuid),
  public.claim_appointment_reminder_delivery(
    uuid,
    text,
    uuid,
    uuid,
    text,
    uuid,
    uuid,
    text
  ),
  public.release_appointment_reminder_delivery_claim(uuid),
  public.claim_appointment_reminder_native_delivery(
    uuid,
    text,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text
  )
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.validate_appointment_reminder_delivery(text, uuid, uuid),
  public.claim_appointment_reminder_delivery(
    uuid,
    text,
    uuid,
    uuid,
    text,
    uuid,
    uuid,
    text
  ),
  public.release_appointment_reminder_delivery_claim(uuid),
  public.claim_appointment_reminder_native_delivery(
    uuid,
    text,
    uuid,
    uuid,
    uuid,
    uuid,
    text,
    text
  )
TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_due_appointment_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
  v_notification_event_id text;
BEGIN
  FOR v_row IN
    SELECT
      appointment.id,
      crew.employee_id,
      (
        (appointment.date + appointment.time_start)
          AT TIME ZONE 'America/Denver'
      ) AS starts_at
    FROM public.appointments appointment
    JOIN public.appointment_crew crew
      ON crew.appointment_id = appointment.id
    JOIN public.employees employee
      ON employee.id = crew.employee_id
    WHERE appointment.status = 'scheduled'
      AND appointment.time_start IS NOT NULL
      AND employee.is_active IS TRUE
      AND employee.is_external IS FALSE
      AND (
        (appointment.date + appointment.time_start)
          AT TIME ZONE 'America/Denver'
      ) >= now() + interval '59 minutes'
      AND (
        (appointment.date + appointment.time_start)
          AT TIME ZONE 'America/Denver'
      ) < now() + interval '61 minutes'
  LOOP
    v_notification_event_id := concat(
      v_row.id,
      ':',
      v_row.employee_id,
      ':',
      v_row.starts_at
    );

    INSERT INTO public.appointment_reminder_claims (
      appointment_id,
      employee_id,
      appointment_starts_at,
      notification_event_id
    )
    VALUES (
      v_row.id,
      v_row.employee_id,
      v_row.starts_at,
      v_notification_event_id
    )
    ON CONFLICT (
      appointment_id,
      employee_id,
      appointment_starts_at
    ) DO UPDATE
    SET notification_event_id =
      public.appointment_reminder_claims.notification_event_id
    RETURNING notification_event_id
      INTO v_notification_event_id;

    -- Re-emit the same durable occurrence during the bounded due window. If a
    -- prior pg_net/config/Worker hop failed before dispatch, the next minute
    -- gets another chance. Recipient/channel claims make a delivered replay a
    -- no-op rather than a duplicate alert.
    PERFORM public.notify_emit(
      'appointment.reminder',
      jsonb_build_object(
        'appointment_id',
        v_row.id,
        'employee_id',
        v_row.employee_id,
        'notification_event_id',
        v_notification_event_id
      )
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

ALTER FUNCTION public.dispatch_due_appointment_reminders()
  OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.dispatch_due_appointment_reminders()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_due_appointment_reminders()
  TO service_role;

DO $postflight$
DECLARE
  v_function oid;
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.notification_types
       WHERE type_key = 'appointment.reminder'
         AND enabled
     )
     OR EXISTS (
       SELECT 1
       FROM cron.job
       WHERE jobname = 'upr_appointment_reminders'
     ) THEN
    RAISE EXCEPTION
      'appointment reminder claims: containment postflight failed';
  END IF;

  IF to_regclass('public.appointment_reminder_delivery_claims') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class table_record
       WHERE table_record.oid =
         'public.appointment_reminder_delivery_claims'::regclass
         AND pg_get_userbyid(table_record.relowner) = 'postgres'
         AND table_record.relrowsecurity
         AND table_record.relforcerowsecurity
     )
     OR EXISTS (
       SELECT 1
       FROM pg_class table_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           table_record.relacl,
           acldefault('r', table_record.relowner)
         )
       ) acl
       WHERE table_record.oid =
         'public.appointment_reminder_delivery_claims'::regclass
         AND acl.grantee = 0
         AND acl.privilege_type IN (
           'SELECT',
           'INSERT',
           'UPDATE',
           'DELETE',
           'TRUNCATE',
           'REFERENCES',
           'TRIGGER'
         )
     )
     OR has_table_privilege(
       'anon',
       'public.appointment_reminder_delivery_claims',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR has_table_privilege(
       'authenticated',
       'public.appointment_reminder_delivery_claims',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'appointment reminder claims: delivery table postflight failed';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    to_regprocedure(
      'public.validate_appointment_reminder_delivery(text,uuid,uuid)'
    ),
    to_regprocedure(
      'public.claim_appointment_reminder_delivery(uuid,text,uuid,uuid,text,uuid,uuid,text)'
    ),
    to_regprocedure(
      'public.release_appointment_reminder_delivery_claim(uuid)'
    ),
    to_regprocedure(
      'public.claim_appointment_reminder_native_delivery(uuid,text,uuid,uuid,uuid,uuid,text,text)'
    )
  ]
  LOOP
    IF v_function IS NULL
       OR EXISTS (
         SELECT 1
         FROM pg_proc function_record
         CROSS JOIN LATERAL aclexplode(
           COALESCE(
             function_record.proacl,
             acldefault('f', function_record.proowner)
           )
         ) acl
         WHERE function_record.oid = v_function
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc function_record
         WHERE function_record.oid = v_function
           AND pg_get_userbyid(function_record.proowner) = 'postgres'
           AND NOT function_record.prosecdef
           AND function_record.proconfig = ARRAY['search_path=""']::text[]
       ) THEN
      RAISE EXCEPTION
        'appointment reminder claims: function ACL/property postflight failed';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function_record
    WHERE function_record.oid =
      to_regprocedure('public.dispatch_due_appointment_reminders()')
      AND pg_get_userbyid(function_record.proowner) = 'postgres'
      AND function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=public']::text[]
      AND md5(function_record.prosrc) =
        'a0d8bbb5a8e871903330499c7d7e4d3b'
  ) THEN
    RAISE EXCEPTION
      'appointment reminder claims: dispatcher postflight failed';
  END IF;

  -- The dispatcher's ACL was previously unasserted here — the one function of
  -- the seven whose EXECUTE grants the postflight did not re-verify, on the
  -- managed project that re-adds PUBLIC EXECUTE on every replaced
  -- function (2026-08-15 review finding).
  IF EXISTS (
       SELECT 1
       FROM pg_proc function_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(
           function_record.proacl,
           acldefault('f', function_record.proowner)
         )
       ) acl
       WHERE function_record.oid =
         to_regprocedure('public.dispatch_due_appointment_reminders()')
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon',
       to_regprocedure('public.dispatch_due_appointment_reminders()'), 'EXECUTE')
     OR has_function_privilege('authenticated',
       to_regprocedure('public.dispatch_due_appointment_reminders()'), 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       to_regprocedure('public.dispatch_due_appointment_reminders()'), 'EXECUTE') THEN
    RAISE EXCEPTION
      'appointment reminder claims: dispatcher ACL postflight failed';
  END IF;

  -- Same completeness gap for the two caller-validated quiet-time functions:
  -- SECURITY DEFINER, so PUBLIC leakage here would be reachable pre-login.
  FOREACH v_function IN ARRAY ARRAY[
    to_regprocedure('public.get_my_notification_quiet_time(uuid)'),
    to_regprocedure('public.set_my_notification_quiet_time(uuid,boolean)')
  ]
  LOOP
    IF v_function IS NULL
       OR EXISTS (
         SELECT 1
         FROM pg_proc function_record
         CROSS JOIN LATERAL aclexplode(
           COALESCE(
             function_record.proacl,
             acldefault('f', function_record.proowner)
           )
         ) acl
         WHERE function_record.oid = v_function
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc function_record
         WHERE function_record.oid = v_function
           AND pg_get_userbyid(function_record.proowner) = 'postgres'
           AND function_record.prosecdef
           AND function_record.proconfig = ARRAY['search_path=public']::text[]
       ) THEN
      RAISE EXCEPTION
        'appointment reminder claims: quiet-time function ACL postflight failed';
    END IF;
  END LOOP;
END;
$postflight$;
