-- ─────────────────────────────────────────────────────────────────────────────
-- Google Calendar — switch to domain-wide delegation (org-wide, no per-user connect)
--
-- The worker now writes each appointment to every assigned employee's calendar
-- by impersonating them via a Workspace service account — so the old "is this
-- person connected?" gate no longer fits. Gate the triggers on a single config
-- flag instead, and report status org-wide.
--
-- APPLY THIS LAST, only after: (1) the delegation worker is live on main, and
-- (2) GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY are set in Cloudflare. Then
-- flip the flag on:  UPDATE integration_config SET value='true' WHERE key='gcal_sync_enabled';
-- (Shared Supabase → this affects dev AND prod at once.)
-- ─────────────────────────────────────────────────────────────────────────────

-- Inert until explicitly switched on.
INSERT INTO integration_config (key, value) VALUES ('gcal_sync_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Gate the trigger notifier on the flag (was: EXISTS a calendar-connected account).
CREATE OR REPLACE FUNCTION notify_google_calendar_sync(p_source_id UUID, p_op TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_url TEXT;
  v_secret     TEXT;
BEGIN
  IF p_source_id IS NULL THEN RETURN; END IF;

  -- INERT until calendar sync is switched on (after delegation is configured).
  IF COALESCE((SELECT value FROM integration_config WHERE key = 'gcal_sync_enabled'), 'false') <> 'true' THEN
    RETURN;
  END IF;

  SELECT value INTO v_worker_url FROM integration_config WHERE key = 'gcal_worker_url';
  SELECT value INTO v_secret     FROM integration_config WHERE key = 'gcal_webhook_secret';
  IF v_worker_url IS NULL OR btrim(v_worker_url) = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_worker_url,
    body    := jsonb_build_object('source_type', 'appointment', 'source_id', p_source_id, 'op', p_op),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', COALESCE(v_secret, ''))
  );
END;
$$;

-- Status RPC: "connected" now means org-wide sync is enabled; counts stay per-caller.
CREATE OR REPLACE FUNCTION get_google_calendar_status()
RETURNS TABLE (connected BOOLEAN, google_email TEXT, synced_count BIGINT, error_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT value FROM integration_config WHERE key = 'gcal_sync_enabled'), 'false') = 'true' AS connected,
    NULL::text AS google_email,
    (SELECT count(*) FROM google_calendar_links l JOIN employees e ON e.id = l.employee_id
       WHERE e.auth_user_id = auth.uid() AND l.status = 'synced'),
    (SELECT count(*) FROM google_calendar_links l JOIN employees e ON e.id = l.employee_id
       WHERE e.auth_user_id = auth.uid() AND l.status = 'error');
$$;

GRANT EXECUTE ON FUNCTION get_google_calendar_status() TO authenticated;

NOTIFY pgrst, 'reload schema';
