-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_clock_omw_hardblock
-- PR-2 (Time-Tracking build plan) — optional enforce-explicit-clockout hard-block.
--
-- WHAT THIS DOES (plain language):
--   Adds one guard to the On-My-Way path: if the office has turned ON the
--   "Enforce explicit clock-out" flag AND the tech is still clocked in on a
--   different appointment, the action is refused (raising OPEN_ENTRY_EXISTS) so the
--   app can tell the tech to clock out of the prior job first. When the flag is OFF
--   (default), behavior is unchanged from PR-1 (the prior clock auto-closes).
--
-- NOTES / GOTCHAS:
--   - SAME 6-arg signature as PR-1 (CREATE OR REPLACE, no drop) → fully
--     backward-compatible; the currently-deployed client keeps working because the
--     flag defaults OFF.
--   - Only the small hard-block check at the top of the `omw` branch is new; the
--     close loop and start/pause/resume/finish branches are byte-for-byte PR-1.
-- ════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.clock_appointment_action(p_appointment_id uuid, p_employee_id uuid, p_action text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_accuracy numeric DEFAULT NULL::numeric)
 RETURNS SETOF job_time_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_entry        job_time_entries%ROWTYPE;
  v_now          TIMESTAMPTZ := NOW();
  v_job_id       UUID;
  v_paused_min   NUMERIC;
  v_total_ms     NUMERIC;
  v_hours        NUMERIC;
  v_stale        RECORD;
  v_stale_hours  NUMERIC;
