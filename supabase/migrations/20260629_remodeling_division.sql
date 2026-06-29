-- ════════════════════════════════════════════════
-- Migration: add "Remodeling" as a first-class job division (prefix RM-)
-- Date: 2026-06-29
--
-- WHAT THIS DOES (plain language):
--   Remodeling work used to be filed under the "reconstruction" division, so its
--   jobs/invoices started with R- and were indistinguishable from real reconstruction
--   jobs. This makes Remodeling its own division: jobs get an RM- number
--   (RM-YYMM-###), and it shows up everywhere the other divisions do.
--
--   Three changes, all inert until the "New Job" form actually offers Remodeling
--   (shipped in the accompanying code change), so this is safe to apply ahead of the code:
--     1. Add 'remodeling' to the job_division enum (after 'reconstruction').
--     2. Widen job_number_sequences.division_prefix char(1) -> varchar(2) so 'RM' fits
--        (existing single-char prefixes W/M/R/C/F/G are unchanged).
--     3. Teach generate_job_number() the remodeling -> 'RM' prefix.
--
-- QBO: a remodeling job's invoice maps to the SAME QuickBooks item/class as
--   reconstruction ("Reconstruction/ Remodeling Services") — handled in
--   functions/lib/quickbooks.js divisionToQbo(); no QBO change here.
--
-- SAFETY:
--   Backward-compatible. No existing rows are reclassified. ALTER TYPE ADD VALUE is
--   run on its own (it cannot be used in the same transaction it's added in).
-- ════════════════════════════════════════════════

-- 1. Enum value (idempotent). Run this statement by itself.
ALTER TYPE job_division ADD VALUE IF NOT EXISTS 'remodeling' AFTER 'reconstruction';

-- 2. Widen the prefix store so a 2-char prefix (RM) fits.
ALTER TABLE job_number_sequences ALTER COLUMN division_prefix TYPE varchar(2);

-- 3. Add the remodeling -> 'RM' branch; widen v_prefix to hold 2 chars. Logic otherwise unchanged.
CREATE OR REPLACE FUNCTION public.generate_job_number(p_division text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_prefix VARCHAR(2);
  v_ym CHAR(4);
  v_seq INT;
  v_job_number TEXT;
BEGIN
  v_prefix := CASE
    WHEN p_division = 'water' THEN 'W'
    WHEN p_division = 'mold' THEN 'M'
    WHEN p_division = 'reconstruction' THEN 'R'
    WHEN p_division = 'remodeling' THEN 'RM'
    WHEN p_division = 'contents' THEN 'C'
    WHEN p_division = 'fire' THEN 'F'
    WHEN p_division = 'general' THEN 'G'
    ELSE 'X'
  END;

  v_ym := to_char(now(), 'YYMM');

  INSERT INTO job_number_sequences (division_prefix, year_month, last_seq)
  VALUES (v_prefix, v_ym, 1)
  ON CONFLICT (division_prefix, year_month)
  DO UPDATE SET last_seq = job_number_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_job_number := v_prefix || '-' || v_ym || '-' || LPAD(v_seq::TEXT, 3, '0');
  RETURN v_job_number;
END;
$function$;
