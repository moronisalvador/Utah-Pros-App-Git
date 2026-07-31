-- ============================================================================
-- MIGRATION: QBO receipt service-role grant containment
-- ============================================================================
--
-- WHAT:
--   Removes managed-default direct write privileges from the private QBO
--   receipt tables. Workers keep SELECT only on payment_receipts and
--   payment_receipt_attempts for their narrow safety/reconciliation reads;
--   payment_receipt_events remains RPC-internal. All receipt mutations
--   continue through the reviewed SECURITY DEFINER RPCs.
--
-- WHY:
--   The managed project grants service_role ALL on new tables by default.
--   The receipt foundation revoked browser roles but did not first revoke that
--   inherited service_role grant before restoring SELECT.
--
-- ROLLBACK:
--   The paired containment rollback deliberately reasserts this same
--   least-privilege state. Reopening direct receipt-table writes is not a safe
--   rollback path.
-- ============================================================================

DO $preflight$
DECLARE
  v_table name;
  v_function_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payment_receipts'::name,
    'payment_receipt_attempts'::name,
    'payment_receipt_events'::name
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'QBO receipt grant containment prerequisite table missing: %', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = v_table
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'QBO receipt grant containment RLS prerequisite drifted: %', v_table;
    END IF;

    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'QBO receipt grant containment browser boundary drifted: %', v_table;
    END IF;

  END LOOP;

  SELECT count(*)
  INTO v_function_count
  FROM pg_proc proc
  JOIN pg_namespace ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname IN (
      'claim_qbo_receipt_event',
      'reserve_qbo_payment_receipt',
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
      'remove_qbo_payment_receipt',
      'fail_qbo_payment_receipt_attempt'
    )
    AND proc.prosecdef
    AND proc.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE');

  IF v_function_count <> 7 THEN
    RAISE EXCEPTION 'QBO receipt service RPC prerequisite drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.feature_flags
    WHERE key = 'feature:qbo_receive_payment'
      AND NOT enabled
      AND NOT force_disabled
  ) THEN
    RAISE EXCEPTION 'QBO receipt feature gate must remain disabled during containment';
  END IF;
END
$preflight$;

REVOKE ALL PRIVILEGES ON TABLE public.payment_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.payment_receipt_attempts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.payment_receipt_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.payment_receipts TO service_role;
GRANT SELECT ON TABLE public.payment_receipt_attempts TO service_role;

DO $postcondition$
DECLARE
  v_table name;
  v_should_select boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'payment_receipts'::name,
    'payment_receipt_attempts'::name,
    'payment_receipt_events'::name
  ]
  LOOP
    v_should_select := v_table <> 'payment_receipt_events';

    IF has_table_privilege('service_role', format('public.%I', v_table), 'SELECT')
         IS DISTINCT FROM v_should_select
       OR has_table_privilege('service_role', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'TRUNCATE')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'REFERENCES')
       OR has_table_privilege('service_role', format('public.%I', v_table), 'TRIGGER')
       OR has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'QBO receipt service-role grant containment failed: %', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.feature_flags
    WHERE key = 'feature:qbo_receive_payment'
      AND NOT enabled
      AND NOT force_disabled
  ) THEN
    RAISE EXCEPTION 'QBO receipt feature gate changed during containment';
  END IF;
END
$postcondition$;

NOTIFY pgrst, 'reload schema';
