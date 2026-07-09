-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_global_search_match_qbo_invoice_id
-- Phase: n/a (standalone quality-of-life fix)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes the top-bar search box also find an invoice when you type its
--   QuickBooks invoice id (the internal number like "4274"). Until now the
--   search matched the UPR invoice number, the QBO doc number, the claim
--   number, the billed-to name and the customer name — but not the raw QBO
--   invoice id, so historical "visualization only" invoices keyed only by
--   that id (e.g. the Chris Smith mit/recon/mold split of QBO 1222 + 1223)
--   never showed up.
--
-- ADDITIVE-ONLY: function-body-only CREATE OR REPLACE of global_search.
--   Signature UNCHANGED (p_term text, p_limit integer DEFAULT 6) RETURNS jsonb;
--   return shape UNCHANGED. The only change is ONE extra OR-condition in the
--   invoices search predicate — it can only WIDEN matches, never narrow them.
--   No table/column change, no data change, no grant change (least-privilege
--   preserved: authenticated + service_role only, never anon).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-run the prior body (drop the "OR iv.qbo_invoice_id ILIKE q.like_term"
--   line from the invoices WHERE clause and CREATE OR REPLACE again).
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.global_search(p_term text, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           OR iv.qbo_invoice_id ILIKE q.like_term
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
$function$;

-- Managed-Supabase re-grants EXECUTE TO PUBLIC on every new/replaced function
-- (database-standard.md §1) — revoke it back and keep least-privilege grants.
REVOKE EXECUTE ON FUNCTION public.global_search(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_search(text, integer) TO authenticated, service_role;
