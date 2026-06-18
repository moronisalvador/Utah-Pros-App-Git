-- On-demand draft invoice creation for a job (used by the Claim-page billing UI).
-- Idempotent: returns the existing invoice if the job already has one.
CREATE OR REPLACE FUNCTION create_invoice_for_job(p_job_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row invoices;
BEGIN
  SELECT * INTO v_row FROM invoices WHERE job_id = p_job_id ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  INSERT INTO invoices (job_id, contact_id, invoice_number, status, invoice_type, created_by)
  SELECT j.id, j.primary_contact_id, generate_invoice_number(), 'draft', 'standard', p_created_by
  FROM jobs j WHERE j.id = p_job_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION create_invoice_for_job(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
