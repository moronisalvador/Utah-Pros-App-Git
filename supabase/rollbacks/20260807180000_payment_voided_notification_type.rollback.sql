-- ════════════════════════════════════════════════
-- ROLLBACK: 20260807180000_payment_voided_notification_type
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the "Payment voided" entry from the notification menu. Payments are
--   still removed from UPR exactly as before — the producer is fire-and-forget,
--   so once this row is gone dispatchEvent() returns { skipped: 'unknown_type' }
--   and removeQboPaymentFromUpr() carries on untouched. The only thing lost is
--   the alert itself, which returns the team to the 2026-08-07 behaviour where a
--   voided payment leaves its "Payment received" alert standing uncorrected.
--
--   The invoice Activity record of the void is NOT affected by this file. That
--   is written to public.invoice_activity by the same code path and needs no
--   catalog row, so the invoice page keeps showing "Payment removed" either way.
--
-- ORDER MATTERS:
--   notification_presentation_audit references notification_types with
--   ON DELETE RESTRICT, so its rows are cleared first. notification_prefs,
--   notification_role_defaults, notification_employee_overrides and
--   notification_presentation_overrides are all ON DELETE CASCADE and need no
--   explicit statement. No notification_role_defaults row is created by the
--   forward migration, so none is deleted here.
--
-- NOTE:
--   Deleting the type also discards any per-admin on/off choice. To stop the
--   alert while keeping the row and its history, run this instead and skip this
--   file:
--     UPDATE public.notification_types SET enabled = false
--      WHERE type_key = 'payment.voided';
--   Neither form needs a code deploy: dispatchEvent() reads the live table on
--   every call.
-- ════════════════════════════════════════════════

BEGIN;

DELETE FROM public.notification_presentation_audit
 WHERE type_key = 'payment.voided';

DELETE FROM public.notification_types
 WHERE type_key = 'payment.voided';

COMMIT;
