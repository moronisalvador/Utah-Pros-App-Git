-- ════════════════════════════════════════════════
-- ROLLBACK: 20260810010000_invoice_line_edit_lock_boundary
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the trigger-owned draft transition, then restores the prior direct-
--   write policy. It does not alter existing
--   invoices or line items.
--
-- RISK:
--   This is a compatibility rollback only. Once the mobile editor has been
--   deployed to use the companion service-only command boundary, rolling back
--   first makes its saves fail safely.
-- ════════════════════════════════════════════════

-- The companion reservation migration replaces the line policy and depends on
-- this trigger boundary. Refuse an out-of-order rollback before changing any
-- object; 20000 must be rolled back first after its active-command checks.
DO $rollback_order_preflight$
BEGIN
  IF to_regclass('public.qbo_invoice_command_reservations') IS NOT NULL
     OR to_regprocedure('public.invoice_line_qbo_write_access(uuid)') IS NOT NULL
     OR to_regprocedure('public.guard_invoice_line_write_during_qbo_command()') IS NOT NULL
     OR to_regprocedure('public.guard_invoice_lock_during_qbo_command()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN (
           'trg_invoice_lines_guard_qbo_command_write',
           'trg_invoices_guard_qbo_command_lock'
         )
     ) THEN
    RAISE EXCEPTION 'INVOICE_LINE_ROLLBACK_ORDER: roll back 20260810020000 before 20260810010000'
      USING ERRCODE = '55000';
  END IF;
END;
$rollback_order_preflight$;

DROP TRIGGER IF EXISTS trg_invoice_lines_revision_draft ON public.invoice_line_items;
REVOKE EXECUTE ON FUNCTION public.mark_invoice_line_revision_draft()
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.mark_invoice_line_revision_draft();

-- Restore the live pre-forward billing-line policy from
-- 20260804120100_billing_editor_role_boundary.
ALTER POLICY "invoice_lines_billing_write" ON public.invoice_line_items
  TO authenticated
  USING (public.billing_edit_access())
  WITH CHECK (public.billing_edit_access());

NOTIFY pgrst, 'reload schema';
