-- ============================================================================
-- ROLLBACK: notification delivery diagnostic claims
-- ============================================================================
-- Removes only the additive service-only functions and claim history introduced
-- by 20260729181049_notification_delivery_diagnostic_claims.sql. Application
-- rollback should stop calling the claim RPCs before this destructive cleanup.
-- ============================================================================

DROP FUNCTION IF EXISTS public.complete_notification_delivery_diagnostic(
  uuid,
  text,
  uuid,
  jsonb
);
DROP FUNCTION IF EXISTS public.claim_notification_delivery_diagnostic(
  uuid,
  text,
  uuid
);
DROP TABLE IF EXISTS public.notification_delivery_diagnostic_claims;
