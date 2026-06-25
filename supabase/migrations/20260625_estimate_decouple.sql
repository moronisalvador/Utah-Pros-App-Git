-- ─────────────────────────────────────────────────────────────────────────────
-- Estimate decoupling — an estimate is PRE-SALE, not a job.
--
-- Before: estimates.job_id was NOT NULL; an estimate required an existing job.
-- After:  an estimate needs only a CONTACT + an "intended division" (the job type it
--         WOULD become) + an optional property address. A claim + job are materialized
--         ONLY when the estimate is sold (converted to an invoice).
--
-- Fully BACKWARD-COMPATIBLE so it can ship ahead of the new frontend on the shared DB:
--   • job_id becomes NULLABLE (relaxing a constraint never breaks old code, which still
--     always set it).
--   • get_estimates / get_open_estimates_summary read division as
--     COALESCE(intended_division, jobs.division) — works for both old (job-coupled) and
--     new (decoupled) estimates.
--   • convert_estimate_to_invoice keeps its signature; it auto-creates the job only when
--     job_id IS NULL, otherwise behaves exactly as before.
-- 0 estimate rows exist, so no data migration. create_estimate_for_job is left in place
-- (deprecated, unused after the new modal ships) to avoid breaking the live flow.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Schema: relax job_id, add intended_division + optional property address ────────
ALTER TABLE estimates ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS intended_division text,
  ADD COLUMN IF NOT EXISTS property_address  text,
  ADD COLUMN IF NOT EXISTS property_city     text,
  ADD COLUMN IF NOT EXISTS property_state    text,
  ADD COLUMN IF NOT EXISTS property_zip      text;

-- 2. create_estimate_for_contact — make an estimate from a CONTACT, no job ───────────
CREATE OR REPLACE FUNCTION create_estimate_for_contact(
  p_contact_id        uuid,
  p_intended_division text DEFAULT 'water',
  p_estimate_type     text DEFAULT 'initial',
  p_property_address  text DEFAULT NULL,
  p_property_city     text DEFAULT NULL,
  p_property_state    text DEFAULT NULL,
  p_property_zip      text DEFAULT NULL,
  p_created_by        uuid DEFAULT NULL
)
RETURNS estimates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
GRANT EXECUTE ON FUNCTION create_estimate_for_contact(uuid, text, text, text, text, text, text, uuid) TO authenticated;

