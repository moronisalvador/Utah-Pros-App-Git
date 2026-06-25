-- Action-required feed: surface the customer name + job address on each row so the
-- owner can tell who a task is for at a glance (was job number + doc status only).
-- ADDITIVE change — adds `client` and `address` keys to each item; every existing
-- key (job_id, job, kind, text, sub) is unchanged, so already-deployed frontend
-- code keeps working (it just ignores the new keys). Safe on the shared dev/prod DB.
-- client  = jobs.insured_name; address = "street, city, ST ZIP" (same derivation as
-- get_tech_status_board so the Employee-status and Action-required cards read alike).
-- Applied to the live DB via MCP on 2026-06-25; committed here for the record.
CREATE OR REPLACE FUNCTION public.get_dashboard_action_items(p_limit int DEFAULT 8)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sigs AS (
    SELECT j.id AS job_id,
           j.job_number AS job,
           j.insured_name AS client,
           NULLIF(CONCAT_WS(', ',
             NULLIF(j.address, ''),
             NULLIF(j.city, ''),
             NULLIF(j.state, '') || CASE WHEN j.zip IS NOT NULL AND j.zip <> '' THEN ' ' || j.zip ELSE '' END
           ), '') AS address,
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
    SELECT jsonb_build_object(
             'job_id', job_id, 'job', job, 'client', client, 'address', address,
             'kind', 'esign', 'text', text, 'sub', sub
           ) AS x, ts
    FROM sigs ORDER BY ts ASC NULLS LAST LIMIT p_limit
  ) q;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_action_items(int) TO authenticated;
