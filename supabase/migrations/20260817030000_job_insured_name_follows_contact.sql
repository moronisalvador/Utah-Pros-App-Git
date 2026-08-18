-- ════════════════════════════════════════════════
-- MIGRATION: 20260817030000_job_insured_name_follows_contact
-- Phase: n/a — standalone defect repair (owner-reported 2026-08-17)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   When you fix or complete a client's name on their customer record, the
--   schedule and the job list keep showing the OLD name. This makes the new name
--   follow through automatically.
--
--   Each job keeps its own copy of the client's name (`jobs.insured_name`). That
--   copy is what the dispatch board, the job list, the search bar and the tech
--   app all read. Nothing has ever updated that copy when the customer record
--   changed, so a job created as "Cameron" stayed "Cameron" forever even after
--   the customer became "Cameron Shumway".
--
--   From now on, renaming a customer also renames it on their jobs — but ONLY on
--   the jobs that were still showing the customer's old name. A job that has been
--   given its own deliberately different label keeps it. See the next block.
--
-- ⚠ THE PREDICATE IS NARROWER THAN THE OBVIOUS ONE — ON PURPOSE:
--   The naive version is
--     UPDATE jobs SET insured_name = NEW.name WHERE primary_contact_id = NEW.id;
--   That is WRONG and would destroy live dispatch information. Measured
--   read-only on production 2026-08-17: of 309 jobs carrying a primary contact,
--   32 have an `insured_name` that differs from their contact's name, and they
--   are NOT all stale. They fall into three groups:
--
--     a) STALE COPIES — the defect. The contact was corrected or completed later.
--        e.g. job "Cameron"       / contact "Cameron Shumway"
--             job "Kanra Arguello"/ contact "Kendra Arguello"
--             job "Shawn More"    / contact "Sean Moore"
--
--     b) DELIBERATE PER-JOB LABELS — must survive. The contact is a property
--        management company and the job names the specific unit or tenant.
--        e.g. job "A2Z Properties (Henriquez)"     / contact "A2Z Properties"
--             job "A2Z Properties (Pleasant Grove)"/ contact "A2Z Properties"
--             job "Merle Hodel"                    / contact "Eric Bottomly" (PM)
--             job "Natalin Handy"                  / contact "PEG Companies - …"
--        Four A2Z jobs at four different addresses would all collapse to the
--        single string "A2Z Properties" on the dispatch board. That is a real
--        loss for whoever reads the board to decide where to send a crew.
--
--     c) EMPTY — 8 jobs have a contact but a NULL/blank `insured_name`, so they
--        render as a blank row on the schedule today.
--
--   So the rule is: propagate to a job only when its copy was still IN SYNC with
--   the contact's OLD name (group a), or when it is empty and therefore carries
--   no information to lose (group c). A job whose copy already disagreed with the
--   old name is, by definition, group b — leave it alone.
--
--   This is the same semantic a careful rename gives you anywhere else: rows that
--   were tracking the old value follow it; rows that had been overridden do not.
--
-- WHAT THIS DOES NOT DO:
--   It fires on FUTURE renames only. The 32 jobs that are ALREADY out of sync are
--   not touched — a trigger cannot know which of them are group (a) and which are
--   group (b), and guessing wrong renames a live job. Repairing those is a
--   separate, owner-reviewed decision; see the handoff notes for the exact list.
--   Nothing in this migration changes a single row of data.
--
--   It never propagates a BLANK name. Clearing a contact's name leaves every job
--   snapshot exactly as it was, because a blank carries nothing worth copying and
--   cascading it would wipe the label off every sibling job in one edit.
--
--   It also deliberately does not touch `jobs.client_phone` / `jobs.client_email`,
--   which are denormalized the same way. Phone in particular is adjacent to the
--   consent/messaging path (AGENTS.md §14) and is not in the scope of the
--   reported defect.
--
-- WHY A DATABASE TRIGGER AND NOT A UI FIX:
--   There are at least four writers of `contacts.name` today —
--   src/pages/CustomerPage.jsx, src/pages/JobPage.jsx (its Client Information
--   tile already syncs job → contact, which is the asymmetry that produced this
--   bug), src/pages/tech/v2/customer/TechCustomerPage.jsx, and the CRM merge
--   tool. Fixing one caller leaves the other three broken. The invariant belongs
--   to the database.
--
-- ADDITIVE-ONLY:
--   Adds one function and one trigger. No table, column, index, policy, grant,
--   constraint or row is created, altered or removed. No data change. The
--   function is SECURITY INVOKER (database-standard.md §1 default): the caller
--   already holds UPDATE on `jobs` under `allow_authenticated_jobs`
--   (NOT is_crm_partner(auth.uid())), which is the same predicate that let them
--   update the contact in the first place, so no privilege is added anywhere. If
--   a caller somehow lacked it, RLS filters the UPDATE to zero rows rather than
--   corrupting anything — the propagation fails safe.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260817030000_job_insured_name_follows_contact.rollback.sql
--     DROP TRIGGER IF EXISTS trg_sync_job_insured_name ON public.contacts;
--     DROP FUNCTION IF EXISTS public.sync_job_insured_name_from_contact();
--   Exact and complete: this migration creates only those two objects and writes
--   no rows, so dropping them restores the prior state byte-for-byte. Names
--   already propagated before a rollback stay propagated — that is correct, they
--   are the right names.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_job_insured_name_from_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- A blank rename NEVER cascades. Clearing a contact's name carries no
  -- information to propagate, and propagating it would silently wipe the client
  -- label off every sibling job at once. `contacts.name` is nullable and
  -- JobPage's Client Information tile writes NULL when its Name field is
  -- cleared, so this is reachable from the UI today, not hypothetical:
  -- contact "A2Z Properties" has 26 jobs (measured 2026-08-17), so one stray
  -- clear would blank 26 live dispatch-board rows. Found in review of this
  -- migration before it was ever applied.
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    RETURN NULL;
  END IF;

  -- Only the jobs whose copy still tracked the old name, plus the empty ones.
  -- A job carrying its own deliberately different label is left untouched.
  UPDATE public.jobs
     SET insured_name = NEW.name,
         updated_at   = now()
   WHERE primary_contact_id = NEW.id
     AND (
           insured_name IS NOT DISTINCT FROM OLD.name
           OR NULLIF(btrim(COALESCE(insured_name, '')), '') IS NULL
         );

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$$;

