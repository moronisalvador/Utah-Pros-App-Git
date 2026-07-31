-- ============================================================================
-- FILE: qbo_multi_invoice_payment_receipts.test.sql
-- ============================================================================
-- ISOLATED DATABASE BEHAVIOR TEST ONLY. Run after applying the paired migration
-- to qa-staging or a disposable local database, inside a transaction that is
-- rolled back. It deliberately refuses to run without two same-contact,
-- QBO-linked fixture invoices rather than inventing production-like records.
--
-- Covers: same client request id returns the original attempt; a changed
-- fingerprint conflicts; atomic event claims retain their retry identity; one
-- QBO Payment identity cannot bind to two attempts; direct QBO reconcile has no
-- outbound attempt prerequisite; two allocation rows share one receipt;
-- webhook-first reconciliation keeps an outbound attempt monotonic when the
-- delayed request path marks, finalizes, or reports a generic failure;
-- reconcile removes stale allocation projection; a later QBO read preserves an
-- outbound receipt's payer; more than 100 allocations are rejected; older
-- provider snapshots are ignored; a terminal event cannot be resurrected; void
-- retains the receipt audit; and a browser-role claim cannot directly change
-- the service-owned payment receipt link.
-- ============================================================================

BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_identity_owner jsonb;
  v_identity_contender jsonb;
  v_identity_conflict jsonb;
  v_tombstone_attempt jsonb;
  v_webhook_first jsonb;
  v_webhook_first_result jsonb;
  v_conflicted boolean := false;
  v_event_claimed boolean;
  v_contact_id uuid;
  v_customer_id text;
  v_invoice_a record;
  v_invoice_b record;
  v_receipt jsonb;
  v_stale_receipt jsonb;
  v_allocations jsonb;
  v_result jsonb;
  v_receipt_id uuid;
  v_too_many_rejected boolean := false;
  v_receipt_link_write_denied boolean := false;
