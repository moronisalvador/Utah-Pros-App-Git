-- ─────────────────────────────────────────────────────────────────────────────
-- Map the new invoicing system onto the existing Financials/Collections dashboard.
--
-- The dashboard (ClaimCollectionPage, Collections, ARPage, JobPage) reads
-- jobs.invoiced_value / invoiced_date via getBalances(). This trigger keeps those
-- in sync from the invoices table so the dashboard reflects QuickBooks automatically.
--
--   "Invoiced" (AR clock starts) = the invoice has been pushed to QuickBooks
--                                  (qbo_invoice_id IS NOT NULL). Drafts don't count.
--   Billed amount                = COALESCE(adjusted_total, total)  -- what the
--                                  push worker actually sends to QBO.
--
-- Non-destructive: a job is only ever written when it has >= 1 pushed invoice, so
-- legacy hand-entered invoiced_value (jobs with no invoices, or only drafts) is
-- never overwritten or zeroed. Collected ($) stays hand-logged for now; QBO payment
-- sync (-> jobs.collected_value) is a later phase.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_job_invoiced_from_invoices(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_sum   numeric;
  v_date  timestamptz;
BEGIN
  IF p_job_id IS NULL THEN RETURN; END IF;

  SELECT count(*),
         COALESCE(sum(COALESCE(adjusted_total, total)), 0),
         min(qbo_synced_at)
    INTO v_count, v_sum, v_date
    FROM invoices
   WHERE job_id = p_job_id
     AND qbo_invoice_id IS NOT NULL;

  -- Only write when the job actually has pushed invoices; never zero legacy values.
  IF v_count > 0 THEN
    UPDATE jobs
       SET invoiced_value = v_sum,
           invoiced_date  = COALESCE(invoiced_date, v_date::date),
           updated_at     = now()
     WHERE id = p_job_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_sync_job_invoiced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM sync_job_invoiced_from_invoices(OLD.job_id);
    RETURN OLD;
  END IF;
  PERFORM sync_job_invoiced_from_invoices(NEW.job_id);
  IF TG_OP = 'UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
    PERFORM sync_job_invoiced_from_invoices(OLD.job_id);  -- invoice re-pointed to another job
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_sync_job_ar ON invoices;
CREATE TRIGGER trg_invoices_sync_job_ar
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trg_sync_job_invoiced();

-- Backfill any already-pushed invoices.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT job_id FROM invoices WHERE qbo_invoice_id IS NOT NULL LOOP
    PERFORM sync_job_invoiced_from_invoices(r.job_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
