-- Operational rollback for 20260724001500_message_notification_outbox_scheduler.
-- Pending/retryable outbox rows are retained so delivery can resume safely later.

SELECT cron.unschedule('upr_message_notification_outbox')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'upr_message_notification_outbox'
);

DROP TRIGGER IF EXISTS message_notification_outbox_dispatch
  ON public.message_notification_outbox;

DROP FUNCTION IF EXISTS public.trigger_message_notification_outbox_worker();
DROP FUNCTION IF EXISTS public.wake_message_notification_outbox_worker();
