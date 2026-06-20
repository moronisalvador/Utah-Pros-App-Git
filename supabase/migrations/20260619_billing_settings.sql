-- 20260619_billing_settings.sql
-- Read/write for the Payment Settings page. Stored in the key/value integration_config.
-- The setter is whitelisted so this RPC can't touch sensitive config keys (e.g.
-- auto_draft_invoices, qbo_webhook_secret).

CREATE OR REPLACE FUNCTION get_billing_settings()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM integration_config
  WHERE key IN (
    'accept_card','accept_ach','default_terms','surcharge_enabled','surcharge_pct',
    'qbo_stripe_clearing_account_id','qbo_stripe_clearing_account_name',
    'qbo_fee_expense_account_id','qbo_fee_expense_account_name','stripe_connected'
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
    'qbo_fee_expense_account_id','qbo_fee_expense_account_name'
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
