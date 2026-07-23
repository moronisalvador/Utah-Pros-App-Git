-- ════════════════════════════════════════════════
-- MIGRATION: 20260723_encircle_managed_credentials
-- Phase: Encircle Managed Integration - Foundation
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds Encircle to the existing locked credential store and records whether
--   its key is using the legacy fallback, active, or explicitly disabled. It
--   also records the latest safe verification result and seeds a default-off
--   rollout switch; no real key is included.
--
-- ADDITIVE-ONLY / attribute-only:
--   Adds nullable columns, one placeholder row, one default-off flag, narrows
--   table grants, and replaces the existing status function without changing
--   its signature. No live table/column is dropped or renamed and no secret is
--   changed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run the complete guarded script at:
--   supabase/rollbacks/20260723_encircle_managed_credentials.rollback.sql
--   It restores the prior response shape while retaining the admin assertion
--   and least-privilege table ACL, removes the inert seeds, and drops the
--   additive constraints/columns. It refuses to run if a managed Encircle token
--   or another provider's lifecycle metadata would be lost.
-- ════════════════════════════════════════════════

ALTER TABLE public.integration_credentials
  ADD COLUMN IF NOT EXISTS managed_status text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verification_status text;

ALTER TABLE public.integration_credentials
  ADD CONSTRAINT integration_credentials_managed_status_check
  CHECK (managed_status IS NULL OR managed_status IN ('fallback', 'active', 'disabled'))
  NOT VALID;

ALTER TABLE public.integration_credentials
  ADD CONSTRAINT integration_credentials_verification_status_check
  CHECK (
    last_verification_status IS NULL
    OR last_verification_status IN ('verified', 'failed', 'disabled')
  )
  NOT VALID;

ALTER TABLE public.integration_credentials
  VALIDATE CONSTRAINT integration_credentials_managed_status_check;

ALTER TABLE public.integration_credentials
  VALIDATE CONSTRAINT integration_credentials_verification_status_check;

INSERT INTO public.integration_credentials (provider, environment, managed_status)
VALUES ('encircle', 'production', 'fallback')
ON CONFLICT (provider) DO NOTHING;

INSERT INTO public.feature_flags (
  key, enabled, dev_only_user_id, category, label, description, updated_at
)
VALUES (
  'feature:encircle_managed_credentials',
  false,
  NULL,
  'integrations',
  'Encircle managed credentials',
  'Owner/admin-only validation and rotation UI. Keep off until Pages and upr-mcp resolver code is deployed.',
  now()
)
ON CONFLICT (key) DO NOTHING;

-- RLS already denies all rows, but direct table privileges are unnecessary for
-- browser roles and are removed as defense in depth. SECURITY DEFINER status
-- functions and service-role Workers retain their intended access.
REVOKE ALL ON TABLE public.integration_credentials FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_managed_credentials_status()
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.p9_assert_admin();

  RETURN QUERY
  SELECT json_build_object(
           'provider', p.provider,
           'connected', (c.access_token IS NOT NULL AND (
             p.provider <> 'encircle' OR c.managed_status = 'active'
           )),
           'connected_at', CASE WHEN c.access_token IS NOT NULL THEN c.connected_at END,
           'updated_at', c.updated_at,
           'managed_status', CASE WHEN p.provider = 'encircle' THEN c.managed_status END,
           'last_verified_at', CASE WHEN p.provider = 'encircle' THEN c.last_verified_at END,
           'last_verification_status',
             CASE WHEN p.provider = 'encircle' THEN c.last_verification_status END,
           'organization_name', CASE WHEN p.provider = 'encircle' THEN c.company_name END,
           'phone_number', CASE WHEN p.provider = 'twilio'
                                THEN (SELECT value FROM integration_config WHERE key = 'twilio_phone_number')
                           END,
           'has_account_sid', CASE WHEN p.provider = 'twilio'
                                   THEN (SELECT value IS NOT NULL AND btrim(value) <> ''
                                         FROM integration_config WHERE key = 'twilio_account_sid')
                              END,
           'has_messaging_service', CASE WHEN p.provider = 'twilio'
                                         THEN (SELECT value IS NOT NULL AND btrim(value) <> ''
                                               FROM integration_config WHERE key = 'twilio_messaging_service_sid')
                                    END
         )
  FROM (VALUES ('stripe'), ('twilio'), ('resend'), ('encircle')) AS p(provider)
  LEFT JOIN public.integration_credentials c ON c.provider = p.provider;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_managed_credentials_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_managed_credentials_status()
  TO authenticated, service_role;

COMMENT ON COLUMN public.integration_credentials.managed_status IS
  'Managed cutover state. Encircle fallback uses the legacy env key; disabled suppresses it.';
COMMENT ON COLUMN public.integration_credentials.last_verified_at IS
  'Last time the active managed credential was checked against its provider.';
COMMENT ON COLUMN public.integration_credentials.last_verification_status IS
  'Safe verification outcome only; provider response bodies and secrets are never stored.';
