-- ISOLATED DATABASE ONLY: runtime proof for
-- 20260810182905_qbo_single_company_binding. The local qualifier supplies
-- upr.isolated_test_database=on and this transaction rolls every fixture back.
-- The qualifier separately proves consistent-but-unattributed realm evidence,
-- no-credential A/B artifact disagreement, and credential realm B versus
-- authoritative command realm A before applying the migration. Each refusal
-- must leave no boundary table/column or evidence mutation behind before the
-- disposable fixtures are cleared.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing non-isolated database';
  END IF;
END;
$guard$;

-- Fixture neutralization clears existing realm-attributed projections. Make
-- that setup an explicit trusted service request before any guarded UPDATE.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Start from the unbound shape that only exists when there was no attributable
-- QuickBooks credential at migration time. The qualifier may retain terminal
-- command audit evidence across its rollback/reapply cycle; neutralize those
-- rows only inside this transaction so the first-bind subtests remain honest.
DELETE FROM public.integration_credentials WHERE provider = 'quickbooks';
DELETE FROM public.qbo_payment_allocation_fences;
DELETE FROM public.qbo_invoice_command_reservations;
DELETE FROM public.qbo_estimate_command_reservations;
DELETE FROM public.qbo_invoice_commands;
DELETE FROM public.qbo_estimate_commands;
UPDATE public.contacts SET qbo_customer_id = NULL WHERE qbo_customer_id IS NOT NULL;
UPDATE public.invoices SET qbo_invoice_id = NULL WHERE qbo_invoice_id IS NOT NULL;
UPDATE public.estimates SET qbo_estimate_id = NULL WHERE qbo_estimate_id IS NOT NULL;
UPDATE public.payments
   SET qbo_payment_id = NULL,
       stripe_fee_qbo_purchase_id = NULL
 WHERE qbo_payment_id IS NOT NULL OR stripe_fee_qbo_purchase_id IS NOT NULL;
UPDATE public.qbo_attachments SET qbo_attachable_id = NULL WHERE qbo_attachable_id IS NOT NULL;
UPDATE public.invoice_line_items
   SET qbo_item_id = NULL,
       qbo_class_id = NULL
 WHERE qbo_item_id IS NOT NULL OR qbo_class_id IS NOT NULL;
UPDATE public.estimate_line_items
   SET qbo_item_id = NULL,
       qbo_class_id = NULL
 WHERE qbo_item_id IS NOT NULL OR qbo_class_id IS NOT NULL;
DELETE FROM public.qbo_company_binding;
DELETE FROM public.integration_config
 WHERE key IN (
   'qbo_stripe_clearing_account_id',
   'qbo_fee_expense_account_id',
   'qbo_bank_account_id'
 );

-- A browser and a claimless service session cannot replace the accounting connection.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $browser_denied$
BEGIN
  BEGIN
    PERFORM public.replace_qbo_connection(
      'sandbox', 'realm-A', 'access-A', 'refresh-A', now() + interval '1 hour'
    );
    RAISE EXCEPTION 'authenticated browser replaced the QBO connection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$browser_denied$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{}', true);
DO $claimless_denied$
BEGIN
  BEGIN
    PERFORM public.replace_qbo_connection(
      'sandbox', 'realm-A', 'access-A', 'refresh-A', now() + interval '1 hour'
    );
    RAISE EXCEPTION 'claimless service session replaced the QBO connection';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$claimless_denied$;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The binding and credentials are one transaction: a failed credential insert
-- cannot strand an otherwise unused database on a permanent company identity.
DO $atomic_first_connection$
BEGIN
  BEGIN
    PERFORM public.replace_qbo_connection(
      'sandbox', 'realm-A', 'access-A', 'refresh-A', now() + interval '1 hour',
      NULL, 'b8000000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'invalid credential attribution unexpectedly persisted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.qbo_company_binding)
     OR EXISTS (SELECT 1 FROM public.integration_credentials WHERE provider = 'quickbooks') THEN
    RAISE EXCEPTION 'failed first connection left a partial binding or credential';
  END IF;
END;
$atomic_first_connection$;