BEGIN
  SELECT job_id INTO v_job_id
  FROM appointments WHERE id = p_appointment_id;

  -- Find the latest non-completed entry first, fall back to latest completed
  SELECT * INTO v_entry
  FROM job_time_entries
  WHERE appointment_id = p_appointment_id
    AND employee_id = p_employee_id
  ORDER BY (clock_out IS NULL) DESC, created_at DESC
  LIMIT 1;

  IF p_action = 'omw' THEN
    -- PR-2 hard-block: when the enforce flag is ON and the tech still has an open
    -- live entry on a DIFFERENT appointment, refuse so the client routes them to a
    -- manual clock-out. Flag OFF (default) → fall through to PR-1 auto-close.
    IF EXISTS (
      SELECT 1 FROM feature_flags
      WHERE key = 'clock_enforce_explicit_clockout' AND enabled = true
    ) AND EXISTS (
      SELECT 1 FROM job_time_entries
      WHERE employee_id = p_employee_id
        AND clock_out IS NULL
        AND travel_start IS NOT NULL
        AND appointment_id IS DISTINCT FROM p_appointment_id
    ) THEN
      RAISE EXCEPTION 'OPEN_ENTRY_EXISTS' USING ERRCODE = 'P0001';
    END IF;

    -- Close ALL open LIVE entries for this employee (clock_out null + travel_start set),
    -- not just arrived ones. travel_start IS NOT NULL excludes manual desk-entered rows.
    FOR v_stale IN
      SELECT id, job_id, clock_in, travel_start, total_paused_minutes, appointment_id
      FROM job_time_entries
      WHERE employee_id = p_employee_id
        AND clock_out IS NULL
        AND travel_start IS NOT NULL
        AND id != COALESCE(v_entry.id, '00000000-0000-0000-0000-000000000000')
    LOOP
      IF v_stale.clock_in IS NOT NULL THEN
        -- Arrived but never finished: on-site hours from clock_in (unchanged behavior).
        v_stale_hours := EXTRACT(EPOCH FROM (v_now - v_stale.clock_in)) / 3600
                         - COALESCE(v_stale.total_paused_minutes, 0) / 60;

        UPDATE job_time_entries
        SET clock_out = v_now,
            on_site_end = COALESCE(on_site_end, v_now),
            hours = LEAST(24, GREATEST(0, v_stale_hours))
        WHERE id = v_stale.id;
      ELSE
        -- En-route only (never arrived) — the orphan case: no on-site time;
        -- capture the drive so far as travel_minutes.
        v_stale_hours := 0;

        UPDATE job_time_entries
        SET clock_out = v_now,
            hours = 0,
            travel_minutes = COALESCE(travel_minutes,
              LEAST(1440, GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_now - v_stale.travel_start)) / 60.0, 1))))
        WHERE id = v_stale.id;
      END IF;

      IF v_stale_hours > 24 THEN
        INSERT INTO system_events (
          event_type, entity_type, entity_id, actor_id, job_id, payload
        ) VALUES (
          'time_entry.auto_closed_stale',
          'job_time_entry',
          v_stale.id,
          p_employee_id,
          v_stale.job_id,
          jsonb_build_object(
            'previous_appointment_id', v_stale.appointment_id,
            'new_appointment_id', p_appointment_id,
            'clock_in', v_stale.clock_in,
            'auto_closed_at', v_now,
            'raw_hours', ROUND(v_stale_hours::numeric, 2),
            'capped_hours', 24,
            'reason', 'Tech tapped On My Way on a new appointment >24h after previous clock-in without hitting Finish'
          )
        );
      END IF;
    END LOOP;

    IF v_entry.id IS NULL OR v_entry.clock_out IS NOT NULL THEN
      INSERT INTO job_time_entries (
        job_id, employee_id, appointment_id, work_date,
        hours, work_type, travel_start, entered_by, description,
        travel_start_lat, travel_start_lng
      ) VALUES (
        v_job_id, p_employee_id, p_appointment_id, v_now::DATE,
        0, 'field', v_now, p_employee_id,
        (SELECT COALESCE(title, 'Appointment') FROM appointments WHERE id = p_appointment_id)
        || ' — en route',
        p_lat, p_lng
      )
      RETURNING * INTO v_entry;
    ELSE
      UPDATE job_time_entries
      SET travel_start = v_now,
          travel_start_lat = COALESCE(p_lat, travel_start_lat),
          travel_start_lng = COALESCE(p_lng, travel_start_lng)
      WHERE id = v_entry.id
      RETURNING * INTO v_entry;
    END IF;

    UPDATE appointments SET status = 'en_route' WHERE id = p_appointment_id;

  ELSIF p_action = 'start' THEN
    UPDATE job_time_entries
    SET clock_in = v_now,
        clock_in_lat = COALESCE(p_lat, clock_in_lat),
        clock_in_lng = COALESCE(p_lng, clock_in_lng),
        travel_minutes = CASE
          WHEN v_entry.travel_start IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (v_now - v_entry.travel_start)) / 60.0, 1)
          ELSE NULL
        END
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'in_progress' WHERE id = p_appointment_id;

  ELSIF p_action = 'pause' THEN
    UPDATE job_time_entries SET paused_at = v_now
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'paused' WHERE id = p_appointment_id;

  ELSIF p_action = 'resume' THEN
    v_paused_min := COALESCE(v_entry.total_paused_minutes, 0)
      + EXTRACT(EPOCH FROM (v_now - v_entry.paused_at)) / 60;

    UPDATE job_time_entries
    SET paused_at = NULL,
        total_paused_minutes = ROUND(v_paused_min::NUMERIC, 2)
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'in_progress' WHERE id = p_appointment_id;

  ELSIF p_action = 'finish' THEN
    v_paused_min := COALESCE(v_entry.total_paused_minutes, 0);
    IF v_entry.paused_at IS NOT NULL THEN
      v_paused_min := v_paused_min + EXTRACT(EPOCH FROM (v_now - v_entry.paused_at)) / 60;
    END IF;

    v_total_ms := EXTRACT(EPOCH FROM (v_now - v_entry.clock_in)) * 1000
                  - v_paused_min * 60000;
    v_hours := LEAST(24, GREATEST(0, ROUND((v_total_ms / 3600000)::NUMERIC, 2)));

    UPDATE job_time_entries
    SET clock_out            = v_now,
        on_site_end          = v_now,
        hours                = v_hours,
        paused_at            = NULL,
        total_paused_minutes = ROUND(v_paused_min::NUMERIC, 2)
    WHERE id = v_entry.id
    RETURNING * INTO v_entry;

    UPDATE appointments SET status = 'completed' WHERE id = p_appointment_id;
  END IF;

  RETURN NEXT v_entry;
END;
$function$;
