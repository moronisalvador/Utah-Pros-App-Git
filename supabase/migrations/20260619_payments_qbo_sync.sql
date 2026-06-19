-- 20260619_payments_qbo_sync.sql
-- One-way payment sync (UPR -> QuickBooks): track each payment's QBO mirror.
-- UPR remains the system of record; payments are entered in UPR and pushed to QBO
-- as a Payment applied to the invoice. These columns let the qbo-payment worker
-- create/delete the QBO Payment and surface sync errors (mirrors invoices.qbo_*).

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS qbo_payment_id text,
  ADD COLUMN IF NOT EXISTS qbo_synced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS qbo_sync_error text;
