-- ════════════════════════════════════════════════
-- FILE: 20260704_notify_clock_abandoned_scan.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Watches for a field tech who left the clock running long past when they
--   should have clocked out (a forgotten/abandoned open clock) and alerts admins
--   once. Unlike the other notification events there is no single triggering
--   action, so this is a periodic SCAN run by pg_cron every 30 minutes.
--
-- DEFINITION OF "abandoned":
--   An OPEN live entry — clock_out IS NULL AND travel_start IS NOT NULL (the
--   repo-wide open-clock predicate) — whose travel_start is ≥ 10 hours ago.
--   The 10h threshold matches the app's existing "forgot to clock out" line
--   (FORGOT_CLOCKOUT_MIN = 600 in src/components/overview/hooks/useEmployeeStatus.js).
--
-- DEDUP (fire once per entry, ever):
--   Before emitting, the scan checks system_events for a prior clock.abandoned
--   row for that entry, and writes the marker BEFORE emitting. So even across
--   many scan runs (and even if the emit's http_post is lost) a tech is alerted
--   at most once per open entry. This does NOT close the entry (a soft warning);
--   the separate midnight-split job owns the hard auto-close path.
--
-- DEPENDS ON:
--   Functions: notify_emit(text, jsonb) (dispatcher gate)
--   Extension: pg_cron (cron.schedule)
--   Data:      reads  → job_time_entries, employees, system_events (dedup)
--              writes → system_events (the once-per-entry marker)
--
-- NOTES / GOTCHAS:
--   - Additive only: new function + a named pg_cron schedule (idempotent by name).
--   - notify_emit is inert until 'clock.abandoned' is enabled and is fire-and-
--     forget. The scan function is internal (cron-only) — REVOKEd from PUBLIC
--     (Postgres grants EXECUTE to PUBLIC at creation; revoking only anon/auth
--     would leave it callable via PostgREST — see the REVOKE below).
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.scan_abandoned_clocks(
  p_now timestamptz DEFAULT now(),
  p_threshold_minutes int DEFAULT 600
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_count int := 0; v_emp text; v_mins int;
BEGIN
  FOR r IN
    SELECT e.id, e.employee_id, e.job_id, e.travel_start
    FROM job_time_entries e
    WHERE e.clock_out IS NULL
      AND e.travel_start IS NOT NULL
      AND e.travel_start <= p_now - make_interval(mins => p_threshold_minutes)
      AND NOT EXISTS (
        SELECT 1 FROM system_events se
        WHERE se.event_type = 'clock.abandoned'
          AND se.entity_type = 'job_time_entry'
          AND se.entity_id = e.id
      )
  LOOP
    SELECT full_name INTO v_emp FROM employees WHERE id = r.employee_id;
    v_mins := floor(extract(epoch FROM (p_now - r.travel_start)) / 60);
    -- marker first → idempotent even if the emit below is lost
    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, job_id, payload)
    VALUES ('clock.abandoned', 'job_time_entry', r.id, NULL, r.job_id,
            jsonb_build_object('employee_id', r.employee_id, 'minutes', v_mins));
    PERFORM notify_emit('clock.abandoned', jsonb_build_object(
      'title', coalesce(v_emp, 'A tech') || ' may have forgotten to clock out',
      'body', 'On the clock for ' || round(v_mins / 60.0, 1) || 'h with no clock-out.',
      'link', '/time-tracking',
      'entity_type', 'job_time_entry',
      'entity_id', r.id,
      'job_id', r.job_id,
      'payload', jsonb_build_object('employee_id', r.employee_id, 'minutes', v_mins)
    ));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $function$;

-- Internal (cron-only) — never exposed through PostgREST. FROM PUBLIC is the
-- load-bearing revoke: anon/authenticated inherit the default PUBLIC EXECUTE
-- grant, so naming them alone would not close /rpc/ access (precedent:
-- 20260627_exec_read_sql.sql).
REVOKE ALL ON FUNCTION public.scan_abandoned_clocks(timestamptz, int) FROM PUBLIC, anon, authenticated;

-- Run every 30 minutes. cron.schedule is upsert-by-name (idempotent).
SELECT cron.schedule('upr_scan_abandoned_clocks', '*/30 * * * *',
  $$SELECT public.scan_abandoned_clocks();$$);
