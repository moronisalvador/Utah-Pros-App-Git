-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p6_timezone_rpc_bodies.sql
-- DB-Foundation Phase P6 — timezone RPC body-replaces  [roadmap item ②]
--   docs/db-foundation-roadmap.md → Phase P6 block; database-standard.md §7.
--
-- WHAT THIS DOES (plain language):
--   Eight existing reporting/scheduling functions decided "today" / "this week"
--   using naive CURRENT_DATE. On this database the session timezone is UTC (no
--   role or database override — verified live 2026-07-08), so CURRENT_DATE returns
--   the UTC calendar day, which is WRONG for a Mountain-Time business every evening
--   between ~6pm and midnight local (it has already rolled to tomorrow in UTC).
--   This migration swaps each naive CURRENT_DATE for public.mt_today() (the Denver
--   calendar day helper Foundation shipped), so every "today" boundary is measured
--   in America/Denver — the one timezone convention (database-standard §7).
--
-- STRICTLY BODY-ONLY (manifest §3, FE-contract freeze §5):
--   • Signatures + RETURNS shapes are byte-identical to the live definitions
--     (drift-dumped via pg_get_functiondef on 2026-07-08 — 3 of these were never
--     in the repo: add_custom_schedule_phase, get_payroll_summary,
--     get_timesheet_entries). The ONLY change per function is CURRENT_DATE →
--     public.mt_today(). No column, no return key, no argument type changes.
--   • The shift is a VALUE shift on already-computed date columns (sanctioned by
--     manifest §5), not a shape change — every existing caller keeps working.
--
-- DISCLOSED RULE AMENDMENT (manifest §3, roadmap "What resisted maximum
--   parallelism" ②): two of these are CRM-frozen (get_call_volume,
--   get_conversion_trend — CRM Phase 9) and three are tech-v2-frozen
--   (get_my_appointments_today, get_assigned_tasks,
--   get_stalled_materials_for_employee). P6 is explicitly authorized to
--   body-only-replace them for the timezone fix; their existing backward-compat
--   tests (supabase/tests/crm_phase9_intelligence.test.js,
--   supabase/tests/tech_v2_feed_upgrades.test.js) assert RETURN SHAPE only and
--   stay green. See the P6 PR body for the full amendment note.
--
-- GRANTS: CREATE OR REPLACE preserves each function's existing privilege set, so
--   no GRANT is emitted (access stays byte-identical: anon + authenticated +
--   service_role, exactly as live — anon closure on these RPCs, if wanted, is P3's
--   job, not P6's). We only defensively REVOKE EXECUTE ... FROM PUBLIC after each
--   replace, because this managed Supabase re-applies the built-in EXECUTE-TO-
--   PUBLIC grant on function DDL (database-standard §1); the explicit role grants
--   are untouched by that revoke.
--
-- ADDITIVE-EQUIVALENT / SAFE: no schema change; behavior-preserving except the
--   intended Denver date shift. One shared Supabase — live in dev + prod on apply.
--
-- ROLLBACK: re-apply the prior bodies (CURRENT_DATE in place of public.mt_today()).
--   Each is a symmetric CREATE OR REPLACE. The 5 repo-tracked functions' prior
--   bodies are recoverable from git history (get_assigned_tasks →
--   20260703_tech_v2_phaseF_drift_capture.sql; get_my_appointments_today →
--   20260703_tech_v2_phaseF_feed_upgrades.sql; get_call_volume/get_conversion_trend
--   → 20260702_crm_phase9_intelligence_rpcs.sql; get_stalled_materials_for_employee
--   → 20260418_get_stalled_for_employee.sql). The 3 that were NEVER in the repo are
--   inlined below (drift-dumped live 2026-07-08) so this undo is self-contained:
--
--   -- add_custom_schedule_phase: revert the two COALESCE defaults
--   --   COALESCE(p_target_start, public.mt_today())          → COALESCE(p_target_start, CURRENT_DATE)
--   --   COALESCE(p_target_end, public.mt_today() + p_duration_days - 1)
--   --                                                        → COALESCE(p_target_end, CURRENT_DATE + p_duration_days - 1)
--   -- get_payroll_summary + get_timesheet_entries: revert the parameter DEFAULTs
--   --   (date_trunc('week', (public.mt_today())::timestamptz))::date
--   --                                                        → (date_trunc('week', (CURRENT_DATE)::timestamptz))::date
--   --   ((date_trunc('week', (public.mt_today())::timestamptz) + '6 days'::interval))::date
--   --                                                        → ((date_trunc('week', (CURRENT_DATE)::timestamptz) + '6 days'::interval))::date
--   -- Everything else in all 8 bodies is byte-identical to this file — only the
--   -- date source changes. A rollback re-runs each CREATE OR REPLACE with the
--   -- swap reversed, then the same per-function REVOKE EXECUTE ... FROM PUBLIC.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. add_custom_schedule_phase (schedule) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_custom_schedule_phase(p_job_id uuid, p_phase_name text, p_phase_color text DEFAULT '#6b7280'::text, p_target_start date DEFAULT NULL::date, p_target_end date DEFAULT NULL::date, p_duration_days integer DEFAULT 1, p_sort_order integer DEFAULT 999)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_schedule_id UUID;
  v_phase_id UUID;
BEGIN
  SELECT id INTO v_schedule_id FROM job_schedules WHERE job_id = p_job_id LIMIT 1;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Job has no schedule';
  END IF;

  INSERT INTO job_schedule_phases (
    job_schedule_id, phase_name, phase_color, target_start, target_end, duration_days, sort_order
  ) VALUES (
    v_schedule_id, p_phase_name, p_phase_color,
    COALESCE(p_target_start, public.mt_today()),
    COALESCE(p_target_end, public.mt_today() + p_duration_days - 1),
    p_duration_days, p_sort_order
  ) RETURNING id INTO v_phase_id;

  RETURN v_phase_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.add_custom_schedule_phase(uuid, text, text, date, date, integer, integer) FROM PUBLIC;

-- ─── 2. get_assigned_tasks (tech-v2 frozen — disclosed amendment) ────────────
CREATE OR REPLACE FUNCTION public.get_assigned_tasks(p_employee_id uuid)
 RETURNS TABLE(task_id uuid, task_name text, is_complete boolean, sort_order integer, phase_name text, appointment_id uuid, appointment_date date, appointment_time text, is_today boolean, job_id uuid, job_number text, insured_name text, division text, job_phase text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    jt.id                                              AS task_id,
    jt.title                                           AS task_name,
    COALESCE(jt.is_completed, FALSE)                   AS is_complete,
    COALESCE(jt.display_order, 0)                      AS sort_order,
    jt.phase_name,
    jt.appointment_id,
    a.date                                             AS appointment_date,
    a.time_start::TEXT                                 AS appointment_time,
    (a.date = public.mt_today())                       AS is_today,
    j.id                                               AS job_id,
    j.job_number,
    c.name                                             AS insured_name,
    j.division::TEXT,
    j.phase                                            AS job_phase
  FROM job_tasks jt
  JOIN appointments a        ON a.id = jt.appointment_id
  JOIN appointment_crew acr  ON acr.appointment_id = a.id
                             AND acr.employee_id = p_employee_id
  JOIN jobs j                ON j.id = jt.job_id
  LEFT JOIN contacts c       ON c.id = j.primary_contact_id
  WHERE COALESCE(jt.is_completed, FALSE) = FALSE
    AND a.status NOT IN ('cancelled', 'completed')
  ORDER BY
    (a.date = public.mt_today()) DESC,
    a.date ASC,
    a.time_start ASC,
    jt.display_order ASC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_assigned_tasks(uuid) FROM PUBLIC;

-- ─── 3. get_call_volume (CRM Phase 9 frozen — disclosed amendment) ───────────
CREATE OR REPLACE FUNCTION public.get_call_volume(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_start date;
  v_end   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, public.mt_today());
  v_start := COALESCE(p_start, (v_end - 29));

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_start::timestamptz, v_end::timestamptz, interval '1 day') AS d
  ),
  calls AS (
    SELECT date_trunc('day', COALESCE(il.occurred_at, il.created_at)) AS d,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(il.duration_sec, 0) > 0) AS answered,
           COUNT(*) FILTER (WHERE COALESCE(il.duration_sec, 0) = 0) AS missed
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
    GROUP BY 1
  )
  SELECT json_build_object(
    'period',       to_char(days.d, 'YYYY-MM-DD'),
    'period_start', days.d::date,
    'total',        COALESCE(calls.total, 0),
    'answered',     COALESCE(calls.answered, 0),
    'missed',       COALESCE(calls.missed, 0)
  )
  FROM days
  LEFT JOIN calls ON calls.d = date_trunc('day', days.d)
  ORDER BY days.d;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) FROM PUBLIC;

