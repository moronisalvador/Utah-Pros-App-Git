-- ════════════════════════════════════════════════
-- MIGRATION: 20260807190000_invoice_qbo_email_mirror
-- Phase: n/a (standalone — invoice email visibility)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Today UPR can only see the invoice emails it sent itself. If somebody emails
--   an invoice from inside QuickBooks, UPR shows nothing, and if QuickBooks is
--   sending to a different address than the customer contact we have on file,
--   nobody can see that either. This adds two places to record what QuickBooks
--   itself reports: the address QuickBooks will email the invoice to, and when
--   we last looked. It changes no existing value and no existing behaviour.
--
-- ADDITIVE-ONLY:
--   Yes. Two nullable columns on public.invoices, plus two COMMENT changes. No
--   table DROP/RENAME, no ALTER of an existing column's type or nullability, no
--   policy, grant, trigger, function or data change. `invoices` is granted at the
--   table level (not per column), so both columns are readable through the
--   existing RLS policies with no policy edit.
--
--   Deliberately NOT touched, because a database trigger or a money/CRM rule owns
--   each one: qbo_emailed_at (UPR-send truth; watched by
--   trg_invoice_qbo_lifecycle_status and crm_invoice_lead_value_sync), status,
--   amount_paid, paid_at, sent_at. Writers of the two new columns must not write
--   those either -- see functions/lib/qbo-invoice-email-mirror.js.
--
-- WHY A SEPARATE `checked_at`:
--   Without it, a null qbo_email_status is ambiguous between "QuickBooks says it
--   was never emailed" and "UPR has never asked QuickBooks". Those are opposite
--   answers for the person reading the invoice, and collapsing them is exactly
--   the blindness this migration exists to remove (real case 2026-08-07:
--   INV-000065 / qbo_doc_number W-2606-005 / qbo_invoice_id 4839 read
--   "Not emailed" while QuickBooks reported EmailStatus = EmailSent to
--   invoices@presidiopm.com).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260807190000_invoice_qbo_email_mirror.rollback.sql
--   Concretely:
--     ALTER TABLE public.invoices
--       DROP COLUMN IF EXISTS qbo_bill_email,
--       DROP COLUMN IF EXISTS qbo_email_checked_at;
--     COMMENT ON COLUMN public.invoices.qbo_email_status IS
--       'QBO EmailStatus after the most recent send (e.g. EmailSent).';
--   Dropping the two columns is safe ONLY once no deployed frontend reads them
--   (database-standard.md §3, frontend-contract freeze): deploy the reverted
--   application code FIRST, then run the rollback. The rollback restores the
--   pre-existing qbo_email_status comment verbatim.
-- ════════════════════════════════════════════════

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qbo_bill_email       text,
  ADD COLUMN IF NOT EXISTS qbo_email_checked_at timestamptz;

COMMENT ON COLUMN public.invoices.qbo_bill_email IS
  'BillEmail.Address on the QuickBooks invoice as UPR last observed it -- the address QuickBooks actually emails. May differ from the UPR contact email; the invoice surfaces flag that.';

COMMENT ON COLUMN public.invoices.qbo_email_checked_at IS
  'When UPR last read EmailStatus/BillEmail off the QuickBooks invoice. NULL means never observed, which is a different answer from "observed as not emailed".';

-- Widened meaning: this column used to be written only by a UPR-triggered send
-- (functions/api/qbo-invoice.js action:'send'). It now also carries what
-- QuickBooks reports whenever UPR reads a QBO invoice it already fetches, so a
-- QuickBooks-side send stops being invisible. qbo_emailed_at keeps its narrower
-- UPR-send-only meaning and is unchanged.
COMMENT ON COLUMN public.invoices.qbo_email_status IS
  'QuickBooks EmailStatus (NotSet | NeedToSend | EmailSent) as UPR last observed it -- from a UPR-triggered send OR from any QBO invoice read. Paired with qbo_email_checked_at.';

-- Refresh PostgREST's schema cache so the new columns are immediately queryable.
NOTIFY pgrst, 'reload schema';
