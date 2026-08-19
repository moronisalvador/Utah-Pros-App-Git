-- Reminder-absence overlay for the disposable notification qualification.
-- Runs AFTER seed-notification-producer-local.sql and removes the synthetic
-- appointment.reminder catalog row and the placeholder reminder cron that the
-- shared seed asserts, so the disposable stack matches qa-staging (reminder
-- foundation entirely absent) before the reminder-activation predecessors
-- apply.
--
-- WHY A SEPARATE FILE: the shared seed is a byte-pinned qualification input of
-- the LIVE appointment-crew repair (tests/qa/unit/appointment-crew-local-
-- qualification.test.js binds its SHA-256 to that receipt). Editing it in
-- place falsifies applied evidence; expressing the reminder branch's
-- absent-foundation requirement as this compensating overlay leaves the
-- pinned input byte-identical. Idempotent by construction — the qualifier may
-- run it any number of times.

DELETE FROM public.notification_types WHERE type_key = 'appointment.reminder';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upr_appointment_reminders') THEN
    PERFORM cron.unschedule('upr_appointment_reminders');
  END IF;
END $$;
