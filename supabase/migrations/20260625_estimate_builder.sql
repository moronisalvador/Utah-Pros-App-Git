-- ─────────────────────────────────────────────────────────────────────────────
-- Estimate Builder — mirrors the invoice builder (line-item, QuickBooks-synced)
--
-- The `estimates` table already existed (empty, lump-sum `amount`, no line items,
-- no QBO columns). This migration turns it into a full line-item builder that
-- pushes to QuickBooks exactly like invoices, plus an estimate → invoice convert.
--
-- ALL ADDITIVE: a new table (estimate_line_items), new columns on `estimates`, and
-- new functions/triggers. No existing object is altered, and nothing in the live
-- app references these yet, so it ships INERT/SAFE on the shared Supabase
-- (dev + main) until the Estimates UI + `page:estimates` flag are turned on.
--
-- Mirrors: 20260618_invoice_qbo_foundation, 20260618_invoice_create_rpc,
--          20260619_invoice_line_items_qbo, 20260619_get_ar_invoices.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. estimate_line_items — clone of invoice_line_items (line_total GENERATED) ─────
CREATE TABLE IF NOT EXISTS estimate_line_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id    uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description    text NOT NULL DEFAULT '',
  xactimate_code text,
  quantity       numeric NOT NULL DEFAULT 1,
  unit           text,
  unit_price     numeric NOT NULL DEFAULT 0,
  line_total     numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  qbo_item_id    text,
  qbo_item_name  text,
  qbo_class_id   text,
  qbo_class_name text,
  sort_order     integer DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_estimate ON estimate_line_items(estimate_id);

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_estimate_line_items ON estimate_line_items;
CREATE POLICY allow_authenticated_estimate_line_items ON estimate_line_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. QBO + builder columns on `estimates` ─────────────────────────────────────────
-- contact_id mirrors invoices.contact_id (who QBO bills); subtotal/amount are rolled
-- up from the line items; converted_invoice_id back-links the invoice this became.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS contact_id           uuid REFERENCES contacts(id),
  ADD COLUMN IF NOT EXISTS subtotal             numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expiration_date      date,
  ADD COLUMN IF NOT EXISTS converted_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qbo_estimate_id      text,
  ADD COLUMN IF NOT EXISTS qbo_synced_at        timestamptz,
  ADD COLUMN IF NOT EXISTS qbo_sync_error       text,
  ADD COLUMN IF NOT EXISTS qbo_doc_number       text,
  ADD COLUMN IF NOT EXISTS qbo_emailed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS qbo_email_status     text,
  ADD COLUMN IF NOT EXISTS sent_to_email        text;
CREATE INDEX IF NOT EXISTS idx_estimates_job     ON estimates(job_id);
CREATE INDEX IF NOT EXISTS idx_estimates_contact ON estimates(contact_id);

-- 3. Roll line items up into estimates.subtotal/amount ────────────────────────────
-- Mirror of recompute_invoice_from_lines(). Writes the line sum to BOTH `subtotal`
-- and `amount` so the existing dashboard donut (get_open_estimates_summary reads
-- `amount`) keeps working with zero changes.
CREATE OR REPLACE FUNCTION recompute_estimate_from_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target uuid;
  sub    numeric;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;
  IF target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(line_total), 0) INTO sub FROM estimate_line_items WHERE estimate_id = target;
  UPDATE estimates
     SET subtotal   = sub,
         amount     = sub,
         updated_at = now()
   WHERE id = target;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_lines_total ON estimate_line_items;
CREATE TRIGGER trg_estimate_lines_total
  AFTER INSERT OR UPDATE OR DELETE ON estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION recompute_estimate_from_lines();

-- 4. Estimate number generator (mirror generate_invoice_number) ───────────────────
CREATE SEQUENCE IF NOT EXISTS estimate_number_seq START 1000;

CREATE OR REPLACE FUNCTION generate_estimate_number()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'EST-' || lpad(nextval('estimate_number_seq')::text, 6, '0');
$$;
GRANT EXECUTE ON FUNCTION generate_estimate_number() TO authenticated;

