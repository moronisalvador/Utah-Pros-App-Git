-- Job costing: get_job_labor_summary now also returns travel_hours (SUM(travel_minutes)/60)
-- so the By Job tab can show Travel / On-site / Total consistently with the rest of the page
-- (total_cost already includes travel). Additive column → DROP + CREATE.
-- Rollback: DROP + re-create the prior 11-column version (without travel_hours).
DROP FUNCTION IF EXISTS public.get_job_labor_summary(uuid, date, date);

CREATE FUNCTION public.get_job_labor_summary(p_job_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS TABLE(job_id uuid, job_number text, insured_name text, division text, employee_id uuid, employee_name text, total_hours numeric, travel_hours numeric, total_cost numeric, approved_hours numeric, approved_cost numeric, entry_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    j.id AS job_id,
    j.job_number,
    j.insured_name,
    j.division,
    e.id AS employee_id,
    e.full_name AS employee_name,
    SUM(t.hours) AS total_hours,
    SUM(COALESCE(t.travel_minutes, 0)) / 60.0 AS travel_hours,
    SUM(t.total_cost) AS total_cost,
    SUM(CASE WHEN t.approved THEN t.hours ELSE 0 END) AS approved_hours,
    SUM(CASE WHEN t.approved THEN t.total_cost ELSE 0 END) AS approved_cost,
    COUNT(*) AS entry_count
  FROM job_time_entries t
  JOIN employees e ON e.id = t.employee_id
  JOIN jobs j ON j.id = t.job_id
  WHERE (p_job_id IS NULL OR t.job_id = p_job_id)
    AND (p_start_date IS NULL OR t.work_date >= p_start_date)
    AND (p_end_date IS NULL OR t.work_date <= p_end_date)
  GROUP BY j.id, j.job_number, j.insured_name, j.division, e.id, e.full_name
  ORDER BY j.job_number, e.full_name;
$function$;
