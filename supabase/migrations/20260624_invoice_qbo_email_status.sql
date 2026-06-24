-- Track when QuickBooks emailed an invoice to the customer (manual "Email to customer"
-- button in the invoice editor → /api/qbo-invoice action:send → QBO /invoice/{id}/send).
-- Nullable additions only — safe on the shared DB; existing code ignores them.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qbo_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qbo_email_status text;

COMMENT ON COLUMN public.invoices.qbo_emailed_at IS 'When QuickBooks emailed this invoice to the customer (via /api/qbo-invoice action:send).';
COMMENT ON COLUMN public.invoices.qbo_email_status IS 'QBO EmailStatus after the most recent send (e.g. EmailSent).';

-- Refresh PostgREST''s schema cache so the new columns are immediately queryable/writable.
NOTIFY pgrst, 'reload schema';
