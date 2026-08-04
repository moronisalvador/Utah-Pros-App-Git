-- ROLLBACK: 20260804210000_invoice_activity
--
-- Only run in an approved maintenance window, after any deployed frontend or
-- Worker that reads get_invoice_activity or writes invoices.customer_message /
-- invoices.send_cc_email has been rolled back first. Dropping these while a
-- consuming deploy is live breaks the invoice page immediately -- one Supabase
-- project sits behind both dev and production.
--
-- DELIBERATELY NOT REVERSED: the two invoices columns are left in place. They
-- are additive and nullable, so leaving them costs nothing and keeps any
-- customer-authored message that staff have already typed. Dropping a column on
-- a live money table is exactly the destructive change database-standard.md §3
-- forbids, and it would silently discard staff work. The DROP statements are
-- written out below, commented, so a later reviewed destructive change has the
-- exact text -- they are not part of this rollback.
--
-- DATA LOSS: dropping public.invoice_activity permanently destroys the audit
-- trail of who sent which invoice to whom. If the reason for rolling back is a
-- defect in the read path rather than the table itself, prefer revoking the
-- browser grant below and leaving the table intact.

-- Least-destructive option first: seal the browser read path, keep the evidence.
--   REVOKE EXECUTE ON FUNCTION public.get_invoice_activity(uuid,integer,integer) FROM authenticated;

DROP TRIGGER IF EXISTS trg_invoice_send_presentation_guard ON public.invoices;

REVOKE EXECUTE ON FUNCTION public.get_invoice_activity(uuid,integer,integer) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_invoice_send_presentation(uuid,text,text) FROM authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_invoice_activity(uuid,uuid,text,text,text,jsonb) FROM service_role;

DROP FUNCTION IF EXISTS public.get_invoice_activity(uuid,integer,integer);
DROP FUNCTION IF EXISTS public.set_invoice_send_presentation(uuid,text,text);
DROP FUNCTION IF EXISTS public.record_invoice_activity(uuid,uuid,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.enforce_invoice_send_presentation_writer();

-- The two length constraints guard columns that survive this rollback, so they
-- are dropped only because the same migration added them.
--
-- KNOWN CONSEQUENCE, stated rather than hidden: dropping the trigger guard above
-- returns customer_message and send_cc_email to whatever public.invoices' blanket
-- table grant allows -- today that means any authenticated session could write
-- them directly. That is acceptable only because rolling back also removes the
-- QuickBooks send path that would read them. Do not roll back the database while
-- leaving a deployed Worker that still sends customer_message.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_customer_message_length;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_send_cc_email_length;

DROP POLICY IF EXISTS invoice_activity_service_all ON public.invoice_activity;
DROP INDEX IF EXISTS public.invoice_activity_invoice_occurred_idx;
DROP TABLE IF EXISTS public.invoice_activity;

-- Text retained for a later, separately reviewed destructive change. Not run here.
--   ALTER TABLE public.invoices DROP COLUMN IF EXISTS customer_message;
--   ALTER TABLE public.invoices DROP COLUMN IF EXISTS send_cc_email;

NOTIFY pgrst, 'reload schema';
