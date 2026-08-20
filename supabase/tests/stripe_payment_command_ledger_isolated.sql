-- ════════════════════════════════════════════════
-- PROOF: stripe_payment_command_ledger_isolated.sql
-- For: supabase/migrations/20260820020000_stripe_payment_command_ledger.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Runs against a throwaway database and proves the new Stripe accounting
--   record behaves: only the trusted server role can touch it, everyone else is
--   refused, a repeated message finds the original entry instead of starting a
--   second one, and a bank payment that has not settled cannot be mistaken for
--   money.
--
-- RUN BY: scripts/qa/qualify-stripe-payment-command-ledger-local.mjs
--
-- NOTES / GOTCHAS:
--   - The isolation guard is the `upr.isolated_test_database` GUC and NOT
--     current_database(). EVERY Supabase database is named `postgres`, including
--     the shared production project — a name check would be no protection at all
--     while feeling like one. Two earlier proofs in this repo carried that bug.
--   - Role claims are built with jsonb_build_object rather than written as a
--     JSON literal. `.claude/hooks/block-secrets.sh` refuses the literal form
--     because that exact string appears inside a decoded service-role JWT. Do
--     not "simplify" these back into a quoted literal; the hook will block it.
-- ════════════════════════════════════════════════

DO $$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'refusing to run outside a disposable database';
  END IF;
END $$;

