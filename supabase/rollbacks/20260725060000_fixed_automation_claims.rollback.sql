-- ════════════════════════════════════════════════
-- ROLLBACK: 20260725060000_fixed_automation_claims
-- ════════════════════════════════════════════════
--
-- PRECONDITION:
--   Deploy the pre-claim run-automations.js FIRST. While the claim-aware
--   worker is live, dropping these functions makes every fixed automation
--   fail its claim step and send nothing.
--
-- BLAST RADIUS:
--   Drops three service-only functions and one table that holds only
--   in-flight/terminal claim tickets. The durable "already fired" history
--   lives in system_events and is NOT touched, so no automation can re-fire
--   for an entity that already completed. Discarding claim rows only forfeits
--   the crash-window protection this migration added.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.finalize_fixed_automation_claim(text, uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.release_fixed_automation_claim(text, uuid, text);
DROP FUNCTION IF EXISTS public.claim_fixed_automation(text, text, uuid, timestamptz);

DROP TABLE IF EXISTS public.fixed_automation_claims;
