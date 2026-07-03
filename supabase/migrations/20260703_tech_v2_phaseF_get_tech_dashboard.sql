-- ════════════════════════════════════════════════
-- MIGRATION: 20260703_tech_v2_phaseF_get_tech_dashboard
-- ════════════════════════════════════════════════
-- Tech Mobile v2 — Phase F (Foundation).
--
-- WHAT THIS DOES (plain language):
--   Adds get_tech_dashboard — one round trip that returns everything the v2 tech
--   dashboard needs: today's visits (full upgraded payload, cancelled excluded),
--   my next 7 days, my open clock entry, hours today and this week (split into
--   travel vs on-site so the UI can show travel + on-site + total, labeled), and
--   how many photos I took today. Replaces the old 4-plus-N request pattern.
--
-- HOURS MATH (docs/tech-v2-roadmap.md, Architecture decision #8; test:
--   supabase/tests/tech_v2_dashboard.test.js):
--   * on_site = SUM(stored hours) over entries in range + a live-elapsed term for
--     the ONE open entry (its stored hours is 0 until finish). We SUM the stored
--     hours column and NEVER recompute closed entries from clock_in/clock_out —
--     that would corrupt manual hours-only rows, admin inline edits, and
--     midnight-split rows.
--   * travel = SUM(stored travel_minutes)/60 + a live travel term for an entry
--     that is en route (travel_start set, clock_in still NULL → travel_minutes not
--     yet stored). Once "Start Work" fires, travel_minutes is stored and the live
--     term switches off (mutually exclusive on clock_in IS NULL).
--   * total = travel + on_site.
--   * Rows are filtered by work_date. Week = Monday-start in America/Denver, to
--     match get_payroll_summary (date_trunc('week', ...) = ISO Monday).
--   * Platform note (labeled in the UI): payroll total_hours EXCLUDES travel; the
--     billing total_cost generated column INCLUDES it. The dashboard shows both.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_tech_dashboard(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_now         timestamptz := now();
  v_today       date := (v_now AT TIME ZONE 'America/Denver')::date;
  v_week_start  date := (date_trunc('week', ((v_now AT TIME ZONE 'America/Denver')::date)::timestamp))::date;
  v_today_appts jsonb;
  v_upcoming    jsonb;
  v_open        job_time_entries%ROWTYPE;
  v_open_json   jsonb;
  v_photos      integer;
  v_hours_today jsonb;
  v_hours_week  jsonb;
BEGIN
  -- Today's appointments (full upgraded payload), scoped to me, cancelled excluded.
  -- NOTE: we filter by the DENVER calendar day (v_today), NOT the legacy feed's
  -- get_my_appointments_today, which keys off CURRENT_DATE (UTC). At 6pm–midnight
  -- Mountain the UTC day has already rolled over, so reusing the feed would show
  -- TOMORROW's visits as "today". The v2 dashboard is internally consistent on
  -- America/Denver (same boundary as the hours math and work_date fix).
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'time_start')), '[]'::jsonb)
  INTO v_today_appts
  FROM (
    SELECT jsonb_build_object(
      'id', a.id, 'job_id', a.job_id, 'title', a.title, 'date', a.date,
      'time_start', a.time_start, 'time_end', a.time_end, 'type', a.type,
      'status', a.status, 'notes', a.notes,
      'color', a.color, 'kind', a.kind, 'duration_days', a.duration_days, 'is_milestone', a.is_milestone,
      'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
      'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true),
      'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object(
        'id', j.id, 'job_number', j.job_number, 'insured_name', j.insured_name,
        'address', j.address, 'city', j.city, 'division', j.division,
        'phase', j.phase, 'client_phone', j.client_phone
      ) ELSE NULL END,
      'appointment_crew', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ac2.id, 'employee_id', ac2.employee_id, 'role', ac2.role,
          'employees', jsonb_build_object(
            'id', e2.id, 'display_name', e2.display_name, 'full_name', e2.full_name,
            'color', e2.color, 'avatar_url', e2.avatar_url
          )
        ))
        FROM appointment_crew ac2 JOIN employees e2 ON e2.id = ac2.employee_id
        WHERE ac2.appointment_id = a.id
      ), '[]'::jsonb)
    ) AS row_data
    FROM appointments a
    JOIN appointment_crew ac ON ac.appointment_id = a.id AND ac.employee_id = p_employee_id
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.date = v_today
      AND a.status <> 'cancelled'
  ) sub;

  -- My upcoming 7 days (tomorrow .. +7), cancelled excluded, scoped to me.
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'date'), (row_data->>'time_start')), '[]'::jsonb)
  INTO v_upcoming
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'job_id', a.job_id,
      'title', a.title,
      'date', a.date,
      'time_start', a.time_start,
      'time_end', a.time_end,
      'type', a.type,
      'status', a.status,
      'notes', a.notes,
      'color', a.color,
      'kind', a.kind,
      'duration_days', a.duration_days,
      'is_milestone', a.is_milestone,
      'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
      'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true),
      'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object(
        'id', j.id, 'job_number', j.job_number, 'insured_name', j.insured_name,
        'address', j.address, 'city', j.city, 'division', j.division,
        'phase', j.phase, 'client_phone', j.client_phone
      ) ELSE NULL END,
      'appointment_crew', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ac2.id, 'employee_id', ac2.employee_id, 'role', ac2.role,
          'employees', jsonb_build_object(
            'id', e2.id, 'display_name', e2.display_name, 'full_name', e2.full_name,
            'color', e2.color, 'avatar_url', e2.avatar_url
          )
        ))
        FROM appointment_crew ac2 JOIN employees e2 ON e2.id = ac2.employee_id
        WHERE ac2.appointment_id = a.id
      ), '[]'::jsonb)
    ) AS row_data
    FROM appointments a
    JOIN appointment_crew ac ON ac.appointment_id = a.id AND ac.employee_id = p_employee_id
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.date > v_today AND a.date <= v_today + 7
      AND a.status <> 'cancelled'
  ) sub;

  -- The single open clock entry (if any).
  SELECT * INTO v_open
  FROM job_time_entries
  WHERE employee_id = p_employee_id AND clock_out IS NULL
  ORDER BY created_at DESC
  LIMIT 1;
  v_open_json := CASE WHEN v_open.id IS NOT NULL THEN to_jsonb(v_open) ELSE NULL END;

  -- Photos I captured today (Denver day).
  SELECT COUNT(*) INTO v_photos
  FROM job_documents d
  WHERE d.uploaded_by = p_employee_id
    AND d.category = 'photo'
    AND (d.created_at AT TIME ZONE 'America/Denver')::date = v_today;

  -- Hours: stored sums + a live term for the open entry, per range.
  v_hours_today := tech_hours_bucket(p_employee_id, v_today, v_today, v_now, v_open);
  v_hours_week  := tech_hours_bucket(p_employee_id, v_week_start, v_today, v_now, v_open);

  RETURN jsonb_build_object(
    'server_now', v_now,
    'today', v_today,
    'week_start', v_week_start,
    'appointments', COALESCE(v_today_appts, '[]'::jsonb),
    'upcoming', COALESCE(v_upcoming, '[]'::jsonb),
    'open_entry', v_open_json,
    'hours_today', v_hours_today,
    'hours_week', v_hours_week,
    'photos_today', COALESCE(v_photos, 0)
  );
