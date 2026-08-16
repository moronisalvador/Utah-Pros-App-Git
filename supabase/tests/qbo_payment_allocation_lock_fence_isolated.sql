-- Disposable local proof for 20260810030000_qbo_payment_allocation_lock_fence.
-- Requires PGOPTIONS=-cupr.isolated_test_database=on; never run against shared DB.
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) <> 'on' THEN
    RAISE EXCEPTION 'qbo payment allocation fence proof requires isolated local database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.invoices'::regclass
    AND tgname = 'trg_invoices_guard_qbo_payment_allocation_lock') THEN
    RAISE EXCEPTION 'payment allocation lock trigger missing';
  END IF;
  IF has_function_privilege('anon', 'public.reserve_qbo_payment_receipt(text,text,text,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reserve_qbo_payment_receipt(text,text,text,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser role can execute service-only receipt reservation';
  END IF;
  IF has_function_privilege('anon', 'public.finalize_qbo_payment_receipt(uuid,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finalize_qbo_payment_receipt(uuid,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reconcile_qbo_payment_receipt(jsonb,jsonb,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reconcile_qbo_payment_receipt(jsonb,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser role can execute payment finalizer';
  END IF;
  IF has_function_privilege('service_role', 'public.guard_payment_receipt_invoice_unlocked()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.lock_qbo_payment_allocation_invoices(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger/internal helper has direct service-role execute';
  END IF;
  IF position('PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);'
      IN pg_get_functiondef('public.finalize_qbo_payment_receipt(uuid,jsonb,jsonb)'::regprocedure)) = 0
     OR position('PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);'
      IN pg_get_functiondef('public.reconcile_qbo_payment_receipt(jsonb,jsonb,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'payment finalizer is missing its explicit ordered allocation lock';
  END IF;
END
$guard$;

-- A PostgreSQL service role without a trusted request claim is not enough to
-- use a SECURITY DEFINER money path. The guard must reject before it validates
-- the otherwise deliberately malformed request or writes a reservation.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claims', '', true);
DO $claimless_service_role_denied$
BEGIN
  BEGIN
    PERFORM public.reserve_qbo_payment_receipt(NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'claimless service role executed payment reservation RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;
END;
$claimless_service_role_denied$;
RESET ROLE;