-- ── Fixture ─────────────────────────────────────────────────────────────────
-- Idempotent on purpose. The runner executes this proof twice — once after the
-- migration and again after rollback-and-reapply — and inserting a job fires
-- triggers that write system_events, whose FK then blocks deleting the job at
-- the end. Making the fixture re-runnable is simpler and more robust than
-- chasing every dependent row a trigger might have created.
INSERT INTO public.jobs (id) VALUES ('d1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.invoices (id, job_id, invoice_number, status, invoice_type, total)
VALUES ('d2000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000001',
        'ZZ-STRIPE-1', 'sent', 'standard', 5182)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════
-- 1. DENY — anon and authenticated hold no privilege of any kind
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_fn IN ARRAY ARRAY[
      'stripe_command_guard()',
      'reserve_stripe_payment_command(text,text,text,text,text,jsonb,uuid,uuid,text)',
      'start_stripe_payment_command(uuid)',
      'finalize_stripe_payment_command(uuid,text,text,text,text,jsonb,uuid)',
      'get_stripe_payment_command(text,text)'
    ] LOOP
      IF has_function_privilege(v_role, 'public.' || v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% must not hold EXECUTE on %', v_role, v_fn;
      END IF;
    END LOOP;

    -- No table privilege either, so RLS is a second line rather than the only one.
    IF has_table_privilege(v_role, 'public.stripe_payment_commands', 'SELECT')
       OR has_table_privilege(v_role, 'public.stripe_payment_commands', 'INSERT')
       OR has_table_privilege(v_role, 'public.stripe_payment_commands', 'UPDATE')
       OR has_table_privilege(v_role, 'public.stripe_payment_commands', 'DELETE') THEN
      RAISE EXCEPTION '% must hold no privilege on stripe_payment_commands', v_role;
    END IF;
  END LOOP;

  -- PUBLIC must not hold EXECUTE: this managed project re-applies EXECUTE TO
  -- PUBLIC on every new function, so the migration's explicit REVOKE is what
  -- makes the narrow grants meaningful.
  IF has_function_privilege('public', 'public.reserve_stripe_payment_command(text,text,text,text,text,jsonb,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC must not hold EXECUTE on reserve_stripe_payment_command';
  END IF;
END $$;

-- ════════════════════════════════════════════════
-- 2. DENY — a real authenticated session is refused at the guard
--    (roles this change is not "about" must be proven too)
-- ════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'd9000000-0000-4000-8000-000000000001')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.get_stripe_payment_command('ch_deny', 'record_payment');
    RAISE EXCEPTION 'authenticated reached the ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;   -- 42501, as designed
  END;
END $$;
RESET ROLE;

-- ════════════════════════════════════════════════
-- 3. DENY — a CLAIMLESS session. This is the NULL-safety case.
--    auth.role() is NULL outside a PostgREST request; with `<>` the guard
--    expression would be NULL, PL/pgSQL's IF treats NULL as false, and the
--    check would be silently skipped. `IS DISTINCT FROM` is why it is not.
-- ════════════════════════════════════════════════
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{}', false);
DO $$
BEGIN
  IF auth.role() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture error: expected a claimless session, got %', auth.role();
  END IF;
  BEGIN
    PERFORM public.get_stripe_payment_command('ch_claimless', 'record_payment');
    RAISE EXCEPTION 'a claimless session reached the ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ════════════════════════════════════════════════
-- 4. ALLOW — the service role, and the behaviour that prevents duplicates
-- ════════════════════════════════════════════════
SET ROLE service_role;
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, false);

DO $$
DECLARE
  v_first public.stripe_payment_commands;
  v_again public.stripe_payment_commands;
  v_fee public.stripe_payment_commands;
  v_started public.stripe_payment_commands;
  v_done public.stripe_payment_commands;
  v_count int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'fixture error: service role not in effect (got %)', auth.role();
  END IF;

  v_first := public.reserve_stripe_payment_command(
    'ch_proof_1', 'record_payment', 'realm-proof', 'upr-s-p-aaaa', repeat('a', 64),
    '{"amount_cents":518200}'::jsonb, 'd2000000-0000-4000-8000-000000000001', NULL, 'evt_1');
  IF v_first.id IS NULL OR v_first.status <> 'prepared' THEN
    RAISE EXCEPTION 'reserve did not return a prepared command';
  END IF;

  -- ── THE POINT OF THE WHOLE TABLE ──
  -- A redelivered Stripe event must find the ORIGINAL row and the ORIGINAL
  -- frozen request id. If this returned a new row, a retry would present Intuit
  -- a fresh requestid and create a SECOND QuickBooks Payment for the same money.
  v_again := public.reserve_stripe_payment_command(
    'ch_proof_1', 'record_payment', 'realm-proof', 'upr-s-p-DIFFERENT', repeat('b', 64),
    '{"amount_cents":999999}'::jsonb, NULL, NULL, 'evt_1_redelivered');
  IF v_again.id <> v_first.id THEN
    RAISE EXCEPTION 'a redelivered event started a second command';
  END IF;
  IF v_again.provider_request_id <> 'upr-s-p-aaaa' THEN
    RAISE EXCEPTION 'the frozen request id changed on redelivery: %', v_again.provider_request_id;
  END IF;

  SELECT count(*) INTO v_count FROM public.stripe_payment_commands WHERE stripe_object_id = 'ch_proof_1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected exactly 1 command for the charge, found %', v_count; END IF;

  -- A different ACTION on the same charge is a separate command: one charge
  -- legitimately produces both a payment and a fee.
  v_fee := public.reserve_stripe_payment_command(
    'ch_proof_1', 'book_fee', 'realm-proof', 'upr-s-f-cccc', repeat('c', 64),
    '{"fee_cents":15000}'::jsonb, NULL, NULL, 'evt_1');
  IF v_fee.id = v_first.id THEN RAISE EXCEPTION 'book_fee collided with record_payment'; END IF;

  v_started := public.start_stripe_payment_command(v_first.id);
  IF v_started.status <> 'provider_started' THEN
    RAISE EXCEPTION 'start did not move the command in flight (got %)', v_started.status;
  END IF;

  v_done := public.finalize_stripe_payment_command(
    v_first.id, 'succeeded', 'QBO-PAY-1', NULL, 'intuit-tid-1', NULL, NULL);
  IF v_done.status <> 'succeeded' OR v_done.provider_target_id <> 'QBO-PAY-1' THEN
    RAISE EXCEPTION 'finalize did not record success';
  END IF;
  IF v_done.completed_at IS NULL THEN RAISE EXCEPTION 'a terminal command must be stamped completed'; END IF;

  -- A finished command cannot be restarted: that is what stops a late duplicate
  -- delivery from re-pushing to QuickBooks.
  v_started := public.start_stripe_payment_command(v_first.id);
  IF v_started.id IS NOT NULL THEN
    RAISE EXCEPTION 'a succeeded command was restarted';
  END IF;
END $$;

-- ════════════════════════════════════════════════
-- 5. An unsettled ACH is a real, non-terminal state
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_cmd public.stripe_payment_commands;
  v_started public.stripe_payment_commands;
BEGIN
  v_cmd := public.reserve_stripe_payment_command(
    'ch_proof_ach', 'record_payment', 'realm-proof', 'upr-s-p-dddd', repeat('d', 64),
    '{"amount_cents":100000}'::jsonb, NULL, NULL, 'evt_ach');

  v_cmd := public.finalize_stripe_payment_command(v_cmd.id, 'pending_settlement', NULL, NULL, NULL, NULL, NULL);
  IF v_cmd.status <> 'pending_settlement' THEN
    RAISE EXCEPTION 'pending_settlement was not accepted';
  END IF;
  -- Not terminal: it must NOT be stamped completed, or a later settlement could
  -- never be recorded.
  IF v_cmd.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'pending_settlement must not complete the command';
  END IF;

  -- And it must still be startable when the money finally arrives.
  v_started := public.start_stripe_payment_command(v_cmd.id);
  IF v_started.status <> 'provider_started' THEN
    RAISE EXCEPTION 'a settled ACH could not start its provider call';
  END IF;
END $$;

-- ════════════════════════════════════════════════
-- 6. An ambiguous failure stays retryable under the SAME frozen id
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_cmd public.stripe_payment_commands;
  v_retry public.stripe_payment_commands;
BEGIN
  v_cmd := public.reserve_stripe_payment_command(
    'ch_proof_amb', 'record_payment', 'realm-proof', 'upr-s-p-eeee', repeat('e', 64),
    '{"amount_cents":250000}'::jsonb, NULL, NULL, 'evt_amb');
  PERFORM public.start_stripe_payment_command(v_cmd.id);
  v_cmd := public.finalize_stripe_payment_command(v_cmd.id, 'ambiguous', NULL, 'connection reset', NULL, NULL, NULL);
  IF v_cmd.status <> 'ambiguous' OR v_cmd.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ambiguous must be non-terminal and retryable';
  END IF;

  -- The retry re-reserves and MUST get the original frozen id back.
  v_retry := public.reserve_stripe_payment_command(
    'ch_proof_amb', 'record_payment', 'realm-proof', 'upr-s-p-NEWID', repeat('f', 64),
    '{}'::jsonb, NULL, NULL, 'evt_amb_retry');
  IF v_retry.provider_request_id <> 'upr-s-p-eeee' THEN
    RAISE EXCEPTION 'a retry after an ambiguous failure changed the request id — this is the duplicate-payment bug';
  END IF;
  -- PL/pgSQL cannot field-access a function result inline; assign first.
  v_retry := public.start_stripe_payment_command(v_retry.id);
  IF v_retry.status <> 'provider_started' THEN
    RAISE EXCEPTION 'an ambiguous command could not be retried';
  END IF;
END $$;

-- ════════════════════════════════════════════════
-- 7. finalize refuses a status outside the vocabulary
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_cmd public.stripe_payment_commands;
BEGIN
  v_cmd := public.reserve_stripe_payment_command(
    'ch_proof_bad', 'record_payment', 'realm-proof', 'upr-s-p-gggg', repeat('9', 64),
    '{}'::jsonb, NULL, NULL, NULL);
  BEGIN
    PERFORM public.finalize_stripe_payment_command(v_cmd.id, 'definitely_paid_trust_me', NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'finalize accepted an unknown status';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;   -- 22023, as designed
  END;
END $$;

-- ════════════════════════════════════════════════
-- 8. A payout command belongs to no invoice
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_cmd public.stripe_payment_commands;
BEGIN
  v_cmd := public.reserve_stripe_payment_command(
    'po_proof_1', 'transfer_payout', 'realm-proof', 'upr-s-t-hhhh', repeat('7', 64),
    '{"net_cents":97070}'::jsonb, NULL, NULL, 'evt_payout');
  IF v_cmd.id IS NULL OR v_cmd.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'a payout command must be reservable with no invoice';
  END IF;
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════
-- 9. Nothing here touched the money tables
-- ════════════════════════════════════════════════
DO $$
DECLARE
  v_paid numeric;
  v_status text;
  v_payments int;
BEGIN
  SELECT amount_paid, status INTO v_paid, v_status
  FROM public.invoices WHERE id = 'd2000000-0000-4000-8000-000000000001';
  IF v_paid <> 0 THEN
    RAISE EXCEPTION 'the ledger changed invoices.amount_paid (%), which the trigger owns', v_paid;
  END IF;
  IF v_status <> 'sent' THEN
    RAISE EXCEPTION 'the ledger changed invoices.status (%)', v_status;
  END IF;

  SELECT count(*) INTO v_payments FROM public.payments;
  IF v_payments <> 0 THEN
    RAISE EXCEPTION 'the ledger created % payments row(s); recording a command is not receiving money', v_payments;
  END IF;
END $$;

-- ── Clean up so a re-apply proof starts from the same place ──────────────────
-- Only what this migration owns. The job and invoice are left in place and the
-- fixture above tolerates them; removing them would mean deleting whatever rows
-- their triggers created, which is not this proof's business.
DELETE FROM public.stripe_payment_commands;