BEGIN
  SELECT public.claim_qbo_receipt_event(
    'qa-receipt-event-claim-1',
    'Payment',
    'Update',
    'qa-qbo-event-realm',
    'qa-qbo-event-payment',
    '2026-07-30T11:00:00Z'
  ) INTO v_event_claimed;
  ASSERT v_event_claimed, 'first receipt event delivery is claimed';
  ASSERT EXISTS (
    SELECT 1 FROM public.qbo_events
    WHERE id = 'qa-receipt-event-claim-1'
      AND qbo_realm_id = 'qa-qbo-event-realm'
      AND qbo_entity_id = 'qa-qbo-event-payment'
      AND provider_updated_at = '2026-07-30T11:00:00Z'::timestamptz
      AND status = 'processing'
  ), 'atomic receipt event claim retains all retry identity';
  SELECT public.claim_qbo_receipt_event(
    'qa-receipt-event-claim-1',
    'Payment',
    'Update',
    'qa-qbo-event-realm',
    'qa-qbo-event-payment',
    '2026-07-30T11:00:00Z'
  ) INTO v_event_claimed;
  ASSERT NOT v_event_claimed, 'duplicate receipt event delivery is not reclaimed';

  SELECT r INTO v_first FROM public.reserve_qbo_payment_receipt(
    'qa-receipt-client-request-1', 'qa-receipt-intuit-request-1', 'qa-qbo-realm',
    repeat('a', 64), '{"purpose":"qbo-receipt-behavior"}'::jsonb, NULL
  ) r;
  SELECT r INTO v_replay FROM public.reserve_qbo_payment_receipt(
    'qa-receipt-client-request-1', 'qa-receipt-intuit-request-1', 'qa-qbo-realm',
    repeat('a', 64), '{"purpose":"qbo-receipt-behavior"}'::jsonb, NULL
  ) r;
  ASSERT v_first->>'attempt_id' = v_replay->>'attempt_id', 'same client request id returns the original attempt';
  ASSERT (v_replay->>'replayed')::boolean IS TRUE, 'same-key replay is explicit';
  BEGIN
    PERFORM public.reserve_qbo_payment_receipt(
      'qa-receipt-client-request-1', 'qa-receipt-intuit-request-2', 'qa-qbo-realm',
      repeat('b', 64), '{"purpose":"conflict"}'::jsonb, NULL
    );
  EXCEPTION WHEN unique_violation THEN v_conflicted := true;
  END;
  ASSERT v_conflicted, 'same client request id with a different fingerprint conflicts';

  SELECT r INTO v_identity_owner FROM public.reserve_qbo_payment_receipt(
    'qa-identity-owner-client', 'qa-identity-owner-intuit', 'qa-qbo-identity-realm',
    repeat('c', 64), '{"purpose":"provider-identity-owner"}'::jsonb, NULL
  ) r;
  SELECT r INTO v_identity_contender FROM public.reserve_qbo_payment_receipt(
    'qa-identity-contender-client', 'qa-identity-contender-intuit', 'qa-qbo-identity-realm',
    repeat('d', 64), '{"purpose":"provider-identity-contender"}'::jsonb, NULL
  ) r;
  PERFORM public.mark_qbo_payment_receipt_created(
    (v_identity_owner->>'attempt_id')::uuid,
    'qa-shared-qbo-payment',
    '{"Id":"qa-shared-qbo-payment"}'::jsonb
  );
  SELECT r INTO v_identity_conflict FROM public.mark_qbo_payment_receipt_created(
    (v_identity_contender->>'attempt_id')::uuid,
    'qa-shared-qbo-payment',
    '{"Id":"qa-shared-qbo-payment"}'::jsonb
  ) r;
  ASSERT COALESCE((v_identity_conflict->>'conflict')::boolean, false),
    'a QBO Payment identity already owned by another attempt returns conflict';
  ASSERT (
    SELECT count(*) FROM public.payment_receipt_attempts
    WHERE qbo_realm_id = 'qa-qbo-identity-realm'
      AND qbo_payment_id = 'qa-shared-qbo-payment'
  ) = 1, 'one QBO Payment identity cannot bind to two receipt attempts';
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_identity_contender->>'attempt_id')::uuid
      AND status = 'conflict'
      AND error_code = 'QBO_PAYMENT_ID_CONFLICT'
  ), 'the losing receipt attempt durably records its provider identity conflict';

  SELECT i.contact_id, c.qbo_customer_id INTO v_contact_id, v_customer_id
  FROM public.invoices i JOIN public.contacts c ON c.id = i.contact_id
  WHERE i.qbo_invoice_id IS NOT NULL AND c.qbo_customer_id IS NOT NULL
  GROUP BY i.contact_id, c.qbo_customer_id HAVING count(*) >= 2
  LIMIT 1;
  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING: two same-contact QBO-linked invoices are required';
  END IF;
  SELECT i.id, i.qbo_invoice_id INTO v_invoice_a FROM public.invoices i
  WHERE i.contact_id = v_contact_id AND i.qbo_invoice_id IS NOT NULL ORDER BY i.id LIMIT 1;
  SELECT i.id, i.qbo_invoice_id INTO v_invoice_b FROM public.invoices i
  WHERE i.contact_id = v_contact_id AND i.qbo_invoice_id IS NOT NULL AND i.id <> v_invoice_a.id ORDER BY i.id LIMIT 1;

  SELECT r INTO v_webhook_first FROM public.reserve_qbo_payment_receipt(
    'qa-webhook-first-client', 'qa-webhook-first-intuit', 'qa-webhook-first-realm',
    repeat('e', 64), '{"purpose":"webhook-first-monotonic-state"}'::jsonb, NULL
  ) r;
  v_receipt := jsonb_build_object(
    'attempt_id', v_webhook_first->>'attempt_id',
    'qbo_realm_id', 'qa-webhook-first-realm', 'qbo_customer_id', v_customer_id,
    'qbo_payment_id', 'qa-webhook-first-payment', 'txn_date', '2026-07-30',
    'total_cents', 100, 'applied_cents', 100, 'unapplied_cents', 0,
    'payment_method', 'check', 'reference_number', 'QA-WEBHOOK-FIRST', 'source', 'upr',
    'qbo_sync_token', '1', 'qbo_updated_at', '2026-07-30T11:30:00Z',
    'normalized_snapshot', '{"Id":"qa-webhook-first-payment"}'::jsonb
  );
  v_allocations := jsonb_build_array(
    jsonb_build_object(
      'invoice_id', v_invoice_a.id,
      'qbo_invoice_id', v_invoice_a.qbo_invoice_id,
      'amount_cents', 100,
      'payer_type', 'homeowner'
    )
  );
  PERFORM public.reconcile_qbo_payment_receipt(
    v_receipt, v_allocations, 'reconciled', 'qa-webhook-first-event'
  );
  SELECT r INTO v_webhook_first_result FROM public.mark_qbo_payment_receipt_created(
    (v_webhook_first->>'attempt_id')::uuid,
    'qa-webhook-first-payment',
    '{"Id":"qa-webhook-first-payment"}'::jsonb
  ) r;
  ASSERT (v_webhook_first_result->>'replayed')::boolean
    AND v_webhook_first_result->>'status' = 'reconciled',
    'webhook-first mark is a replay and cannot downgrade reconciled';
  SELECT r INTO v_webhook_first_result FROM public.finalize_qbo_payment_receipt(
    (v_webhook_first->>'attempt_id')::uuid, v_receipt, v_allocations
  ) r;
  ASSERT (v_webhook_first_result->>'replayed')::boolean
    AND v_webhook_first_result->>'status' = 'reconciled',
    'webhook-first finalize is a replay and cannot downgrade reconciled';
  SELECT r INTO v_webhook_first_result FROM public.fail_qbo_payment_receipt_attempt(
    (v_webhook_first->>'attempt_id')::uuid,
    'unknown_outcome',
    'DELAYED_REQUEST_FAILURE',
    'A delayed outbound handler must not downgrade a reconciled attempt'
  ) r;
  ASSERT (v_webhook_first_result->>'ignored_downgrade')::boolean
    AND v_webhook_first_result->>'status' = 'reconciled',
    'webhook-first generic failure is ignored after reconciliation';
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_webhook_first->>'attempt_id')::uuid
      AND status = 'reconciled'
      AND qbo_payment_id = 'qa-webhook-first-payment'
      AND receipt_id IS NOT NULL
  ), 'webhook-first same-attempt state remains monotonic';

  v_receipt := jsonb_build_object(
    'qbo_realm_id', 'qa-qbo-direct-realm', 'qbo_customer_id', v_customer_id,
    'qbo_payment_id', 'qa-direct-payment-1', 'txn_date', '2026-07-30',
    'total_cents', 300, 'applied_cents', 300, 'unapplied_cents', 0,
    'payment_method', 'check', 'reference_number', 'QA-7956', 'source', 'qbo',
    'qbo_sync_token', '1', 'qbo_updated_at', '2026-07-30T12:00:00Z',
    'status', 'reconciled', 'normalized_snapshot', '{}'::jsonb
  );
  v_allocations := jsonb_build_array(
    jsonb_build_object('invoice_id', v_invoice_a.id, 'qbo_invoice_id', v_invoice_a.qbo_invoice_id, 'amount_cents', 100, 'payer_type', 'homeowner'),
    jsonb_build_object('invoice_id', v_invoice_b.id, 'qbo_invoice_id', v_invoice_b.qbo_invoice_id, 'amount_cents', 200, 'payer_type', 'homeowner')
  );
  BEGIN
    PERFORM public.reconcile_qbo_payment_receipt(
      v_receipt,
      (SELECT jsonb_agg(v_allocations->0) FROM generate_series(1, 101)),
      'reconciled',
      'qa-too-many-allocations'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_too_many_rejected := true;
  END;
  ASSERT v_too_many_rejected, 'receipt RPC rejects more than 100 allocations';

  SELECT r INTO v_result FROM public.reconcile_qbo_payment_receipt(v_receipt, v_allocations, 'reconciled', 'qa-direct-event-1') r;
  v_receipt_id := (v_result->>'receipt_id')::uuid;
  ASSERT (SELECT count(*) FROM public.payments WHERE receipt_id = v_receipt_id) = 2,
    'direct QBO reconcile creates two allocation rows share one receipt';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts a WHERE a.receipt_id = v_receipt_id
  ), 'direct QBO reconcile has no outbound attempt prerequisite';

  v_receipt := jsonb_set(v_receipt, '{applied_cents}', '100'::jsonb);
  v_receipt := jsonb_set(v_receipt, '{total_cents}', '100'::jsonb);
  v_receipt := jsonb_set(v_receipt, '{qbo_sync_token}', '"2"'::jsonb);
  v_receipt := jsonb_set(v_receipt, '{qbo_updated_at}', '"2026-07-30T13:00:00Z"'::jsonb);
  v_allocations := jsonb_build_array(
    jsonb_build_object('invoice_id', v_invoice_a.id, 'qbo_invoice_id', v_invoice_a.qbo_invoice_id, 'amount_cents', 100, 'payer_type', 'homeowner')
  );
  PERFORM public.reconcile_qbo_payment_receipt(v_receipt, v_allocations, 'reconciled', 'qa-direct-event-2');
  ASSERT (SELECT count(*) FROM public.payments WHERE receipt_id = v_receipt_id) = 1,
    'reconcile removes stale allocation projection';

  v_stale_receipt := jsonb_set(v_receipt, '{total_cents}', '50'::jsonb);
  v_stale_receipt := jsonb_set(v_stale_receipt, '{applied_cents}', '50'::jsonb);
  v_stale_receipt := jsonb_set(v_stale_receipt, '{qbo_sync_token}', '"1"'::jsonb);
  v_stale_receipt := jsonb_set(v_stale_receipt, '{qbo_updated_at}', '"2026-07-30T12:30:00Z"'::jsonb);
  SELECT r INTO v_result FROM public.reconcile_qbo_payment_receipt(
    v_stale_receipt,
    jsonb_build_array(
      jsonb_build_object(
        'invoice_id', v_invoice_a.id,
        'qbo_invoice_id', v_invoice_a.qbo_invoice_id,
        'amount_cents', 50,
        'payer_type', 'homeowner'
      )
    ),
    'reconciled',
    'qa-direct-stale-event'
  ) r;
  ASSERT COALESCE((v_result->>'ignored_stale')::boolean, false),
    'an older provider snapshot is ignored';
  ASSERT (SELECT amount FROM public.payments WHERE receipt_id = v_receipt_id) = 1.00,
    'an older provider snapshot cannot roll back an allocation';

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    UPDATE public.payments
    SET receipt_id = NULL
    WHERE id = (
      SELECT id FROM public.payments WHERE receipt_id = v_receipt_id LIMIT 1
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_receipt_link_write_denied := true;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  ASSERT v_receipt_link_write_denied,
    'a browser-role claim cannot directly change a payment receipt link';
  ASSERT EXISTS (SELECT 1 FROM public.payments WHERE receipt_id = v_receipt_id),
    'the rejected browser receipt-link write leaves the projection intact';

  PERFORM public.remove_qbo_payment_receipt(
    'qa-qbo-direct-realm', 'qa-direct-payment-1', 'voided', 'qa-direct-event-3'
  );
  ASSERT NOT EXISTS (SELECT 1 FROM public.payments WHERE receipt_id = v_receipt_id),
    'void removes payment projections but retains receipt audit';
  ASSERT EXISTS (SELECT 1 FROM public.payment_receipts WHERE id = v_receipt_id AND status = 'voided'),
    'void retains the receipt header';
  ASSERT EXISTS (SELECT 1 FROM public.payment_receipt_events WHERE receipt_id = v_receipt_id AND event_type = 'voided'),
    'void retains audit evidence';

  PERFORM public.mark_qbo_payment_receipt_created(
    (v_first->>'attempt_id')::uuid,
    'qa-upr-payment-1',
    '{"Id":"qa-upr-payment-1"}'::jsonb
  );
  v_receipt := jsonb_build_object(
    'attempt_id', v_first->>'attempt_id',
    'qbo_realm_id', 'qa-qbo-realm', 'qbo_customer_id', v_customer_id,
    'qbo_payment_id', 'qa-upr-payment-1', 'txn_date', '2026-07-30',
    'total_cents', 100, 'applied_cents', 100, 'unapplied_cents', 0,
    'payment_method', 'check', 'reference_number', 'QA-UPR', 'source', 'upr',
    'qbo_sync_token', '1', 'qbo_updated_at', '2026-07-30T14:00:00Z',
    'normalized_snapshot', '{"Id":"qa-upr-payment-1"}'::jsonb
  );
  v_allocations := jsonb_build_array(
    jsonb_build_object('invoice_id', v_invoice_a.id, 'qbo_invoice_id', v_invoice_a.qbo_invoice_id, 'amount_cents', 100, 'payer_type', 'insurance')
  );
  PERFORM public.finalize_qbo_payment_receipt((v_first->>'attempt_id')::uuid, v_receipt, v_allocations);
  v_receipt := jsonb_set(v_receipt, '{source}', '"qbo"'::jsonb);
  v_allocations := jsonb_build_array(
    jsonb_build_object('invoice_id', v_invoice_a.id, 'qbo_invoice_id', v_invoice_a.qbo_invoice_id, 'amount_cents', 100, 'payer_type', 'homeowner')
  );
  PERFORM public.reconcile_qbo_payment_receipt(v_receipt, v_allocations, 'reconciled', 'qa-upr-reconcile-event');
  ASSERT EXISTS (
    SELECT 1
    FROM public.payment_receipts r
    JOIN public.payments p ON p.receipt_id = r.id
    WHERE r.qbo_realm_id = 'qa-qbo-realm'
      AND r.qbo_payment_id = 'qa-upr-payment-1'
      AND r.source = 'upr'
      AND p.payer_type = 'insurance'
  ), 'QBO reconciliation preserves an outbound UPR receipt source and human-selected payer';
  PERFORM public.remove_qbo_payment_receipt(
    'qa-qbo-realm', 'qa-upr-payment-1', 'conflict', 'qa-upr-conflict-event'
  );
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.payments p
    JOIN public.payment_receipts r ON r.id = p.receipt_id
    WHERE r.qbo_realm_id = 'qa-qbo-realm' AND r.qbo_payment_id = 'qa-upr-payment-1'
  ), 'an unsupported QBO update removes stale active projections';
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipts
    WHERE qbo_realm_id = 'qa-qbo-realm' AND qbo_payment_id = 'qa-upr-payment-1' AND status = 'conflict'
  ), 'an unsupported QBO update retains a conflict audit header';
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_first->>'attempt_id')::uuid
      AND qbo_payment_id = 'qa-upr-payment-1'
      AND status = 'conflict'
  ), 'a QBO conflict propagates to the original durable attempt';
  PERFORM public.reconcile_qbo_payment_receipt(
    v_receipt, v_allocations, 'reconciled', 'qa-upr-corrected-event'
  );
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipts r
    JOIN public.payments p ON p.receipt_id = r.id
    WHERE r.qbo_realm_id = 'qa-qbo-realm'
      AND r.qbo_payment_id = 'qa-upr-payment-1'
      AND r.status = 'reconciled'
  ), 'a corrected QBO receipt restores its active projection';
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_first->>'attempt_id')::uuid
      AND status = 'reconciled'
  ), 'a corrected QBO receipt restores its durable attempt state';
  PERFORM public.remove_qbo_payment_receipt(
    'qa-qbo-realm', 'qa-upr-payment-1', 'deleted', 'qa-upr-delete-event'
  );
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_first->>'attempt_id')::uuid
      AND receipt_id IS NOT NULL
      AND status = 'deleted'
  ), 'a QBO delete propagates to the original durable attempt';
  SELECT r INTO v_replay FROM public.reserve_qbo_payment_receipt(
    'qa-receipt-client-request-1', 'qa-receipt-intuit-request-1', 'qa-qbo-realm',
    repeat('a', 64), '{"purpose":"qbo-receipt-behavior"}'::jsonb, NULL
  ) r;
  ASSERT (v_replay->>'replayed')::boolean
    AND v_replay->>'status' = 'deleted',
    'a same-request retry returns the durable deleted state';

  SELECT r INTO v_result FROM public.reserve_qbo_payment_receipt(
    'qa-terminal-client', 'qa-terminal-intuit', 'qa-terminal-realm',
    repeat('f', 64), '{"purpose":"terminal-before-finalize"}'::jsonb, NULL
  ) r;
  PERFORM public.mark_qbo_payment_receipt_created(
    (v_result->>'attempt_id')::uuid,
    'qa-terminal-payment',
    '{"Id":"qa-terminal-payment"}'::jsonb
  );
  PERFORM public.remove_qbo_payment_receipt(
    'qa-terminal-realm', 'qa-terminal-payment', 'deleted', 'qa-terminal-delete-event'
  );
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_result->>'attempt_id')::uuid
      AND receipt_id IS NULL
      AND status = 'deleted'
  ), 'a delete before finalization terminates the provider-matched attempt';
  SELECT r INTO v_replay FROM public.reserve_qbo_payment_receipt(
    'qa-terminal-client', 'qa-terminal-intuit', 'qa-terminal-realm',
    repeat('f', 64), '{"purpose":"terminal-before-finalize"}'::jsonb, NULL
  ) r;
  ASSERT (v_replay->>'replayed')::boolean
    AND v_replay->>'status' = 'deleted',
    'a pre-finalization terminal attempt returns its deleted state on retry';
  v_receipt := jsonb_set(v_receipt, '{qbo_realm_id}', '"qa-terminal-realm"'::jsonb);
  v_receipt := jsonb_set(v_receipt, '{qbo_payment_id}', '"qa-terminal-payment"'::jsonb);
  SELECT r INTO v_result FROM public.reconcile_qbo_payment_receipt(
    v_receipt, v_allocations, 'reconciled', 'qa-terminal-late-create-event'
  ) r;
  ASSERT COALESCE((v_result->>'ignored_terminal')::boolean, false),
    'a terminal tombstone refuses a delayed create reconciliation';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.payment_receipts
    WHERE qbo_realm_id = 'qa-terminal-realm' AND qbo_payment_id = 'qa-terminal-payment'
  ), 'a delayed create cannot resurrect a terminal receipt or attempt';

  SELECT r INTO v_tombstone_attempt FROM public.reserve_qbo_payment_receipt(
    'qa-prebind-terminal-client', 'qa-prebind-terminal-intuit', 'qa-prebind-terminal-realm',
    repeat('0', 64), '{"purpose":"tombstone-before-provider-binding"}'::jsonb, NULL
  ) r;
  PERFORM public.remove_qbo_payment_receipt(
    'qa-prebind-terminal-realm', 'qa-prebind-terminal-payment', 'deleted',
    'qa-prebind-terminal-delete-event'
  );
  SELECT r INTO v_result FROM public.mark_qbo_payment_receipt_created(
    (v_tombstone_attempt->>'attempt_id')::uuid,
    'qa-prebind-terminal-payment',
    '{"Id":"qa-prebind-terminal-payment"}'::jsonb
  ) r;
  ASSERT COALESCE((v_result->>'ignored_terminal')::boolean, false)
    AND v_result->>'status' = 'deleted',
    'a provider tombstone before binding is absorbed by the mark attempt';
  ASSERT EXISTS (
    SELECT 1 FROM public.payment_receipt_attempts
    WHERE id = (v_tombstone_attempt->>'attempt_id')::uuid
      AND qbo_payment_id = 'qa-prebind-terminal-payment'
      AND status = 'deleted'
  ), 'a pre-binding tombstone durably binds the attempt to its terminal state';
  SELECT r INTO v_replay FROM public.reserve_qbo_payment_receipt(
    'qa-prebind-terminal-client', 'qa-prebind-terminal-intuit', 'qa-prebind-terminal-realm',
    repeat('0', 64), '{"purpose":"tombstone-before-provider-binding"}'::jsonb, NULL
  ) r;
  ASSERT (v_replay->>'replayed')::boolean
    AND v_replay->>'status' = 'deleted',
    'a tombstone-before-bind same-request retry remains terminal';
  v_receipt := jsonb_set(v_receipt, '{qbo_realm_id}', '"qa-prebind-terminal-realm"'::jsonb);
  v_receipt := jsonb_set(v_receipt, '{qbo_payment_id}', '"qa-prebind-terminal-payment"'::jsonb);
  SELECT r INTO v_result FROM public.reconcile_qbo_payment_receipt(
    v_receipt, v_allocations, 'reconciled', 'qa-prebind-terminal-late-reconcile'
  ) r;
  ASSERT COALESCE((v_result->>'ignored_terminal')::boolean, false),
    'a tombstone absorbed during mark still blocks delayed reconciliation';
END
$test$;

ROLLBACK;
