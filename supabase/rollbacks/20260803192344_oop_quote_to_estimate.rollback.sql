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

REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.convert_oop_quote_to_estimate(uuid);

DROP TRIGGER IF EXISTS oop_prevent_converted_quote_mutation ON public.oop_quotes;
DROP FUNCTION IF EXISTS public.oop_prevent_converted_quote_mutation();
DROP INDEX IF EXISTS public.oop_quotes_converted_estimate_unique;
ALTER TABLE public.oop_quotes DROP COLUMN IF EXISTS converted_estimate_id;

NOTIFY pgrst, 'reload schema';
