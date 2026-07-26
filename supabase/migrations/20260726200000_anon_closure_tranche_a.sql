-- ════════════════════════════════════════════════
-- MIGRATION: 20260726200000_anon_closure_tranche_a
-- Phase: Anon closure, tranche (a) — highest-consequence tables first
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops anyone on the internet from changing two settings tables they should
--   never have been able to touch.
--
--   The key that the website uses to talk to the database is public by design —
--   it ships inside the browser bundle. Today that key can switch customer
--   texting on or off, and can delete the list of people who asked us to stop
--   emailing them. Nobody has to log in to do either. This closes both.
--
--   It also makes the customer-texting switch admin-only. Closing the table
--   alone was not enough: the switch can also be flipped through a helper
--   function that ANY logged-in employee could call, including a field
--   technician.
--
--   Nothing a person actually uses changes. The two screens that read these
--   settings go through helper functions that keep working exactly as before.
--
-- ADDITIVE-ONLY:
--   No — this is a deliberate REVOKE (RED tier), which is the point. It drops
--   two always-true policies and revokes table privileges from the browser
--   roles, plus one function-body-only CREATE OR REPLACE. It creates and drops
--   no table, column, or index, and changes no row of business data.
--
-- EVIDENCE (live catalog, 2026-07-26):
--   - automation_settings: policy `automation_settings_all` = ALL / {anon,
--     authenticated} / USING true / WITH CHECK true. anon holds all 7 table
--     privileges. Same shape on email_suppressions.
--   - Caller inventory: NO src/ code touches either table directly.
--     automation_settings is reached only via get_automation_settings /
--     set_automation_setting (both SECURITY DEFINER, search_path pinned, so
--     they bypass RLS and are unaffected by this revoke). email_suppressions
--     has zero browser references; every writer is a service-role Worker
--     (resend-webhook, email-unsubscribe, conversation-email, email-consent).
--   - Precedent for RLS-on-with-no-policy + explicit revoke:
--     20260724180000_crm_lead_notes.sql:83-89.
--
-- NOT IN SCOPE (deliberately):
--   The database-standard.md §2 public allowlist — login/session bootstrap,
--   /status, public e-sign retrieval, public job-file read — is untouched here.
--   Those are the paths whose breakage would stop logins or customer signing,
--   and they get their own tranche with their own proof.
--
-- COORDINATION:
--   automation_settings sits in db-foundation-wave-ownership.md §8's
--   deferred-hardening bucket keyed to CRM 4b. CRM 4b is unbuilt and blocked on
--   A2P carrier approval, so there is no in-flight caller to regress. Disclosed
--   rather than assumed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726200000_anon_closure_tranche_a.rollback.sql
--   (recreates both always-true policies verbatim, re-grants the browser roles,
--    and restores the previous set_automation_setting body without the gate).
-- ════════════════════════════════════════════════

-- ─── 1. automation_settings — RPC-only ───

DROP POLICY IF EXISTS automation_settings_all ON public.automation_settings;

ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.automation_settings FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.automation_settings IS
  'RPC-only. Read via get_automation_settings, written via set_automation_setting '
  '(both SECURITY DEFINER). Browser roles hold no table privilege: the anon key is '
  'public, and this table carries the customer-SMS kill switch.';

-- ─── 2. email_suppressions — service-role only ───

DROP POLICY IF EXISTS email_suppressions_all ON public.email_suppressions;

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_suppressions FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.email_suppressions IS
  'Service-role only. Every writer is a Worker (resend-webhook, email-unsubscribe, '
  'conversation-email, email-consent). This is the opt-out list: anonymous DELETE '
  'was a CAN-SPAM exposure.';

-- ─── 3. set_automation_setting — gate the kill switch ───
-- Function-body-only CREATE OR REPLACE. Signature, return type, language,
-- volatility and search_path are byte-identical to the live definition
-- (crm-wave-ownership.md §3 freezes the Phase 4d signature). The ONLY change is
-- the authorization block at the top.
--
-- Two tiers, because the keys are not equally dangerous:
--   * sms_sending_enabled is the TCPA kill switch — admin only.
--   * the four feature toggles — admin or office.
-- Both exclude is_external: an external account must not be able to arm
-- customer texting. NOTE: the shipped p9_assert_admin() helper does NOT check
-- is_external; that gap is recorded for the 3.2 shared-assert pass rather than
-- silently diverging here.

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

  -- Authorization: validated INSIDE the definer, per database-standard.md §1.
  IF p_key = 'sms_sending_enabled' THEN
    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
        AND role = 'admin'
        AND is_active
        AND NOT is_external
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: sms_sending_enabled is admin only'
        USING errcode = '42501';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'office')
        AND is_active
        AND NOT is_external
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: admin or office only'
        USING errcode = '42501';
    END IF;
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

-- Managed-Supabase trap (database-standard.md §1): this project re-applies
-- EXECUTE TO PUBLIC to every new/replaced function at ddl_command_end, so the
-- revoke must be explicit and must precede the grant.
REVOKE EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) TO authenticated, service_role;
