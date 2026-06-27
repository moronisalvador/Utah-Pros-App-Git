-- ─────────────────────────────────────────────────────────────────────────────
-- Google Calendar Sync — push UPR appointments → each assigned crew member's
-- personal Google Calendar (create / update / delete).
--
-- DESIGN GOAL (important): this must SURVIVE the planned "appointments → scheduled
-- jobs" refactor. So the sync is NOT hard-wired to the appointments table. The
-- durable record is `google_calendar_links`, keyed by a generic (source_type,
-- source_id, employee_id). Today source_type='appointment'; when scheduling moves
-- onto job_schedules (the table + appointments.job_schedule_id already exist), the
-- same links table + worker keep working — only the feeding trigger changes to
-- source_type='job_schedule'. The mapping (what UPR row → which Google event in
-- whose calendar) is preserved across the refactor; nothing has to be rebuilt.
--
-- Reuses the per-employee Google connection (user_google_accounts + token refresh
-- in functions/lib/google-drive.js) and the integration_config key/value store
-- (worker URL + webhook secret), exactly like the QuickBooks customer-sync trigger.
--
-- INERT UNTIL CONNECTED: the triggers no-op unless at least one employee has
-- granted the calendar.events scope, so applying this to the shared prod DB
-- changes nothing until someone actually connects Google Calendar.
--
-- Additive only: new table + status RPC + config seeds + triggers.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Source-agnostic event mapping ─────────────────────────────────────────────
-- One row per (synced UPR occurrence × crew member). Holds the Google event id so
-- updates/deletes work even after the source row is gone. RLS on, service-role
-- only (workers); a SECURITY DEFINER status RPC exposes safe per-user counts.
CREATE TABLE IF NOT EXISTS google_calendar_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     TEXT NOT NULL DEFAULT 'appointment',   -- 'appointment' | 'job_schedule' (future)
  source_id       UUID NOT NULL,                          -- appointments.id today
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  google_event_id TEXT,                                   -- event id in that employee's calendar
  calendar_id     TEXT NOT NULL DEFAULT 'primary',
  sync_hash       TEXT,                                   -- detects no-op updates
  status          TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'synced' | 'deleted' | 'error'
  last_error      TEXT,
  synced_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_gcal_links_source   ON google_calendar_links (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_gcal_links_employee ON google_calendar_links (employee_id);

ALTER TABLE google_calendar_links ENABLE ROW LEVEL SECURITY;

-- 2. Worker URL + webhook secret (service-role only, via integration_config) ────
-- NOTE: dev URL for staging verification. On production release, flip to
--   UPDATE integration_config SET value='https://utahpros.app/api/google-calendar-sync'
--     WHERE key='gcal_worker_url';
-- (One Supabase serves both envs, so the trigger can only call one host. Server-
-- to-server — no OAuth redirect — so either host syncs correctly against Google.)
INSERT INTO integration_config (key, value) VALUES
  ('gcal_worker_url',     'https://dev.utahpros.app/api/google-calendar-sync'),
  ('gcal_webhook_secret', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- 3. Per-user status RPC — safe fields only, NEVER returns tokens ───────────────
-- connected = caller has granted the calendar.events scope. Also returns how many
-- of their appointments are currently mirrored to Google.
CREATE OR REPLACE FUNCTION get_google_calendar_status()
RETURNS TABLE (connected BOOLEAN, google_email TEXT, synced_count BIGINT, error_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (g.refresh_token IS NOT NULL AND g.scopes ILIKE '%calendar%') AS connected,
    g.google_email,
    (SELECT count(*) FROM google_calendar_links l
       WHERE l.employee_id = e.id AND l.status = 'synced'),
    (SELECT count(*) FROM google_calendar_links l
       WHERE l.employee_id = e.id AND l.status = 'error')
  FROM employees e
  LEFT JOIN user_google_accounts g ON g.employee_id = e.id
  WHERE e.auth_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_google_calendar_status() TO authenticated;

-- 4. Trigger plumbing — notify the worker on appointment / crew changes ─────────
-- SECURITY DEFINER so it can read the locked-down integration_config + credentials.
-- Fires net.http_post (async, non-blocking); the worker does the real work and is
-- idempotent (skips Google calls when nothing in the synced fields changed).
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

  -- INERT until at least one employee has connected Google Calendar.
  IF NOT EXISTS (
    SELECT 1 FROM user_google_accounts
    WHERE refresh_token IS NOT NULL AND scopes ILIKE '%calendar%'
  ) THEN RETURN; END IF;

  SELECT value INTO v_worker_url FROM integration_config WHERE key = 'gcal_worker_url';
  SELECT value INTO v_secret     FROM integration_config WHERE key = 'gcal_webhook_secret';
  IF v_worker_url IS NULL OR btrim(v_worker_url) = '' THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_worker_url,
    body    := jsonb_build_object('source_type', 'appointment', 'source_id', p_source_id, 'op', p_op),
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', COALESCE(v_secret, '')
    )
  );
END;
$$;

-- 4a. appointments: insert / update / delete ──────────────────────────────────
CREATE OR REPLACE FUNCTION trg_appt_calendar_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM notify_google_calendar_sync(OLD.id, 'delete');
    RETURN OLD;
  END IF;
  -- 'event' kind (PTO/meetings) still syncs to the assigned crew's calendars.
  PERFORM notify_google_calendar_sync(NEW.id, 'upsert');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_calendar_sync ON appointments;
CREATE TRIGGER trg_appointments_calendar_sync
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION trg_appt_calendar_sync();

-- 4b. appointment_crew: insert / delete (crew added or removed) ────────────────
CREATE OR REPLACE FUNCTION trg_appt_crew_calendar_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM notify_google_calendar_sync(OLD.appointment_id, 'upsert');
    RETURN OLD;
  END IF;
  PERFORM notify_google_calendar_sync(NEW.appointment_id, 'upsert');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointment_crew_calendar_sync ON appointment_crew;
CREATE TRIGGER trg_appointment_crew_calendar_sync
  AFTER INSERT OR DELETE ON appointment_crew
  FOR EACH ROW EXECUTE FUNCTION trg_appt_crew_calendar_sync();

-- 5. Bust PostgREST schema cache ───────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
