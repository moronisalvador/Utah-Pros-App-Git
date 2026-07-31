-- ============================================================================
-- ROLLBACK: qbo multi-invoice payment receipts
-- ============================================================================
-- CONTAINMENT FIRST:
--   Stop callers and keep feature:qbo_receive_payment disabled before this is
--   applied. This rollback removes the service execution surface but deliberately
--   retains receipt, attempt, event, and payment-link financial audit data.
--   It also deliberately retains the payments receipt-link guard and the
--   anonymous-access closure added with the receipt schema; re-opening either
--   boundary would be an authorization regression, not a safe rollback.
--   A later owner-reviewed retention/destruction migration is required to drop
--   those records safely.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.claim_qbo_receipt_event(text, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mark_qbo_payment_receipt_created(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.remove_qbo_payment_receipt(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fail_qbo_payment_receipt_attempt(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.claim_qbo_receipt_event(text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.mark_qbo_payment_receipt_created(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.remove_qbo_payment_receipt(text, text, text, text);
DROP FUNCTION IF EXISTS public.fail_qbo_payment_receipt_attempt(uuid, text, text, text);

-- Keep guard_payment_receipt_link_write(), its two triggers, and the
-- payments anon-policy/grant closure in place as containment.

UPDATE public.feature_flags
SET enabled = false, force_disabled = true, updated_at = now()
WHERE key = 'feature:qbo_receive_payment';

NOTIFY pgrst, 'reload schema';