-- Existing external IDs with no durable realm make an automatic first
-- connection unsafe. Clearing this fixture then permits exactly one company.
INSERT INTO public.integration_config(key, value)
VALUES('qbo_bank_account_id', 'legacy-bank-proof')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
DO $unscoped_artifact$
DECLARE r jsonb;
BEGIN
  r := public.replace_qbo_connection(
    'sandbox', 'realm-A', 'access-A', 'refresh-A', now() + interval '1 hour'
  );
  IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'reason' IS DISTINCT FROM 'unscoped-links' THEN
    RAISE EXCEPTION 'unscoped QBO artifact did not block first connection: %', r;
  END IF;
END;
$unscoped_artifact$;
DELETE FROM public.integration_config WHERE key = 'qbo_bank_account_id';

DO $first_and_repeat_connection$
DECLARE first_result jsonb; repeat_result jsonb;
BEGIN
  first_result := public.replace_qbo_connection(
    'sandbox', 'realm-A', 'access-A', 'refresh-A', now() + interval '1 hour'
  );
  repeat_result := public.replace_qbo_connection(
    'sandbox', 'realm-A', 'access-B', 'refresh-B', now() + interval '2 hours'
  );
  IF first_result->>'ok' IS DISTINCT FROM 'true'
     OR first_result->>'generation' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'first company connection failed: %', first_result;
  END IF;
  IF repeat_result->>'ok' IS DISTINCT FROM 'true'
     OR repeat_result->>'generation' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'same-company reconnect did not advance generation: %', repeat_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_credentials
     WHERE provider = 'quickbooks'
       AND realm_id = 'realm-A'
       AND environment = 'sandbox'
       AND access_token = 'access-B'
       AND refresh_token = 'refresh-B'
       AND qbo_binding_generation = 2
  ) THEN
    RAISE EXCEPTION 'same-company reconnect did not atomically replace credentials';
  END IF;
END;
$first_and_repeat_connection$;

-- A stale refresh cannot overwrite the reconnect winner. The current refresh
-- advances the same generation counter rather than relying on timestamp precision.
DO $refresh_generation_cas$
DECLARE stale_result jsonb; current_result jsonb; competing_result jsonb;
BEGIN
  stale_result := public.refresh_qbo_connection_cas(
    'sandbox', 'realm-A', 1, 'stale-access', 'stale-refresh', now() + interval '3 hours'
  );
  IF stale_result->>'ok' IS DISTINCT FROM 'false'
     OR stale_result->>'reason' IS DISTINCT FROM 'connection-changed' THEN
    RAISE EXCEPTION 'stale refresh was accepted: %', stale_result;
  END IF;
  current_result := public.refresh_qbo_connection_cas(
    'sandbox', 'realm-A', 2, 'access-C', 'refresh-C', now() + interval '3 hours'
  );
  IF current_result->>'ok' IS DISTINCT FROM 'true'
     OR current_result->>'generation' IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'current refresh did not advance generation: %', current_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_credentials
     WHERE provider = 'quickbooks'
       AND access_token = 'access-C'
       AND refresh_token = 'refresh-C'
       AND qbo_binding_generation = 3
  ) OR NOT EXISTS (
    SELECT 1 FROM public.qbo_company_binding
     WHERE singleton AND generation = 3
  ) THEN
    RAISE EXCEPTION 'refresh did not atomically advance binding and credential';
  END IF;

  -- Two refreshes can leave Intuit with the same starting generation. Only the
  -- first database finalizer may persist; the other must observe the CAS loss.
  current_result := public.refresh_qbo_connection_cas(
    'sandbox', 'realm-A', 3, 'access-D', 'refresh-D', now() + interval '4 hours'
  );
  competing_result := public.refresh_qbo_connection_cas(
    'sandbox', 'realm-A', 3, 'competing-access', 'competing-refresh', now() + interval '4 hours'
  );
  IF current_result->>'ok' IS DISTINCT FROM 'true'
     OR current_result->>'generation' IS DISTINCT FROM '4'
     OR competing_result->>'ok' IS DISTINCT FROM 'false'
     OR competing_result->>'reason' IS DISTINCT FROM 'connection-changed' THEN
    RAISE EXCEPTION 'refresh-vs-refresh CAS did not choose exactly one winner: % / %', current_result, competing_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_credentials
     WHERE provider = 'quickbooks'
       AND access_token = 'access-D'
       AND refresh_token = 'refresh-D'
       AND qbo_binding_generation = 4
  ) THEN
    RAISE EXCEPTION 'losing refresh overwrote the winning credential';
  END IF;
