-- ════════════════════════════════════════════════
-- Overview dashboard read-only RPCs (Phase 2)
-- Applied to the live DB via MCP on 2026-06-24; committed here for the record.
-- All SECURITY DEFINER, fixed search_path, granted to authenticated.
-- Dashboard division buckets: mitigation = water|fire|contents|other,
-- plus reconstruction, mold, remodeling (no enum value yet → always 0).
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dash_division_bucket(p_division text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_division = 'reconstruction' THEN 'reconstruction'
    WHEN p_division = 'mold' THEN 'mold'
    WHEN p_division = 'remodeling' THEN 'remodeling'
    ELSE 'mitigation'
  END;
$$;

-- 1) Revenue recognized by division for a period (pushed-to-QBO invoices)
CREATE OR REPLACE FUNCTION public.get_revenue_by_division(p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket,
           COALESCE(i.adjusted_total, i.total, 0) AS amt,
           i.invoice_date AS d
    FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.qbo_invoice_id IS NOT NULL
  ),
  cur AS (SELECT bucket, SUM(amt) AS v FROM inv WHERE d BETWEEN p_start AND p_end GROUP BY bucket),
  prev AS (SELECT SUM(amt) AS v FROM inv WHERE d BETWEEN (p_start - ((p_end - p_start) + 1)) AND (p_start - 1))
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT SUM(v) FROM cur), 0),
    'prev_total', COALESCE((SELECT v FROM prev), 0),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'value', v)) FROM cur), '[]'::jsonb)
  );
$$;

-- 2) Avg ticket per division + avg per claim/loss for a period
CREATE OR REPLACE FUNCTION public.get_avg_ticket(p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket,
           j.claim_id,
           COALESCE(i.adjusted_total, i.total, 0) AS amt
    FROM invoices i JOIN jobs j ON j.id = i.job_id
    WHERE i.qbo_invoice_id IS NOT NULL AND i.invoice_date BETWEEN p_start AND p_end
  )
  SELECT jsonb_build_object(
    'divisions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', bucket, 'avg', av))
      FROM (SELECT bucket, AVG(amt) AS av FROM inv GROUP BY bucket) s), '[]'::jsonb),
    'avg_per_claim', COALESCE((
      SELECT AVG(cs) FROM (SELECT claim_id, SUM(amt) cs FROM inv WHERE claim_id IS NOT NULL GROUP BY claim_id) c), 0)
  );
$$;

-- 3) Open estimates summary (grouped by division bucket)
CREATE OR REPLACE FUNCTION public.get_open_estimates_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH e AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket, COALESCE(es.amount, 0) AS amt
    FROM estimates es JOIN jobs j ON j.id = es.job_id
    WHERE COALESCE(es.status, 'open') NOT IN ('approved','denied','rejected','cancelled','void','converted','paid')
  )
  SELECT jsonb_build_object(
    'total_count', COALESCE((SELECT count(*) FROM e), 0),
    'total_value', COALESCE((SELECT SUM(amt) FROM e), 0),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'count', c, 'value', v))
                          FROM (SELECT bucket, count(*) c, SUM(amt) v FROM e GROUP BY bucket) s), '[]'::jsonb)
  );
$$;

-- 4) Production pipeline counts by stage (active stages from real phases + invoice status)
CREATE OR REPLACE FUNCTION public.get_pipeline_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('stages', jsonb_build_array(
    jsonb_build_object('label','New / FNOL','count',
      (SELECT count(*) FROM jobs WHERE phase = 'job_received' AND status IS DISTINCT FROM 'deleted')),
    jsonb_build_object('label','In production','count',
      (SELECT count(*) FROM jobs WHERE phase = 'reconstruction_in_progress' AND status IS DISTINCT FROM 'deleted')),
    jsonb_build_object('label','Invoiced','count',
      (SELECT count(DISTINCT job_id) FROM invoices WHERE qbo_invoice_id IS NOT NULL)),
    jsonb_build_object('label','Paid','count',
      (SELECT count(DISTINCT job_id) FROM invoices WHERE status = 'paid'))
  ));
$$;

-- 5) Active drying jobs (% to dry standard per job; empty until Hydro is in use)
CREATE OR REPLACE FUNCTION public.get_active_drying_jobs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH started AS (
    SELECT job_id, MIN(placed_at) AS placed FROM equipment_placements WHERE status = 'active' GROUP BY job_id
  ),
  latest AS (
    SELECT DISTINCT ON (mr.job_id, mr.material)
           mr.job_id, mr.mc_pct, mr.drying_goal_pct, mr.taken_at
    FROM moisture_readings mr
    ORDER BY mr.job_id, mr.material, mr.taken_at DESC
  ),
  prog AS (
    SELECT job_id,
           AVG(CASE
                 WHEN drying_goal_pct IS NULL OR mc_pct IS NULL THEN NULL
                 WHEN mc_pct <= drying_goal_pct THEN 100
                 ELSE GREATEST(0, LEAST(99, round((drying_goal_pct / NULLIF(mc_pct, 0)) * 100)))
               END) AS pct,
           MAX(taken_at) AS last_reading
    FROM latest GROUP BY job_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'job', j.job_number,
           'city', j.city,
           'day', GREATEST(1, (CURRENT_DATE - s.placed::date) + 1),
           'pct', COALESCE(round(p.pct)::int, 0),
           'hours_since_reading',
             CASE WHEN p.last_reading IS NULL THEN NULL
                  ELSE round(EXTRACT(EPOCH FROM (now() - p.last_reading)) / 3600)::int END
         ) ORDER BY COALESCE(p.pct, 0) DESC), '[]'::jsonb)
  FROM started s JOIN jobs j ON j.id = s.job_id LEFT JOIN prog p ON p.job_id = s.job_id;
$$;

-- 6) Action-required feed (currently: unsigned/pending sign requests, oldest first)
CREATE OR REPLACE FUNCTION public.get_dashboard_action_items(p_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sigs AS (
    SELECT j.job_number AS job,
           CASE sr.doc_type
             WHEN 'coc' THEN 'Certificate of Completion unsigned'
             WHEN 'work_auth' THEN 'Work authorization unsigned'
             WHEN 'direction_pay' THEN 'Direction-to-pay unsigned'
             WHEN 'recon_agreement' THEN 'Reconstruction agreement unsigned'
             ELSE 'Document unsigned'
           END AS text,
           'Awaiting signature · sent ' || to_char(COALESCE(sr.sent_at, sr.created_at), 'Mon DD') AS sub,
           COALESCE(sr.sent_at, sr.created_at) AS ts
    FROM sign_requests sr LEFT JOIN jobs j ON j.id = sr.job_id
    WHERE sr.status = 'pending'
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY ts ASC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('job', job, 'kind', 'esign', 'text', text, 'sub', sub) AS x, ts
    FROM sigs ORDER BY ts ASC NULLS LAST LIMIT p_limit
  ) q;
$$;

GRANT EXECUTE ON FUNCTION public.dash_division_bucket(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_division(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_avg_ticket(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_estimates_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_drying_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_action_items(int) TO authenticated;
