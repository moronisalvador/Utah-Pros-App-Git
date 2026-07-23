-- ════════════════════════════════════════════════
-- ROLLBACK: 20260723_encircle_managed_credentials
-- ════════════════════════════════════════════════
--
-- Run only after resolver code has returned to environment-only behavior.
-- Refuses to continue if a managed Encircle token or another provider's new
-- lifecycle metadata would be destroyed.

BEGIN;

-- The rollback is a rare, owner-approved maintenance action. Lock before the
-- guard so no credential writer can activate Encircle between check and undo.
LOCK TABLE public.integration_credentials IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.feature_flags IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.integration_credentials
    WHERE provider = 'encircle'
      AND access_token IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Refusing rollback: Encircle still has a managed token';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.integration_credentials
    WHERE provider <> 'encircle'
      AND (
        managed_status IS NOT NULL
        OR last_verified_at IS NOT NULL
        OR last_verification_status IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Refusing rollback: another provider uses Encircle lifecycle columns';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_managed_credentials_status()
RETURNS SETOF json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
           'provider', p.provider,
           'connected', (c.access_token IS NOT NULL),
           'connected_at', CASE WHEN c.access_token IS NOT NULL THEN c.connected_at END,
           'updated_at', c.updated_at,
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
  FROM (VALUES ('stripe'), ('twilio'), ('resend')) AS p(provider)
  LEFT JOIN public.integration_credentials c ON c.provider = p.provider;
$$;

REVOKE EXECUTE ON FUNCTION public.get_managed_credentials_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_managed_credentials_status()
  TO authenticated, service_role;

DELETE FROM public.feature_flags
WHERE key = 'feature:encircle_managed_credentials';

DELETE FROM public.integration_credentials
WHERE provider = 'encircle'
  AND access_token IS NULL;

ALTER TABLE public.integration_credentials
  DROP CONSTRAINT IF EXISTS integration_credentials_managed_status_check,
  DROP CONSTRAINT IF EXISTS integration_credentials_verification_status_check;

ALTER TABLE public.integration_credentials
  DROP COLUMN IF EXISTS managed_status,
  DROP COLUMN IF EXISTS last_verified_at,
  DROP COLUMN IF EXISTS last_verification_status;

-- Restores the live ACL captured before the forward migration. This is an
-- intentional rollback of the defense-in-depth revoke, not a recommended
-- steady-state permission model.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.integration_credentials TO anon, authenticated;

COMMIT;
