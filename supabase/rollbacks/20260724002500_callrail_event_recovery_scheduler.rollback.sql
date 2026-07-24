-- Operational rollback for 20260724002500_callrail_event_recovery_scheduler.
-- Retained provider events and the non-secret URL remain available for recovery.

SELECT cron.unschedule('upr_callrail_event_recovery')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'upr_callrail_event_recovery'
);

DROP FUNCTION IF EXISTS public.wake_callrail_event_recovery_worker();
