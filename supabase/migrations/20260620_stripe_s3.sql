-- 20260620_stripe_s3.sql
-- Stripe S3 — live card collection + fee automation (DORMANT until Stripe keys exist).
--
-- Pattern (one-way UPR -> QBO, UPR is system of record):
--   customer pays via a UPR pay-link -> Stripe webhook records the payment in UPR ->
--   UPR pushes it to QBO as a Payment *deposited to the "Stripe Clearing" bank account*,
--   books the exact Stripe fee as a Purchase (clearing -> Merchant Fees), and on payout
--   posts a Transfer (clearing -> real bank) for the net. UPR is the ONLY writer to QBO.
--
-- Everything here is additive and safe to ship before Stripe is set up: the columns are
-- nullable, the table is unused until the webhook runs, and the settings keys default to
-- empty. Nothing fires until STRIPE_* env vars are present in Cloudflare.

-- ── Invoice pay-link (Stripe Checkout session for the balance) ──────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stripe_payment_link_url        text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id     text,
  ADD COLUMN IF NOT EXISTS stripe_payment_link_created_at timestamptz;

-- ── Stripe linkage + fee on payments ───────────────────────────────────────────
-- source distinguishes Stripe-collected payments from hand-entered ones; the qbo_*
-- columns (already present) carry the QBO mirror. stripe_fee is the exact processing
-- fee (from balance_transaction.fee); stripe_fee_qbo_purchase_id is the QBO Purchase
-- that books it (so S4 refunds/disputes can reverse it).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS source                     text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id           text,
  ADD COLUMN IF NOT EXISTS stripe_fee                 numeric,
  ADD COLUMN IF NOT EXISTS stripe_fee_qbo_purchase_id text;

-- One UPR payment per Stripe charge (charge-level idempotency for the webhook).
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_charge_uniq
  ON payments (stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

-- ── Webhook idempotency ledger (event-level "never double-post") ────────────────
-- One row per processed Stripe event. RLS-locked to the service role (the webhook
-- worker), mirroring integration_credentials — NO anon/authenticated policies.
CREATE TABLE IF NOT EXISTS stripe_events (
  id           text PRIMARY KEY,                 -- Stripe event id (evt_...)
  type         text,
  status       text NOT NULL DEFAULT 'processing', -- processing | processed | error | skipped
  payload      jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Atomically claim an event: inserts (status 'processing') and returns TRUE only when
-- this call created the row. A duplicate delivery hits the conflict and returns FALSE,
-- so the worker can no-op. Race-safe (unlike select-then-insert).
CREATE OR REPLACE FUNCTION claim_stripe_event(p_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO stripe_events (id, type, status)
  VALUES (p_id, p_type, 'processing')
  ON CONFLICT (id) DO NOTHING;
  RETURN FOUND;  -- TRUE = newly inserted (process it), FALSE = duplicate (skip)
END;
$$;
GRANT EXECUTE ON FUNCTION claim_stripe_event(text, text) TO service_role;

-- ── Billing settings: payout destinations (Payment Settings page) ───────────────
-- Adds the standard-deposit checking account and the instant-payout debit card to the
-- read set + setter whitelist. stripe_connected stays read-only here (the worker sets it
-- when the keys work). Keys hold Stripe external-account ids (ba_.../card_...).
CREATE OR REPLACE FUNCTION get_billing_settings()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM integration_config
  WHERE key IN (
    'accept_card','accept_ach','default_terms','surcharge_enabled','surcharge_pct',
    'qbo_stripe_clearing_account_id','qbo_stripe_clearing_account_name',
    'qbo_fee_expense_account_id','qbo_fee_expense_account_name','stripe_connected',
    'qbo_bank_account_id','qbo_bank_account_name',
    'stripe_payout_bank_id','stripe_payout_bank_name',
    'stripe_instant_card_id','stripe_instant_card_name'
  );
$$;

CREATE OR REPLACE FUNCTION set_billing_setting(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF p_key NOT IN (
    'accept_card','accept_ach','default_terms','surcharge_enabled','surcharge_pct',
    'qbo_stripe_clearing_account_id','qbo_stripe_clearing_account_name',
    'qbo_fee_expense_account_id','qbo_fee_expense_account_name',
    'qbo_bank_account_id','qbo_bank_account_name',
    'stripe_payout_bank_id','stripe_payout_bank_name',
    'stripe_instant_card_id','stripe_instant_card_name'
  ) THEN
    RAISE EXCEPTION 'Not an editable billing setting: %', p_key;
  END IF;
  INSERT INTO integration_config (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION get_billing_settings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_billing_setting(text, text) TO anon, authenticated;
