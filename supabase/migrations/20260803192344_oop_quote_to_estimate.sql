-- ════════════════════════════════════════════════
-- MIGRATION: 20260803192344_oop_quote_to_estimate
-- Phase: n/a (standalone OOP pricing workflow)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets an authorized admin turn one saved OOP quote into one draft estimate
--   for the quote's job. Customer-facing quote lines are copied atomically; an
--   uncertain retry opens the same estimate instead of creating a duplicate.
--
-- ADDITIVE-ONLY:
--   Adds one nullable foreign-key column, one partial unique index, and narrow
--   conversion/correction functions. Existing estimate write policies are
--   tightened to the already-documented billing-editor boundary.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260803192344_oop_quote_to_estimate.rollback.sql.
--   It refuses once a quote has been converted so provenance is never erased.
-- ════════════════════════════════════════════════

ALTER TABLE public.oop_quotes
  ADD COLUMN IF NOT EXISTS converted_estimate_id uuid
  REFERENCES public.estimates(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS oop_quotes_converted_estimate_unique
  ON public.oop_quotes(converted_estimate_id)
  WHERE converted_estimate_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.billing_edit_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.employees e
     WHERE e.auth_user_id = auth.uid()
       AND e.is_active IS TRUE
       AND e.is_external IS FALSE
       AND e.role::text IN ('admin', 'manager')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.billing_edit_access()
  FROM PUBLIC, anon, authenticated, service_role;
-- Policy-only browser predicate. service_role bypasses these RLS policies and
-- deliberately does not receive a redundant direct helper capability.
GRANT EXECUTE ON FUNCTION public.billing_edit_access() TO authenticated;

-- Preserve broad internal reads while making direct money writes match the
-- existing canEditBilling/admin server boundary. The correction RPC below
-- repeats that authorization under its own SECURITY DEFINER boundary.
DROP POLICY IF EXISTS "allow_authenticated_estimates" ON public.estimates;
DROP POLICY IF EXISTS "oop_estimates_internal_read" ON public.estimates;
DROP POLICY IF EXISTS "oop_estimates_billing_write" ON public.estimates;
CREATE POLICY "oop_estimates_internal_read" ON public.estimates
  FOR SELECT TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()));
CREATE POLICY "oop_estimates_billing_write" ON public.estimates
  FOR ALL TO authenticated
  USING (public.billing_edit_access())
  WITH CHECK (public.billing_edit_access());

DROP POLICY IF EXISTS "allow_authenticated_estimate_line_items" ON public.estimate_line_items;
DROP POLICY IF EXISTS "oop_estimate_lines_internal_read" ON public.estimate_line_items;
DROP POLICY IF EXISTS "oop_estimate_lines_billing_write" ON public.estimate_line_items;
CREATE POLICY "oop_estimate_lines_internal_read" ON public.estimate_line_items
  FOR SELECT TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()));
CREATE POLICY "oop_estimate_lines_billing_write" ON public.estimate_line_items
  FOR ALL TO authenticated
  USING (public.billing_edit_access())
  WITH CHECK (public.billing_edit_access());

-- No deployed browser caller uses this legacy bulk-replace helper. Leaving its
-- unauthenticated SECURITY DEFINER body executable by every signed-in user would
-- bypass the narrowed line policy, so retain only the existing service capability.
REVOKE EXECUTE ON FUNCTION public.save_estimate_lines(uuid, jsonb, text)
  FROM authenticated;

