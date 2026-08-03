-- Rollback for 20260803192344_oop_quote_to_estimate.
-- Refuses after first use so an official estimate never loses its source link.

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.oop_quotes
     WHERE converted_estimate_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'oop_quote_estimate_rollback_blocked';
  END IF;
END;
$rollback$;

REVOKE EXECUTE ON FUNCTION public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb);

REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.convert_oop_quote_to_estimate(uuid);

DROP TRIGGER IF EXISTS oop_prevent_converted_quote_mutation ON public.oop_quotes;
DROP FUNCTION IF EXISTS public.oop_prevent_converted_quote_mutation();
DROP INDEX IF EXISTS public.oop_quotes_converted_estimate_unique;
ALTER TABLE public.oop_quotes DROP COLUMN IF EXISTS converted_estimate_id;

DROP POLICY IF EXISTS "oop_estimate_lines_billing_write" ON public.estimate_line_items;
DROP POLICY IF EXISTS "oop_estimate_lines_internal_read" ON public.estimate_line_items;
CREATE POLICY "allow_authenticated_estimate_line_items" ON public.estimate_line_items
  FOR ALL TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()))
  WITH CHECK (NOT public.is_crm_partner(auth.uid()));
GRANT EXECUTE ON FUNCTION public.save_estimate_lines(uuid, jsonb, text)
  TO authenticated;

DROP POLICY IF EXISTS "oop_estimates_billing_write" ON public.estimates;
DROP POLICY IF EXISTS "oop_estimates_internal_read" ON public.estimates;
CREATE POLICY "allow_authenticated_estimates" ON public.estimates
  FOR ALL TO authenticated
  USING (NOT public.is_crm_partner(auth.uid()))
  WITH CHECK (NOT public.is_crm_partner(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.billing_edit_access()
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.billing_edit_access();

NOTIFY pgrst, 'reload schema';
