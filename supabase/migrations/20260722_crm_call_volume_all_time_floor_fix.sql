-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_call_volume_all_time_floor_fix
-- Phase: n/a (standalone production fix — CRM Overview "All time" calls bug)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes a real bug the frontend's own "All time" fix accidentally caused.
--   To stop get_call_volume's default 30-day window from silently narrowing
--   an "All time" view, the Overview page started passing a fixed distant
--   floor ('2000-01-01') as p_start. That made this function's internal
--   generate_series(v_start, v_end, '1 day') produce one row PER DAY across
--   26+ years — and PostgREST's default 1000-row response cap then truncated
--   the result to the FIRST 1000 days (Jan 2000 – Sept 2002), which are all
--   zero. The Overview's Calls chart showed "0 calls, no data" even though 68
--   real calls exist, because none of them ever appeared in the truncated
--   window. This fixes it at the source: when p_start is null, derive a REAL
--   floor from the org's actual earliest call instead of a guessed distant
--   date — for this org (created 2026-07-01) that's a tiny, safe window, and
--   it stays correct as the org's own history grows. Falls back to the old
--   30-day window only if the org has literally never had a call.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE. Signature UNCHANGED
--   (p_start date, p_end date, p_org_id uuid) → SETOF json; return shape
--   UNCHANGED (period, period_start, total, answered, missed) — every
--   existing caller keeps working with no code change. Only the v_start
--   COALESCE chain changed (one extra fallback step). No table DROP/RENAME/
--   ALTER COLUMN, no data change. GRANT/REVOKE unchanged (still TO
--   authenticated, service_role — never anon).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (v_start := COALESCE(p_start, (v_end - 29));, no
--   earliest-call lookup) via another CREATE OR REPLACE FUNCTION
--   public.get_call_volume — the exact prior body is in git history at this
--   file's prior commit (20260721_crm_call_volume_uses_answered_field.sql).
--   NOTE: rolling back alone does not fix the frontend bug this migration
--   addresses — CrmOverview.jsx's ALL_TIME_FLOOR frontend hack must also be
--   reverted in the same rollback, or "All time" calls will show 0 again.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_call_volume(
  p_start date DEFAULT NULL::date,
  p_end   date DEFAULT NULL::date,
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org        uuid;
  v_start      date;
  v_end        date;
  v_earliest   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, public.mt_today());

  -- When no explicit start is given, use the org's REAL earliest call as the
  -- floor — never a guessed distant date. A guessed floor forces
  -- generate_series() to produce one row per day across the gap, which can
  -- blow past PostgREST's default 1000-row response cap and silently
  -- truncate the result to years with no data at all (the bug this fixes).
  IF p_start IS NULL THEN
    SELECT MIN(COALESCE(il.occurred_at, il.created_at))::date INTO v_earliest
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false;
  END IF;
  v_start := COALESCE(p_start, v_earliest, (v_end - 29));

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_start::timestamptz, v_end::timestamptz, interval '1 day') AS d
  ),
  calls AS (
    SELECT date_trunc('day', COALESCE(il.occurred_at, il.created_at)) AS d,
           COUNT(*) AS total,
           COUNT(*) FILTER (
             WHERE CASE
               WHEN il.raw_payload ? 'answered' THEN (il.raw_payload->>'answered')::boolean
               ELSE COALESCE(il.duration_sec, 0) > 0
             END
           ) AS answered,
           COUNT(*) FILTER (
             WHERE NOT CASE
               WHEN il.raw_payload ? 'answered' THEN (il.raw_payload->>'answered')::boolean
               ELSE COALESCE(il.duration_sec, 0) > 0
             END
           ) AS missed
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

-- Managed-Supabase re-applies EXECUTE TO PUBLIC on every function replace
-- (database-standard.md §1) — re-assert least-privilege explicitly.
REVOKE EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_volume(date, date, uuid) TO authenticated, service_role;
