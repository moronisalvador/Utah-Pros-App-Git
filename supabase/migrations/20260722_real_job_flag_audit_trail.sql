-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_real_job_flag_audit_trail
-- Phase: n/a (standalone CRM data-integrity fix — owner-directed)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   jobs.is_real_job is the company's single source of truth for "we sold
--   this job" — but until now, changes to it left no record at all. A bulk
--   demotion on 2026-07-03 silently un-sold 13 jobs (16 jobs total carry
--   paid QuickBooks invoices while flagged is_real_job=false — $50,905
--   invoiced), and set_job_real_job made it worse by OVERWRITING
--   real_job_source='manual' + real_job_marked_at=now() even when DEMOTING,
--   destroying the record of what originally proved the sale. 8 more jobs
--   are is_real_job=true with BOTH real_job_source and real_job_marked_at
--   NULL — raw writes that went through no function at all.
--
--   This migration adds three things: (1) a read-only history table
--   (job_real_flag_history) that keeps a permanent before/after record of
--   every change; (2) a trigger on jobs that writes that record
--   automatically no matter HOW the change happens — through the RPC, an
--   automation, or a raw UPDATE/INSERT — so nothing can slip past it again;
--   and (3) a body-only fix to set_job_real_job so that demoting a job
--   (p_is_real=false) PRESERVES real_job_source and real_job_marked_at.
--   After this, "is_real_job=false but real_job_marked_at IS NOT NULL"
--   remains the recognizable signature of a demoted-once-sold job, and the
--   history table says exactly who changed what, when.
--
-- ADDITIVE-ONLY:
--   One new table (RLS enabled + explicit policy at creation), one new
--   trigger function + two triggers on jobs (AFTER — they never block or
--   alter the underlying write), and a function-BODY-only CREATE OR REPLACE
--   of set_job_real_job (signature byte-for-byte unchanged, RETURNS jobs;
--   promote path behavior-identical). No ALTER/DROP/rename of any live
--   table, no data change.
--
--   POLICY-BREADTH DECISION (reviewer-requested conscious call, 2026-07-22):
--   the history table's SELECT policy is deliberately the authenticated
--   floor (USING (true)) rather than admin-gated — this ledger records WHO
--   flipped a sale flag, which is exactly the transparency staff should be
--   able to see; money computation stays gated where it lives
--   (get_commissions, billing). Tighten to a role predicate later if the
--   owner ever wants it private.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_job_real_flag_history_ins ON public.jobs;
--   DROP TRIGGER IF EXISTS trg_job_real_flag_history_upd ON public.jobs;
--   DROP FUNCTION IF EXISTS public.record_job_real_flag_change();
--   DROP TABLE IF EXISTS public.job_real_flag_history;
--   -- then re-apply the prior set_job_real_job body verbatim
--   -- (pg_get_functiondef, captured live 2026-07-22):
--   CREATE OR REPLACE FUNCTION public.set_job_real_job(p_job_id uuid, p_is_real boolean, p_actor uuid DEFAULT NULL::uuid)
--    RETURNS jobs
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--     DECLARE r public.jobs;
--   BEGIN
--     UPDATE public.jobs
--        SET is_real_job        = p_is_real,
--            real_job_source    = 'manual',
--            real_job_marked_at = now(),
--            updated_by         = COALESCE(p_actor, updated_by)
--      WHERE id = p_job_id
--      RETURNING * INTO r;
--     RETURN r;
--   END; $function$;
--   REVOKE EXECUTE ON FUNCTION public.set_job_real_job(uuid, boolean, uuid) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.set_job_real_job(uuid, boolean, uuid) TO authenticated, service_role;
-- ════════════════════════════════════════════════

-- 1. The history table — append-only ledger of every change to the sale
--    flag trio (is_real_job / real_job_source / real_job_marked_at).
--    Only the trigger below writes it; staff can only read it.
CREATE TABLE public.job_real_flag_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  old_is_real   boolean,
  new_is_real   boolean NOT NULL,
  old_source    text,
  new_source    text,
  old_marked_at timestamptz,
  new_marked_at timestamptz,
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_real_flag_history_job_changed
  ON public.job_real_flag_history (job_id, changed_at);

ALTER TABLE public.job_real_flag_history ENABLE ROW LEVEL SECURITY;

