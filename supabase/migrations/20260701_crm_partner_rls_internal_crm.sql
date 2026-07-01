-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Partner — lock internal-only CRM surfaces
--
-- Two CRM tables stay internal-only even though the rest of `/crm/*` is
-- readable by a `crm_partner`:
--   - crm_build_phases / crm_build_stages: the roadmap build-progress tracker
--     (`/crm/roadmap`) — not something an outside partner should see.
--   - pipeline_stages: shared pipeline config used by every internal role;
--     a partner can read it (needed to render the Leads Kanban) but must not
--     write it (renaming/reordering stages affects all of internal staff).
--
-- Also guards get_crm_revenue_by_division() — a SECURITY DEFINER report RPC
-- that returns real invoiced revenue by division, which a marketing partner
-- should not see (aggregate spend/lead/attribution numbers are fine; won-
-- dollar revenue is not). Returns no rows for a crm_partner caller instead of
-- erroring, since the frontend simply won't render that section for them.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "crm_build_phases_all" ON crm_build_phases;
CREATE POLICY "crm_build_phases_all" ON crm_build_phases
  FOR ALL TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "crm_build_stages_all" ON crm_build_stages;
CREATE POLICY "crm_build_stages_all" ON crm_build_stages
  FOR ALL TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "pipeline_stages_all" ON pipeline_stages;

CREATE POLICY "pipeline_stages_select" ON pipeline_stages
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "pipeline_stages_write" ON pipeline_stages
  FOR INSERT TO anon, authenticated
  WITH CHECK (NOT is_crm_partner(auth.uid()));

CREATE POLICY "pipeline_stages_update" ON pipeline_stages
  FOR UPDATE TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

CREATE POLICY "pipeline_stages_delete" ON pipeline_stages
  FOR DELETE TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()));

CREATE OR REPLACE FUNCTION get_crm_revenue_by_division(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL
)
RETURNS TABLE (
  division  text,
  won_jobs  bigint,
  revenue   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.division::text,
         COUNT(*)::bigint,
         COALESCE(SUM(j.invoiced_value), 0)::numeric
  FROM jobs j
  WHERE j.phase <> 'lead' AND j.status <> 'deleted'
    AND NOT is_crm_partner(auth.uid())
    AND (p_start_date IS NULL OR j.created_at >= p_start_date::timestamptz)
    AND (p_end_date   IS NULL OR j.created_at <  (p_end_date + 1)::timestamptz)
  GROUP BY j.division
  ORDER BY 3 DESC;
$$;
