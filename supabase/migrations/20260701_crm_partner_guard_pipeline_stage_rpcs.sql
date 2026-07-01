-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Partner — block pipeline-stage config writes at the RPC layer
--
-- upsert_pipeline_stage() and delete_pipeline_stage() are SECURITY DEFINER,
-- so the pipeline_stages RLS write-block added in
-- 20260701_crm_partner_rls_internal_crm.sql doesn't actually stop these RPCs
-- (SECURITY DEFINER runs as the function owner, bypassing the caller's RLS).
-- Add the same is_crm_partner() guard directly inside each function so a
-- partner can't rename/reorder/delete pipeline stages used by all of
-- internal staff, even by calling the RPC directly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_pipeline_stage(
  p_id          uuid DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_color       text DEFAULT '#6366f1',
  p_sort_order  int DEFAULT NULL,
  p_is_won      boolean DEFAULT false,
  p_is_lost     boolean DEFAULT false,
  p_org_id      uuid DEFAULT NULL
)
RETURNS pipeline_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row    pipeline_stages;
BEGIN
  IF is_crm_partner(auth.uid()) THEN
    RAISE EXCEPTION 'pipeline stage configuration is admin/staff-only';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'pipeline stage name is required';
  END IF;
  IF p_is_won AND p_is_lost THEN
    RAISE EXCEPTION 'a pipeline stage cannot be both is_won and is_lost';
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  IF p_id IS NULL THEN
    INSERT INTO pipeline_stages (org_id, name, color, sort_order, is_won, is_lost)
    VALUES (
      v_org_id, btrim(p_name), COALESCE(p_color, '#6366f1'),
      COALESCE(p_sort_order, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pipeline_stages WHERE org_id = v_org_id)),
      p_is_won, p_is_lost
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE pipeline_stages
       SET name       = btrim(p_name),
           color      = COALESCE(p_color, color),
           sort_order = COALESCE(p_sort_order, sort_order),
           is_won     = p_is_won,
           is_lost    = p_is_lost,
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown pipeline_stages id: %', p_id;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION delete_pipeline_stage(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF is_crm_partner(auth.uid()) THEN
    RAISE EXCEPTION 'pipeline stage configuration is admin/staff-only';
  END IF;
  IF EXISTS (SELECT 1 FROM lead_pipeline_stage WHERE stage_id = p_stage_id) THEN
    RAISE EXCEPTION 'cannot delete a pipeline stage with leads on it — move them first';
  END IF;

  DELETE FROM pipeline_stages WHERE id = p_stage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown pipeline_stages id: %', p_stage_id;
  END IF;
END;
$$;
