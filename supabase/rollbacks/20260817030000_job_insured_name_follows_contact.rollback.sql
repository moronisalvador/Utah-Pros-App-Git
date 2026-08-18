-- ════════════════════════════════════════════════
-- ROLLBACK: 20260817030000_job_insured_name_follows_contact
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Turns the automatic name sync back off. After this runs, correcting a
--   client's name on their customer record will once again NOT update the name
--   shown on their jobs or on the schedule — i.e. it deliberately restores the
--   reported defect.
--
-- EXACTNESS:
--   The forward migration created exactly these two objects and wrote no rows,
--   so dropping them restores the prior database state completely.
--
--   Names that were already propagated while the trigger was live are NOT
--   reverted, and must not be — they are the corrected names the owner typed on
--   the customer record. There is no prior value to restore them to that would
--   be more correct than what they now hold.
-- ════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_sync_job_insured_name ON public.contacts;

DROP FUNCTION IF EXISTS public.sync_job_insured_name_from_contact();

-- ── POSTCONDITIONS ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_sync_job_insured_name'
       AND tgrelid = 'public.contacts'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback postcondition failed: trigger trg_sync_job_insured_name is still installed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'sync_job_insured_name_from_contact'
  ) THEN
    RAISE EXCEPTION 'rollback postcondition failed: sync_job_insured_name_from_contact() still exists';
  END IF;
END;
$$;
