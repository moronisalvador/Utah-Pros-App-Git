-- ════════════════════════════════════════════════
-- FILE: 20260702_crm_phase4d_automation_rpcs.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Turns two placeholder database functions into real ones so the CRM
--   Settings page can read and flip the on/off switches for the four
--   automatic follow-ups. One function hands back the current switch settings
--   for the business; the other sets a single switch on or off. Nothing about
--   the database's shape changes — only the insides of these two functions.
--
-- DEPENDS ON:
--   Tables:  automation_settings (Foundation-owned; one row per org), crm_orgs
--   Replaces: the frozen stubs from 20260702_crm_phaseF_rpc_stubs.sql
--
-- NOTES / GOTCHAS:
--   - FUNCTION-BODY-ONLY CREATE OR REPLACE (roadmap v3 wave rule): signatures
--     are IDENTICAL to Phase F's stubs —
--       get_automation_settings(p_org_id uuid DEFAULT NULL) → automation_settings
--       set_automation_setting(p_key text, p_value boolean, p_org_id uuid DEFAULT NULL) → automation_settings
--     No schema change. Both stay SECURITY DEFINER + GRANT EXECUTE to anon,
--     authenticated.
--   - Org resolution mirrors the existing CRM RPCs (crm_manual_lead.sql etc.):
--     COALESCE(p_org_id, first non-test org).
--   - set_automation_setting whitelists p_key against the 5 real boolean
--     columns BEFORE the dynamic UPDATE (format %I), so no arbitrary column can
--     be written; p_value/org are passed as bound params.
-- ════════════════════════════════════════════════

-- Read (and lazily create) the single per-org automation_settings row.
CREATE OR REPLACE FUNCTION get_automation_settings(p_org_id uuid DEFAULT NULL)
RETURNS automation_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_row automation_settings;
BEGIN
  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'get_automation_settings: no org resolved';
  END IF;

  SELECT * INTO v_row FROM automation_settings WHERE org_id = v_org;
  IF NOT FOUND THEN
    INSERT INTO automation_settings (org_id) VALUES (v_org)
    ON CONFLICT (org_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION get_automation_settings(uuid) TO anon, authenticated;

-- Flip one boolean toggle. p_key is whitelisted against the real boolean
-- columns before it ever reaches the dynamic UPDATE (format %I), so no
-- arbitrary column can be written. Returns the full updated row.
CREATE OR REPLACE FUNCTION set_automation_setting(p_key text, p_value boolean, p_org_id uuid DEFAULT NULL)
RETURNS automation_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION set_automation_setting(text, boolean, uuid) TO anon, authenticated;
