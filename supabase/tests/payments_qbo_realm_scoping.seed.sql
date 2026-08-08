-- ═══════════════════════════════════════════════════════════════════════════
-- FILE: payments_qbo_realm_scoping.seed.sql
-- Phase: n/a — committed fixture for 20260808070000_payments_qbo_realm_scoping
-- ═══════════════════════════════════════════════════════════════════════════
-- The ONLY committed writes in this qualification. Both behavioural proofs run
-- inside a transaction they roll back, which is right for everything they
-- assert — except two claims that are meaningless unless a row SURVIVES a
-- boundary the proof cannot cross:
--
--   1. "no backfill" — a payments row must exist BEFORE the migration and still
--      read qbo_realm_id IS NULL after it. A row created inside the forward
--      proof was created after the ALTER TABLE, so it proves nothing about
--      pre-existing data.
--   2. "realm values survive the rollback" — a realm-stamped projection must be
--      committed BEFORE the rollback runs. The forward proof's writes are gone
--      by the time the rollback proof starts.
--
-- The qualifier therefore runs THIS FILE TWICE: once after the predecessors and
-- before the migration, once immediately after the migration. It selects its own
-- phase from whether public.payments.qbo_realm_id exists, so the runner passes
-- no arguments and there is no SQL string interpolation anywhere in the harness.
--
-- Everything is a fixed UUID literal so both passes and both proofs agree on
-- identity without a lookup table. Every INSERT is ON CONFLICT DO NOTHING, so a
-- repeated pass is inert rather than an error.
-- ═══════════════════════════════════════════════════════════════════════════

-- Refuse to run anywhere but a disposable stack. current_database() is NOT a
-- usable guard — every Supabase database is named "postgres", including the
-- shared production project — so this keys on a GUC the qualifier sets and
-- nothing else does.
DO $guard$
BEGIN
  IF current_setting('upr.isolated_test_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'REFUSING TO RUN: upr.isolated_test_database is not "on". This file COMMITS rows and is for a disposable database only.';
  END IF;
END
$guard$;

-- One DO block on purpose: psql runs each top-level statement in its own
-- transaction, and the post phase needs set_config(..., is_local => true) and
-- the reconcile call to share one. A DO block is a single statement.
DO $seed$
DECLARE
  v_has_realm boolean;
  v_contact_a  uuid := '11111111-1111-4111-8111-111111111111';
  v_job_a      uuid := '22222222-2222-4222-8222-222222222222';
  v_inv_legacy uuid := '33333333-3333-4333-8333-333333333333';
  v_inv_keep   uuid := '44444444-4444-4444-8444-444444444444';
  v_pay_legacy uuid := '55555555-5555-4555-8555-555555555555';
  v_stamped    text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'qbo_realm_id'
  ) INTO v_has_realm;

  IF NOT v_has_realm THEN
    -- ─── PRE-MIGRATION PASS ────────────────────────────────────────────────
    -- contacts.phone is NOT NULL; jobs.division is the enum public.job_division;
    -- contacts.qbo_customer_id must match the receipt's customer or reconcile
    -- refuses with ALLOCATION_INVOICE_MISMATCH.
    INSERT INTO public.contacts (id, name, phone, qbo_customer_id)
    VALUES (v_contact_a, 'QA Realm Seed Contact', '+15550000900', '910')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.jobs (id, job_number, primary_contact_id, division)
    VALUES (v_job_a, 'QA-SEED-REALM-001', v_contact_a, 'water')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
    VALUES (v_inv_legacy, 'QA-SEED-INV-LEGACY', v_job_a, v_contact_a, 40.00, '990001', 'sent')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.invoices (id, invoice_number, job_id, contact_id, total, qbo_invoice_id, status)
    VALUES (v_inv_keep, 'QA-SEED-INV-KEEP', v_job_a, v_contact_a, 60.00, '990002', 'sent')
    ON CONFLICT (id) DO NOTHING;

    -- The historical tail this migration deliberately does NOT backfill: a
    -- source='qbo' payment carrying a QuickBooks payment id and no realm,
    -- written before the column existed. receipt_id stays NULL, so the
    -- guard_payment_receipt_link_insert trigger does not fire.
    INSERT INTO public.payments (
      id, invoice_id, job_id, contact_id, amount, payment_date,
      payer_type, payment_method, source, qbo_payment_id, qbo_synced_at
    ) VALUES (
      v_pay_legacy, v_inv_legacy, v_job_a, v_contact_a, 40.00, DATE '2025-09-05',
      'homeowner', 'other', 'qbo', 'QA-SEED-LEGACY-PAY', now()
    ) ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'SEED pre-migration — fixtures + 1 legacy realm-less qbo payment committed';
  ELSE
    -- ─── POST-MIGRATION PASS ───────────────────────────────────────────────
    -- One realm-stamped projection, written the way production writes them, and
    -- COMMITTED so the rollback proof can show the realm value survives.
    -- The realm literal is the only realm ever observed in production.
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('role', 'service_role', 'sub', gen_random_uuid()::text)::text,
      true
    );

    PERFORM public.reconcile_qbo_payment_receipt(
      jsonb_build_object(
        'qbo_realm_id', '9341453160223706', 'qbo_payment_id', 'QA-SEED-KEEP-PAY',
        'qbo_customer_id', '910', 'txn_date', '2026-08-08', 'payment_method', 'other',
        'reference_number', 'QA seed keep', 'total_cents', 6000, 'applied_cents', 6000,
        'unapplied_cents', 0, 'source', 'qbo'),
      jsonb_build_array(jsonb_build_object(
        'invoice_id', v_inv_keep, 'qbo_invoice_id', '990002',
        'amount_cents', 6000, 'payer_type', 'homeowner')),
      'reconciled', 'qa-seed-keep-event');

    SELECT max(qbo_realm_id) INTO v_stamped
    FROM public.payments WHERE qbo_payment_id = 'QA-SEED-KEEP-PAY';
    IF v_stamped IS DISTINCT FROM '9341453160223706' THEN
      RAISE EXCEPTION
        'SEED FAILED: committed projection carries realm %, expected 9341453160223706 — the rollback proof has nothing to measure',
        COALESCE(v_stamped, '<NULL>');
    END IF;

    RAISE NOTICE 'SEED post-migration — 1 realm-stamped projection committed';
  END IF;
END
$seed$;
