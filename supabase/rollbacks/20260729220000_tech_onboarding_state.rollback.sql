-- ════════════════════════════════════════════════
-- ROLLBACK: 20260729220000_tech_onboarding_state
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the first-run onboarding bookkeeping added by the paired
--   migration: the two self-service helper functions and the small table that
--   remembers who has seen which tour version. The frontend fails closed when
--   the read function is missing (the tour simply never shows), so this is
--   safe to run at any time without a coordinated frontend deploy.
--
-- Destroys only data recorded by this feature (who saw the tour). If the tour
-- has already been live, re-applying the migration later re-shows it once to
-- everyone — acceptable by design for this surface.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_my_onboarding_version_seen(text);
DROP FUNCTION IF EXISTS public.ack_my_onboarding_seen(text, integer);
DROP TABLE IF EXISTS public.employee_onboarding_state;
