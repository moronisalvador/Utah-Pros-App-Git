-- ─────────────────────────────────────────────────────────────────────────────
-- QuickBooks Online — Customer Sync (Phase 1)
-- One-directional push: UPR paying-party contacts → QuickBooks Online Customers.
--
-- An AFTER INSERT trigger on `contacts` fires the `qbo-sync-customer` Cloudflare
-- worker via pg_net (async, non-blocking) whenever a homeowner / property_manager
-- / tenant contact with a real name is created — but only once QuickBooks has been
-- connected. The worker creates the customer in QuickBooks and writes the
-- resulting id back onto the contact row.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Sync-tracking columns on contacts ─────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS qbo_synced_at   TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS qbo_sync_error  TEXT;

-- Partial index to make the "pending sync" backfill query cheap.
CREATE INDEX IF NOT EXISTS idx_contacts_qbo_unsynced
  ON contacts(role)
  WHERE qbo_customer_id IS NULL;

-- 2. integration_credentials — one row per provider (OAuth tokens) ─────────────
-- RLS is enabled with NO anon/authenticated policies, so ONLY the service-role
-- key (Cloudflare workers) and SECURITY DEFINER functions can read/write tokens.
CREATE TABLE IF NOT EXISTS integration_credentials (
  provider         TEXT PRIMARY KEY,
  access_token     TEXT,
  refresh_token    TEXT,
  realm_id         TEXT,
  environment      TEXT DEFAULT 'production',   -- 'sandbox' | 'production'
  token_expires_at TIMESTAMPTZ,
  company_name     TEXT,
  connected_by     UUID REFERENCES employees(id) ON DELETE SET NULL,
  connected_at     TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;

-- 3. integration_config — key/value (worker URL, webhook secret, oauth state) ──
-- Same lock-down: service-role only. The trigger (SECURITY DEFINER) reads it.
CREATE TABLE IF NOT EXISTS integration_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE integration_config ENABLE ROW LEVEL SECURITY;

-- Seed worker URL + a generated webhook secret. After deploy, copy the secret
-- value into the Cloudflare env var QBO_WEBHOOK_SECRET so the worker trusts the
-- trigger's calls. Read it with:
--   SELECT value FROM integration_config WHERE key = 'qbo_webhook_secret';
INSERT INTO integration_config (key, value) VALUES
  ('qbo_worker_url',     'https://dev.utahpros.app/api/qbo-sync-customer'),
  ('qbo_webhook_secret', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- 4. Connection-status RPC — safe fields only, NEVER returns tokens ────────────
CREATE OR REPLACE FUNCTION get_integration_status(p_provider TEXT DEFAULT 'quickbooks')
RETURNS TABLE (
  provider         TEXT,
  connected        BOOLEAN,
  environment      TEXT,
  company_name     TEXT,
  realm_id         TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_provider,
    EXISTS (
      SELECT 1 FROM integration_credentials c
      WHERE c.provider = p_provider AND c.refresh_token IS NOT NULL
    ),
    c.environment, c.company_name, c.realm_id, c.token_expires_at, c.connected_at
  FROM (SELECT 1) one
  LEFT JOIN integration_credentials c ON c.provider = p_provider;
$$;

GRANT EXECUTE ON FUNCTION get_integration_status(TEXT) TO authenticated;

-- 5. Sync stats for the DevTools integrations panel ────────────────────────────
CREATE OR REPLACE FUNCTION get_qbo_sync_stats()
RETURNS TABLE (synced BIGINT, pending BIGINT, errored BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE qbo_customer_id IS NOT NULL),
    COUNT(*) FILTER (
      WHERE qbo_customer_id IS NULL
        AND role IN ('homeowner','property_manager','tenant')
        AND name IS NOT NULL AND btrim(name) <> ''
    ),
    COUNT(*) FILTER (WHERE qbo_sync_error IS NOT NULL AND qbo_customer_id IS NULL)
  FROM contacts;
$$;

GRANT EXECUTE ON FUNCTION get_qbo_sync_stats() TO authenticated;

-- 6. Trigger function — notify the worker on a new paying-party contact ────────
CREATE OR REPLACE FUNCTION notify_qbo_customer_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_url TEXT;
  v_secret     TEXT;
  v_connected  BOOLEAN;
BEGIN
  -- Only paying-party contacts with a real name, not already synced.
  IF NEW.role NOT IN ('homeowner','property_manager','tenant') THEN RETURN NEW; END IF;
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN RETURN NEW; END IF;
  IF NEW.qbo_customer_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Only if QuickBooks is actually connected (otherwise no-op).
  SELECT (refresh_token IS NOT NULL) INTO v_connected
  FROM integration_credentials WHERE provider = 'quickbooks';
  IF v_connected IS NOT TRUE THEN RETURN NEW; END IF;

  SELECT value INTO v_worker_url FROM integration_config WHERE key = 'qbo_worker_url';
  SELECT value INTO v_secret     FROM integration_config WHERE key = 'qbo_webhook_secret';
  IF v_worker_url IS NULL OR btrim(v_worker_url) = '' THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url     := v_worker_url,
    body    := jsonb_build_object('contact_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', COALESCE(v_secret, '')
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qbo_customer_sync ON contacts;
CREATE TRIGGER trg_qbo_customer_sync
  AFTER INSERT ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION notify_qbo_customer_sync();

-- 7. Bust PostgREST schema cache ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
