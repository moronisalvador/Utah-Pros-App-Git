-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice → QuickBooks, Phase 2a foundation
-- - qbo_* sync columns on invoices (mirrors contacts.qbo_customer_id)
-- - invoice number generator (sequence-based, unique)
-- - auto-create a DRAFT invoice in UPR per job on job creation (one per job)
--   GUARDED by integration_config 'auto_draft_invoices' (default 'false') so this
--   ships dormant — we flip it on once the push-to-QBO flow + UI are built/tested.
-- The QBO invoice is created later by a separate "push" worker, not here.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. QBO sync columns on invoices ──────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_synced_at  TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;

-- 2. Invoice number generator ──────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0');
$$;
GRANT EXECUTE ON FUNCTION generate_invoice_number() TO authenticated;

-- 3. Kill switch (default OFF — ships dormant) ─────────────────────────────────
INSERT INTO integration_config (key, value)
VALUES ('auto_draft_invoices', 'false')
ON CONFLICT (key) DO NOTHING;

-- 4. Draft-invoice-per-job trigger ─────────────────────────────────────────────
-- Internal only: inserts a UPR draft invoice. No external/QBO call here.
CREATE OR REPLACE FUNCTION create_draft_invoice_for_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled TEXT;
BEGIN
  SELECT value INTO v_enabled FROM integration_config WHERE key = 'auto_draft_invoices';
  IF v_enabled IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;

  -- One draft per job (idempotent)
  IF EXISTS (SELECT 1 FROM invoices WHERE job_id = NEW.id) THEN RETURN NEW; END IF;

  INSERT INTO invoices (job_id, contact_id, invoice_number, status, invoice_type)
  VALUES (NEW.id, NEW.primary_contact_id, generate_invoice_number(), 'draft', 'standard');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_draft_invoice ON jobs;
CREATE TRIGGER trg_create_draft_invoice
  AFTER INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION create_draft_invoice_for_job();

-- 5. Bust PostgREST schema cache ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
