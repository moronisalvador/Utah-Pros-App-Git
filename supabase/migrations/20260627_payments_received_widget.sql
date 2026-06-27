-- Payments-received dashboard widget: cash collected by payment_date (independent
-- of invoice_date / the sales-date change). Mirrors get_revenue_by_division but
-- sums the `payments` table by division bucket for the period + prior period.
-- Division is resolved payment → invoice → job (or payment.job_id directly).

-- Also: break CONTENTS out as its own bucket (was folded into mitigation via the
-- ELSE branch). This flows into revenue / avg-ticket / payments alike.
CREATE OR REPLACE FUNCTION public.dash_division_bucket(p_division text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_division = 'reconstruction' THEN 'reconstruction'
    WHEN p_division = 'mold' THEN 'mold'
    WHEN p_division = 'remodeling' THEN 'remodeling'
    WHEN p_division = 'contents' THEN 'contents'
    ELSE 'mitigation'  -- water + anything else
  END;
$$;
GRANT EXECUTE ON FUNCTION public.dash_division_bucket(text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_payments_received(p_start date, p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pay AS (
    SELECT public.dash_division_bucket(j.division::text) AS bucket,
           COALESCE(p.amount, 0) - COALESCE(p.refunded_amount, 0) AS amt,
           p.payment_date AS d
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN jobs j ON j.id = COALESCE(p.job_id, i.job_id)
    WHERE p.payment_date IS NOT NULL
  ),
  cur  AS (SELECT bucket, SUM(amt) AS v FROM pay WHERE d BETWEEN p_start AND p_end AND bucket IS NOT NULL GROUP BY bucket),
  tot  AS (SELECT SUM(amt) AS v FROM pay WHERE d BETWEEN p_start AND p_end),
  prev AS (SELECT SUM(amt) AS v FROM pay WHERE d BETWEEN (p_start - ((p_end - p_start) + 1)) AND (p_start - 1))
  SELECT jsonb_build_object(
    'total',      COALESCE((SELECT v FROM tot), 0),
    'prev_total', COALESCE((SELECT v FROM prev), 0),
    'segments',   COALESCE((SELECT jsonb_agg(jsonb_build_object('key', bucket, 'value', v)) FROM cur), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_payments_received(date, date) TO anon, authenticated;