-- 3. get_estimates — division from intended_division (fallback to a linked job) ──────
CREATE OR REPLACE FUNCTION get_estimates()
RETURNS TABLE (
  estimate_id uuid, estimate_number text, estimate_type text, status text,
  amount numeric, created_at timestamptz, submitted_at timestamptz, expiration_date date,
  qbo_estimate_id text, qbo_doc_number text, qbo_sync_error text, qbo_emailed_at timestamptz,
  job_id uuid, job_number text, division text,
  claim_id uuid, claim_number text,
  contact_id uuid, client_name text,
  converted_invoice_id uuid, converted_invoice_number text
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    e.id, e.estimate_number, e.estimate_type, e.status,
    COALESCE(e.amount, 0), e.created_at, e.submitted_at, e.expiration_date,
    e.qbo_estimate_id, e.qbo_doc_number, e.qbo_sync_error, e.qbo_emailed_at,
    e.job_id, j.job_number,
    COALESCE(e.intended_division, j.division::text)    AS division,
    j.claim_id, cl.claim_number,
    COALESCE(e.contact_id, j.primary_contact_id)       AS contact_id,
    ct.name                                            AS client_name,
    e.converted_invoice_id,
    COALESCE(iv.qbo_doc_number, iv.invoice_number)     AS converted_invoice_number
  FROM estimates e
  LEFT JOIN jobs     j  ON j.id  = e.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = COALESCE(e.contact_id, j.primary_contact_id)
  LEFT JOIN invoices iv ON iv.id = e.converted_invoice_id
  ORDER BY e.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_estimates() TO anon, authenticated;

-- 4. convert_estimate_to_invoice — auto-create claim+job when the estimate has none ──
-- Same signature (keeps the deployed editor working). If the estimate already has a job
-- (legacy), behaves exactly as before. If not (decoupled), it silently materializes a
-- claim + job from the contact + intended division + optional property address (no
-- insurance = OOP) via create_job_with_contact, then makes the invoice and copies lines.
CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(
  p_estimate_id uuid, p_force boolean DEFAULT false, p_created_by uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_est      estimates;
  v_contact  contacts;
  v_jobres   jsonb;
  v_job_id   uuid;
  v_invoice  invoices;
  v_existing integer;
  v_copied   integer;
  v_max_sort integer;
BEGIN
  SELECT * INTO v_est FROM estimates WHERE id = p_estimate_id;
  IF v_est.id IS NULL THEN RAISE EXCEPTION 'Estimate % not found', p_estimate_id; END IF;

  v_job_id := v_est.job_id;

  -- Decoupled path: no job yet → silently auto-create a claim + job for the contact.
  IF v_job_id IS NULL THEN
    IF v_est.contact_id IS NULL THEN RAISE EXCEPTION 'Estimate % has no contact to create a job from', p_estimate_id; END IF;
    SELECT * INTO v_contact FROM contacts WHERE id = v_est.contact_id;
    v_jobres := create_job_with_contact(
      p_contact_id     := v_contact.id,
      p_contact_name   := v_contact.name,
      p_contact_phone  := v_contact.phone,
      p_contact_email  := v_contact.email,
      p_contact_role   := COALESCE(v_contact.role, 'homeowner'),
      p_division       := COALESCE(v_est.intended_division, 'water'),
      p_source         := 'insurance',
      p_priority       := 3,
      p_address        := v_est.property_address,
      p_city           := v_est.property_city,
      p_state          := v_est.property_state,
      p_zip            := v_est.property_zip,
      p_internal_notes := 'Auto-created from estimate ' || COALESCE(v_est.estimate_number, v_est.id::text)
    );
    v_job_id := (v_jobres->'job'->>'id')::uuid;
    IF v_job_id IS NULL THEN RAISE EXCEPTION 'Failed to auto-create a job for estimate %', p_estimate_id; END IF;
    UPDATE estimates SET job_id = v_job_id WHERE id = p_estimate_id;
  END IF;

  v_invoice := create_invoice_for_job(v_job_id, p_created_by);

  SELECT COUNT(*) INTO v_existing FROM invoice_line_items WHERE invoice_id = v_invoice.id;
  IF v_existing > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('needs_confirm', true, 'invoice_id', v_invoice.id, 'existing_line_count', v_existing);
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) INTO v_max_sort FROM invoice_line_items WHERE invoice_id = v_invoice.id;

  INSERT INTO invoice_line_items (invoice_id, description, xactimate_code, quantity, unit, unit_price,
                                  qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order)
  SELECT v_invoice.id, eli.description, eli.xactimate_code, eli.quantity, eli.unit, eli.unit_price,
         eli.qbo_item_id, eli.qbo_item_name, eli.qbo_class_id, eli.qbo_class_name,
         v_max_sort + (row_number() OVER (ORDER BY eli.sort_order, eli.created_at))::int
  FROM estimate_line_items eli WHERE eli.estimate_id = p_estimate_id;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  UPDATE invoices  SET estimate_id = p_estimate_id, updated_at = now() WHERE id = v_invoice.id;
  UPDATE estimates
     SET converted_invoice_id = v_invoice.id,
         status               = 'approved',
         approved_at          = COALESCE(approved_at, now()),
         approved_amount      = COALESCE(approved_amount, amount),
         updated_at           = now()
   WHERE id = p_estimate_id;

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_invoice.id, 'lines_copied', v_copied, 'appended', v_existing > 0);
END;
$$;
GRANT EXECUTE ON FUNCTION convert_estimate_to_invoice(uuid, boolean, uuid) TO authenticated;

-- 5. Dashboard "open estimates" — bucket on intended_division (LEFT JOIN jobs) ───────
CREATE OR REPLACE FUNCTION public.get_open_estimates_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH e AS (
    SELECT public.dash_division_bucket(COALESCE(es.intended_division, j.division::text)) AS bucket,
           COALESCE(es.amount, 0) AS amt
    FROM estimates es
    LEFT JOIN jobs j ON j.id = es.job_id
    WHERE COALESCE(es.status, 'open') NOT IN ('approved','denied','rejected','cancelled','void','converted','paid')
  )
  SELECT jsonb_build_object(
    'total_count', COALESCE((SELECT count(*) FROM e), 0),
    'total_value', COALESCE((SELECT SUM(amt) FROM e), 0),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'count', c, 'value', v))
                          FROM (SELECT bucket, count(*) c, SUM(amt) v FROM e GROUP BY bucket) s), '[]'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_open_estimates_summary() TO authenticated;

-- 6. Bust PostgREST schema cache ─────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
