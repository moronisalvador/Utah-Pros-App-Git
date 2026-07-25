-- ════════════════════════════════════════════════
-- ROLLBACK: 20260725190000_ops_health_alerting
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Turns the "watchman" back off completely: stops the scheduled check,
--   removes the function it called, forgets the worker address, and removes the
--   alert type from the notification catalog.
--
-- SAFETY:
--   - Removes only objects this migration created. Nothing else is touched.
--   - No message, conversation, consent, or provider state is affected.
--   - The /api/ops-health Worker may stay deployed; with no schedule and no
--     notification type it becomes inert (any manual call finds the type
--     missing and dispatches nothing).
--   - Alerts already delivered to the bell remain; they are ordinary
--     notification rows and are intentionally NOT deleted here.
--   - The system_events dedupe markers (event_type='ops_health_alert') are
--     append-only history and are intentionally left in place.
-- ════════════════════════════════════════════════

SELECT cron.unschedule('upr_ops_health')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'upr_ops_health');

DROP FUNCTION IF EXISTS public.wake_ops_health_worker();

DELETE FROM public.integration_config
WHERE key = 'ops_health_worker_url';

DELETE FROM public.notification_types
WHERE type_key = 'ops.health';
