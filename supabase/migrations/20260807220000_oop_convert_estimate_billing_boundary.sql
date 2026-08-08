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
-- ⚠️ ORDERING DEPENDENCY — THIS IS BUILT ON THE GROUPED-LINES BODY:
--   supabase/migrations/20260807210000_oop_estimate_grouped_lines.sql replaces
--   this SAME function and MUST apply first. The body below IS that migration's
--   body with only the authorization block swapped, so applying in timestamp
--   order (…210000 then …220000) lands both changes: the grouped customer lines
--   AND the corrected role gate.
--
--   The drift guard below pins md5(prosrc) = bbf68c740b6172dde55dd0bc2197bac3
--   (the grouped-lines body, 8,344 bytes). If grouped-lines has not applied, or
--   has itself changed, the guard ABORTS with SQLSTATE 55000 rather than
--   silently reverting whatever is actually installed.
--
--   Grouped-lines was renumbered from 20260807190000 to 20260807210000 on
--   2026-08-07 because another session committed a DIFFERENT migration at
--   20260807190000 (invoice_qbo_email_mirror) and the Supabase ledger keys on
--   the version prefix. Nothing in the tooling detects a duplicate version —
--   scripts/check-migration-hygiene.mjs checked 301 files and did not flag it.
--
-- WHAT CHANGED, EXACTLY:
--   The body is the grouped-lines definition with ONLY the authorization block
--   swapped. Every other statement — the FOR UPDATE lock, the idempotent
--   re-entry on an already-converted quote, the snapshot requirement, the
--   two-line section bucketing, the QuickBooks Item/Class assignment, the total
--   reconciliation and the set_config provenance markers — is byte-for-byte the
--   20260807210000 text. Removed: the now-unused v_role variable and its
--   lookup. Replaced:
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
--   This one is not: its grants are EXECUTE to authenticated ONLY, with the
--   standing comment "Browser-only by design: no Worker/provider path converts
--   calculator quotes." A short-circuit for a role that holds no EXECUTE
--   privilege would be dead code that falsely advertises a worker path.
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
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260807220000_oop_convert_estimate_billing_boundary.rollback.sql.
--   It restores the exact GROUPED-LINES body — byte for byte, including the
--   ('admin','manager') gate — so office and project_manager lose conversion
--   again and the UI button starts failing for them once more, while the
--   two-line customer output that 20260807210000 introduced is PRESERVED.
--   Rolling this back does not undo grouped lines. That is the defect this
--   migration closes, so prefer rolling FORWARD. No row is written or altered in
--   either direction; both files only replace one function body.
-- ════════════════════════════════════════════════

-- ── Drift guard ───────────────────────────────────────────────────────────────
-- This migration replaces a WHOLE function body, so applying it onto an
-- unexpected body would destroy whatever else had been written there. Refuse
-- unless the live body is exactly the 20260807210000 grouped-lines definition.

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

  IF v_src LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'This migration is already applied (live body already carries billing_edit_access()); nothing to do'
      USING ERRCODE = '55000';
  END IF;

  IF v_src NOT LIKE '%NOT IN (''admin'',''manager'')%' THEN
    RAISE EXCEPTION 'live body does not carry the expected predecessor gate; refusing to replace it'
      USING ERRCODE = '55000';
  END IF;

  v_md5 := md5(v_src);
  IF v_md5 <> 'bbf68c740b6172dde55dd0bc2197bac3' THEN
    RAISE EXCEPTION 'DRIFT: convert_oop_quote_to_estimate body is % , expected % . This migration is built on the body left by 20260807210000_oop_estimate_grouped_lines; apply that FIRST, and if it has itself changed, rebuild this body on the new one and re-pin this guard. Replacing an unexpected body would silently revert whatever is actually there.', v_md5, 'bbf68c740b6172dde55dd0bc2197bac3'
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

-- This managed project re-applies EXECUTE TO PUBLIC at ddl_command_end on every
-- replaced function, so the revoke must be restated immediately before the grant
-- (database-standard.md §1). Grants are identical to the predecessor:
-- browser-only, no service_role.
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
  IF md5(v_src) <> 'eee648e41503edfd018afd2f8b08f0be' THEN
    RAISE EXCEPTION 'postcondition: replaced body is % , expected %', md5(v_src), 'eee648e41503edfd018afd2f8b08f0be';
  END IF;
  IF v_src NOT LIKE '%billing_edit_access()%' THEN
    RAISE EXCEPTION 'postcondition: the shared billing predicate is not in the body';
  END IF;
  IF v_src LIKE '%''manager''%' OR v_src LIKE '%''office''%' THEN
    RAISE EXCEPTION 'postcondition: a role literal was inlined instead of calling billing_edit_access()';
  END IF;
  -- The grouped-lines work must survive this replacement.
  IF v_src NOT LIKE '%1000000005%' OR v_src NOT LIKE '%1010000071%' THEN
    RAISE EXCEPTION 'postcondition: the grouped-lines QuickBooks Item/Class assignment was lost';
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