END;
$function$;

-- Internal helper: one hours bucket for a work_date range. Kept as its own
-- SECURITY DEFINER function so today/week share exactly one implementation of the
-- stored-sum + live-open-term math. p_open is the caller's already-fetched open
-- entry (NULL row if none) — passed in so we compute the live term consistently.
CREATE OR REPLACE FUNCTION public.tech_hours_bucket(
  p_employee_id uuid, p_start date, p_end date, p_now timestamptz, p_open job_time_entries
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_onsite_stored numeric;
  v_travel_stored numeric;
  v_live_onsite   numeric := 0;
  v_live_travel   numeric := 0;
  v_onsite        numeric;
  v_travel        numeric;
BEGIN
  SELECT COALESCE(SUM(hours), 0), COALESCE(SUM(travel_minutes), 0) / 60.0
  INTO v_onsite_stored, v_travel_stored
  FROM job_time_entries
  WHERE employee_id = p_employee_id AND work_date BETWEEN p_start AND p_end;

  -- Live terms only when the open entry's work_date falls in this range.
  IF p_open.id IS NOT NULL AND p_open.work_date BETWEEN p_start AND p_end THEN
    IF p_open.clock_in IS NOT NULL THEN
      -- On site (or paused): elapsed since clock-in, minus paused time.
      v_live_onsite := GREATEST(0,
        EXTRACT(EPOCH FROM (p_now - p_open.clock_in)) / 3600.0
        - COALESCE(p_open.total_paused_minutes, 0) / 60.0
        - CASE WHEN p_open.paused_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (p_now - p_open.paused_at)) / 3600.0 ELSE 0 END);
    ELSIF p_open.travel_start IS NOT NULL THEN
      -- Still en route: travel_minutes not yet stored; accrue live.
      v_live_travel := GREATEST(0, EXTRACT(EPOCH FROM (p_now - p_open.travel_start)) / 3600.0);
    END IF;
  END IF;

  v_onsite := ROUND((v_onsite_stored + v_live_onsite)::numeric, 2);
  v_travel := ROUND((v_travel_stored + v_live_travel)::numeric, 2);

  RETURN jsonb_build_object(
    'on_site', v_onsite,
    'travel', v_travel,
    'total', ROUND((v_onsite + v_travel)::numeric, 2)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tech_hours_bucket(uuid, date, date, timestamptz, job_time_entries) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tech_dashboard(uuid) TO anon, authenticated;
