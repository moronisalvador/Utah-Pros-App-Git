-- ════════════════════════════════════════════════
-- ROLLBACK: 20260805030000_crm_weekly_digest_notification_type
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the "Weekly CRM digest" entry from the notification menu. The
--   worker keeps running — resolveRecipients() simply finds no admin with an
--   effective preference for the now-absent type and falls back to the
--   pre-existing static recipient list (env var / integration_config row), so
--   this cannot stop the digest from sending, only stop it from being
--   controllable per-admin.
--
-- ORDER MATTERS:
--   notification_presentation_audit references notification_types with
--   ON DELETE RESTRICT, so its rows are cleared first (there should be none
--   for this type — it has no bell/push presentation surface — but this
--   mirrors 20260804120000_message_outbound_thread_notification.rollback.sql
--   for safety). notification_prefs, notification_role_defaults,
--   notification_employee_overrides and notification_presentation_overrides
--   are all ON DELETE CASCADE and need no explicit statement.
--
-- NOTE:
--   Deleting the type also discards any per-admin on/off choice. If the
--   intent is only to STOP admins from receiving it via this preference while
--   keeping the row and history, run this instead and skip this file:
--     UPDATE public.notification_role_defaults SET enabled = false
--      WHERE role = 'admin' AND type_key = 'crm_weekly_digest' AND channel = 'email';
--   Neither form needs a code deploy: weekly-crm-digest.js's
--   resolvePreferenceRecipients() reads the live table state on every run.
-- ════════════════════════════════════════════════

BEGIN;

DELETE FROM public.notification_presentation_audit
 WHERE type_key = 'crm_weekly_digest';

DELETE FROM public.notification_role_defaults
 WHERE role = 'admin' AND type_key = 'crm_weekly_digest' AND channel = 'email';

DELETE FROM public.notification_types
 WHERE type_key = 'crm_weekly_digest';

COMMIT;
