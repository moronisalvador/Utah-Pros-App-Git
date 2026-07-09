-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_invoice_status_backfill_qbo_synced
-- Phase: n/a (standalone bugfix)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Some invoices were saved to QuickBooks but their status column was never
--   moved off "draft", so the app kept showing a DRAFT badge on an invoice that
--   is really a live QuickBooks invoice. This flips those already-in-QuickBooks
--   rows from "draft" to "sent" so the badge matches reality. Going forward the
--   qbo-invoice worker does this automatically on save; this only fixes the rows
--   that were already stuck.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Data-only UPDATE. No table DROP/RENAME/ALTER COLUMN, no schema change. Only
--   touches rows that already have a qbo_invoice_id AND status = 'draft'.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   No automatic undo — this corrects wrong data to the correct value. To revert
--   a specific row to draft (not recommended, it re-breaks the badge):
--     UPDATE invoices SET status = 'draft' WHERE invoice_number = 'INV-XXXXX';
-- ════════════════════════════════════════════════

UPDATE invoices
SET status = 'sent'
WHERE status = 'draft'
  AND qbo_invoice_id IS NOT NULL;
