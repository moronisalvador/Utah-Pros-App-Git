-- ════════════════════════════════════════════════
-- FILE: 20260627_real_job_classification.sql
--
-- WHAT THIS DOES (plain language):
--   Adds a flag to every job that says whether it's a REAL JOB (work we were
--   actually authorized to do and/or billed) versus an ESTIMATE/LEAD that never
--   sold. The dashboard's "New claims booked" tile and the billing reports use
--   this flag so they only count real jobs, not estimates we went out to look at.
--
--   A job is flagged real automatically the moment ANY of these happens:
--     • a Work Authorization (or Reconstruction Agreement) is SIGNED in UPR   ← the gate
--     • a real (QuickBooks-synced) invoice is created for the job
--     • the job's estimate is APPROVED
--   A tech clocking in does NOT count (techs clock in to do estimate visits too).
--   A "Real job / Estimate" toggle (set_job_real_job) lets the office mark or
--   override any job by hand; a manual mark is never overwritten by the triggers.
--
-- NOTES / GOTCHAS:
--   • Every job auto-gets a DRAFT invoice on creation (trg_create_draft_invoice),
--     so the invoice signal keys on qbo_invoice_id IS NOT NULL (actually billed),
--     never on the mere existence of an invoice row.
--   • Inert until the frontend reads is_real_job / get_real_claims_created — safe
--     to apply ahead of the dashboard PR.
-- ════════════════════════════════════════════════

-- ─── SECTION: columns ──────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS is_real_job        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS real_job_source    text,          -- 'work_auth' | 'invoice' | 'estimate' | 'manual' | 'backfill'
  ADD COLUMN IF NOT EXISTS real_job_marked_at timestamptz;

COMMENT ON COLUMN public.jobs.is_real_job IS
  'TRUE = authorized/billed real job (counts in New-claims-booked + billing reports). FALSE = estimate/lead. Auto-set by signed work-auth, QBO invoice, or approved estimate; manually overridable.';

-- ─── SECTION: helper (idempotent; never downgrades a mark) ──────────────
CREATE OR REPLACE FUNCTION public.mark_job_real(p_job_id uuid, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_job_id IS NULL THEN RETURN; END IF;
  UPDATE public.jobs
     SET is_real_job        = true,
         real_job_source    = COALESCE(real_job_source, p_source),  -- keep the first authoritative source
         real_job_marked_at = COALESCE(real_job_marked_at, now())
   WHERE id = p_job_id
     AND is_real_job = false;
END; $$;

-- ─── SECTION: manual override RPC (UI toggle) ──────────────
CREATE OR REPLACE FUNCTION public.set_job_real_job(p_job_id uuid, p_is_real boolean, p_actor uuid DEFAULT NULL)
RETURNS public.jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE r public.jobs;
BEGIN
  UPDATE public.jobs
     SET is_real_job        = p_is_real,
         real_job_source    = 'manual',
         real_job_marked_at = now(),
         updated_by         = COALESCE(p_actor, updated_by)
   WHERE id = p_job_id
   RETURNING * INTO r;
  RETURN r;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_job_real_job(uuid, boolean, uuid) TO anon, authenticated;

-- ─── SECTION: auto-set triggers ──────────────
-- Work Authorization / Reconstruction Agreement signed  → the primary gate
CREATE OR REPLACE FUNCTION public.trg_signreq_real_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'signed' AND NEW.doc_type IN ('work_auth','recon_agreement') THEN
    PERFORM public.mark_job_real(NEW.job_id, 'work_auth');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS signreq_real_job ON public.sign_requests;
CREATE TRIGGER signreq_real_job AFTER INSERT OR UPDATE OF status ON public.sign_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_signreq_real_job();

-- A real (QBO-synced) invoice exists for the job
CREATE OR REPLACE FUNCTION public.trg_invoice_real_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.qbo_invoice_id IS NOT NULL THEN
    PERFORM public.mark_job_real(NEW.job_id, 'invoice');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS invoice_real_job ON public.invoices;
CREATE TRIGGER invoice_real_job AFTER INSERT OR UPDATE OF qbo_invoice_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_real_job();

-- Estimate approved/accepted
CREATE OR REPLACE FUNCTION public.trg_estimate_real_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(COALESCE(NEW.status,'')) IN ('approved','accepted','converted','signed') THEN
    PERFORM public.mark_job_real(NEW.job_id, 'estimate');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS estimate_real_job ON public.estimates;
CREATE TRIGGER estimate_real_job AFTER INSERT OR UPDATE OF status ON public.estimates
  FOR EACH ROW EXECUTE FUNCTION public.trg_estimate_real_job();

-- ─── SECTION: dashboard read RPC ──────────────
-- Claims (created_at >= floor) that have >= 1 real job — for "New claims booked".
CREATE OR REPLACE FUNCTION public.get_real_claims_created(p_floor timestamptz)
RETURNS TABLE(created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.created_at
  FROM public.claims c
  WHERE c.created_at >= p_floor
    AND COALESCE(c.status,'') <> 'deleted'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.claim_id = c.id AND j.is_real_job = true AND COALESCE(j.status,'') <> 'deleted'
    )
  ORDER BY c.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_real_claims_created(timestamptz) TO anon, authenticated;

-- ─── SECTION: one-time backfill (existing data, all-time) ──────────────
UPDATE public.jobs j
   SET is_real_job        = true,
       real_job_source    = 'backfill',
       real_job_marked_at = now()
 WHERE j.is_real_job = false
   AND (
     EXISTS (SELECT 1 FROM public.invoices i  WHERE i.job_id = j.id AND i.qbo_invoice_id IS NOT NULL)
  OR EXISTS (SELECT 1 FROM public.estimates e WHERE e.job_id = j.id AND lower(COALESCE(e.status,'')) IN ('approved','accepted','converted','signed'))
  OR EXISTS (SELECT 1 FROM public.sign_requests sr WHERE sr.job_id = j.id AND sr.status = 'signed' AND sr.doc_type IN ('work_auth','recon_agreement'))
   );
