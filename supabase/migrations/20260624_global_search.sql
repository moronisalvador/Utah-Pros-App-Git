-- Global top-nav search (desktop office shell). Grouped, read-only matches across
-- customers/claims/jobs/invoices/payments. Estimates bucket is reserved (empty)
-- until an estimates module exists. Additive + SECURITY DEFINER like the other
-- app RPCs; surfaced only in the desktop TopNav (field techs never see it).
-- Enum columns (e.g. job division) are cast to text before NULLIF.
-- Applied to project glsmljpabrwonfiltiqm on 2026-06-24.
CREATE OR REPLACE FUNCTION public.global_search(p_term TEXT, p_limit INT DEFAULT 6)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (SELECT '%' || trim(p_term) || '%' AS like_term)
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT c.id,
               c.name AS title,
               NULLIF(concat_ws(' · ', NULLIF(c.company::text,''), NULLIF(c.phone::text,''), NULLIF(c.role::text,'')), '') AS subtitle
        FROM contacts c, q
        WHERE c.name ILIKE q.like_term OR c.phone ILIKE q.like_term
           OR c.email ILIKE q.like_term OR c.company ILIKE q.like_term
        ORDER BY c.name
        LIMIT p_limit
      ) x
    ), '[]'::jsonb),
    'claims', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT cl.id,
               COALESCE(NULLIF(cl.claim_number::text,''), 'Claim') AS title,
               NULLIF(concat_ws(' · ', NULLIF(ct.name::text,''), NULLIF(cl.loss_city::text,''), NULLIF(cl.insurance_carrier::text,'')), '') AS subtitle
        FROM claims cl
        LEFT JOIN contacts ct ON ct.id = cl.contact_id, q
        WHERE cl.claim_number ILIKE q.like_term OR cl.insurance_claim_number ILIKE q.like_term
           OR cl.loss_address ILIKE q.like_term OR cl.loss_city ILIKE q.like_term
           OR ct.name ILIKE q.like_term
        ORDER BY cl.created_at DESC
        LIMIT p_limit
      ) x
    ), '[]'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT j.id,
               COALESCE(NULLIF(j.job_number::text,''), 'Job') AS title,
               NULLIF(concat_ws(' · ', NULLIF(j.insured_name::text,''), NULLIF(j.division::text,''), NULLIF(j.address::text,'')), '') AS subtitle
        FROM jobs j, q
        WHERE j.job_number ILIKE q.like_term OR j.insured_name ILIKE q.like_term
           OR j.address ILIKE q.like_term OR j.claim_number ILIKE q.like_term
        ORDER BY j.created_at DESC
        LIMIT p_limit
      ) x
    ), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT iv.id,
               COALESCE(NULLIF(iv.qbo_doc_number::text,''), NULLIF(iv.invoice_number::text,''), 'Invoice') AS title,
               NULLIF(concat_ws(' · ', NULLIF(ct.name::text,''), NULLIF(iv.billed_to::text,''),
                      '$' || to_char(COALESCE(iv.adjusted_total, iv.total, 0), 'FM999,999,990.00')), '') AS subtitle
        FROM invoices iv
        LEFT JOIN contacts ct ON ct.id = iv.contact_id, q
        WHERE iv.invoice_number ILIKE q.like_term OR iv.qbo_doc_number ILIKE q.like_term
           OR iv.claim_number ILIKE q.like_term OR iv.billed_to ILIKE q.like_term
           OR ct.name ILIKE q.like_term
        ORDER BY iv.created_at DESC
        LIMIT p_limit
      ) x
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT p.id, p.invoice_id, p.job_id,
               concat_ws(' ', COALESCE(NULLIF(p.payer_name::text,''), 'Payment'),
                         '· $' || to_char(COALESCE(p.amount,0), 'FM999,999,990.00')) AS title,
               NULLIF(concat_ws(' · ', NULLIF(p.payment_method::text,''), NULLIF(p.reference_number::text,''),
                      to_char(p.payment_date, 'Mon DD, YYYY')), '') AS subtitle
        FROM payments p, q
        WHERE p.payer_name ILIKE q.like_term OR p.reference_number ILIKE q.like_term
           OR p.amount::text ILIKE q.like_term
        ORDER BY p.payment_date DESC NULLS LAST
        LIMIT p_limit
      ) x
    ), '[]'::jsonb),
    'estimates', '[]'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION public.global_search(TEXT, INT) TO anon, authenticated;
