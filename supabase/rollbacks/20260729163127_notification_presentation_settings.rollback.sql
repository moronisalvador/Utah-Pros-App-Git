-- ============================================================================
-- ROLLBACK: notification presentation settings
-- ============================================================================
-- Removes only the additive service-only function and tables introduced by
-- 20260729163127_notification_presentation_settings.sql.
-- Application rollback should stop reading overrides first. Applying this SQL
-- permanently removes audit history and therefore requires owner confirmation.
-- ============================================================================

DROP FUNCTION IF EXISTS public.mutate_notification_presentation(
  uuid, text, text, text, jsonb, bigint, uuid
);
DROP TABLE IF EXISTS public.notification_presentation_audit;
DROP TABLE IF EXISTS public.notification_presentation_overrides;
