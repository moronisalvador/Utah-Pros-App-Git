-- ═════════════════════════════════════════════════════════════════════════════
-- 20260707_p9_credential_management.sql
-- Settings Overhaul · Phase P9 — Credential management (Session J, security-weighted)
--   docs/settings-overhaul-roadmap.md → "Wave 2 amendment" → P9 block.
--
-- WHAT THIS DOES (plain language):
--   Lets an admin paste the Stripe / Twilio / Resend keys into the app instead of
--   editing Cloudflare environment variables. The pasted secret is written into
--   the already-locked integration_credentials table (Stripe/Resend/Twilio auth
--   token) and the non-secret bits (Twilio account SID, messaging service SID,
--   phone number) into integration_config. Both tables are RLS-enabled with ZERO
--   policies — deny-all to anon/authenticated — so only the service-role worker
--   and the SECURITY DEFINER functions below can touch them. The secret is NEVER
--   returned to the browser: the status function returns booleans + public bits
--   only.
--
-- SECURITY POSTURE (P9's #1 acceptance criterion — PRESERVE, never regress):
--   integration_credentials + integration_config stay RLS-enabled with NO
--   anon/authenticated policies. This migration adds NO policy to either table.
--   Reads/writes of the secret happen ONLY through the SECURITY DEFINER RPCs
--   here, and every WRITE RPC re-checks the caller is an active admin employee
--   (auth.uid() → employees.role='admin') so a direct PostgREST call cannot
--   bypass the admin-only UI route (mirrors functions/api/github-connect.js).
--
-- One shared Supabase across dev + main — these objects go live in both the
-- moment this applies. Nothing consumes them until the P9 code deploys, and the
-- resolver keeps an env fallback, so applying first is safe.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. Provider rows (NO secrets committed) ─────────────────────────────────
-- Placeholder rows so the three providers are first-class in integration_credentials
-- exactly like GitHub/QuickBooks. access_token stays NULL (= not connected) until
-- an admin pastes a key via set_integration_secret(). NEVER put a real secret in a
-- migration.
INSERT INTO integration_credentials (provider, environment)
VALUES ('stripe', 'production'), ('twilio', 'production'), ('resend', 'production')
ON CONFLICT (provider) DO NOTHING;

-- Non-secret Twilio identifiers live in integration_config (also RLS-locked). Seed
-- empty keys so set_twilio_config()/get_managed_credentials_status() always have a
-- row to read.
INSERT INTO integration_config (key, value)
VALUES ('twilio_account_sid', NULL),
       ('twilio_messaging_service_sid', NULL),
       ('twilio_phone_number', NULL)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Admin guard (shared by the write RPCs) ───────────────────────────────
-- Raises unless the JWT's user maps to an ACTIVE admin employee. auth.uid() comes
-- from the verified Supabase session token, so a client cannot spoof it. This is
-- the server-side gate behind the admin-only /settings/integrations route.
CREATE OR REPLACE FUNCTION public.p9_assert_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
      AND is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.p9_assert_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p9_assert_admin() TO authenticated;

-- ─── 3. Connection status — booleans + public bits ONLY, NEVER the secret ────
-- One json row per managed provider. `connected` is derived from access_token
-- presence; the token itself is never selected. For Twilio the raw account/
-- messaging SIDs are NOT returned (only booleans) — the phone number is public
-- (customers text it) so it is safe to surface for the admin card.
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
  LEFT JOIN integration_credentials c ON c.provider = p.provider;
$$;
REVOKE ALL ON FUNCTION public.get_managed_credentials_status() FROM PUBLIC;
-- Non-secret status (booleans + public phone), but authenticated-ONLY: an
-- unauthenticated caller must not be able to enumerate which integrations are
-- connected. Mirrors get_integration_status's grant. The browser-as-anon is
-- therefore denied entirely (see the never-echo test), and the never-token
-- shape is guaranteed structurally (the SELECT list has no token) + verified live.
GRANT EXECUTE ON FUNCTION public.get_managed_credentials_status() TO authenticated;

-- ─── 4. Write the secret (Stripe/Resend key, or Twilio auth token) ───────────
CREATE OR REPLACE FUNCTION public.set_integration_secret(p_provider text, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.p9_assert_admin();

  IF p_provider NOT IN ('stripe', 'twilio', 'resend') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER: %', p_provider USING errcode = '22023';
  END IF;
  IF p_secret IS NULL OR btrim(p_secret) = '' THEN
    RAISE EXCEPTION 'EMPTY_SECRET' USING errcode = '22023';
  END IF;

  INSERT INTO integration_credentials (provider, access_token, environment,
                                       connected_by, connected_at, updated_at)
  VALUES (p_provider, p_secret, 'production',
          (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1),
          now(), now())
  ON CONFLICT (provider) DO UPDATE
    SET access_token = EXCLUDED.access_token,
        connected_by = EXCLUDED.connected_by,
        -- preserve the original connect date when replacing a key
        connected_at = COALESCE(integration_credentials.connected_at, EXCLUDED.connected_at),
        updated_at   = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_integration_secret(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_integration_secret(text, text) TO authenticated;

-- ─── 5. Write Twilio's non-secret identifiers (config) ───────────────────────
-- Whitelisted keys only — this RPC can NEVER be used to overwrite an unrelated
-- config secret (e.g. qbo_webhook_secret). Semantics: a NULL arg leaves that key
-- UNCHANGED (the caller doesn't have the raw SID to re-send — status is booleans);
-- an empty string '' CLEARS it. To wipe everything at once use disconnect_integration.
CREATE OR REPLACE FUNCTION public.set_twilio_config(
  p_account_sid text DEFAULT NULL,
  p_messaging_service_sid text DEFAULT NULL,
  p_phone_number text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.p9_assert_admin();

  IF p_account_sid IS NOT NULL THEN
    INSERT INTO integration_config (key, value) VALUES ('twilio_account_sid', NULLIF(btrim(p_account_sid), ''))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;
  IF p_messaging_service_sid IS NOT NULL THEN
    INSERT INTO integration_config (key, value) VALUES ('twilio_messaging_service_sid', NULLIF(btrim(p_messaging_service_sid), ''))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;
  IF p_phone_number IS NOT NULL THEN
    INSERT INTO integration_config (key, value) VALUES ('twilio_phone_number', NULLIF(btrim(p_phone_number), ''))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_twilio_config(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_twilio_config(text, text, text) TO authenticated;

-- ─── 6. Disconnect (clear the secret; Twilio also clears its config) ─────────
CREATE OR REPLACE FUNCTION public.disconnect_integration(p_provider text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.p9_assert_admin();

  IF p_provider NOT IN ('stripe', 'twilio', 'resend') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER: %', p_provider USING errcode = '22023';
  END IF;

  UPDATE integration_credentials
     SET access_token = NULL, connected_by = NULL, updated_at = now()
   WHERE provider = p_provider;

  IF p_provider = 'twilio' THEN
    UPDATE integration_config SET value = NULL, updated_at = now()
     WHERE key IN ('twilio_account_sid', 'twilio_messaging_service_sid', 'twilio_phone_number');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.disconnect_integration(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disconnect_integration(text) TO authenticated;
