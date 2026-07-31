-- ============================================================================
-- ROLLBACK: QBO receipt service-role grant containment
-- ============================================================================
--
-- This is a containment rollback: it reasserts SELECT-only service access and
-- never restores the managed-default direct write privileges. Receipt mutation
-- remains available through the service-only SECURITY DEFINER RPCs.
-- ============================================================================

REVOKE ALL PRIVILEGES ON TABLE public.payment_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.payment_receipt_attempts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.payment_receipt_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.payment_receipts TO service_role;
GRANT SELECT ON TABLE public.payment_receipt_attempts TO service_role;

NOTIFY pgrst, 'reload schema';
