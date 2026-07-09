-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_invoice_due_date_default_today
-- Phase: n/a (standalone billing UX fix)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes a brand-new invoice start with its due date already set to today,
--   the moment the invoice is created — instead of being blank until you save
--   it to QuickBooks. It sets a column default on invoices.due_date so every new
--   invoice row is born with today's date (Mountain Time). Existing invoices and
--   any invoice that explicitly picks its own due date are unaffected.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Attribute-only: ALTER COLUMN ... SET DEFAULT. No data change, no type change,
--   no NOT NULL added, existing rows untouched. The default only fills in an
--   INSERT that omits due_date (e.g. create_invoice_for_job, which does).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   ALTER TABLE public.invoices ALTER COLUMN due_date DROP DEFAULT;
-- ════════════════════════════════════════════════

-- America/Denver so the "today" matches the app's timezone convention
-- (database-standard.md §7) rather than UTC.
ALTER TABLE public.invoices
  ALTER COLUMN due_date SET DEFAULT (now() AT TIME ZONE 'America/Denver')::date;