-- ─── 4. get_conversion_trend (CRM Phase 9 frozen — disclosed amendment) ──────
CREATE OR REPLACE FUNCTION public.get_conversion_trend(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_start date;
  v_end   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, public.mt_today());
  v_start := COALESCE(p_start, (date_trunc('month', v_end::timestamptz) - interval '11 months')::date);

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(date_trunc('month', v_start::timestamptz),
                           date_trunc('month', v_end::timestamptz),
                           interval '1 month') AS m
  ),
  lead_c AS (
    SELECT date_trunc('month', COALESCE(il.occurred_at, il.created_at)) AS m, COUNT(*) AS c
    FROM inbound_leads il
    WHERE il.org_id = v_org AND COALESCE(il.spam_flag, false) = false
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  est_c AS (
    SELECT date_trunc('month', e.created_at) AS m, COUNT(*) AS c
    FROM estimates e
    WHERE e.status IS DISTINCT FROM 'draft'
      AND e.created_at >= v_start::timestamptz AND e.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  job_c AS (
    SELECT date_trunc('month', j.created_at) AS m, COUNT(*) AS c, COALESCE(SUM(j.invoiced_value), 0) AS rev
    FROM jobs j
    WHERE j.phase <> 'lead' AND j.status <> 'deleted'
      AND j.created_at >= v_start::timestamptz AND j.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  )
  SELECT json_build_object(
    'period',       to_char(months.m, 'YYYY-MM'),
    'period_start', months.m::date,
    'leads',        COALESCE(lead_c.c, 0),
    'estimates',    COALESCE(est_c.c, 0),
    'won_jobs',     COALESCE(job_c.c, 0),
    'revenue',      COALESCE(job_c.rev, 0)
  )
  FROM months
  LEFT JOIN lead_c ON lead_c.m = months.m
  LEFT JOIN est_c  ON est_c.m  = months.m
  LEFT JOIN job_c  ON job_c.m  = months.m
  ORDER BY months.m;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_conversion_trend(date, date, uuid) FROM PUBLIC;

-- ─── 5. get_my_appointments_today (tech-v2 frozen — disclosed amendment) ─────
CREATE OR REPLACE FUNCTION public.get_my_appointments_today(p_employee_id uuid, p_include_cancelled boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  today date := public.mt_today();
BEGIN
  SELECT jsonb_agg(row_data ORDER BY (row_data->>'time_start'))
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', a.id, 'job_id', a.job_id, 'title', a.title, 'date', a.date,
      'time_start', a.time_start, 'time_end', a.time_end, 'type', a.type,
      'status', a.status, 'notes', a.notes,
      'color', a.color, 'kind', a.kind, 'duration_days', a.duration_days, 'is_milestone', a.is_milestone,
      'task_total', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id),
      'task_completed', (SELECT COUNT(*) FROM job_tasks jt WHERE jt.appointment_id = a.id AND jt.is_completed = true),
      'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object(
        'id', j.id, 'job_number', j.job_number, 'insured_name', j.insured_name, 'address', j.address,
        'city', j.city, 'division', j.division, 'phase', j.phase, 'client_phone', j.client_phone
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
    ) as row_data
    FROM appointments a
    JOIN appointment_crew ac ON ac.appointment_id = a.id AND ac.employee_id = p_employee_id
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.date = today
      AND (p_include_cancelled OR a.status <> 'cancelled')
  ) sub;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_my_appointments_today(uuid, boolean) FROM PUBLIC;

