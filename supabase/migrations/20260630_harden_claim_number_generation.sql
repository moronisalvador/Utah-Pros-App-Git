-- Harden claim-number generation against duplicates.
--
-- ROOT CAUSE (2026-06-30): two claims received the same number (CLM-2606-167 —
-- Dorothy Killian and Tanner Johnson). `generate_claim_number()` used a global
-- sequence (`claim_number_seq`), but imported/backfilled claims were inserted with
-- EXPLICIT claim_numbers that never advanced the sequence. The sequence drifted
-- behind the real max, so the UI handed a new claim a number that already existed.
-- The Encircle sync worker then matched the pre-existing Encircle claim by that CLM
-- and silently linked the new job to the WRONG customer's claim.
--
-- FIX:
--   1. UNIQUE constraint on claims.claim_number — a collision now throws instead of
--      silently duplicating.
--   2. Rewrite generate_claim_number() to derive the next number from the ACTUAL
--      claims (max suffix + 1), immune to sequence drift, serialized by an advisory
--      lock. The legacy sequence is kept only as a synced secondary guard.
--
-- (Companion app change: functions/api/sync-claim-to-encircle.js now verifies a
--  CLM-matched Encircle claim's policyholder/address before linking.)

ALTER TABLE public.claims ADD CONSTRAINT claims_claim_number_unique UNIQUE (claim_number);

CREATE OR REPLACE FUNCTION public.generate_claim_number()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  next_seq int;
BEGIN
  -- serialize concurrent claim creation so two callers can't compute the same number
  PERFORM pg_advisory_xact_lock(739104826);
  -- next number = (highest existing suffix) + 1, read from real claims
  SELECT COALESCE(max(split_part(claim_number, '-', 3)::int), 0) + 1
    INTO next_seq
    FROM claims
    WHERE claim_number ~ '^CLM-\d{4}-\d+$';
  -- keep the legacy sequence in sync as a secondary guard
  PERFORM setval('claim_number_seq', next_seq);
  RETURN 'CLM-' || to_char(now(), 'YYMM') || '-' || lpad(next_seq::text, 3, '0');
END;
$function$;
