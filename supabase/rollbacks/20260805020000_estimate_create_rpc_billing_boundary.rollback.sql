-- ════════════════════════════════════════════════
-- ROLLBACK: 20260805020000_estimate_create_rpc_billing_boundary
-- ════════════════════════════════════════════════
--
-- ⚠️  READ THIS BEFORE RUNNING IT
--     This RE-OPENS a known authorization hole. After this runs, EVERY
--     authenticated employee — field_tech, estimator, supervisor, crm_partner —
--     can create draft estimate rows again by calling the RPC directly, because
--     these two functions are SECURITY DEFINER and therefore bypass the
--     oop_estimates_billing_write policy on public.estimates.
--     Exposure is draft rows, not money: estimate_line_items writes still go
--     through RLS and save_estimate_lines is revoked from `authenticated`.
--     Prefer rolling FORWARD. See WHEN TO RUN below for the cheaper fix.
--
-- WHAT THIS DOES (plain language):
--   Puts the two estimate-creating routines back exactly as they were before the
--   migration ran — including the missing permission check. After running this,
--   any signed-in employee can once again create blank draft estimates, which is
--   the defect the migration closed. Prefer fixing forward.
--
-- WHEN TO RUN:
--   Only if the added caller check refuses someone it should not. The far
--   cheaper first move is to widen public.billing_edit_access() itself (one
--   predicate, already the single source of truth for every billing write) —
--   that fixes every billing surface at once and needs no change here.
--
-- SAFETY:
--   No data is written or altered in either direction; both files only replace
--   function bodies. The bodies below are the exact live definitions captured
--   read-only from pg_get_functiondef() on 2026-08-05 before the migration was
--   authored, with the authorization block removed and nothing else changed.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_estimate_for_contact(
  p_contact_id        uuid,
  p_intended_division text DEFAULT 'water',
  p_estimate_type     text DEFAULT 'initial',
  p_property_address  text DEFAULT NULL,
  p_property_city     text DEFAULT NULL,
  p_property_state    text DEFAULT NULL,
  p_property_zip      text DEFAULT NULL,
  p_created_by        uuid DEFAULT NULL
)
RETURNS estimates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row estimates;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'Contact % not found', p_contact_id;
  END IF;
  INSERT INTO estimates (contact_id, estimate_number, estimate_type, status, amount, subtotal,
                         intended_division, property_address, property_city, property_state, property_zip, created_by)
  VALUES (p_contact_id, generate_estimate_number(), COALESCE(p_estimate_type, 'initial'), 'draft', 0, 0,
          COALESCE(p_intended_division, 'water'), p_property_address, p_property_city, p_property_state, p_property_zip, p_created_by)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_estimate_for_contact(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_estimate_for_contact(uuid, text, text, text, text, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_estimate_for_job(
  p_job_id        uuid,
  p_estimate_type text DEFAULT 'initial',
  p_created_by    uuid DEFAULT NULL
)
RETURNS estimates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row estimates;
BEGIN
  INSERT INTO estimates (job_id, contact_id, estimate_number, estimate_type, status, amount, subtotal, created_by)
  SELECT j.id, j.primary_contact_id, generate_estimate_number(),
         COALESCE(p_estimate_type, 'initial'), 'draft', 0, 0, p_created_by
  FROM jobs j WHERE j.id = p_job_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Job % not found', p_job_id; END IF;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_estimate_for_job(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_estimate_for_job(uuid, text, uuid) TO authenticated, service_role;