-- Read-only history: authenticated staff may read; nobody INSERTs through
-- PostgREST (the SECURITY DEFINER trigger function below is the sole writer
-- — as table owner it bypasses RLS).
CREATE POLICY job_real_flag_history_select ON public.job_real_flag_history
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.job_real_flag_history FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.job_real_flag_history TO authenticated;
GRANT ALL ON TABLE public.job_real_flag_history TO service_role;

-- 2. Trigger function + triggers — capture EVERY change to the trio, no
--    matter what code path made it (RPC, automation trigger, raw UPDATE).
--    AFTER INSERT also records a row when a job is born already-sold
--    (is_real_job=true on insert — the raw-write pattern that produced the
--    8 unexplained true/NULL/NULL jobs). auth.uid() is wrapped so a
--    service-role or trigger-context call (where it is NULL or the auth
--    schema is unavailable) can never error the parent write.
CREATE OR REPLACE FUNCTION public.record_job_real_flag_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.job_real_flag_history
      (job_id, old_is_real, new_is_real, old_source, new_source,
       old_marked_at, new_marked_at, changed_by)
    VALUES
      (NEW.id, NULL, NEW.is_real_job, NULL, NEW.real_job_source,
       NULL, NEW.real_job_marked_at, v_actor);
  ELSE
    INSERT INTO public.job_real_flag_history
      (job_id, old_is_real, new_is_real, old_source, new_source,
       old_marked_at, new_marked_at, changed_by)
    VALUES
      (OLD.id, OLD.is_real_job, NEW.is_real_job,
       OLD.real_job_source, NEW.real_job_source,
       OLD.real_job_marked_at, NEW.real_job_marked_at, v_actor);
  END IF;

  RETURN NULL; -- AFTER trigger: return value ignored
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): every function DDL
-- re-grants EXECUTE TO PUBLIC — revoke explicitly. (A trigger function is
-- not directly callable via PostgREST either way; belt-and-suspenders.)
REVOKE EXECUTE ON FUNCTION public.record_job_real_flag_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_job_real_flag_change() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_job_real_flag_history_upd ON public.jobs;
CREATE TRIGGER trg_job_real_flag_history_upd
AFTER UPDATE ON public.jobs
FOR EACH ROW
WHEN (OLD.is_real_job        IS DISTINCT FROM NEW.is_real_job
   OR OLD.real_job_source    IS DISTINCT FROM NEW.real_job_source
   OR OLD.real_job_marked_at IS DISTINCT FROM NEW.real_job_marked_at)
EXECUTE FUNCTION public.record_job_real_flag_change();

DROP TRIGGER IF EXISTS trg_job_real_flag_history_ins ON public.jobs;
CREATE TRIGGER trg_job_real_flag_history_ins
AFTER INSERT ON public.jobs
FOR EACH ROW
WHEN (NEW.is_real_job IS TRUE)
EXECUTE FUNCTION public.record_job_real_flag_change();

-- 3. set_job_real_job — body-only replace (signature FROZEN, RETURNS jobs).
--    PROMOTE (p_is_real=true): unchanged from today — stamps source='manual'
--    + marked_at=now(). DEMOTE (p_is_real=false): now flips ONLY the flag
--    (+ updated_by), PRESERVING real_job_source / real_job_marked_at so the
--    original evidence of the sale survives the demotion. The old body
--    overwrote both on demote — that is how the 2026-07-03 bulk demotion
--    destroyed the provenance of 13 sold jobs.
CREATE OR REPLACE FUNCTION public.set_job_real_job(p_job_id uuid, p_is_real boolean, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE r public.jobs;
BEGIN
  IF p_is_real THEN
    UPDATE public.jobs
       SET is_real_job        = true,
           real_job_source    = 'manual',
           real_job_marked_at = now(),
           updated_by         = COALESCE(p_actor, updated_by)
     WHERE id = p_job_id
     RETURNING * INTO r;
  ELSE
    -- DEMOTE: preserve source/marked_at — is_real_job=false with
    -- real_job_marked_at NOT NULL is the recognizable "was sold, then
    -- demoted" signature (the history table has the full story).
    UPDATE public.jobs
       SET is_real_job = false,
           updated_by  = COALESCE(p_actor, updated_by)
     WHERE id = p_job_id
     RETURNING * INTO r;
  END IF;
  RETURN r;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.set_job_real_job(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_job_real_job(uuid, boolean, uuid) TO authenticated, service_role;