-- ─── 6. get_payroll_summary (payroll) — CURRENT_DATE in DEFAULTs + none in body ─
CREATE OR REPLACE FUNCTION public.get_payroll_summary(p_start_date date DEFAULT (date_trunc('week'::text, (public.mt_today())::timestamp with time zone))::date, p_end_date date DEFAULT ((date_trunc('week'::text, (public.mt_today())::timestamp with time zone) + '6 days'::interval))::date)
 RETURNS TABLE(employee_id uuid, employee_name text, hourly_rate numeric, overtime_rate numeric, total_hours numeric, regular_hours numeric, overtime_hours numeric, regular_cost numeric, overtime_cost numeric, total_cost numeric, approved_hours numeric, pending_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH weekly_hours AS (
    SELECT
      t.employee_id,
      date_trunc('week', t.work_date::timestamp) AS week_start,
      SUM(t.hours) AS week_hours
    FROM job_time_entries t
    WHERE t.work_date BETWEEN p_start_date AND p_end_date
    GROUP BY t.employee_id, date_trunc('week', t.work_date::timestamp)
  ),
  ot_by_employee AS (
    SELECT
      employee_id,
      SUM(GREATEST(week_hours - 40, 0)) AS total_ot_hours,
      SUM(LEAST(week_hours, 40)) AS total_reg_hours
    FROM weekly_hours
    GROUP BY employee_id
  )
  SELECT
    e.id AS employee_id,
    e.full_name AS employee_name,
    e.hourly_rate,
    COALESCE(e.overtime_rate, e.hourly_rate * 1.5) AS overtime_rate,
    SUM(t.hours) AS total_hours,
    COALESCE(ot.total_reg_hours, SUM(t.hours)) AS regular_hours,
    COALESCE(ot.total_ot_hours, 0) AS overtime_hours,
    ROUND(COALESCE(ot.total_reg_hours, SUM(t.hours)) * e.hourly_rate, 2) AS regular_cost,
    ROUND(COALESCE(ot.total_ot_hours, 0) * COALESCE(e.overtime_rate, e.hourly_rate * 1.5), 2) AS overtime_cost,
    ROUND(
      COALESCE(ot.total_reg_hours, SUM(t.hours)) * e.hourly_rate +
      COALESCE(ot.total_ot_hours, 0) * COALESCE(e.overtime_rate, e.hourly_rate * 1.5),
    2) AS total_cost,
    SUM(CASE WHEN t.approved THEN t.hours ELSE 0 END) AS approved_hours,
    SUM(CASE WHEN NOT COALESCE(t.approved, false) THEN t.hours ELSE 0 END) AS pending_hours
  FROM employees e
  JOIN job_time_entries t ON t.employee_id = e.id
  LEFT JOIN ot_by_employee ot ON ot.employee_id = e.id
  WHERE t.work_date BETWEEN p_start_date AND p_end_date
    AND e.is_active = true
  GROUP BY e.id, e.full_name, e.hourly_rate, e.overtime_rate, ot.total_reg_hours, ot.total_ot_hours
  ORDER BY e.full_name;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_payroll_summary(date, date) FROM PUBLIC;

-- ─── 7. get_stalled_materials_for_employee (tech-v2 frozen — disclosed amend.) ─
CREATE OR REPLACE FUNCTION public.get_stalled_materials_for_employee(p_employee_id uuid)
 RETURNS TABLE(job_id uuid, job_number text, appointment_id uuid, appointment_date date, room_id uuid, room_name text, material material_type, latest_mc numeric, latest_reading_at timestamp with time zone, mc_36h_ago numeric, drying_goal_pct numeric, days_stalled integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH emp_jobs AS (
    -- Jobs the tech has touched in the last 30 days via crew assignments.
    SELECT DISTINCT a.job_id,
                    (array_agg(a.id ORDER BY a.date DESC))[1] AS latest_appt_id,
                    max(a.date) AS latest_appt_date
      FROM appointments a
      JOIN appointment_crew ac ON ac.appointment_id = a.id
     WHERE ac.employee_id = p_employee_id
       AND a.job_id IS NOT NULL
       AND a.date >= (public.mt_today() - interval '30 days')
     GROUP BY a.job_id
  )
  SELECT
    ej.job_id,
    j.job_number,
    ej.latest_appt_id AS appointment_id,
    ej.latest_appt_date AS appointment_date,
    sm.room_id,
    sm.room_name,
    sm.material,
    sm.latest_mc,
    sm.latest_reading_at,
    sm.mc_36h_ago,
    sm.drying_goal_pct,
    sm.days_stalled
  FROM emp_jobs ej
  JOIN jobs j ON j.id = ej.job_id
  CROSS JOIN LATERAL get_stalled_materials(ej.job_id) AS sm
  ORDER BY sm.latest_reading_at DESC;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_stalled_materials_for_employee(uuid) FROM PUBLIC;

-- ─── 8. get_timesheet_entries (timesheets) — CURRENT_DATE in DEFAULTs only ────
CREATE OR REPLACE FUNCTION public.get_timesheet_entries(p_start_date date DEFAULT (date_trunc('week'::text, (public.mt_today())::timestamp with time zone))::date, p_end_date date DEFAULT ((date_trunc('week'::text, (public.mt_today())::timestamp with time zone) + '6 days'::interval))::date, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, job_id uuid, employee_id uuid, employee_name text, job_number text, insured_name text, division text, work_date date, hours numeric, hourly_rate numeric, total_cost numeric, work_type text, description text, approved boolean, approved_by uuid, clock_in timestamp with time zone, clock_out timestamp with time zone, appointment_id uuid, notes text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    t.id,
    t.job_id,
    t.employee_id,
    e.full_name AS employee_name,
    j.job_number,
    j.insured_name,
    j.division,
    t.work_date,
    t.hours,
    t.hourly_rate,
    t.total_cost,
    t.work_type,
    t.description,
    t.approved,
    t.approved_by,
    t.clock_in,
    t.clock_out,
    t.appointment_id,
    t.notes,
    t.created_at
  FROM job_time_entries t
  JOIN employees e ON e.id = t.employee_id
  JOIN jobs j ON j.id = t.job_id
  WHERE t.work_date BETWEEN p_start_date AND p_end_date
    AND (p_employee_id IS NULL OR t.employee_id = p_employee_id)
  ORDER BY t.work_date DESC, e.full_name, t.clock_in;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_timesheet_entries(date, date, uuid) FROM PUBLIC;
