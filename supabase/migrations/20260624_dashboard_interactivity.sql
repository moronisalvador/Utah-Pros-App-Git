-- Dashboard interactivity + completeness (Phase 2 "Part A").
-- Applied to the live DB via MCP on 2026-06-24; committed here for the record.
-- A1: add job_id to drying + action-item RPCs so rows can deep-link to /jobs/:id.
-- A4: get_jobs_completed. A3: seed page:overview feature flag.

-- A1a — Active drying: add job_id
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
           'job_id', j.id,
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

-- A1b — Action items: add job_id
CREATE OR REPLACE FUNCTION public.get_dashboard_action_items(p_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sigs AS (
    SELECT j.id AS job_id,
           j.job_number AS job,
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
    SELECT jsonb_build_object('job_id', job_id, 'job', job, 'kind', 'esign', 'text', text, 'sub', sub) AS x, ts
    FROM sigs ORDER BY ts ASC NULLS LAST LIMIT p_limit
  ) q;
$$;

-- A4 — Jobs completed (terminal-phase jobs in the period + last calendar month)
CREATE OR REPLACE FUNCTION public.get_jobs_completed(p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM jobs
              WHERE phase IN ('completed','closed') AND actual_completion BETWEEN p_start AND p_end),
    'last_month', (SELECT count(*) FROM jobs
              WHERE phase IN ('completed','closed')
                AND actual_completion >= date_trunc('month', CURRENT_DATE - interval '1 month')::date
                AND actual_completion <  date_trunc('month', CURRENT_DATE)::date)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_active_drying_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_action_items(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_jobs_completed(date, date) TO authenticated;

-- A3 — seed the page:overview feature flag (enabled; kill-switch + dev-only scoping)
INSERT INTO public.feature_flags (key, enabled, force_disabled, category, label, description, updated_at)
VALUES ('page:overview', true, false, 'page', 'Overview Dashboard', 'Owner overview dashboard at / — kill-switch + dev-only scoping', now())
ON CONFLICT (key) DO NOTHING;
