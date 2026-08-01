-- Technician notification quiet time and one-hour appointment reminders.
-- All schedule calculations use America/Denver because appointments store Denver
-- date/time wall-clock values. The claim table makes the minute cron idempotent.

CREATE TABLE public.notification_quiet_time_preferences (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_quiet_time_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_quiet_time_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_quiet_time_preferences_service_only
  ON public.notification_quiet_time_preferences FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.notification_quiet_time_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_quiet_time_preferences TO service_role;

CREATE FUNCTION public.get_my_notification_quiet_time(p_employee_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification quiet time only' USING errcode = '42501';
  END IF;
  RETURN COALESCE((SELECT enabled FROM public.notification_quiet_time_preferences WHERE employee_id = p_employee_id), false);
END;
$fn$;
CREATE FUNCTION public.set_my_notification_quiet_time(p_employee_id uuid, p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.is_current_native_push_preferences_employee(p_employee_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: own notification quiet time only' USING errcode = '42501';
  END IF;
  INSERT INTO public.notification_quiet_time_preferences (employee_id, enabled)
  VALUES (p_employee_id, p_enabled)
  ON CONFLICT (employee_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN p_enabled;
END;
$fn$;
ALTER FUNCTION public.get_my_notification_quiet_time(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_my_notification_quiet_time(uuid, boolean) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_my_notification_quiet_time(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_my_notification_quiet_time(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_notification_quiet_time(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_notification_quiet_time(uuid, boolean) TO authenticated, service_role;

CREATE TABLE public.appointment_reminder_claims (
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  appointment_starts_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, employee_id, appointment_starts_at)
);
ALTER TABLE public.appointment_reminder_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_reminder_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_reminder_claims_service_only ON public.appointment_reminder_claims
  FOR ALL TO service_role, postgres USING (true) WITH CHECK (true);
REVOKE ALL ON public.appointment_reminder_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.appointment_reminder_claims TO service_role;

INSERT INTO public.notification_types (type_key, label, description, category, audience, bell_default, push_default, email_default, enabled, sort_order)
VALUES ('appointment.reminder', 'Appointment in one hour', 'A reminder one hour before an assigned appointment starts.', 'appointments', 'The assigned crew member', true, true, false, true, 23)
ON CONFLICT (type_key) DO NOTHING;

CREATE FUNCTION public.dispatch_due_appointment_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_row record; v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT appointment.id, crew.employee_id,
      ((appointment.date + appointment.time_start) AT TIME ZONE 'America/Denver') AS starts_at
    FROM public.appointments appointment
    JOIN public.appointment_crew crew ON crew.appointment_id = appointment.id
    JOIN public.employees employee ON employee.id = crew.employee_id
    WHERE appointment.status = 'scheduled'
      AND appointment.time_start IS NOT NULL
      AND employee.is_active IS TRUE AND employee.is_external IS FALSE
      AND ((appointment.date + appointment.time_start) AT TIME ZONE 'America/Denver') >= now() + interval '59 minutes'
      AND ((appointment.date + appointment.time_start) AT TIME ZONE 'America/Denver') < now() + interval '61 minutes'
  LOOP
    INSERT INTO public.appointment_reminder_claims (appointment_id, employee_id, appointment_starts_at)
    VALUES (v_row.id, v_row.employee_id, v_row.starts_at)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public.notify_emit('appointment.reminder', jsonb_build_object(
        'appointment_id', v_row.id, 'employee_id', v_row.employee_id,
        'notification_event_id', concat(v_row.id, ':', v_row.employee_id, ':', v_row.starts_at)
      ));
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$fn$;
ALTER FUNCTION public.dispatch_due_appointment_reminders() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.dispatch_due_appointment_reminders() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_due_appointment_reminders() TO service_role;
SELECT cron.schedule('upr_appointment_reminders', '* * * * *', $$SELECT public.dispatch_due_appointment_reminders();$$);
SELECT public.bust_postgrest_cache();
