-- 20260622_upr_mcp_audit.sql
-- Audit log + kill switch for the UPR MCP server (the private remote MCP that can
-- read/write QuickBooks and the UPR database on behalf of the owner from chat).
-- The MCP worker writes here with the service-role key (bypasses RLS).

CREATE TABLE IF NOT EXISTS upr_mcp_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text,
  tool        text,
  arguments   jsonb,
  status      text,          -- 'ok' | 'preview' | 'error'
  result      text,
  error       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE upr_mcp_audit ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy: only the service role (the worker) writes/reads
-- directly. App-side viewing goes through the SECURITY DEFINER RPC below.

CREATE INDEX IF NOT EXISTS idx_upr_mcp_audit_created ON upr_mcp_audit (created_at DESC);

-- Viewer RPC (for an admin screen later). Returns recent audit rows.
CREATE OR REPLACE FUNCTION get_upr_mcp_audit(p_limit int DEFAULT 100)
RETURNS SETOF upr_mcp_audit
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT * FROM upr_mcp_audit ORDER BY created_at DESC LIMIT LEAST(COALESCE(p_limit, 100), 500); $$;

GRANT EXECUTE ON FUNCTION get_upr_mcp_audit(int) TO anon, authenticated;

-- Kill switch. Default ON. Set value = 'false' to disable the MCP instantly:
--   UPDATE integration_config SET value = 'false' WHERE key = 'upr_mcp_enabled';
INSERT INTO integration_config (key, value, updated_at)
VALUES ('upr_mcp_enabled', 'true', now())
ON CONFLICT (key) DO NOTHING;
