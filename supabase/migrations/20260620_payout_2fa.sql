-- 20260620_payout_2fa.sql
-- Email-2FA gate for the Stripe payout destinations (where our money lands). Changing
-- the deposit bank or instant-payout debit card requires a one-time code emailed to the
-- owner — it is NOT an easy click-and-edit field.
--
-- Enforcement: the four payout-destination keys are REMOVED from the open
-- set_billing_setting whitelist, so they can only be written by the billing-2fa worker
-- (service role) after it verifies the emailed code. get_billing_settings still returns
-- them for display.

-- One-time codes (RLS-locked → service role / the worker only; no anon/authenticated policies).
CREATE TABLE IF NOT EXISTS billing_2fa_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose      text NOT NULL DEFAULT 'payout_destination',
  code_hash    text NOT NULL,              -- SHA-256 hex of the 6-digit code
  requested_by uuid,                       -- employees.id who initiated
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE billing_2fa_codes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS billing_2fa_codes_open_idx
  ON billing_2fa_codes (code_hash) WHERE used_at IS NULL;

-- Drop the payout-destination keys from the open setter. They are now write-protected:
-- only the billing-2fa worker (service role) sets them, post email verification.
CREATE OR REPLACE FUNCTION set_billing_setting(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF p_key NOT IN (
    'accept_card','accept_ach','default_terms','surcharge_enabled','surcharge_pct',
    'qbo_stripe_clearing_account_id','qbo_stripe_clearing_account_name',
    'qbo_fee_expense_account_id','qbo_fee_expense_account_name',
    'qbo_bank_account_id','qbo_bank_account_name'
  ) THEN
    RAISE EXCEPTION 'Not an editable billing setting: %', p_key;
  END IF;
  INSERT INTO integration_config (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION set_billing_setting(text, text) TO anon, authenticated;
