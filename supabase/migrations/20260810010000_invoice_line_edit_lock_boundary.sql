-- ════════════════════════════════════════════════
-- MIGRATION: 20260810010000_invoice_line_edit_lock_boundary
-- Phase: n/a (Admin Mobile invoice line edit boundary)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Keeps ordinary desktop billing edits available on unlocked invoices while
--   refusing direct browser writes to a manually locked parent. Changing a
--   linked invoice line makes that unpaid invoice a draft again so a person must
--   save the revision to QuickBooks. This migration exposes no write RPC.
--
-- ADDITIVE-ONLY / attribute-only:
--   Adds one trigger-owned revision transition and replaces the existing
--   invoice-line write policy. No table DROP/RENAME/ALTER COLUMN and no data
--   change. The existing total rollup is untouched. Existing desktop billing
--   writes keep working while the policy refuses manually locked parents. The
--   companion reservation migration adds service-only staging and post-provider
--   finalization RPCs; this migration intentionally exposes no browser RPC.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260810010000_invoice_line_edit_lock_boundary.rollback.sql.
--   It drops the revision trigger and restores the prior write policy.
-- ════════════════════════════════════════════════

-- Keep existing desktop insert/update/delete behavior for billing roles, but do
-- not let a direct PostgREST write bypass a manually locked parent. The mobile
-- screen uses the companion service-only command boundary for its parent-and-
-- line row locks.
ALTER POLICY "invoice_lines_billing_write" ON public.invoice_line_items
  TO authenticated
  USING (
    public.billing_edit_access()
    AND EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_id
        AND i.locked IS FALSE
    )
  )
  WITH CHECK (
    public.billing_edit_access()
    AND EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_id
        AND i.locked IS FALSE
    )
  );

-- Status stays trigger-owned without replacing the established total-rollup
-- function. Row locks serialize this update with QBO CAS finalization: an edit
-- committed after QBO becomes draft; a successful QBO CAS committed after the
-- edit sees OLD.status='draft' and restores saved. Protected collection and
-- exceptional states are never downgraded.
CREATE OR REPLACE FUNCTION public.mark_invoice_line_revision_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  target uuid;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF target IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.invoices
     SET status = 'draft',
         updated_at = now()
   WHERE id = target
     AND qbo_invoice_id IS NOT NULL
     AND COALESCE(invoice_type, '') <> 'collection'
     AND COALESCE(amount_paid, 0) = 0
     AND status NOT IN (
       'draft', 'paid', 'partially_paid', 'voided', 'disputed', 'viewed', 'overdue'
     );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Trigger invocation does not require a direct function grant. Keep this
-- privileged invoice writer unreachable as a browser/service RPC.
REVOKE EXECUTE ON FUNCTION public.mark_invoice_line_revision_draft()
  FROM PUBLIC, anon, authenticated, service_role;

DO $preflight_trigger$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.invoice_line_items'::regclass
      AND tgname = 'trg_invoice_lines_revision_draft'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_invoice_lines_revision_draft already exists';
  END IF;
END;
$preflight_trigger$;
CREATE TRIGGER trg_invoice_lines_revision_draft
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_invoice_line_revision_draft();

NOTIFY pgrst, 'reload schema';
