-- ============================================================================
-- Phase: N/A - bounded production data repair
-- Purpose: Repair the existing Dorothy Killian downstairs reconstruction
--          job/invoice records from the already-existing QuickBooks invoice.
-- Dependencies: Existing billing tables and money synchronization triggers.
-- Rollback: supabase/rollbacks/20260727222000_dorothy_killian_downstairs_reconstruction_repair.rollback.sql
-- Notes:
--   - Exact UUID rows only; creates one missing contact_jobs association.
--   - Creates no job, invoice, line item, or payment and never writes a
--     generated or payment-trigger-owned money column.
--   - No schema, grant, policy, function, table, or storage contract changes.
--   - Exact repaired state is a verified no-op; any drift fails closed.
-- ============================================================================

DO $repair$
DECLARE
  v_contact CONSTANT uuid := 'd1271af5-205d-42c2-872b-fd46137eac3a';
  v_down_claim CONSTANT uuid := '5aea2cee-84ee-42dd-848d-284ad65e7ecf';
  v_up_claim CONSTANT uuid := '25b844f0-ddb8-4a99-b9f6-44bdde342b00';
  v_down_job CONSTANT uuid := 'd7e8f211-8945-4e70-b63f-52bad5e9735b';
  v_up_job CONSTANT uuid := '52bcab09-ae03-4dd9-ba3a-8c9707b73265';
  v_invoice CONSTANT uuid := 'd0195bdf-6913-4066-aadd-1b07897daacb';
  v_line CONSTANT uuid := '743f73d3-60ed-475d-a8cd-1ddc1edd7f9b';
  v_payment CONSTANT uuid := '4bd87290-1037-45e6-b573-c72a9b3d29b9';
  v_contact_job CONSTANT uuid := '63c91770-4af6-4b48-ad12-826371471447';
  v_repaired boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('upr:dorothy-killian:downstairs-reconstruction-repair', 0));

  -- Lock every existing source/target row in a deterministic order before
  -- evaluating state. Concurrent billing/provider/editor writes either finish
  -- first and are rechecked below, or wait until this transaction completes.
  PERFORM id FROM contacts WHERE id = v_contact FOR UPDATE;
  PERFORM id FROM claims
    WHERE id IN (v_down_claim, v_up_claim) ORDER BY id FOR UPDATE;
  PERFORM id FROM jobs
    WHERE id IN (v_down_job, v_up_job) ORDER BY id FOR UPDATE;
  PERFORM id FROM invoices WHERE id = v_invoice FOR UPDATE;
  PERFORM id FROM invoice_line_items WHERE id = v_line FOR UPDATE;
  PERFORM id FROM payments WHERE id = v_payment FOR UPDATE;
  PERFORM id FROM contact_jobs
    WHERE id = v_contact_job
       OR (contact_id = v_contact AND job_id = v_down_job)
    ORDER BY id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = v_contact AND name = 'Dorothy Killian'
      AND email = 'Dorcot11@yahoo.com' AND phone = '+18019600739'
      AND qbo_customer_id = '420'
  ) THEN RAISE EXCEPTION 'Dorothy contact identity drifted'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM claims WHERE id = v_down_claim AND contact_id = v_contact
      AND claim_number = 'CLM-2603-010' AND encircle_claim_id = '4390121'
      AND date_of_loss = DATE '2026-03-02' AND insurance_carrier = 'All State'
  ) OR NOT EXISTS (
    SELECT 1 FROM claims WHERE id = v_up_claim AND contact_id = v_contact
      AND claim_number = 'CLM-2606-167' AND encircle_claim_id = '4760844'
      AND date_of_loss = DATE '2026-03-16' AND insurance_carrier = 'Allstate'
  ) THEN RAISE EXCEPTION 'Dorothy claim identity drifted'; END IF;

  IF (SELECT count(*) FROM jobs WHERE job_number = 'R-2604-062') <> 1
    OR NOT EXISTS (SELECT 1 FROM jobs WHERE id = v_down_job
      AND job_number = 'R-2604-062' AND claim_id = v_down_claim
      AND division = 'reconstruction')
  THEN RAISE EXCEPTION 'Downstairs job identity/count drifted'; END IF;

  IF (SELECT count(*) FROM invoices WHERE qbo_invoice_id = '4283') <> 1
    OR NOT EXISTS (SELECT 1 FROM invoices WHERE id = v_invoice
      AND job_id = v_down_job AND contact_id = v_contact
      AND invoice_number = 'INV-000069' AND qbo_invoice_id = '4283'
      AND qbo_doc_number = 'R-2604-062')
  THEN RAISE EXCEPTION 'QuickBooks invoice 4283 identity/count drifted'; END IF;

  IF NOT EXISTS (SELECT 1 FROM payments WHERE id = v_payment
      AND invoice_id = v_invoice AND job_id = v_down_job AND contact_id = v_contact
      AND amount = 7672.87 AND payment_date = DATE '2026-03-24'
      AND qbo_payment_id = '4284' AND source = 'qbo')
  THEN RAISE EXCEPTION 'Reviewed QuickBooks payment drifted'; END IF;

  SELECT
    EXISTS (SELECT 1 FROM jobs WHERE id = v_up_job AND claim_id = v_up_claim
      AND job_number = 'R-2604-027' AND division = 'reconstruction'
      AND encircle_claim_id = '4760844' AND date_of_loss = DATE '2026-03-16')
    AND EXISTS (SELECT 1 FROM jobs WHERE id = v_down_job
      AND encircle_claim_id = '4390121' AND primary_contact_id = v_contact
      AND insured_name = 'Dorothy Killian'
      AND address = '1295 Oquirrh Dr, Provo, UT, 84604' AND city = 'Provo'
      AND state = 'UT' AND zip = '84604' AND client_email = 'Dorcot11@yahoo.com'
      AND client_phone = '+18019600739' AND insurance_company = 'All State'
      AND date_of_loss = DATE '2026-03-02' AND type_of_loss = 'type_of_loss_water')
    AND EXISTS (SELECT 1 FROM invoices WHERE id = v_invoice
      AND due_date = DATE '2026-04-23' AND carrier_name = 'All State'
      AND internal_notes = 'QBO backfill invoice 4283 already exists in QuickBooks; do not create or re-push it.'
      AND subtotal = 10611.51 AND total = 10611.51 AND amount_paid = 7672.87
      AND balance_due = 2938.64 AND status = 'partially_paid')
    AND EXISTS (SELECT 1 FROM invoice_line_items WHERE id = v_line
      AND invoice_id = v_invoice
      AND description = 'Reconstruction / Remodeling Services (recon portion split from combined invoice 1227, 1295 Oquirrh Dr).'
      AND category = 'reconstruction' AND quantity = 1 AND unit_price = 10611.51
      AND line_total = 10611.51 AND unit IS NULL AND qbo_item_id = '1010000201'
      AND qbo_item_name = 'Reconstruction:Reconstruction/ Remodeling Services'
      AND qbo_class_id IS NULL AND qbo_class_name IS NULL AND sort_order = 0)
    AND EXISTS (SELECT 1 FROM contact_jobs WHERE id = v_contact_job
      AND contact_id = v_contact AND job_id = v_down_job
      AND role = 'primary_client' AND is_primary IS TRUE)
  INTO v_repaired;

  IF NOT v_repaired THEN
    IF NOT EXISTS (SELECT 1 FROM jobs WHERE id = v_up_job AND claim_id = v_up_claim
        AND job_number = 'R-2604-027' AND division = 'reconstruction'
        AND encircle_claim_id = '4390121' AND date_of_loss = DATE '2026-03-02')
      OR (SELECT count(*) FROM jobs WHERE encircle_claim_id = '4390121'
          AND division = 'reconstruction') <> 1
      OR EXISTS (SELECT 1 FROM jobs WHERE encircle_claim_id = '4760844'
          AND division = 'reconstruction')
    THEN RAISE EXCEPTION 'Upstairs reconstruction mapping drifted'; END IF;

    IF NOT EXISTS (SELECT 1 FROM jobs WHERE id = v_down_job
        AND encircle_claim_id IS NULL AND primary_contact_id IS NULL
        AND insured_name IS NULL AND address IS NULL AND city IS NULL
        AND state = 'UT' AND zip IS NULL AND client_email IS NULL
        AND client_phone IS NULL AND insurance_company IS NULL
        AND date_of_loss IS NULL AND type_of_loss IS NULL
        AND received_date = DATE '2026-06-29' AND invoiced_value = 0
        AND collected_value = 7672.87 AND ar_status = 'partial')
    THEN RAISE EXCEPTION 'Downstairs reconstruction job pre-state drifted'; END IF;

    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = v_invoice
        AND invoice_date = DATE '2026-03-02' AND due_date IS NULL
        AND subtotal = 0 AND total = 0 AND amount_paid = 7672.87
        AND balance_due = -7672.87 AND status = 'partially_paid'
        AND billed_to = 'insurance' AND carrier_name IS NULL
        AND internal_notes IS NULL)
    THEN RAISE EXCEPTION 'Downstairs invoice pre-state drifted'; END IF;

    IF NOT EXISTS (SELECT 1 FROM invoice_line_items WHERE id = v_line
        AND invoice_id = v_invoice AND COALESCE(description, '') = ''
        AND category IS NULL AND quantity = 1 AND unit_price = 0
        AND line_total = 0 AND unit IS NULL AND qbo_item_id IS NULL
        AND qbo_item_name IS NULL AND qbo_class_id IS NULL
        AND qbo_class_name IS NULL AND sort_order = 0)
      OR EXISTS (SELECT 1 FROM contact_jobs WHERE contact_id = v_contact
          AND job_id = v_down_job)
      OR EXISTS (SELECT 1 FROM contact_jobs WHERE id = v_contact_job)
    THEN RAISE EXCEPTION 'Invoice line/contact link pre-state drifted'; END IF;

    UPDATE jobs
    SET encircle_claim_id = '4760844', date_of_loss = DATE '2026-03-16'
    WHERE id = v_up_job;

    UPDATE jobs
    SET encircle_claim_id = '4390121', primary_contact_id = v_contact,
      insured_name = 'Dorothy Killian',
      address = '1295 Oquirrh Dr, Provo, UT, 84604', city = 'Provo',
      state = 'UT', zip = '84604', client_email = 'Dorcot11@yahoo.com',
      client_phone = '+18019600739', insurance_company = 'All State',
      date_of_loss = DATE '2026-03-02', type_of_loss = 'type_of_loss_water'
    WHERE id = v_down_job;

    INSERT INTO contact_jobs (id, contact_id, job_id, role, is_primary)
    VALUES (v_contact_job, v_contact, v_down_job, 'primary_client', true)
    ON CONFLICT (contact_id, job_id, role) DO NOTHING;

    UPDATE invoices
    SET due_date = DATE '2026-04-23', carrier_name = 'All State',
      internal_notes = 'QBO backfill invoice 4283 already exists in QuickBooks; do not create or re-push it.'
    WHERE id = v_invoice;

    -- Existing generated columns/triggers derive line total, invoice totals and job A/R.
    UPDATE invoice_line_items
    SET description = 'Reconstruction / Remodeling Services (recon portion split from combined invoice 1227, 1295 Oquirrh Dr).',
      category = 'reconstruction', quantity = 1, unit_price = 10611.51,
      unit = NULL, qbo_item_id = '1010000201',
      qbo_item_name = 'Reconstruction:Reconstruction/ Remodeling Services',
      qbo_class_id = NULL, qbo_class_name = NULL, sort_order = 0
    WHERE id = v_line;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM jobs WHERE id = v_up_job AND claim_id = v_up_claim
      AND encircle_claim_id = '4760844' AND date_of_loss = DATE '2026-03-16')
    OR NOT EXISTS (SELECT 1 FROM jobs WHERE id = v_down_job AND claim_id = v_down_claim
      AND encircle_claim_id = '4390121' AND primary_contact_id = v_contact
      AND insured_name = 'Dorothy Killian'
      AND address = '1295 Oquirrh Dr, Provo, UT, 84604' AND city = 'Provo'
      AND state = 'UT' AND zip = '84604' AND client_email = 'Dorcot11@yahoo.com'
      AND client_phone = '+18019600739' AND insurance_company = 'All State'
      AND date_of_loss = DATE '2026-03-02' AND type_of_loss = 'type_of_loss_water'
      AND invoiced_value = 10611.51 AND collected_value = 7672.87
      AND ar_status = 'partial')
  THEN RAISE EXCEPTION 'Job mapping/A/R postcondition failed'; END IF;

  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = v_invoice
      AND job_id = v_down_job AND qbo_invoice_id = '4283'
      AND qbo_doc_number = 'R-2604-062' AND invoice_date = DATE '2026-03-02'
      AND due_date = DATE '2026-04-23' AND subtotal = 10611.51
      AND total = 10611.51 AND amount_paid = 7672.87
      AND balance_due = 2938.64 AND status = 'partially_paid'
      AND carrier_name = 'All State')
    OR NOT EXISTS (SELECT 1 FROM invoice_line_items WHERE id = v_line
      AND invoice_id = v_invoice AND quantity = 1 AND unit_price = 10611.51
      AND line_total = 10611.51 AND qbo_item_id = '1010000201')
  THEN RAISE EXCEPTION 'Invoice/line postcondition failed'; END IF;

  IF NOT EXISTS (SELECT 1 FROM payments WHERE id = v_payment
      AND invoice_id = v_invoice AND amount = 7672.87
      AND payment_date = DATE '2026-03-24' AND qbo_payment_id = '4284'
      AND source = 'qbo')
    OR (SELECT count(*) FROM contact_jobs WHERE contact_id = v_contact
      AND job_id = v_down_job AND role = 'primary_client' AND is_primary IS TRUE) <> 1
    OR (SELECT count(*) FROM invoices WHERE qbo_invoice_id = '4283') <> 1
    OR (SELECT count(*) FROM jobs WHERE job_number = 'R-2604-062') <> 1
    OR (SELECT count(*) FROM jobs WHERE encircle_claim_id = '4390121'
      AND division = 'reconstruction') <> 1
    OR (SELECT count(*) FROM jobs WHERE encircle_claim_id = '4760844'
      AND division = 'reconstruction') <> 1
  THEN RAISE EXCEPTION 'Payment/association/uniqueness postcondition failed'; END IF;
END
$repair$;
