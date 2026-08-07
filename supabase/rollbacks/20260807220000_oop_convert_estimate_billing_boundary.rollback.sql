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
--   Puts the quote-to-estimate routine back exactly as it was before the
--   migration ran, including the old permission check that only let admins
--   through. Nothing else about how a quote becomes an estimate changes.
--
-- WHEN TO RUN:
--   Only if widening conversion to billing editors turns out to be wrong. If
--   instead the ROLE LIST is wrong, do NOT run this — change
--   public.billing_edit_access() itself, which is the single predicate behind
--   every billing surface, and this function follows automatically.
--
-- SAFETY:
--   No data is written or altered in either direction; this only replaces one
--   function body. The body below is the exact applied 20260803192344 text
--   (md5 c8cb9551c48ea8d3e22e35985945645f), reproduced mechanically from that file
--   rather than retyped (database-standard.md §5 — a retyped payload is not
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
    RAISE EXCEPTION 'convert_oop_quote_to_estimate(uuid) is absent; apply 20260803192344_oop_quote_to_estimate first'
      USING ERRCODE = '55000';
  END IF;

  IF v_src LIKE '%NOT IN ('admin','manager')%' THEN
    RAISE EXCEPTION 'This rollback is already applied (live body already carries NOT IN ('admin','manager')); nothing to do'
      USING ERRCODE = '55000';
  END IF;

  IF v_src NOT LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'live body does not carry the expected predecessor gate; refusing to replace it'
      USING ERRCODE = '55000';
  END IF;

  v_md5 := md5(v_src);
  IF v_md5 <> '1eec6a8e1065ec7d069af8c349045edb' THEN
    RAISE EXCEPTION 'DRIFT: convert_oop_quote_to_estimate body is % , expected % . Another migration replaced this function (most likely 20260807190000_oop_estimate_grouped_lines, which rewrites this same body). Replacing it now would silently revert that change. Reconcile the two bodies deliberately, then re-pin this guard.', v_md5, '1eec6a8e1065ec7d069af8c349045edb'
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
  v_formula text;
  v_description text;
  v_unit text;
  v_quantity numeric;
  v_unit_price numeric;
  v_amount numeric;
  v_days numeric;
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
      v_item := NULL;
      v_formula := 'fixed';
      v_description := 'Project minimum adjustment';
      v_unit := NULL;
      v_quantity := 1;
      v_unit_price := v_amount;
    ELSE
      SELECT item.value
        INTO v_item
        FROM jsonb_array_elements(v_snapshot.pricing_config_snapshot->'items') item(value)
       WHERE item.value->>'key' = v_line->>'key'
       LIMIT 1;
      IF v_item IS NULL THEN RAISE EXCEPTION 'oop_quote_snapshot_item_missing'; END IF;

      v_formula := v_item->>'formula';
      v_description := v_item->>'label';
      v_unit := NULLIF(v_item->>'unit', '');
      v_quantity := COALESCE((v_line->>'quantity')::numeric, 0);
      v_unit_price := COALESCE((v_line->>'rate')::numeric, 0);

      IF v_formula = 'duration' THEN
        v_days := COALESCE((v_line->>'days')::numeric, 0);
        v_description := format('%s (%s units × %s days)', v_description, v_quantity, v_days);
        v_quantity := v_quantity * v_days;
      END IF;

      -- Minimum charges, percentages, fixed fees, and cost-plus math do not
      -- always equal quantity × displayed rate. Flatten only those lines so the
      -- official estimate retains the exact canonical customer amount.
      IF v_quantity <= 0
        OR round(v_quantity * v_unit_price, 2) <> v_amount THEN
        v_quantity := 1;
        v_unit := NULL;
        v_unit_price := v_amount;
      END IF;
    END IF;

    INSERT INTO public.estimate_line_items (
      estimate_id, description, quantity, unit, unit_price, sort_order
    ) VALUES (
      v_estimate.id, v_description, v_quantity, v_unit, v_unit_price,
      COALESCE((v_line->>'sortOrder')::integer, 2147483647)
    );
    v_inserted := v_inserted + 1;
  END LOOP;

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
  IF md5(v_src) <> 'c8cb9551c48ea8d3e22e35985945645f' THEN
    RAISE EXCEPTION 'rollback postcondition: body is % , expected the pre-migration %', md5(v_src), 'c8cb9551c48ea8d3e22e35985945645f';
  END IF;
END;
$post$;
