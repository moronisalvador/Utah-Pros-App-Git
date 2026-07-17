-- Seed the shared secret the Webflow form_submission webhook uses to
-- authenticate itself (see functions/api/webflow-form-webhook.js). Only a
-- migration (or the real service-role key) can write here — integration_config
-- is RLS-enabled with zero policies for any role, same as every other
-- webhook secret in this table (see 20260628_google_calendar_sync.sql).
INSERT INTO integration_config (key, value) VALUES
  ('webflow_webhook_secret', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;
