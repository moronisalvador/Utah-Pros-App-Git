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
--   Adds one nullable foreign-key column, one partial unique index, and two new
--   functions/triggers. No existing column, RPC signature, or row is changed.
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

COMMENT ON COLUMN public.oop_quotes.converted_estimate_id IS
  'Draft estimate created atomically from this quote; one quote converts at most once.';
COMMENT ON FUNCTION public.convert_oop_quote_to_estimate(uuid) IS
  'Creates or returns the one draft UPR estimate for a saved, job-linked OOP quote. Does not call QuickBooks.';

NOTIFY pgrst, 'reload schema';
