-- ─────────────────────────────────────────────────────────────────────────────
-- Client-facing appointment emails — confirmation / reschedule / cancellation,
-- gated by a per-appointment opt-out (the "Email client a confirmation" checkbox).
--
-- The worker sends to jobs.client_email for job appointments that opted in,
-- deduped via atomic compare-and-set on the appointment row. Cancellation rides
-- the client details along in the DELETE trigger payload (the row is gone by then).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notify_client      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_notified_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_time_sig    TEXT;

-- Drop the old 2-arg notifier so the new 3-arg (with default) is unambiguous for
-- 2-arg callers (the crew trigger). Keeping both makes 2-arg calls ambiguous → 42725.
DROP FUNCTION IF EXISTS notify_google_calendar_sync(uuid, text);

CREATE OR REPLACE FUNCTION notify_google_calendar_sync(p_source_id UUID, p_op TEXT, p_cancel JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_url TEXT;
  v_secret     TEXT;
  v_body       JSONB;
BEGIN
  IF p_source_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_google_accounts
    WHERE refresh_token IS NOT NULL AND scopes ILIKE '%calendar%'
  ) THEN RETURN; END IF;

  SELECT value INTO v_worker_url FROM integration_config WHERE key = 'gcal_worker_url';
  SELECT value INTO v_secret     FROM integration_config WHERE key = 'gcal_webhook_secret';
  IF v_worker_url IS NULL OR btrim(v_worker_url) = '' THEN RETURN; END IF;

  v_body := jsonb_build_object('source_type', 'appointment', 'source_id', p_source_id, 'op', p_op);
  IF p_cancel IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('cancel_client', p_cancel);
  END IF;

  PERFORM net.http_post(
    url     := v_worker_url,
    body    := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', COALESCE(v_secret, ''))
  );
END;
$$;

CREATE OR REPLACE FUNCTION trg_appt_calendar_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT;
  v_name   TEXT;
  v_cancel JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind = 'job' AND OLD.notify_client AND OLD.client_notified_at IS NOT NULL AND OLD.job_id IS NOT NULL THEN
      SELECT j.client_email, j.insured_name INTO v_email, v_name FROM jobs j WHERE j.id = OLD.job_id;
      IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
        v_cancel := jsonb_build_object('email', v_email, 'name', v_name,
          'date', OLD.date, 'time_start', OLD.time_start, 'time_end', OLD.time_end);
      END IF;
    END IF;
    PERFORM notify_google_calendar_sync(OLD.id, 'delete', v_cancel);
    RETURN OLD;
  END IF;

  -- Skip when nothing sync-relevant changed (e.g. the worker only stamped the
  -- client_* bookkeeping columns, or notify_client was toggled) — prevents a loop.
  IF TG_OP = 'UPDATE' AND
     (NEW.title, NEW.date, NEW.time_start, NEW.time_end, NEW.notes, NEW.status, NEW.job_id, NEW.duration_days, NEW.is_private)
     IS NOT DISTINCT FROM
     (OLD.title, OLD.date, OLD.time_start, OLD.time_end, OLD.notes, OLD.status, OLD.job_id, OLD.duration_days, OLD.is_private)
  THEN
    RETURN NEW;
  END IF;

  PERFORM notify_google_calendar_sync(NEW.id, 'upsert', NULL);
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
