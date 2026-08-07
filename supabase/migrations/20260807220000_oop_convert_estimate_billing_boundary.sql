-- ════════════════════════════════════════════════
-- MIGRATION: 20260807220000_oop_convert_estimate_billing_boundary
-- Phase: n/a (standalone money-path authorization correction)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets the office staff and project managers who already use the out-of-pocket
--   price calculator turn a saved quote into a real estimate. Until now the
--   button was on screen for them but the database refused the click, so it
--   simply failed with a permission error. This makes the database agree with
--   the button by asking the same question every other billing action asks:
--   are you an active internal member of staff allowed to edit billing?
--
-- ADDITIVE-ONLY / attribute-only:
--   No table DROP/RENAME/ALTER COLUMN and no data change. This is an
--   authorization-only change: it replaces ONE function body in place. No
--   policy, grant, table, column, index, constraint or trigger is touched. The
--   signature, return type, language, volatility, SECURITY DEFINER posture and
--   search_path of convert_oop_quote_to_estimate are preserved exactly, so the
--   deployed frontend contract does not move (database-standard.md §3).
--
-- WHAT CHANGED, EXACTLY:
--   The body is the live definition with ONLY the authorization block swapped.
--   Every other statement — the FOR UPDATE lock, the idempotent re-entry on an
--   already-converted quote, the snapshot requirement, the line flattening, the
--   total reconciliation and the set_config provenance markers — is byte-for-byte
--   the applied 20260803192344 text. Removed: the now-unused v_role variable and
--   its lookup. Replaced:
--     IF v_role IS NULL OR v_role NOT IN ('admin','manager')   -- before
--     IF NOT public.billing_edit_access()                      -- after
--
--   'manager' IS NOT A LIVE ROLE. public.employee_role is
--   (admin, office, project_manager, field_tech, estimator, supervisor,
--   crm_partner) — it has no 'manager' value, so that arm never matched anyone
--   and the gate was admin-only in practice. This is the same dead literal
--   src/lib/claimUtils.js dropped when BILLING_EDIT_ROLES was widened on
--   2026-08-04; see functions/lib/qbo-auth.js for the same note.
--
-- WHY billing_edit_access() AND NOT A SECOND ROLE LIST:
--   public.billing_edit_access() is the single live predicate behind payments,
--   invoices, invoice_line_items, estimates, estimate_line_items,
--   create_invoice_for_job, convert_estimate_to_invoice, qbo_attachments and —
--   since production ledger 20260805031844 — create_estimate_for_contact and
--   create_estimate_for_job. Inlining ('admin','office','project_manager') here
--   would create the second hardcoded list that the whole boundary exists to
--   prevent, and would drift the moment the predicate is retuned.
--   tests/qa/unit/billing-role-surface-parity.test.js fails if this file ever
--   names a role literal instead of calling the helper.
--
-- WHY THERE IS NO service_role SHORT-CIRCUIT (deliberate divergence):
--   The sibling 20260805020000 guard reads
--     IF auth.role() IS DISTINCT FROM 'service_role' AND NOT billing_edit_access()
--   because those two RPCs ARE granted to service_role and a Worker calls them.
--   This one is not: 20260803192344 revokes it from service_role and grants
--   EXECUTE to authenticated ONLY, with the standing comment "Browser-only by
--   design: no Worker/provider path converts calculator quotes." A short-circuit
--   for a role that holds no EXECUTE privilege would be dead code that falsely
--   advertises a worker path.
--
--   That also removes the NULL trap rather than defusing it. There is no
--   auth.role() comparison here to get wrong, and billing_edit_access() returns
--   EXISTS(...), which is true or false and never NULL — so NOT
--   billing_edit_access() cannot evaluate to NULL and cannot be silently
--   skipped by PL/pgSQL's IF. (Where an auth.role() comparison IS needed, the
--   NULL-safe IS DISTINCT FROM form is mandatory; see 20260805020000.)
--   The claimless-session case is proved explicitly in the behavioural test.
--
-- WHO GAINS AND WHO DOES NOT (the §5b question, answered for every role):
--   The first statement of this function is still
--   public.oop_pricing_active_employee(false), which requires an employee row,
--   is_active, NOT is_external, the tool:oop_pricing flag, and a role in
--   ('admin','office','supervisor','estimator','project_manager'). That runs
--   BEFORE this gate and is unchanged, so:
--     admin            — unchanged, still allowed
--     office           — GAINS conversion (this is the fix)
--     project_manager  — GAINS conversion (this is the fix)
--     supervisor       — still refused (reaches the calculator, fails billing)
--     estimator        — still refused (reaches the calculator, fails billing)
--     field_tech       — still refused (fails OOP access first)
--     crm_partner      — still refused (fails OOP access first)
--     inactive/external— still refused (fails OOP access first; this migration
--                        does NOT change that, both predicates already exclude them)
--
-- WHY THE UI IS NOT CHANGED IN THIS COMMIT:
--   src/components/oop/ConfiguredOopPricingCalculator.jsx already gates the
--   Create-estimate button on canEditBilling(), i.e. exactly
--   ('admin','office','project_manager'). The UI was right and the database was
--   wrong; this migration moves the database to the UI, so the button stops
--   failing rather than disappearing. On native the same button additionally
--   requires role === 'admin', which is narrower than this predicate — narrower
--   is safe (no button can outrun the database) and is left as-is deliberately:
--   the native OOP estimate surface is admin-only by design.
--
-- ⚠️ APPLY-ORDER COLLISION — READ BEFORE APPLYING:
--   supabase/migrations/20260807190000_oop_estimate_grouped_lines.sql (authored,
--   uncommitted at the time of writing) ALSO does CREATE OR REPLACE on this same
--   function and carries the legacy ('admin','manager') gate forward. Two
--   whole-body replacements of one function cannot both win:
--     * grouped-lines applied FIRST  -> the drift guard below ABORTS this
--       migration (SQLSTATE 55000) rather than reverting the grouped-lines work;
--     * this applied FIRST           -> grouped-lines would silently restore the
--       broken gate.
--   Resolution: the grouped-lines migration must adopt
--   "IF NOT public.billing_edit_access()" before either is applied. The guard
--   makes the wrong order loud instead of silent; it is not a substitute for
--   reconciling the two bodies.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260807220000_oop_convert_estimate_billing_boundary.rollback.sql.
--   It restores the exact pre-migration body — the applied 20260803192344 text,
--   byte for byte, including the ('admin','manager') gate — so office and
--   project_manager lose conversion again and the UI button starts failing for
--   them once more. That is the defect this migration closes, so prefer rolling
--   FORWARD. No row is written or altered in either direction; both files only
--   replace one function body.
-- ════════════════════════════════════════════════

