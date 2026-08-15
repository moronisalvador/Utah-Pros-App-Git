-- ════════════════════════════════════════════════
-- MIGRATION: 20260807180000_payment_voided_notification_type
-- Phase: n/a (standalone owner-requested change)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds "Payment voided" to the notification catalog, so that when a payment
--   is voided or deleted in QuickBooks the team is told — instead of being left
--   with the earlier "Payment received" alert pointing at an invoice that no
--   longer has a payment on it.
--
--   On 2026-08-07 a $2,797.82 payment for A2Z Properties was recorded in
--   QuickBooks and voided 26 seconds later. UPR mirrored both actions correctly,
--   but only the first one was announced, so the owner opened an untouched
--   invoice wondering what the alert had meant. This row is the other half of
--   that pair.
--
-- ADDITIVE-ONLY:
--   Yes. One INSERT of one catalog row into public.notification_types. No table
--   DROP/RENAME/ALTER COLUMN, no function replaced, no grant or policy changed,
--   no existing row updated, no data backfilled. ON CONFLICT DO NOTHING makes it
--   safe to re-run.
--
--   Seeded enabled = true and defaults copied from payment.received (bell, push
--   and email all on), because this alert exists to correct one that was already
--   delivered on those same channels — a retraction reaching fewer people than
--   the claim it retracts is worse than no retraction. Audience is Admins, set by
--   the emitter's role-scoped query in functions/api/notify.js exactly like
--   payment.received; no notification_role_defaults row is needed (see
--   20260805030000, which needed one only because it has no emitter).
--
--   sort_order 41 places it directly under payment.received (40) in the billing
--   category, so the pair reads together in Settings → Notifications.
--
--   A catalog row does nothing on its own. The producer is notifyPaymentVoided()
--   in functions/lib/qbo-payment-sync.js, reached from removeQboPaymentFromUpr().
--   Applying this before or after that code deploys is equally safe: until the
--   code ships nothing dispatches this type_key, and until this row exists
--   dispatchEvent() returns { skipped: 'unknown_type' } and the removal path
--   continues untouched. The producer is fire-and-forget in both directions, so
--   neither ordering can affect whether a payment is removed correctly.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260807180000_payment_voided_notification_type.rollback.sql
--   Clears notification_presentation_audit rows for this type_key (that FK is ON
--   DELETE RESTRICT, mirroring 20260804120000 and 20260805030000), then deletes
--   the notification_types row; notification_prefs and
--   notification_employee_overrides cascade on delete of the type.
--
--   Deleting the row is also the instant kill switch: the producer's
--   dispatchEvent() call immediately returns { skipped: 'unknown_type' } and
--   payment removal is unaffected. A softer stop that keeps the row and its
--   history:
--     UPDATE public.notification_types SET enabled = false
--      WHERE type_key = 'payment.voided';
-- ════════════════════════════════════════════════

INSERT INTO public.notification_types
  (type_key, label, description, category, audience,
   bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('payment.voided',
   'Payment voided',
   'A payment that had been recorded was voided or deleted in QuickBooks, so '
     || 'the invoice is owed again. Retracts the earlier "Payment received" alert.',
   'billing',
   'Admins',
   true, true, true, true, 41)
ON CONFLICT (type_key) DO NOTHING;
