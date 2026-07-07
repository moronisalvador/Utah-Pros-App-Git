-- Harden estimate-number generation against duplicates (mirrors
-- 20260707_harden_invoice_number_generation.sql and 20260630_harden_claim_number_generation.sql).
--
-- CONTEXT (2026-07-07): `generate_estimate_number()` drew from `estimate_number_seq`, the same
-- drift-prone pattern that broke invoice numbers. It is NOT currently colliding — the 34
-- reconciliation-imported estimates use plain QBO DocNumbers (e.g. "1125"), a separate namespace
-- from the app's `EST-######`, so the sequence stayed in sync (0 duplicates today). This adds the
-- same guard proactively so a future explicit-number import can't drift it.
--
-- FIX:
--   1. UNIQUE constraint on estimates.estimate_number (all 37 numbers are already distinct).
--   2. Rewrite generate_estimate_number() to max(EST-suffix)+1 from real rows under an advisory lock
--      (sequence kept as a synced secondary guard). Idempotent.

DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimates_estimate_number_unique'
  ) THEN
    ALTER TABLE public.estimates
      ADD CONSTRAINT estimates_estimate_number_unique UNIQUE (estimate_number);
  END IF;
END $c$;

CREATE OR REPLACE FUNCTION public.generate_estimate_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_num int;
BEGIN
  PERFORM pg_advisory_xact_lock(739104829);
  SELECT COALESCE(max((regexp_replace(estimate_number, '\D', '', 'g'))::int), 0) + 1
    INTO next_num
    FROM public.estimates
    WHERE estimate_number ~ '^EST-\d+$';
  PERFORM setval('estimate_number_seq', next_num);
  RETURN 'EST-' || lpad(next_num::text, 6, '0');
END;
$function$;
