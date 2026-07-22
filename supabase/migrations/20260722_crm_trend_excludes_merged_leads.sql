-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_trend_excludes_merged_leads
-- Phase: n/a (standalone CRM counting-consistency fix — owner-caught live)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   When a customer calls twice about the same job, the second call's lead row
--   is "merged" into the first (its merged_into_lead_id points at the original)
--   so the pipeline shows one card, not two. The headline "Leads" card
--   (get_attribution_rollup) already skips those merged duplicate rows when it
--   counts leads — but the Conversion Trend chart on the SAME screen
--   (get_conversion_trend) does not. So the card and the chart disagree:
--   verified live 2026-07-22, the card said 26 leads while the trend chart's
--   bar for the same period said 28 (the 2 merged duplicates). This adds the
--   same one-line exclusion the card already uses to the chart's lead count,
--   so both numbers come from the same definition of "a lead".
--
-- ADDITIVE-ONLY:
--   Function-body-only CREATE OR REPLACE of get_conversion_trend. Signature is
--   byte-for-byte unchanged; the ONLY change from the live body (last shipped
--   in 20260722_crm_won_jobs_use_canonical_real_job_rule.sql §2, verified
--   byte-identical to production this session) is ONE added WHERE line in the
--   lead_c CTE: `AND il.merged_into_lead_id IS NULL`. No table/column/policy
--   change, no data change. Timezone/bucketing handling is deliberately
--   untouched (an owner ruling on Denver bucketing is pending — out of scope).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body — identical to the body below minus the single
--   `AND il.merged_into_lead_id IS NULL` line in lead_c. The prior body is
--   preserved verbatim in 20260722_crm_won_jobs_use_canonical_real_job_rule.sql
--   (section 2). No schema or data is touched, so a rollback is purely that
--   one function body.
-- ════════════════════════════════════════════════

-- get_conversion_trend — the Overview Conversion Trend chart. lead_c gains the
-- merged-duplicate exclusion that get_attribution_rollup's leads_agg already
-- applies, so the "Leads" card and the trend bar count the same rows.
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
      AND il.merged_into_lead_id IS NULL
      AND (il.source_type <> 'call' OR public.crm_call_is_answered(il.raw_payload, il.duration_sec))
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  est_c AS (
    SELECT date_trunc('month', e.created_at) AS m, COUNT(*) AS c
    FROM estimates e
    WHERE e.status IS DISTINCT FROM 'draft'
      AND crm_contact_is_traced(e.contact_id)
      AND e.created_at >= v_start::timestamptz AND e.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  -- CANONICAL SALE RULE (see job_agg note in get_attribution_rollup).
  job_c AS (
    SELECT date_trunc('month', COALESCE(cl.created_at, j.created_at)) AS m,
           COUNT(*) AS c,
           COALESCE(SUM(j.invoiced_value), 0) AS rev
    FROM jobs j
    LEFT JOIN claims cl ON cl.id = j.claim_id
    WHERE j.is_real_job = true AND j.status IS DISTINCT FROM 'deleted'
      AND crm_contact_is_traced(j.primary_contact_id)
      AND COALESCE(cl.created_at, j.created_at) >= v_start::timestamptz
      AND COALESCE(cl.created_at, j.created_at) <  (v_end + 1)::timestamptz
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

-- Managed-Supabase function trap (database-standard.md §1): the project
-- re-applies EXECUTE TO PUBLIC on every function DDL, so re-assert explicitly.
REVOKE EXECUTE ON FUNCTION public.get_conversion_trend(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversion_trend(date, date, uuid) TO authenticated, service_role;