CREATE OR REPLACE FUNCTION public.oop_prevent_converted_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.converted_estimate_id IS NOT NULL THEN
    RAISE EXCEPTION 'oop_quote_already_converted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.converted_estimate_id IS DISTINCT FROM OLD.converted_estimate_id
    AND current_setting('oop_pricing.estimate_conversion', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'oop_quote_conversion_rpc_required' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE'
    AND current_setting('oop_pricing.estimate_conversion', true) = 'on'
    AND (to_jsonb(NEW) - 'converted_estimate_id')
      IS DISTINCT FROM (to_jsonb(OLD) - 'converted_estimate_id') THEN
    RAISE EXCEPTION 'oop_quote_conversion_link_only' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.oop_prevent_converted_quote_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS oop_prevent_converted_quote_mutation ON public.oop_quotes;
CREATE TRIGGER oop_prevent_converted_quote_mutation
  BEFORE UPDATE OR DELETE ON public.oop_quotes
  FOR EACH ROW EXECUTE FUNCTION public.oop_prevent_converted_quote_mutation();

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
-- Browser-only by design: no Worker/provider path converts calculator quotes.
GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_oop_estimate(
  p_estimate_id uuid,
  p_expected_updated_at timestamptz,
  p_address jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
  v_role text;
  v_estimate public.estimates;
  v_line_count integer;
  v_existing_count integer;
  v_address text;
  v_city text;
  v_state text;
  v_zip text;
  v_total numeric;
  v_lines jsonb;
  v_matches boolean;
  v_updated_at timestamptz;
BEGIN
  v_actor := public.oop_pricing_active_employee(false);
  SELECT e.role::text
    INTO v_role
    FROM public.employees e
   WHERE e.id = v_actor;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'not_authorized: active internal admin required'
      USING ERRCODE = '42501';
  END IF;

  IF p_estimate_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'oop_estimate_correction_version_required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_address) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'oop_estimate_correction_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_address := NULLIF(btrim(p_address->>'property_address'), '');
  v_city := NULLIF(btrim(p_address->>'property_city'), '');
  v_state := NULLIF(btrim(p_address->>'property_state'), '');
  v_zip := NULLIF(btrim(p_address->>'property_zip'), '');
  IF length(COALESCE(v_address, '')) > 500
    OR length(COALESCE(v_city, '')) > 160
    OR length(COALESCE(v_state, '')) > 64
    OR length(COALESCE(v_zip, '')) > 32 THEN
    RAISE EXCEPTION 'oop_estimate_correction_address_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 1 OR v_line_count > 100 THEN
    RAISE EXCEPTION 'oop_estimate_correction_line_count_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_lines) elem
     WHERE jsonb_typeof(elem) IS DISTINCT FROM 'object'
        OR COALESCE(elem->>'id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        OR length(btrim(COALESCE(elem->>'description', ''))) NOT BETWEEN 1 AND 2000
        OR COALESCE(elem->>'quantity', '') !~ '^[0-9]+([.][0-9]+)?$'
        OR COALESCE(elem->>'unit_price', '') !~ '^[0-9]+([.][0-9]+)?$'
        OR COALESCE(elem->>'sort_order', '') !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'oop_estimate_correction_line_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(DISTINCT x.id)
      FROM jsonb_to_recordset(p_lines)
        AS x(id uuid, description text, quantity numeric, unit_price numeric, sort_order integer)
  ) <> v_line_count THEN
    RAISE EXCEPTION 'oop_estimate_correction_duplicate_line'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_lines)
        AS x(id uuid, description text, quantity numeric, unit_price numeric, sort_order integer)
     WHERE x.quantity <= 0
        OR x.quantity > 100000
        OR x.unit_price < 0
        OR x.unit_price > 10000000
  ) THEN
    RAISE EXCEPTION 'oop_estimate_correction_line_bounds'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.*
    INTO v_estimate
    FROM public.estimates e
   WHERE e.id = p_estimate_id
   FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'oop_estimate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_estimate.converted_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'oop_estimate_already_converted' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.oop_quotes q
     WHERE q.converted_estimate_id = v_estimate.id
  ) THEN
    RAISE EXCEPTION 'oop_estimate_source_quote_required' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
    INTO v_existing_count
    FROM public.estimate_line_items li
   WHERE li.estimate_id = v_estimate.id;
  IF v_existing_count <> v_line_count OR EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_lines)
        AS x(id uuid, description text, quantity numeric, unit_price numeric, sort_order integer)
      LEFT JOIN public.estimate_line_items li
        ON li.id = x.id
       AND li.estimate_id = v_estimate.id
     WHERE li.id IS NULL
  ) THEN
    RAISE EXCEPTION 'oop_estimate_correction_line_set_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT round(sum(x.quantity * x.unit_price), 2)
    INTO v_total
    FROM jsonb_to_recordset(p_lines)
      AS x(id uuid, description text, quantity numeric, unit_price numeric, sort_order integer);
  IF v_total <= 0 OR v_total > 100000000 THEN
    RAISE EXCEPTION 'oop_estimate_correction_total_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    SELECT
      v_estimate.property_address IS NOT DISTINCT FROM v_address
      AND v_estimate.property_city IS NOT DISTINCT FROM v_city
      AND v_estimate.property_state IS NOT DISTINCT FROM v_state
      AND v_estimate.property_zip IS NOT DISTINCT FROM v_zip
      AND NOT EXISTS (
        SELECT 1
          FROM public.estimate_line_items li
          FULL OUTER JOIN jsonb_to_recordset(p_lines)
            AS x(id uuid, description text, quantity numeric, unit_price numeric, sort_order integer)
            ON x.id = li.id
         WHERE (li.estimate_id = v_estimate.id OR li.id IS NULL)
           AND (
             li.id IS NULL
             OR x.id IS NULL
             OR li.description IS DISTINCT FROM btrim(x.description)
             OR li.quantity IS DISTINCT FROM x.quantity
             OR li.unit_price IS DISTINCT FROM x.unit_price
             OR li.sort_order IS DISTINCT FROM x.sort_order
           )
      )
      INTO v_matches;
    IF NOT COALESCE(v_matches, false) THEN
      RAISE EXCEPTION 'oop_estimate_correction_conflict'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.estimate_line_items li
       SET description = btrim(x.description),
           quantity = x.quantity,
           unit_price = x.unit_price,
           sort_order = x.sort_order
      FROM jsonb_to_recordset(p_lines)
        AS x(id uuid, description text, quantity numeric, unit_price numeric, sort_order integer)
     WHERE li.id = x.id
       AND li.estimate_id = v_estimate.id;

    v_updated_at := clock_timestamp();
    UPDATE public.estimates e
       SET property_address = v_address,
           property_city = v_city,
           property_state = v_state,
           property_zip = v_zip,
           updated_at = v_updated_at
     WHERE e.id = v_estimate.id;
  END IF;

  SELECT e.updated_at
    INTO v_updated_at
    FROM public.estimates e
   WHERE e.id = v_estimate.id;
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', li.id,
        'description', li.description,
        'quantity', li.quantity,
        'unit_price', li.unit_price,
        'line_total', li.line_total,
        'sort_order', li.sort_order
      )
      ORDER BY li.sort_order, li.created_at
    ),
    '[]'::jsonb
  )
    INTO v_lines
    FROM public.estimate_line_items li
   WHERE li.estimate_id = v_estimate.id;

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at,
    'updated_at', v_updated_at,
    'total', v_total,
    'lines', v_lines
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb)
  TO authenticated;

COMMENT ON COLUMN public.oop_quotes.converted_estimate_id IS
  'Draft estimate created atomically from this quote; one quote converts at most once.';
COMMENT ON FUNCTION public.convert_oop_quote_to_estimate(uuid) IS
  'Creates or returns the one draft UPR estimate for a saved, job-linked OOP quote. Does not call QuickBooks.';
COMMENT ON FUNCTION public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb) IS
  'Atomically corrects the service address and exact existing line set of an unconverted OOP estimate for an active internal admin.';

NOTIFY pgrst, 'reload schema';
