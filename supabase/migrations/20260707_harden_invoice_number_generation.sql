-- Harden invoice-number generation against duplicates.
--
-- ROOT CAUSE (2026-07-07): a new draft for job W-2607-003 received INV-000062, a
-- number the Q2 reconciliation import had already used. `generate_invoice_number()`
-- drew from a global sequence (`invoice_number_seq`), but the backfilled invoices
-- (INV-000049..INV-000087) were inserted with EXPLICIT numbers that never advanced
-- the sequence. The sequence drifted behind the real max (87), so the app began
-- re-issuing already-used numbers — the same failure class as the 2026-06-30
-- claim-number collision (see 20260630_harden_claim_number_generation.sql).
--
-- FIX (mirrors the claim-number hardening):
--   1. Resolve the one existing duplicate (the July draft) by giving it the next
--      free number, so the UNIQUE constraint can be added.
--   2. UNIQUE constraint on invoices.invoice_number — a collision now throws
--      instead of silently duplicating. (qbo_doc_number is intentionally NOT made
--      unique: split/deductible invoices legitimately reuse a QBO doc number.)
--   3. Rewrite generate_invoice_number() to derive the next number from the ACTUAL
--      invoices (max numeric suffix + 1), immune to sequence drift, serialized by an
--      advisory lock. The legacy sequence is kept only as a synced secondary guard.
--
-- Idempotent: each step guards itself so a re-run is a no-op.

-- 1. Resolve the existing duplicate (the newer, unsynced July draft) -> next free number.
UPDATE public.invoices
   SET invoice_number = 'INV-' || lpad(
         ((SELECT COALESCE(max((regexp_replace(invoice_number, '\D', '', 'g'))::int), 0)
             FROM public.invoices WHERE invoice_number ~ '^INV-\d+$') + 1)::text, 6, '0')
 WHERE id = '5f690deb-debf-4e10-a994-b948b2335d06'
   AND invoice_number = 'INV-000062';

-- 2. UNIQUE constraint (guarded).
DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_invoice_number_unique'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_invoice_number_unique UNIQUE (invoice_number);
  END IF;
END $c$;

-- 3. Drift-proof generator: next number = highest existing numeric suffix + 1.
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  next_num int;
BEGIN
  -- serialize concurrent invoice creation so two callers can't compute the same number
  PERFORM pg_advisory_xact_lock(739104828);
  SELECT COALESCE(max((regexp_replace(invoice_number, '\D', '', 'g'))::int), 0) + 1
    INTO next_num
    FROM public.invoices
    WHERE invoice_number ~ '^INV-\d+$';
  -- keep the legacy sequence in sync as a secondary guard
  PERFORM setval('invoice_number_seq', next_num);
  RETURN 'INV-' || lpad(next_num::text, 6, '0');
END;
$function$;
