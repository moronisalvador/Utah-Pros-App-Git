-- ════════════════════════════════════════════════
-- MIGRATION: 20260724200000_payments_qbo_dedup_index
-- Phase: QBO Payments — two-way sync hardening (n/a standalone)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes it physically impossible for the same QuickBooks payment to be recorded twice
--   against the same invoice. Today two different jobs bring payments in from QuickBooks —
--   the real-time webhook and the hourly catch-up poller — and both check "have I already
--   got this one?" by reading first and then writing. If they ever run at the same moment
--   for the same payment, both can read "no" and both can write, so the invoice would show
--   the money twice. This adds a database rule that simply refuses the second write.
--
--   It deliberately still ALLOWS one QuickBooks payment to be split across DIFFERENT
--   invoices — that is the sanctioned multi-trade case (one payment covering a mitigation
--   invoice and a reconstruction invoice), per UPR-QBO-SYNC-PROTOCOL rule 11. Only the
--   same-payment-on-the-same-invoice combination is blocked.
--
-- ADDITIVE-ONLY:
--   One partial UNIQUE index. No table, column, policy, function, or data change. Mirrors
--   the existing `payments_stripe_charge_uniq` precedent already on this table.
--
-- SAFETY / PRECONDITION (verified live 2026-07-24 before authoring):
--   SELECT count(*) FROM (SELECT qbo_payment_id, invoice_id FROM payments
--     WHERE qbo_payment_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) v;  -->  0
--   So the index builds cleanly against current data. The 5 qbo_payment_ids that appear on
--   more than one row are all split across 2 DISTINCT invoices (legitimate rule-11 splits)
--   and are unaffected.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.payments_qbo_payment_invoice_uniq;
-- ════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS payments_qbo_payment_invoice_uniq
  ON public.payments (qbo_payment_id, invoice_id)
  WHERE qbo_payment_id IS NOT NULL;
