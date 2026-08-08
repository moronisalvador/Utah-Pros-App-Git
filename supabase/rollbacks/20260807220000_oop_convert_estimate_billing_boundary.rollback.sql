-- ════════════════════════════════════════════════
-- ROLLBACK: 20260807220000_oop_convert_estimate_billing_boundary
-- ════════════════════════════════════════════════
--
-- ⚠️  READ THIS BEFORE RUNNING IT
--     This RE-BREAKS a live surface on purpose. After this runs, office and
--     project_manager users still SEE an enabled "Create estimate" button in the
--     OOP calculator (src/components/oop/ConfiguredOopPricingCalculator.jsx
--     gates it on canEditBilling) and get SQLSTATE 42501 when they press it.
--     That mismatch is exactly the defect the migration closed.
--     Prefer rolling FORWARD. See WHEN TO RUN below.
--
-- WHAT THIS DOES (plain language):
--   Puts the quote-to-estimate routine back to the version that came with the
--   grouped-lines change, including the old permission check that only let
--   admins through. The two-line customer output is NOT undone — customers still
--   see a tidy estimate; only who may create one changes back.
--
-- WHEN TO RUN:
--   Only if widening conversion to billing editors turns out to be wrong. If
--   instead the ROLE LIST is wrong, do NOT run this — change
--   public.billing_edit_access() itself, which is the single predicate behind
--   every billing surface, and this function follows automatically.
--
-- SAFETY:
--   No data is written or altered in either direction; this only replaces one
--   function body. The body below is the exact 20260807210000 grouped-lines text
--   (md5 bbf68c740b6172dde55dd0bc2197bac3), reproduced mechanically from that
--   file rather than retyped (database-standard.md §5 — a retyped payload is not
--   reviewed source). Grants are restored identically: authenticated only.
-- ════════════════════════════════════════════════

-- Refuse unless the migration this undoes is actually the live body.

DO $guard$
DECLARE
  v_src text;
  v_md5 text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'convert_oop_quote_to_estimate'
     AND pg_get_function_identity_arguments(p.oid) = 'p_quote_id uuid';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'convert_oop_quote_to_estimate(uuid) is absent; apply its predecessors first'
      USING ERRCODE = '55000';
  END IF;

  IF v_src LIKE '%NOT IN (''admin'',''manager'')%' THEN
    RAISE EXCEPTION 'This rollback is already applied (live body already carries NOT IN (''admin'',''manager'')); nothing to do'
      USING ERRCODE = '55000';
  END IF;

  IF v_src NOT LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'live body does not carry the expected predecessor gate; refusing to replace it'
      USING ERRCODE = '55000';
  END IF;

  v_md5 := md5(v_src);
  IF v_md5 <> 'eee648e41503edfd018afd2f8b08f0be' THEN
    RAISE EXCEPTION 'DRIFT: convert_oop_quote_to_estimate body is % , expected % . This migration is built on the body left by 20260807210000_oop_estimate_grouped_lines; apply that FIRST, and if it has itself changed, rebuild this body on the new one and re-pin this guard. Replacing an unexpected body would silently revert whatever is actually there.', v_md5, 'eee648e41503edfd018afd2f8b08f0be'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
  v_role text;
  v_quote public.oop_quotes;
  v_job public.jobs;
  v_snapshot public.oop_quote_pricing_snapshots;
  v_estimate public.estimates;
  v_line jsonb;
  v_item jsonb;
  v_section text;
  v_amount numeric;
  v_service_total numeric := 0;
  v_equipment_total numeric := 0;
  v_equipment_labels text[] := ARRAY[]::text[];
  v_label text;
  v_service_description text;
  v_equipment_description text;
  v_qbo_item_id text;
  v_qbo_item_name text;
  v_inserted integer := 0;
  v_total numeric;
