-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_speed_to_lead_human_moves_only
-- Phase: n/a (standalone CRM fix — follow-up the auto-stage migration made
--        necessary, caught by same-day self-review)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Keeps the "Speed to lead" metric honest now that the system moves cards
--   by itself. Speed-to-lead answers "how fast did a PERSON respond to a new
--   lead" — it measures the gap between a lead arriving and its first
--   pipeline move. But 20260722_crm_auto_stage_missed_calls now auto-stages
--   every missed call within seconds (moved_by NULL = system), and the AI
--   transcript pass also auto-advances leads (also moved_by NULL). Those
--   machine moves are not responses — without this fix, every missed call
--   would register a fake near-instant "response" and quietly inflate the
--   SLA. Verified live before this fix: 7 of 88 speed samples already had a
--   system move as their first move (4 added by the auto-stage backfill the
--   same day).
--
--   Fix: get_speed_to_lead now considers only HUMAN moves
--   (moved_by IS NOT NULL) when finding a lead's first response. A lead
--   that has only ever been machine-moved simply contributes no sample yet —
--   it starts contributing the moment a person actually touches it.
--
-- ADDITIVE-ONLY:
--   Function-body-only CREATE OR REPLACE of get_speed_to_lead — signature
--   byte-for-byte unchanged (frozen per db-foundation P6 / CRM Phase 9). One
--   added predicate in the first_move CTE. No table/column/policy change,
--   no data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body: delete the `AND lsh.moved_by IS NOT NULL` line
--   from the first_move CTE — everything else is unchanged.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_speed_to_lead(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_since timestamptz;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_since := (SELECT MIN(moved_at) FROM lead_stage_history WHERE org_id = v_org);

  RETURN QUERY
  WITH first_move AS (
    SELECT lsh.lead_id, MIN(lsh.moved_at) AS first_moved_at
    FROM lead_stage_history lsh
    WHERE lsh.org_id = v_org
      -- Human moves only: system automation (missed-call auto-stage, AI
      -- auto-advance) writes moved_by NULL and is not a "response".
      AND lsh.moved_by IS NOT NULL
    GROUP BY lsh.lead_id
  ),
  gaps AS (
    SELECT EXTRACT(EPOCH FROM (fm.first_moved_at - COALESCE(il.occurred_at, il.created_at))) / 60.0 AS mins
    FROM first_move fm
    JOIN inbound_leads il ON il.id = fm.lead_id
    WHERE COALESCE(il.spam_flag, false) = false
      AND (p_start IS NULL OR fm.first_moved_at >= p_start::timestamptz)
      AND (p_end   IS NULL OR fm.first_moved_at <  (p_end + 1)::timestamptz)
  ),
  binned AS (
    SELECT CASE
      WHEN GREATEST(mins, 0) <= 5 THEN 1
      WHEN mins <= 30            THEN 2
      WHEN mins <= 60            THEN 3
      WHEN mins <= 240           THEN 4
      WHEN mins <= 1440          THEN 5
      ELSE 6
    END AS b
    FROM gaps
  ),
  counts AS (SELECT b, COUNT(*) AS c FROM binned GROUP BY b),
  defs(sort_order, label, within_sla) AS (
    VALUES (1, '≤5 min', true), (2, '5–30 min', false), (3, '30–60 min', false),
           (4, '1–4 hr', false), (5, '4–24 hr', false), (6, '>24 hr', false)
  )
  SELECT json_build_object(
    'bucket',     defs.label,
    'sort_order', defs.sort_order,
    'within_sla', defs.within_sla,
    'count',      COALESCE(counts.c, 0),
    'data_since', v_since
  )
  FROM defs
  LEFT JOIN counts ON counts.b = defs.sort_order
  ORDER BY defs.sort_order;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_speed_to_lead(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_speed_to_lead(date, date, uuid) TO authenticated, service_role;
