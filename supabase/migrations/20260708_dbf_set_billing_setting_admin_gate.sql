-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_set_billing_setting_admin_gate.sql
-- DB-Foundation Phase F — lock the payment-settings writer to admins  [item ②]
--   docs/db-foundation-roadmap.md → Phase F block (Severity findings).
--
-- WHAT THIS DOES (plain language):
--   `set_billing_setting` decides whether the business accepts cards/ACH, the
--   surcharge %, default invoice terms, and the QuickBooks clearing/fee/bank
--   account mappings. It was granted to the browser and only checked the KEY
--   name — never WHO was calling — so a logged-out visitor hitting PostgREST
--   directly could flip payment behavior. This adds the same server-side admin
--   gate the P9 credential writers use (`p9_assert_admin()`) as the FIRST
--   statement, and drops the anon EXECUTE grant. The whitelist and the entire
--   rest of the body are reproduced VERBATIM from the LIVE definition (dumped via
--   pg_get_functiondef, which had drifted ahead of the repo to include the
--   qbo_bank_account_* keys) — signature and behavior for a legitimate admin
--   caller are unchanged.
--
-- CONTRACT FREEZE: signature stays set_billing_setting(p_key text, p_value text)
--   RETURNS void. Return shape unchanged. The shipped caller (Payment Settings
--   page, authenticated admin) still succeeds — see the live admin round-trip in
--   the PR notes and db_foundation_billing_admin_gate.test.js.
--
-- ROLLBACK (exact inverse — restores the pre-gate function + anon grant):
--   CREATE OR REPLACE FUNCTION public.set_billing_setting(p_key text, p_value text)
--   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   BEGIN
--     IF p_key NOT IN (
--       'accept_card','accept_ach','default_terms','surcharge_enabled','surcharge_pct',
--       'qbo_stripe_clearing_account_id','qbo_stripe_clearing_account_name',
--       'qbo_fee_expense_account_id','qbo_fee_expense_account_name',
--       'qbo_bank_account_id','qbo_bank_account_name'
--     ) THEN
--       RAISE EXCEPTION 'Not an editable billing setting: %', p_key;
--     END IF;
--     INSERT INTO integration_config (key, value, updated_at)
--     VALUES (p_key, p_value, now())
--     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
--   END;
--   $function$;
--   GRANT EXECUTE ON FUNCTION public.set_billing_setting(text, text) TO anon;
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_billing_setting(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.p9_assert_admin();          -- ← DB-Foundation: admin-only, server side

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
$function$;

-- Least privilege: a write RPC has no business being callable by the anon role.
-- (The admin gate already rejects anon; this removes the grant entirely.)
REVOKE ALL ON FUNCTION public.set_billing_setting(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_billing_setting(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_billing_setting(text, text) TO authenticated, service_role;
