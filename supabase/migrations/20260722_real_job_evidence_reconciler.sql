-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_real_job_evidence_reconciler
-- Phase: n/a (standalone canonical-sale-flag reliability fix — owner-directed)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The company's "is this a real sold job?" flag (jobs.is_real_job) is set
--   automatically by three kinds of hard evidence — a QuickBooks-synced
--   invoice, a signed Work Authorization / Reconstruction Agreement, or an
--   approved estimate — but the flag can silently drift away from that
--   evidence and nothing tells anyone. Verified live 2026-07-22: 16 jobs have
--   PAID QuickBooks invoices yet are flagged "not a real job" ($50,905
--   invoiced; 13 of them were un-sold by a 2026-07-03 bulk demotion through
--   set_job_real_job, which stamps over the original proof), and 15 jobs are
--   flagged real with zero evidence on file. It took a manual audit to find
--   any of this. This migration adds a read-only "reconciler" report that
--   lists every job whose flag disagrees with its own evidence, in two
--   buckets, plus a once-a-day database timer that quietly logs one
--   system_events row whenever at least one mismatch exists — so drift
--   surfaces on its own instead of waiting for the next manual audit.
--
--   Deliberately NOT done here: no data is changed and no flag is flipped.
--   A job flagged real by hand ('manual') can be perfectly legitimate — the
--   report surfaces everything and includes real_job_source so the consumer
--   can filter; deciding what to fix stays a human call.
--
-- ADDITIVE-ONLY:
--   Yes — one new read-only (STABLE) function + one named pg_cron schedule
--   (cron.schedule is upsert-by-name, idempotent). No table/column/policy
--   change, no data change. The cron body only ever INSERTs into the
--   append-only system_events log, and only when a mismatch exists.
--
-- DEPENDS ON:
--   Tables:    jobs, invoices, sign_requests, estimates, contacts (reads);
--              system_events (cron writes one row per drift day)
--   Extension: pg_cron (already enabled — 20260626_pr3_enable_pg_cron.sql)
--
-- NOTES / GOTCHAS:
--   - The three evidence predicates are copied VERBATIM from the live
--     mark_job_real triggers (20260627_real_job_classification.sql):
--     invoices.qbo_invoice_id IS NOT NULL; sign_requests status='signed' AND
--     doc_type IN ('work_auth','recon_agreement'); estimates lower(status) IN
--     ('approved','accepted','converted','signed'). If those triggers ever
--     change, this reconciler must change in the same migration.
--   - was_demoted keys on real_job_marked_at IS NOT NULL while
--     is_real_job=false — the exact signature set_job_real_job leaves behind
--     when it demotes (it overwrites source/marked_at even on demotion).
--   - pg_cron runs in UTC: '15 13 * * *' = 6:15/7:15 AM Denver (DST/standard)
--     — before the workday, after the overnight QBO/automation crons.
--   - system_events.entity_id is NOT NULL with no FK; this is a whole-table
--     summary event (no single job), so it uses the all-zeros sentinel uuid —
--     per-job detail lives in the RPC, not the event row.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   SELECT cron.unschedule('upr_real_job_evidence_reconciler');
--   DROP FUNCTION public.get_real_job_evidence_mismatches();
--   (Optional: DELETE FROM public.system_events
--      WHERE event_type = 'real_job_evidence_mismatch';)
-- ════════════════════════════════════════════════