-- ── Drift guard ───────────────────────────────────────────────────────────────
-- This migration replaces a WHOLE function body, so applying it onto an
-- unexpected body would destroy whatever else had been written there. Refuse
-- unless the live body is exactly the applied 20260803192344 definition.

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

  IF v_src LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'This migration is already applied (live body already carries billing_edit_access()); nothing to do'
      USING ERRCODE = '55000';
  END IF;

  IF v_src NOT LIKE '%NOT IN (''admin'',''manager'')%' THEN
    RAISE EXCEPTION 'live body does not carry the expected predecessor gate; refusing to replace it'
      USING ERRCODE = '55000';
  END IF;

  v_md5 := md5(v_src);
  IF v_md5 <> 'c8cb9551c48ea8d3e22e35985945645f' THEN
    RAISE EXCEPTION 'DRIFT: convert_oop_quote_to_estimate body is % , expected % . Another migration replaced this function (most likely 20260807190000_oop_estimate_grouped_lines, which rewrites this same body). Replacing it now would silently revert that change. Reconcile the two bodies deliberately, then re-pin this guard.', v_md5, 'c8cb9551c48ea8d3e22e35985945645f'
      USING ERRCODE = '55000';
  END IF;
END;
$guard$;

-- ── The replacement ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
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

  IF NOT public.billing_edit_access() THEN
    RAISE EXCEPTION 'not_authorized: active internal billing editor required'
      USING ERRCODE = '42501';
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

-- This managed project re-applies EXECUTE TO PUBLIC at ddl_command_end on every
-- replaced function, so the revoke must be restated immediately before the grant
-- (database-standard.md §1). Grants are identical to 20260803192344: browser-only,
-- no service_role.
REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid) TO authenticated;

-- ── Postconditions ────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
  v_oid oid;
BEGIN
  SELECT p.oid, p.prosrc INTO v_oid, v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'convert_oop_quote_to_estimate'
     AND pg_get_function_identity_arguments(p.oid) = 'p_quote_id uuid';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'postcondition: the function is missing after replacement';
  END IF;
  IF md5(v_src) <> '1eec6a8e1065ec7d069af8c349045edb' THEN
    RAISE EXCEPTION 'postcondition: replaced body is % , expected %', md5(v_src), '1eec6a8e1065ec7d069af8c349045edb';
  END IF;
  IF v_src NOT LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'postcondition: the shared billing predicate is not in the body';
  END IF;
  IF v_src LIKE '%''manager''%' OR v_src LIKE '%''office''%' THEN
    RAISE EXCEPTION 'postcondition: a role literal was inlined instead of calling billing_edit_access()';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: authenticated lost EXECUTE';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: anon holds EXECUTE';
  END IF;
  IF has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: service_role holds EXECUTE (this RPC is browser-only)';
  END IF;
END;
$post$;
