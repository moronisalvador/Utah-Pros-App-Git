-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_call_volume_uses_answered_field
-- Phase: n/a (standalone production fix — CRM Overview dashboard-gap follow-up)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Fixes get_call_volume's answered-vs-missed split. It used to guess "missed"
--   from talk time (duration_sec = 0), but CallRail already tells us directly
--   whether IT considers a call answered (raw_payload->>'answered') — and the
--   two disagree in real data: a call can ring, drop to voicemail with a few
--   seconds of greeting, and still be a miss. Live check on 2026-07-21: the
--   duration proxy found 1 missed call out of 67; CallRail's own field says 20.
--   This switches the split to CallRail's field, with a safe fallback to the
--   old duration proxy for any older row that never recorded the field.
--
-- ADDITIVE-ONLY / attribute-only:
--   Function-body-only CREATE OR REPLACE. Signature UNCHANGED
--   (p_start date, p_end date, p_org_id uuid) → SETOF json; return shape
--   UNCHANGED (period, period_start, total, answered, missed) — every existing
--   caller (CrmReports.jsx, CrmOverview.jsx) keeps working with no code change.
--   No table DROP/RENAME/ALTER COLUMN, no data change. GRANT/REVOKE unchanged
--   (still TO authenticated, service_role — never anon).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (duration_sec-based split) via another
--   CREATE OR REPLACE FUNCTION public.get_call_volume with the WHERE/COUNT
--   FILTER clauses reverted to:
--     COUNT(*) FILTER (WHERE COALESCE(il.duration_sec, 0) > 0)  AS answered
--     COUNT(*) FILTER (WHERE COALESCE(il.duration_sec, 0) = 0)  AS missed
--   (the exact body live before this migration, preserved in git history at
--   this file's prior commit / the original 20260702_crm_phase9_intelligence_rpcs.sql).
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
           -- CallRail's own disposition is the source of truth: a call can have
           -- real talk time (voicemail, brief greeting) and still be a miss.
           -- Fall back to the old duration_sec proxy only for a row that never
           -- recorded the field (older/backfilled data), so nothing regresses
           -- to NULL.
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
