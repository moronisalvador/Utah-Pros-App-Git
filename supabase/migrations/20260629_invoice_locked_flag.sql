-- Add an explicit per-invoice lock flag.
--
-- Locked invoices are read-only in the UPR billing UI (InvoiceEditor) even for
-- billing admins/managers — a guard against accidental edits to closed, fully-paid
-- A/R that is already reconciled with QuickBooks (e.g. old combined water+recon
-- invoices that UPR splits across two division rows pointing at one QBO invoice).
--
-- IMPORTANT — OPT-IN ONLY:
--   * Defaults to false.
--   * NEVER set automatically by any trigger, RPC, or app code path.
--   * App code (InvoiceEditor, qbo-invoice worker) only READS this column; nothing
--     writes it. An invoice becomes locked solely via an explicit manual UPDATE.
-- This keeps the guarantee that no invoice is ever locked automatically or by mistake.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN invoices.locked IS
  'Manual, opt-in read-only flag. When true the billing UI disables all edits for this invoice. Never set automatically — only by explicit manual update.';
