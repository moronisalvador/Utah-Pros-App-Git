-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_invoice_saved_status_tier
-- Phase: n/a (standalone billing UX fix)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a new "saved" step to an invoice's life between "draft" and "sent". An
--   invoice is a Draft until it's saved to QuickBooks; then it's Saved (recorded
--   in QuickBooks, but not yet emailed to the customer); and only after you press
--   "Send to customer" is it Sent. Before this, saving to QuickBooks left it stuck
--   on "draft", and there was no way to tell "saved but not emailed" from "emailed".
--   This widens the allowed status values to include "saved" and reclassifies the
--   existing invoices that are in QuickBooks but were never emailed to "saved".
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Widen-only CHECK swap (adds the value 'saved'; every previously-valid value
--   still validates) + a data-only UPDATE. No column DROP/RENAME/type change.
--   The UPDATE touches only unpaid, in-QuickBooks, never-emailed rows; paid /
--   partially_paid rows are left untouched.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   -- 1. move the new tier back to the closest old value (best-effort; the
--   --    original draft-vs-sent split for these rows is not recoverable):
--   UPDATE public.invoices SET status = 'sent'
--     WHERE status = 'saved' AND qbo_invoice_id IS NOT NULL;
--   UPDATE public.invoices SET status = 'draft'
--     WHERE status = 'saved';
--   -- 2. restore the pre-widen CHECK:
--   ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
--   ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
--     CHECK (status = ANY (ARRAY['draft','sent','viewed','partially_paid',
--            'paid','overdue','voided','disputed']));
-- ════════════════════════════════════════════════

-- Widen the allowed statuses to include the new 'saved' tier (additive value).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY['draft','saved','sent','viewed','partially_paid',
         'paid','overdue','voided','disputed']));

-- Reclassify existing invoices that reached QuickBooks but have no record of ever
-- being emailed (no email timestamp / recipient / QBO email status) into 'saved'.
-- 'sent' now means "actually emailed to the customer", which only the Send action
-- stamps going forward. paid / partially_paid are left as-is (higher-precedence).
UPDATE public.invoices
SET status = 'saved'
WHERE qbo_invoice_id IS NOT NULL
  AND status IN ('draft', 'sent')
  AND qbo_emailed_at IS NULL;