BEGIN
  v_actor := public.oop_pricing_active_employee(false);

  SELECT e.role::text
    INTO v_role
    FROM public.employees e
   WHERE e.id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin','manager') THEN
    RAISE EXCEPTION 'not_authorized: billing role required' USING ERRCODE = '42501';
  END IF;

  SELECT q.*
    INTO v_quote
    FROM public.oop_quotes q
   WHERE q.id = p_quote_id
   FOR UPDATE;
  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'oop_quote_not_found'; END IF;

  IF v_quote.converted_estimate_id IS NOT NULL THEN
    SELECT e.* INTO v_estimate
      FROM public.estimates e
     WHERE e.id = v_quote.converted_estimate_id;
    IF v_estimate.id IS NULL THEN RAISE EXCEPTION 'oop_quote_estimate_link_broken'; END IF;
    RETURN jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',false);
  END IF;

  IF v_quote.job_id IS NULL THEN RAISE EXCEPTION 'oop_quote_job_required'; END IF;
  IF COALESCE(v_quote.quote_total, 0) <= 0 THEN RAISE EXCEPTION 'oop_quote_positive_total_required'; END IF;

  SELECT j.*
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_quote.job_id
   FOR SHARE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'oop_quote_job_not_found'; END IF;
  IF v_job.primary_contact_id IS NULL THEN RAISE EXCEPTION 'oop_quote_job_contact_required'; END IF;

  SELECT s.*
    INTO v_snapshot
    FROM public.oop_quote_pricing_snapshots s
   WHERE s.quote_id = v_quote.id
     AND s.cleared_at IS NULL;
  IF v_snapshot.quote_id IS NULL
    OR jsonb_typeof(v_snapshot.pricing_evaluated_lines) <> 'array'
    OR jsonb_typeof(v_snapshot.pricing_config_snapshot->'items') <> 'array' THEN
    RAISE EXCEPTION 'oop_quote_snapshot_required';
  END IF;

  INSERT INTO public.estimates (
    job_id, contact_id, estimate_number, estimate_type, notes, created_by,
    intended_division, property_address, property_city, property_state, property_zip
  ) VALUES (
    v_job.id, v_job.primary_contact_id, public.generate_estimate_number(), 'initial',
    NULLIF(btrim(v_quote.notes), ''), v_actor, v_quote.job_type,
    v_job.address, v_job.city, v_job.state, v_job.zip
  ) RETURNING * INTO v_estimate;

  -- Roll the priced items into two customer-facing buckets instead of copying the
  -- internal breakdown onto the document. The bucket is the price list's own
  -- `section`, so a new equipment item added in the pricing builder lands in the
  -- equipment bucket without touching this function.
  FOR v_line IN
    SELECT value
      FROM jsonb_array_elements(v_snapshot.pricing_evaluated_lines)
     ORDER BY COALESCE((value->>'sortOrder')::integer, 2147483647), value->>'key'
  LOOP
    v_amount := round(COALESCE((v_line->>'amount')::numeric, 0), 2);
    IF NOT COALESCE((v_line->>'customerVisible')::boolean,false) OR v_amount <= 0 THEN
      CONTINUE;
    END IF;

    IF v_line->>'key' = 'project_minimum_adjustment' THEN
      -- Not a priced item; it tops the job up to the project minimum, so it
      -- belongs with the service rather than with equipment.
      v_service_total := v_service_total + v_amount;
      CONTINUE;
    END IF;

    SELECT item.value
      INTO v_item
      FROM jsonb_array_elements(v_snapshot.pricing_config_snapshot->'items') item(value)
     WHERE item.value->>'key' = v_line->>'key'
     LIMIT 1;
    IF v_item IS NULL THEN RAISE EXCEPTION 'oop_quote_snapshot_item_missing'; END IF;

    v_section := lower(btrim(COALESCE(v_item->>'section', '')));
    IF v_section = 'equipment' THEN
      v_equipment_total := v_equipment_total + v_amount;
      v_label := btrim(COALESCE(v_item->>'label', ''));
      IF v_label <> '' AND NOT (v_label = ANY (v_equipment_labels)) THEN
        v_equipment_labels := v_equipment_labels || v_label;
      END IF;
    ELSE
      v_service_total := v_service_total + v_amount;
    END IF;
  END LOOP;

  -- Standard scope of work. Staff can edit either description afterwards in the
  -- estimate editor; this is the starting text, not a frozen contract.
  IF v_quote.job_type = 'mold' THEN
    v_service_description :=
      'Mold remediation. Containment of the affected area under negative air pressure, '
      || 'removal and disposal of mold-affected materials, HEPA vacuuming and detail cleaning '
      || 'of the remaining structure, antimicrobial application, and post-remediation drying '
      || 'to industry standard. Includes technician labor, personal protective equipment, and '
      || 'haul-off and disposal of debris.';
    v_qbo_item_id := '1010000131';
    v_qbo_item_name := 'Mold Remediation Services';
  ELSE
    v_service_description :=
      'Water damage mitigation and structural drying. Emergency response and stabilization of '
      || 'the affected area: containment of the work zone, demolition and removal of '
      || 'unsalvageable materials, cleaning and detail cleaning of affected surfaces, '
      || 'antimicrobial application to the remaining structure, and structural drying to '
      || 'industry standard. Includes technician labor, personal protective equipment, and '
      || 'haul-off and disposal of debris.';
    v_qbo_item_id := '1010000071';
    v_qbo_item_name := 'Water Damage Mitigation And Drying';
  END IF;

  -- QuickBooks Item/Class defaults. These mirror divisionToQbo() in
  -- functions/lib/quickbooks.js, which is the fallback the estimate Worker still
  -- applies to any line that arrives without them; the two lists are pinned
  -- together by tests/qa/unit/oop-estimate-grouped-lines.test.js. Class 1000000005
  -- is "Mitigation" — the only non-Reconstruction class in the realm, and the one
  -- both water and mold work belongs to.
  IF v_service_total > 0 THEN
    INSERT INTO public.estimate_line_items (
      estimate_id, description, quantity, unit, unit_price, sort_order,
      qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name
    ) VALUES (
      v_estimate.id, v_service_description, 1, NULL, v_service_total, 0,
      v_qbo_item_id, v_qbo_item_name, '1000000005', 'Mitigation'
    );
    v_inserted := v_inserted + 1;
  END IF;

  IF v_equipment_total > 0 THEN
    v_equipment_description :=
      'Equipment. Drying and air-quality equipment placed, monitored and removed over the '
      || 'course of the project'
      || CASE
           WHEN array_length(v_equipment_labels, 1) > 0
             THEN ': ' || array_to_string(v_equipment_labels, ', ')
           ELSE ''
         END
      || '.';
    INSERT INTO public.estimate_line_items (
      estimate_id, description, quantity, unit, unit_price, sort_order,
      qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name
    ) VALUES (
      v_estimate.id, v_equipment_description, 1, NULL, v_equipment_total, 1,
      v_qbo_item_id, v_qbo_item_name, '1000000005', 'Mitigation'
    );
    v_inserted := v_inserted + 1;
  END IF;

  IF v_inserted = 0 THEN RAISE EXCEPTION 'oop_quote_customer_lines_required'; END IF;

  SELECT round(COALESCE(sum(li.line_total), 0), 2)
    INTO v_total
    FROM public.estimate_line_items li
   WHERE li.estimate_id = v_estimate.id;
  IF v_total <> round(v_quote.quote_total, 2) THEN
    RAISE EXCEPTION 'oop_quote_estimate_total_mismatch';
  END IF;

  -- This metadata-only transition must not run the legacy canonical recompute or
  -- clear the private v2 snapshot. A distinct marker also prevents a direct
  -- browser UPDATE from manufacturing the provenance link.
  PERFORM set_config('oop_pricing.estimate_conversion', 'on', true);
  PERFORM set_config('oop_pricing.v2_write', 'on', true);
  UPDATE public.oop_quotes
     SET converted_estimate_id = v_estimate.id
   WHERE id = v_quote.id;
  PERFORM set_config('oop_pricing.v2_write', 'off', true);
  PERFORM set_config('oop_pricing.estimate_conversion', 'off', true);

  RETURN jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid) TO authenticated;

DO $post$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'convert_oop_quote_to_estimate';
  IF md5(v_src) <> 'bbf68c740b6172dde55dd0bc2197bac3' THEN
    RAISE EXCEPTION 'rollback postcondition: body is % , expected the grouped-lines %', md5(v_src), 'bbf68c740b6172dde55dd0bc2197bac3';
  END IF;
  IF v_src NOT LIKE '%1000000005%' THEN
    RAISE EXCEPTION 'rollback postcondition: the grouped-lines work was not preserved';
  END IF;
END;
$post$;
