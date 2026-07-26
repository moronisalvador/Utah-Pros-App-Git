-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726200000_anon_closure_tranche_a
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts both tables back exactly as they were before the closure, and removes
--   the admin-only requirement from the customer-texting switch.
--
--   Be aware of what this restores: anyone on the internet could again switch
--   customer texting on or off, and delete the do-not-email list. Only run this
--   if the closure actually broke something, and treat it as temporary.
--
-- VERIFIED-BEFORE STATE (live catalog, 2026-07-26):
--   automation_settings_all : ALL / {anon,authenticated} / USING true / WITH CHECK true
--   email_suppressions_all  : ALL / {anon,authenticated} / USING true / WITH CHECK true
--   both tables: anon + authenticated held all 7 privileges.
-- ════════════════════════════════════════════════

-- ─── 1. automation_settings ───

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.automation_settings TO anon, authenticated;

CREATE POLICY automation_settings_all ON public.automation_settings
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.automation_settings IS NULL;

-- ─── 2. email_suppressions ───

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.email_suppressions TO anon, authenticated;

CREATE POLICY email_suppressions_all ON public.email_suppressions
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.email_suppressions IS NULL;

-- ─── 3. set_automation_setting — prior body, no authorization block ───

CREATE OR REPLACE FUNCTION public.set_automation_setting(
  p_key text,
  p_value boolean,
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS automation_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_row automation_settings;
BEGIN
  IF p_key NOT IN (
    'sms_sending_enabled', 'speed_to_lead_enabled', 'missed_call_textback_enabled',
    'no_response_followup_enabled', 'review_request_enabled'
  ) THEN
    RAISE EXCEPTION 'set_automation_setting: invalid key %', p_key;
  END IF;

  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'set_automation_setting: no org resolved';
  END IF;

  INSERT INTO automation_settings (org_id) VALUES (v_org) ON CONFLICT (org_id) DO NOTHING;

  EXECUTE format(
    'UPDATE automation_settings SET %I = $1, updated_at = now() WHERE org_id = $2 RETURNING *', p_key
  ) INTO v_row USING p_value, v_org;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) TO authenticated, service_role;
