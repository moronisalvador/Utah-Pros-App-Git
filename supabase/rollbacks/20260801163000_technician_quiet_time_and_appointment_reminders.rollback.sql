-- Rollback: disable the reminder cron and remove only the additive feature objects.
SELECT cron.unschedule('upr_appointment_reminders');
DROP FUNCTION IF EXISTS public.dispatch_due_appointment_reminders();
DELETE FROM public.notification_types WHERE type_key = 'appointment.reminder';
DROP TABLE IF EXISTS public.appointment_reminder_claims;
DROP FUNCTION IF EXISTS public.set_my_notification_quiet_time(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_my_notification_quiet_time(uuid);
DROP TABLE IF EXISTS public.notification_quiet_time_preferences;
