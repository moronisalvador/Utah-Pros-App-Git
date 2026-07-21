-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_demo_sheet_pdf_gap_rpc
-- Phase: n/a (standalone bug-follow-up)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one read-only function, get_demo_sheet_pdf_gaps(), that finds any
--   submitted field-tech scope sheet whose PDF never got attached to its
--   job's Files (a silent failure discovered on a real job — see the
--   accompanying demo-sheet-pdf.js fix). It compares the "forms" table
--   (every submitted scope sheet) against "job_documents" (the attached
--   PDFs) and lists the ones with no matching PDF, so the office can see
--   the gap directly instead of only finding out when a customer asks.
--
-- ADDITIVE-ONLY:
--   Yes — one new SECURITY DEFINER function. No table/column change, no
--   data change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_demo_sheet_pdf_gaps();
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_demo_sheet_pdf_gaps()
RETURNS TABLE(
  form_id        uuid,
  job_id         uuid,
  job_number     text,
  insured_name   text,
  technician_name text,
  submitted_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- A "gap" = a submitted demo_sheet form with no job_documents row of
  -- category 'demo_sheet' on the same job created within 48h after the
  -- form's own created_at (the PDF-attach call fires synchronously with
  -- submit, so a real success always lands within minutes — the 48h window
  -- is slack for a manual resend, not evidence the check is loose).
  SELECT
    f.id AS form_id,
    f.job_id,
    j.job_number,
    j.insured_name,
    f.technician_name,
    f.created_at AS submitted_at
  FROM forms f
  JOIN jobs j ON j.id = f.job_id
  WHERE f.form_type = 'demo_sheet'
    AND f.status = 'submitted'
    AND NOT EXISTS (
      SELECT 1 FROM job_documents jd
      WHERE jd.job_id = f.job_id
        AND jd.category = 'demo_sheet'
        AND jd.created_at >= f.created_at
        AND jd.created_at <= f.created_at + interval '48 hours'
    )
  ORDER BY f.created_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_demo_sheet_pdf_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_demo_sheet_pdf_gaps() TO authenticated, service_role;
