-- ─────────────────────────────────────────────────────────────────────────────
-- Per-User Google Account Integration (Drive today; Calendar planned)
-- Each employee connects their OWN Google account once (Settings → Integrations).
-- Tokens are stored server-side, keyed per employee, and auto-refreshed by the
-- Cloudflare workers (functions/lib/google-drive.js). Mirrors the QuickBooks
-- integration_credentials pattern, but per-user instead of one row per provider.
--
-- The table is intentionally provider-generic (user_google_accounts) so a future
-- Google Calendar feature can share the same per-employee connection + token
-- refresh, adding its scope via incremental auth rather than a second table.
--
-- Additive only: new table + status RPC. No change to existing rows/behavior.
-- Reuses the existing `integration_config` table for the transient OAuth `state`
-- (+ connecting employee id), under keys gdrive_oauth_state / gdrive_oauth_user.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Per-employee Google account credentials ──────────────────────────────────
-- RLS enabled with NO anon/authenticated policies, so ONLY the service-role key
-- (Cloudflare workers) and SECURITY DEFINER functions can read/write tokens. The
-- refresh token never leaves the server; the frontend only ever sees a short-lived
-- access token minted on demand for the Google Picker. `scopes` records what the
-- employee has granted (e.g. drive.file today, calendar.events later).
CREATE TABLE IF NOT EXISTS user_google_accounts (
  employee_id      UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  google_email     TEXT,
  scopes           TEXT,
  connected_at     TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_google_accounts ENABLE ROW LEVEL SECURITY;

-- 2. Connection-status RPC — safe fields only, NEVER returns tokens ────────────
-- Resolves the caller via auth.uid() → employees row; SECURITY DEFINER bypasses
-- the table RLS so the authenticated user can read just their own connection flag.
CREATE OR REPLACE FUNCTION get_google_drive_status()
RETURNS TABLE (connected BOOLEAN, google_email TEXT, connected_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (g.refresh_token IS NOT NULL) AS connected,
    g.google_email,
    g.connected_at
  FROM employees e
  LEFT JOIN user_google_accounts g ON g.employee_id = e.id
  WHERE e.auth_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_google_drive_status() TO authenticated;

-- 3. Bust PostgREST schema cache so the new table + RPC are visible ────────────
NOTIFY pgrst, 'reload schema';