COMMENT ON FUNCTION public.sync_job_insured_name_from_contact() IS
  'Propagates a contacts.name rename onto jobs.insured_name, but only for jobs whose '
  'snapshot still matched the old name or was blank. Jobs carrying a deliberate per-job '
  'label (e.g. "A2Z Properties (Henriquez)" under contact "A2Z Properties") are preserved. '
  'Added 2026-08-17 — before this, a corrected client name never reached the schedule.';

-- Managed-Supabase function trap (database-standard.md §1): this project re-applies
-- Postgres's built-in EXECUTE TO PUBLIC to every new function at ddl_command_end.
-- Not exploitable here — Postgres refuses to call a RETURNS-trigger function outside
-- the trigger manager whatever the ACL says — but the precedent
-- (oop_prevent_converted_quote_mutation, 20260803192344) revokes anyway, and a blanket
-- "no function ships with PUBLIC EXECUTE" is worth more than the exception.
REVOKE EXECUTE ON FUNCTION public.sync_job_insured_name_from_contact() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_sync_job_insured_name ON public.contacts;

CREATE TRIGGER trg_sync_job_insured_name
  AFTER UPDATE OF name ON public.contacts
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION public.sync_job_insured_name_from_contact();

-- ── POSTCONDITIONS ──────────────────────────────
-- Fail the migration loudly rather than leaving a half-installed sync.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_sync_job_insured_name'
       AND tgrelid = 'public.contacts'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'postcondition failed: trigger trg_sync_job_insured_name is not installed on public.contacts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'sync_job_insured_name_from_contact'
       AND p.prosecdef = false                       -- SECURITY INVOKER
       AND p.proconfig @> ARRAY['search_path=public'] -- pinned
  ) THEN
    RAISE EXCEPTION 'postcondition failed: sync_job_insured_name_from_contact() is missing, is SECURITY DEFINER, or has no pinned search_path';
  END IF;
END;
$$;
