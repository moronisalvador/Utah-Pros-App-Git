-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical "sale" definition for ALL reporting.
--
-- Until now no object in the DB encoded what counts as a SALE — every report
-- invented its own logic (the Overview card counted raw `claims`; the pipeline
-- card counts `phase='job_received'`; etc.). This makes the rule explicit and
-- reusable so every future report reads ONE definition.
--
-- THE RULE — a job is "Sold" when EITHER:
--   (a) an estimate for it was converted to an invoice
--       (estimates.converted_invoice_id IS NOT NULL) — sale date = approved_at; OR
--   (b) it has a signed work authorization in sign_requests
--       (status='signed' AND doc_type IN ('work_auth','recon_agreement'))
--       — sale date = signed_at.
-- A job's sale_date is the EARLIEST qualifying event. `coc` (certificate of
-- completion), `direction_pay`, and `change_order` do NOT count as a sale.
--
-- Read-only + additive (a view + a SECURITY DEFINER RPC). Nothing existing reads
-- it, so it is safe to ship ahead of the frontend on the shared Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. job_sales — THE canonical definition (one row per sold job) ──────────────
CREATE OR REPLACE VIEW public.job_sales AS
WITH s AS (
  -- (a) estimate converted to an invoice
  SELECT e.job_id,
         COALESCE(e.approved_at, e.updated_at, e.created_at) AS sale_date,
         'estimate_sold'::text                               AS sale_source
  FROM estimates e
  WHERE e.converted_invoice_id IS NOT NULL
    AND e.job_id IS NOT NULL
  UNION ALL
  -- (b) signed work authorization (or reconstruction agreement)
  SELECT sr.job_id,
         COALESCE(sr.signed_at, sr.updated_at) AS sale_date,
         'work_auth_signed'::text              AS sale_source
  FROM sign_requests sr
  WHERE sr.status = 'signed'
    AND sr.doc_type IN ('work_auth', 'recon_agreement')
    AND sr.job_id IS NOT NULL
)
SELECT s.job_id,
       MIN(s.sale_date)                                   AS sale_date,
       (array_agg(s.sale_source ORDER BY s.sale_date))[1] AS first_sale_source
FROM s
WHERE s.sale_date IS NOT NULL
GROUP BY s.job_id;

GRANT SELECT ON public.job_sales TO authenticated;

-- 2. get_jobs_closed — dashboard reader (sold, non-deleted jobs since a floor) ─
-- SECURITY DEFINER so it reads estimates/sign_requests regardless of RLS, and so
-- the new column/view is reliable before the PostgREST schema cache catches up.
CREATE OR REPLACE FUNCTION public.get_jobs_closed(p_floor date DEFAULT NULL)
RETURNS TABLE (job_id uuid, sale_date timestamptz, sale_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT js.job_id, js.sale_date, js.first_sale_source
  FROM public.job_sales js
  JOIN public.jobs j ON j.id = js.job_id AND j.status IS DISTINCT FROM 'deleted'
  WHERE p_floor IS NULL OR js.sale_date >= p_floor::timestamptz
  ORDER BY js.sale_date DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_jobs_closed(date) TO anon, authenticated;

-- 3. Bust PostgREST schema cache ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