END;
$refresh_generation_cas$;

DO $environment_mismatch$
DECLARE r jsonb;
BEGIN
  r := public.replace_qbo_connection(
    'production', 'realm-A', 'wrong-environment-access', 'wrong-environment-refresh',
    now() + interval '1 hour'
  );
  IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'reason' IS DISTINCT FROM 'realm-mismatch' THEN
    RAISE EXCEPTION 'environment mismatch did not fail closed: %', r;
  END IF;
END;
$environment_mismatch$;

-- The credential guard stamps the durable generation and rejects both realm
-- and environment drift, while unrelated providers remain untouched.
DO $credential_guard$
BEGIN
  IF (SELECT qbo_binding_generation FROM public.integration_credentials WHERE provider = 'quickbooks') IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'credential was not stamped with binding generation';
  END IF;
  BEGIN
    UPDATE public.integration_credentials SET realm_id = 'realm-B' WHERE provider = 'quickbooks';
    RAISE EXCEPTION 'ordinary credential update changed QBO realm';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.integration_credentials SET environment = 'production' WHERE provider = 'quickbooks';
    RAISE EXCEPTION 'ordinary credential update changed QBO environment';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.integration_credentials SET access_token = 'direct-overwrite' WHERE provider = 'quickbooks';
    RAISE EXCEPTION 'ordinary credential update bypassed generation CAS';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  INSERT INTO public.integration_credentials(provider, environment)
  VALUES('qbo-binding-proof-unrelated', 'production')
  ON CONFLICT (provider) DO UPDATE SET environment = EXCLUDED.environment;
END;
$credential_guard$;

