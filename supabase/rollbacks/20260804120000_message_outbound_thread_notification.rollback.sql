-- ════════════════════════════════════════════════
-- ROLLBACK: 20260804120000_message_outbound_thread_notification
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the "Teammate sent a text" and "Teammate left a note" entries from
--   the notification menu, so the team goes back to only being alerted when a
--   customer texts in. Everyone's other notification settings are untouched.
--
-- ORDER MATTERS:
--   notification_presentation_audit references notification_types with
--   ON DELETE RESTRICT, so its rows are cleared first. Everything else
--   (notification_prefs, notification_role_defaults,
--   notification_employee_overrides, notification_presentation_overrides)
--   is ON DELETE CASCADE and needs no explicit statement.
--
-- NOTE:
--   Deleting the types also discards any per-person on/off choices and any admin
--   copy edits for them. If the intent is only to STOP the alerts while keeping
--   that history, run this instead and skip this file:
--     UPDATE public.notification_types SET enabled = false
--      WHERE type_key IN ('message.outbound', 'message.note');
--   Either type can also be stopped on its own — they are independent rows.
--   Neither form needs a code deploy: the producer in send-message.js is
--   fire-and-forget and dispatchEvent already no-ops on a disabled or unknown
--   type.
-- ════════════════════════════════════════════════

BEGIN;

DELETE FROM public.notification_presentation_audit
 WHERE type_key IN ('message.outbound', 'message.note');

DELETE FROM public.notification_types
 WHERE type_key IN ('message.outbound', 'message.note');

COMMIT;
