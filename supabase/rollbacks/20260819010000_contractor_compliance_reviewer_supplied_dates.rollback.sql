-- ════════════════════════════════════════════════
-- ROLLBACK: 20260819010000_contractor_compliance_reviewer_supplied_dates
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the contractor document rules back exactly as they were: coverage dates
--   become required again the moment a document arrives, and the reviewer loses
--   the ability to type them in. Contractors go back to entering their own dates
--   before they can send anything.
--
-- ⚠ THIS RE-TIGHTENS A CONSTRAINT AND CAN FAIL — ON PURPOSE:
--   If any non-W-9 document was received with no coverage dates while the
--   forward migration was live, ADD CONSTRAINT below will refuse to validate and
--   this rollback aborts, changing nothing. That is the correct behaviour: the
--   alternative is deleting a subcontractor's certificate to satisfy a
--   constraint. Resolve those rows first — have a reviewer date them, or reject
--   them — then re-run. To find them:
--
--     SELECT id, profile_id, document_type, review_state, original_filename
--       FROM public.contractor_compliance_documents
--      WHERE document_type <> 'w9'
--        AND (coverage_start_date IS NULL OR coverage_end_date IS NULL);
--
-- ════════════════════════════════════════════════

-- NOTE: no top-level BEGIN/COMMIT — an operator-run rollback may own an explicit
-- transaction when its runbook says so; this one is run through the same
-- executor as the forward file (database-standard.md §5).

-- ─── 1. Restore the original date constraint, verbatim ──────────────
ALTER TABLE public.contractor_compliance_documents
  DROP CONSTRAINT contractor_compliance_documents_date_check;

ALTER TABLE public.contractor_compliance_documents
  ADD CONSTRAINT contractor_compliance_documents_date_check CHECK (
    (
      (document_type = 'w9'::text)
      AND ((tax_year >= 2000) AND (tax_year <= 2200))
      AND (coverage_start_date IS NULL)
      AND (coverage_end_date IS NULL)
    )
    OR (
      (document_type <> 'w9'::text)
      AND (tax_year IS NULL)
      AND (coverage_start_date IS NOT NULL)
      AND (coverage_end_date IS NOT NULL)
      AND (coverage_end_date >= coverage_start_date)
    )
  );

-- ─── 2. Restore the original 4-argument function body, verbatim ──────────────
CREATE OR REPLACE FUNCTION public.contractor_compliance_review_document(p_actor_employee_id uuid, p_document_id uuid, p_review_state text, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_profile uuid; v_type text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE AND e.role::text IN ('admin','office')) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: contractor compliance manager required' USING errcode='42501'; END IF;
  IF p_review_state NOT IN ('accepted','rejected') OR (p_review_state='rejected' AND NULLIF(btrim(p_rejection_reason),'') IS NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: accepted or reasoned rejection required' USING errcode='22023';
  END IF;
  UPDATE public.contractor_compliance_documents
  SET review_state=p_review_state,verified_by=p_actor_employee_id,verified_at=now(),
      rejection_reason=CASE WHEN p_review_state='rejected' THEN NULLIF(btrim(p_rejection_reason),'') ELSE NULL END
  WHERE id=p_document_id AND review_state='pending_review'
  RETURNING profile_id,document_type INTO v_profile,v_type;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: reviewable document not found' USING errcode='P0002'; END IF;
  INSERT INTO public.contractor_compliance_activity(profile_id,document_id,actor_employee_id,event_type) VALUES(v_profile,p_document_id,p_actor_employee_id,'document_' || p_review_state);
  IF p_review_state='accepted' THEN
    UPDATE public.contractor_compliance_documents
    SET review_state='superseded',superseded_at=now(),superseded_by_document_id=p_document_id
    WHERE profile_id=v_profile AND document_type=v_type AND id<>p_document_id AND review_state='accepted';
    UPDATE public.contractor_compliance_requests r SET completed_at=now(),updated_at=now()
    WHERE r.profile_id=v_profile AND r.completed_at IS NULL AND r.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM unnest(r.requested_document_types) typ WHERE
        (typ='w9' AND NOT EXISTS (SELECT 1 FROM public.contractor_compliance_documents d WHERE d.profile_id=v_profile AND d.document_type='w9' AND d.review_state IN ('accepted','superseded') AND d.tax_year=(SELECT required_w9_year FROM public.contractor_compliance_profiles WHERE id=v_profile)))
        OR (typ='general_liability' AND COALESCE(public.contractor_compliance_continuous_coverage_end(v_profile,ARRAY['general_liability'],(now() AT TIME ZONE 'America/Denver')::date),'0001-01-01'::date)
              <= COALESCE(NULLIF(substring(r.request_identity FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$'), '')::date,(now() AT TIME ZONE 'America/Denver')::date))
        OR (typ IN ('workers_comp','workers_comp_waiver') AND COALESCE(public.contractor_compliance_continuous_coverage_end(v_profile,ARRAY['workers_comp','workers_comp_waiver'],(now() AT TIME ZONE 'America/Denver')::date),'0001-01-01'::date)
              <= COALESCE(NULLIF(substring(r.request_identity FROM '([0-9]{4}-[0-9]{2}-[0-9]{2})$'), '')::date,(now() AT TIME ZONE 'America/Denver')::date))
      );
  END IF;
  RETURN jsonb_build_object('id',p_document_id,'review_state',p_review_state);
END; $function$;

-- Restore the FOUNDATION's posture exactly (20260803090000 L779-780): this
-- definer trusts a caller-supplied actor id, so it is service_role-only. A
-- rollback that left `authenticated` holding EXECUTE would undo the feature
-- while keeping a privilege the original never granted — that is not an undo.
REVOKE EXECUTE ON FUNCTION public.contractor_compliance_review_document(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_compliance_review_document(uuid, uuid, text, text) TO service_role;

-- ─── 3. Remove the 6-argument overload ──────────────
-- Dropped last so nothing can call the widened signature after the constraint
-- has already been re-tightened.
DROP FUNCTION IF EXISTS public.contractor_compliance_review_document(uuid, uuid, text, text, date, date);
