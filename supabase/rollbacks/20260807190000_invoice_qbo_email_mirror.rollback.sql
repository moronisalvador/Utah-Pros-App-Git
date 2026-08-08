-- ════════════════════════════════════════════════
-- ROLLBACK: 20260807190000_invoice_qbo_email_mirror
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Undoes the invoice email-visibility migration: removes the two columns it
--   added and puts the old wording back on the column comment it reworded.
--
-- ORDER MATTERS (database-standard.md §3, frontend-contract freeze):
--   Deploy the reverted application code FIRST, then run this. One Supabase sits
--   behind both dev and production, so dropping a column a deployed frontend
--   still selects breaks production immediately. The readers to retire first are
--   src/lib/invoiceEmailStatus.js and its three callers (InvoiceEditor.jsx,
--   ClaimBilling.jsx, tech/admin/AdminInvoiceDetail.jsx), plus the worker mirror
--   in functions/lib/qbo-invoice-email-mirror.js and its three call sites.
--
-- WHAT IS LOST:
--   Every observation of QuickBooks' own EmailStatus and BillEmail. qbo_emailed_at
--   (UPR-triggered sends) is untouched and survives, so the pre-migration
--   behaviour returns intact -- the surfaces go back to reading
--   "Not emailed from UPR" for a QuickBooks-side send.
--
-- NOT DESTRUCTIVE TO ANY PRE-EXISTING VALUE:
--   qbo_email_status is deliberately NOT dropped. It predates this migration
--   (20260624_invoice_qbo_email_status.sql) and is read by the CRM contact
--   activity projections; only its comment is restored.
-- ════════════════════════════════════════════════

-- destructive-approved: reverts this migration's OWN two additive columns only.
-- Both were introduced by 20260807190000; no pre-existing column, value, policy,
-- grant or function is removed. Run only after the reverted frontend is deployed.
ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS qbo_bill_email,
  DROP COLUMN IF EXISTS qbo_email_checked_at;

-- Restore the comment exactly as 20260624_invoice_qbo_email_status.sql set it.
COMMENT ON COLUMN public.invoices.qbo_email_status IS
  'QBO EmailStatus after the most recent send (e.g. EmailSent).';

NOTIFY pgrst, 'reload schema';