-- RPC bodies are SECURITY DEFINER and therefore write as their owner while
-- preserving the caller's service-role JWT for the realm trigger. Return this
-- fixture session to its owner before the direct projection checks below.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Every persisted realm-bearing ledger/projection is guarded after the binding
-- exists. Exercise a real command reservation RPC and direct service writes:
-- realm B must leave no row, realm A succeeds, and an ordinary non-QBO payment
-- remains compatible with its legacy NULL realm.
DO $realm_ledger_guard$
DECLARE
  v_contact_id uuid := 'b7000000-0000-4000-8000-000000000051';
  v_job_id uuid := 'b6000000-0000-4000-8000-000000000051';
  v_invoice_id uuid := 'b2000000-0000-4000-8000-000000000051';
  v_estimate_id uuid := 'b3000000-0000-4000-8000-000000000051';
  v_command_id uuid := 'b4000000-0000-4000-8000-000000000051';
  v_reservation_id uuid := 'b4000000-0000-4000-8000-000000000052';
  v_invoice_reservation_id uuid := 'b4000000-0000-4000-8000-000000000053';
  v_result jsonb;
  v_target text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'payments', 'payment_receipts', 'payment_receipt_attempts',
    'payment_receipt_events', 'qbo_payment_allocation_fences',
    'qbo_invoice_commands', 'qbo_invoice_command_reservations',
    'qbo_estimate_commands', 'qbo_estimate_command_reservations'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = ('public.' || v_target)::regclass
         AND tgname = 'trg_qbo_realm_binding' AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'missing durable realm guard on %', v_target;
    END IF;
  END LOOP;

  INSERT INTO public.contacts(id, phone, name)
  VALUES (v_contact_id, '+18015550151', 'Binding ledger guard proof');
  INSERT INTO public.jobs(id) VALUES (v_job_id);
  INSERT INTO public.invoices(id, job_id, contact_id, invoice_number, status, invoice_type, total)
  VALUES (v_invoice_id, v_job_id, v_contact_id, 'INV-BINDING-LEDGER', 'draft', 'standard', 10);
  INSERT INTO public.estimates(id, contact_id, estimate_number, estimate_type, status, amount, subtotal)
  VALUES (v_estimate_id, v_contact_id, 'EST-BINDING-LEDGER', 'initial', 'draft', 10, 10);

  BEGIN
    PERFORM public.reserve_qbo_invoice_command(
      v_invoice_reservation_id, v_invoice_id, 'save',
      'b9000000-0000-4000-8000-000000000051', NULL, 'browser', 'realm-B'
    );
    RAISE EXCEPTION 'realm B invoice reservation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE command_id = v_invoice_reservation_id) THEN
    RAISE EXCEPTION 'realm B invoice reservation persisted a row';
  END IF;

  BEGIN
    PERFORM public.reserve_qbo_estimate_command(
      v_reservation_id, v_estimate_id, 'save',
      'b9000000-0000-4000-8000-000000000051',
      'b8000000-0000-4000-8000-000000000051', 'browser', 'realm-B', repeat('5', 64),
      jsonb_build_object('kind', 'customer_sync', 'contact_id', v_contact_id::text, 'primary_request_id', 'binding-ledger')
    );
    RAISE EXCEPTION 'realm B estimate reservation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.qbo_estimate_command_reservations WHERE command_id = v_reservation_id) THEN
    RAISE EXCEPTION 'realm B estimate reservation persisted a row';
  END IF;

  BEGIN
    PERFORM public.reserve_qbo_payment_receipt(
      'binding-ledger-realm-b', 'binding-ledger-realm-b', 'realm-B', repeat('6', 64),
      jsonb_build_object('contact_id', v_contact_id::text, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', v_invoice_id::text, 'amount_cents', 100))),
      NULL
    );
    RAISE EXCEPTION 'realm B receipt reservation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.payment_receipt_attempts WHERE client_request_id = 'binding-ledger-realm-b') THEN
    RAISE EXCEPTION 'realm B receipt reservation persisted a row';
  END IF;

  v_result := public.reserve_qbo_estimate_command(
    v_reservation_id, v_estimate_id, 'save',
    'b9000000-0000-4000-8000-000000000051',
    'b8000000-0000-4000-8000-000000000051', 'browser', 'realm-A', repeat('5', 64),
    jsonb_build_object('kind', 'customer_sync', 'contact_id', v_contact_id::text, 'primary_request_id', 'binding-ledger')
  );
  IF v_result->>'ok' IS DISTINCT FROM 'true'
     OR NOT EXISTS (SELECT 1 FROM public.qbo_estimate_command_reservations WHERE command_id = v_reservation_id AND realm_id = 'realm-A') THEN
    RAISE EXCEPTION 'same-realm estimate reservation did not persist: %', v_result;
  END IF;

  BEGIN
    INSERT INTO public.payment_receipts(
      qbo_realm_id, qbo_customer_id, qbo_payment_id, txn_date, total_cents, applied_cents, status
    ) VALUES ('realm-B', 'customer-B', 'payment-B', current_date, 100, 0, 'rejected');
    RAISE EXCEPTION 'realm B receipt projection was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.payment_receipts WHERE qbo_payment_id = 'payment-B') THEN
    RAISE EXCEPTION 'realm B receipt projection persisted a row';
  END IF;
  INSERT INTO public.payment_receipts(
    qbo_realm_id, qbo_customer_id, qbo_payment_id, txn_date,
    total_cents, applied_cents, unapplied_cents, status
  ) VALUES ('realm-A', 'customer-A', 'payment-A', current_date, 100, 0, 100, 'rejected');
  INSERT INTO public.payments(job_id, amount, payment_date, payment_method, qbo_payment_id, qbo_realm_id)
  VALUES (v_job_id, 1, current_date, 'other', 'payment-A', 'realm-A');
  INSERT INTO public.payments(job_id, amount, payment_date, payment_method)
  VALUES (v_job_id, 1, current_date, 'other');
  BEGIN
    INSERT INTO public.payments(job_id, amount, payment_date, payment_method, qbo_payment_id)
    VALUES (v_job_id, 1, current_date, 'other', 'missing-realm');
    RAISE EXCEPTION 'QBO payment projection without realm was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.payments WHERE qbo_payment_id = 'missing-realm') THEN
    RAISE EXCEPTION 'QBO payment projection without realm persisted a row';
  END IF;
END;
$realm_ledger_guard$;

-- The nullable compatibility exit must preserve the existing authenticated
-- manual-payment path, yet an authenticated caller must still be unable to
-- add QBO attribution. This uses the actual billing RLS predicate, not a
-- postgres bypass.
INSERT INTO public.employees(id, auth_user_id, full_name, email, role, is_active, is_external)
VALUES (
  'b8000000-0000-4000-8000-000000000051',
  'b9000000-0000-4000-8000-000000000051',
  'Binding ledger admin', 'binding-ledger-admin@example.invalid', 'admin', true, false
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b9000000-0000-4000-8000-000000000051","role":"authenticated"}', true);
DO $authenticated_manual_payment$
DECLARE v_payment_id uuid;
BEGIN
  INSERT INTO public.payments(invoice_id, job_id, contact_id, amount, payment_date, payer_type, recorded_by)
  VALUES (
    'b2000000-0000-4000-8000-000000000051',
    'b6000000-0000-4000-8000-000000000051',
    'b7000000-0000-4000-8000-000000000051', 1, current_date, 'insurance',
    'b8000000-0000-4000-8000-000000000051'
  ) RETURNING id INTO v_payment_id;
  UPDATE public.payments SET amount = 2 WHERE id = v_payment_id;
  BEGIN
    INSERT INTO public.payments(invoice_id, job_id, contact_id, amount, payment_date, payer_type, recorded_by, qbo_payment_id, qbo_realm_id)
    VALUES (
      'b2000000-0000-4000-8000-000000000051',
      'b6000000-0000-4000-8000-000000000051',
      'b7000000-0000-4000-8000-000000000051', 1, current_date, 'insurance',
      'b8000000-0000-4000-8000-000000000051', 'browser-qbo-payment', 'realm-A'
    );
    RAISE EXCEPTION 'authenticated QBO-attributed payment was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.payments WHERE qbo_payment_id = 'browser-qbo-payment') THEN
    RAISE EXCEPTION 'authenticated QBO-attributed payment persisted a row';
  END IF;
  BEGIN
    INSERT INTO public.payments(
      invoice_id, job_id, contact_id, amount, payment_date, payer_type, recorded_by,
      stripe_fee_qbo_purchase_id
    ) VALUES (
      'b2000000-0000-4000-8000-000000000051',
      'b6000000-0000-4000-8000-000000000051',
      'b7000000-0000-4000-8000-000000000051', 1, current_date, 'insurance',
      'b8000000-0000-4000-8000-000000000051', 'browser-qbo-purchase-insert'
    );
    RAISE EXCEPTION 'authenticated QBO purchase insert was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.payments
     WHERE stripe_fee_qbo_purchase_id = 'browser-qbo-purchase-insert'
  ) THEN
    RAISE EXCEPTION 'authenticated QBO purchase insert persisted a row';
  END IF;
  BEGIN
    UPDATE public.payments
       SET stripe_fee_qbo_purchase_id = 'browser-qbo-purchase-update'
     WHERE id = v_payment_id;
    RAISE EXCEPTION 'authenticated QBO purchase update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.payments
     WHERE id = v_payment_id
       AND (stripe_fee_qbo_purchase_id IS NOT NULL OR amount IS DISTINCT FROM 2)
  ) THEN
    RAISE EXCEPTION 'authenticated QBO purchase update changed the manual payment';
  END IF;
END;
$authenticated_manual_payment$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Deleting secrets never deletes or changes the company identity. A colliding
-- numeric external id in another company can therefore never become reachable.
DELETE FROM public.integration_credentials WHERE provider = 'quickbooks';
DO $deletion_survival$
DECLARE r jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.qbo_company_binding
     WHERE singleton AND environment = 'sandbox' AND realm_id = 'realm-A' AND generation = 4
  ) THEN
    RAISE EXCEPTION 'credential deletion lost durable QBO company binding';
  END IF;
  r := public.replace_qbo_connection(
    'sandbox', 'realm-B', 'access-other', 'refresh-other', now() + interval '1 hour'
  );
  IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'reason' IS DISTINCT FROM 'realm-mismatch' THEN
    RAISE EXCEPTION 'different company was accepted after credential deletion: %', r;
  END IF;
END;
$deletion_survival$;

RESET ROLE;
ROLLBACK;