-- ─── SECTION: the reconciler report RPC ──────────────
-- One row per job whose is_real_job flag disagrees with its own canonical
-- evidence. Two categories:
--   'evidence_unflagged'  — evidence exists but is_real_job=false (lost sales
--                           in every report; includes the demotion victims)
--   'flagged_no_evidence' — is_real_job=true with none of the three evidence
--                           kinds (possibly-legit manual marks — surfaced, not
--                           judged; consumer filters by real_job_source)
CREATE OR REPLACE FUNCTION public.get_real_job_evidence_mismatches()
 RETURNS SETOF json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH ev AS (
    SELECT j.id                 AS job_id,
           j.job_number,
           j.is_real_job,
           j.real_job_source,
           j.real_job_marked_at,
           c.name               AS contact_name,
           -- The three canonical evidence predicates — verbatim from the
           -- mark_job_real triggers (see header gotcha).
           EXISTS (SELECT 1 FROM invoices i
                    WHERE i.job_id = j.id
                      AND i.qbo_invoice_id IS NOT NULL)                    AS has_invoice,
           EXISTS (SELECT 1 FROM sign_requests sr
                    WHERE sr.job_id = j.id
                      AND sr.status = 'signed'
                      AND sr.doc_type IN ('work_auth','recon_agreement'))  AS has_work_auth,
           EXISTS (SELECT 1 FROM estimates e
                    WHERE e.job_id = j.id
                      AND lower(COALESCE(e.status, '')) IN
                          ('approved','accepted','converted','signed'))    AS has_estimate
    FROM jobs j
    LEFT JOIN contacts c ON c.id = j.primary_contact_id
    WHERE j.status IS DISTINCT FROM 'deleted'
  ),
  mismatches AS (
    -- Category 1: evidence exists, flag says "not a sale".
    SELECT 1                            AS grp,
           COALESCE(inv.invoiced_total, 0) AS sort_amt,
           json_build_object(
             'job_id',          ev.job_id,
             'job_number',      ev.job_number,
             'category',        'evidence_unflagged',
             'evidence',        array_to_json(
                                  ARRAY[]::text[]
                                  || CASE WHEN ev.has_work_auth THEN ARRAY['work_auth'] ELSE ARRAY[]::text[] END
                                  || CASE WHEN ev.has_invoice   THEN ARRAY['invoice']   ELSE ARRAY[]::text[] END
                                  || CASE WHEN ev.has_estimate  THEN ARRAY['estimate']  ELSE ARRAY[]::text[] END),
             'invoiced_total',  COALESCE(inv.invoiced_total, 0),
             'amount_paid',     COALESCE(inv.amount_paid, 0),
             'was_demoted',     (ev.real_job_marked_at IS NOT NULL),  -- the set_job_real_job demotion signature
             'real_job_source', ev.real_job_source,
             'contact_name',    ev.contact_name
           ) AS row_json
    FROM ev
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(COALESCE(i.adjusted_total, i.total, 0)), 0) AS invoiced_total,
             COALESCE(SUM(COALESCE(i.amount_paid, 0)), 0)             AS amount_paid
      FROM invoices i
      WHERE i.job_id = ev.job_id AND i.qbo_invoice_id IS NOT NULL
    ) inv ON true
    WHERE ev.is_real_job = false
      AND (ev.has_invoice OR ev.has_work_auth OR ev.has_estimate)

    UNION ALL

    -- Category 2: flag says "sale", zero evidence on file. Manual marks are
    -- documented-legitimate — included on purpose; filter by real_job_source.
    SELECT 2       AS grp,
           0::numeric AS sort_amt,
           json_build_object(
             'job_id',             ev.job_id,
             'job_number',         ev.job_number,
             'category',           'flagged_no_evidence',
             'real_job_source',    ev.real_job_source,
             'real_job_marked_at', ev.real_job_marked_at,
             'contact_name',       ev.contact_name
           ) AS row_json
    FROM ev
    WHERE ev.is_real_job = true
      AND NOT (ev.has_invoice OR ev.has_work_auth OR ev.has_estimate)
  )
  SELECT m.row_json
  FROM mismatches m
  ORDER BY m.grp, m.sort_amt DESC;
END;
$function$;

-- Managed-Supabase trap: this project re-grants EXECUTE TO PUBLIC on every
-- function DDL — the explicit REVOKE below is mandatory, not belt-and-braces.
REVOKE EXECUTE ON FUNCTION public.get_real_job_evidence_mismatches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_real_job_evidence_mismatches() TO authenticated, service_role;

-- ─── SECTION: daily drift safety net (pg_cron) ──────────────
-- Self-contained SQL (pg_cron runs inside the DB — no pg_net/http needed).
-- Logs exactly ONE system_events row per firing, and ONLY when at least one
-- mismatch exists — a clean day writes nothing. cron.schedule is
-- upsert-by-name, so re-applying this migration is idempotent.
SELECT cron.schedule(
  'upr_real_job_evidence_reconciler',
  '15 13 * * *',  -- UTC → 6:15/7:15 AM Denver
  $$
  INSERT INTO public.system_events (event_type, entity_type, entity_id, payload)
  SELECT 'real_job_evidence_mismatch',
         'jobs',
         -- Whole-table summary sentinel: entity_id is NOT NULL with no FK, and
         -- this event summarizes ALL jobs, not one. Accepted as the house
         -- convention for whole-table events (reviewer-confirmed 2026-07-22).
         '00000000-0000-0000-0000-000000000000'::uuid,
         jsonb_build_object(
           'evidence_unflagged',  counts.evidence_unflagged,
           'flagged_no_evidence', counts.flagged_no_evidence,
           'checked_at',          now()
         )
  FROM (
    SELECT COUNT(*) FILTER (WHERE m->>'category' = 'evidence_unflagged')  AS evidence_unflagged,
           COUNT(*) FILTER (WHERE m->>'category' = 'flagged_no_evidence') AS flagged_no_evidence
    FROM public.get_real_job_evidence_mismatches() AS m
  ) counts
  WHERE counts.evidence_unflagged + counts.flagged_no_evidence > 0;
  $$
);
