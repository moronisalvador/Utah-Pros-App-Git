-- ════════════════════════════════════════════════
-- FILE: 20260729211728_twilio_inbound_notification_parity.rollback.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the inactive Twilio database operation added by the paired
--   migration. Saved messages, events, consent history, and alert jobs remain.
--
-- DEPENDS ON:
--   20260729211728_twilio_inbound_notification_parity.sql
--
-- NOTES / GOTCHAS:
--   - Roll back compatible Worker code first so no request can call the
--     function while it is removed.
--   - This intentionally does not delete durable history.
-- ════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.project_twilio_inbound_event(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.project_twilio_inbound_event(uuid, boolean);

COMMIT;