-- 5. create_estimate_for_job — always inserts a NEW draft (multiple per job) ───────
-- Unlike create_invoice_for_job (idempotent / one-per-job), a job can carry several
-- estimates (initial + supplements + change orders + final), so this always creates.
CREATE OR REPLACE FUNCTION create_estimate_for_job(
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
GRANT EXECUTE ON FUNCTION create_estimate_for_job(uuid, text, uuid) TO authenticated;

-- 6. get_estimates — one row per estimate w/ client/claim/job context ─────────────
-- Mirror of get_ar_invoices() for the Estimates list page. Read-only.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    e.id, e.estimate_number, e.estimate_type, e.status,
    COALESCE(e.amount, 0), e.created_at, e.submitted_at, e.expiration_date,
    e.qbo_estimate_id, e.qbo_doc_number, e.qbo_sync_error, e.qbo_emailed_at,
    e.job_id, j.job_number, j.division,
    j.claim_id, cl.claim_number,
    COALESCE(e.contact_id, j.primary_contact_id)        AS contact_id,
    ct.name                                             AS client_name,
    e.converted_invoice_id,
    COALESCE(iv.qbo_doc_number, iv.invoice_number)      AS converted_invoice_number
  FROM estimates e
  LEFT JOIN jobs     j  ON j.id  = e.job_id
  LEFT JOIN claims   cl ON cl.id = j.claim_id
  LEFT JOIN contacts ct ON ct.id = COALESCE(e.contact_id, j.primary_contact_id)
  LEFT JOIN invoices iv ON iv.id = e.converted_invoice_id
  ORDER BY e.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_estimates() TO anon, authenticated;

-- 7. convert_estimate_to_invoice — build/append the job's invoice from the estimate
-- Invoices are one-per-job, so this reuses the idempotent create_invoice_for_job and
-- copies the estimate's lines in. If the target invoice already has line items it
-- returns { needs_confirm: true } (the UI shows a two-click confirm) unless p_force.
-- The QBO-side link (LinkedTxn → Estimate) is applied when the invoice is pushed by
-- the qbo-invoice worker, which reads invoices.estimate_id → estimates.qbo_estimate_id.
CREATE OR REPLACE FUNCTION convert_estimate_to_invoice(
  p_estimate_id uuid,
  p_force       boolean DEFAULT false,
  p_created_by  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_est      estimates;
  v_invoice  invoices;
  v_existing integer;
  v_copied   integer;
  v_max_sort integer;
BEGIN
  SELECT * INTO v_est FROM estimates WHERE id = p_estimate_id;
  IF v_est.id IS NULL THEN RAISE EXCEPTION 'Estimate % not found', p_estimate_id; END IF;

  -- Ensure the job's (single) invoice exists — reuse the idempotent creator.
  v_invoice := create_invoice_for_job(v_est.job_id, p_created_by);

  SELECT COUNT(*) INTO v_existing FROM invoice_line_items WHERE invoice_id = v_invoice.id;

  -- One-invoice-per-job: if the target invoice already has lines, require confirm.
  IF v_existing > 0 AND NOT p_force THEN
    RETURN jsonb_build_object('needs_confirm', true, 'invoice_id', v_invoice.id, 'existing_line_count', v_existing);
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) INTO v_max_sort FROM invoice_line_items WHERE invoice_id = v_invoice.id;

  -- Copy estimate lines → invoice lines (line_total is GENERATED; never copy it).
  INSERT INTO invoice_line_items (invoice_id, description, xactimate_code, quantity, unit, unit_price,
                                  qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order)
  SELECT v_invoice.id, eli.description, eli.xactimate_code, eli.quantity, eli.unit, eli.unit_price,
         eli.qbo_item_id, eli.qbo_item_name, eli.qbo_class_id, eli.qbo_class_name,
         v_max_sort + (row_number() OVER (ORDER BY eli.sort_order, eli.created_at))::int
  FROM estimate_line_items eli
  WHERE eli.estimate_id = p_estimate_id;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  -- Link both directions + mark the estimate converted (status 'approved' removes it
  -- from the dashboard "open estimates" donut, which excludes approved).
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

-- 8. Feature flag — ships DISABLED (dormant) ──────────────────────────────────────
-- isFeatureEnabled treats a MISSING flag as ON, so we must seed an explicit OFF row to
-- keep Estimates hidden until the owner flips it on in Dev Tools. Gates the nav items
-- (page:estimates) and the /estimates routes + editor.
INSERT INTO feature_flags (key, enabled, category, label, description)
VALUES ('page:estimates', false, 'page', 'Estimates',
        'Estimate builder (line-item, QuickBooks-synced) with convert-to-invoice. Off by default; turn on to reveal the Estimates page + nav.')
ON CONFLICT (key) DO NOTHING;

-- 9. Bust PostgREST schema cache ──────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
