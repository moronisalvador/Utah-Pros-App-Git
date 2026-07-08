-- ════════════════════════════════════════════════
-- DB-Foundation Phase P5 — FK covering indexes (hot-path subset)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds btree indexes on a small, hand-picked set of foreign-key columns that
--   sit on genuinely hot query paths (dispatch, billing, e-sign, clock, inbound
--   SMS routing). Postgres does NOT auto-index the referencing side of a foreign
--   key, so these lookups/joins (and the integrity check when a parent row is
--   deleted) currently fall back to a sequential scan. Each index makes the
--   navigation from the FK column O(log n) and future-proofs the table as it grows.
--
-- WHY THIS SUBSET (not all 108 unindexed FKs):
--   The live audit found 108 unindexed FKs. The vast majority are employee
--   audit columns (created_by / updated_by / recorded_by / entered_by / …) that
--   are never filtered on and whose parent (employees) is deactivated, never
--   DELETEd — indexing them only taxes writes for no read benefit. The other
--   large bucket is zero-row, flag-gated CRM/form/sequence tables (page:crm is
--   closed) — not hot-path today. This migration indexes ONLY FK columns that
--   back an ACTIVE read path right now:
--     • jobs.lead_tech_id             — filter jobs by lead tech (dispatch/schedule)
--     • invoices.estimate_id          — estimate → invoice link (billing)
--     • estimates.converted_invoice_id— estimate → converted invoice (billing)
--     • job_documents.sign_request_id — docs for an e-sign request (45k+ seq scans on this table)
--     • sign_requests.contact_id      — sign requests for a contact (e-sign)
--     • job_time_entries.continued_from — supersede/continuation clock chain (tech clock)
--     • conversation_participants.contact_id — inbound SMS resolves conversation by participant contact_id (hot)
--
-- SCOPE GUARD:
--   Indexes ONLY. Touches none of P4's declared external-ID columns (all seven
--   columns here are internal uuid FKs, not qbo_/encircle_ external IDs).
--   Plain CREATE INDEX (not CONCURRENTLY): CONCURRENTLY is illegal inside the
--   apply_migration transaction and unnecessary — every target table is < 320 rows,
--   so the build lock is sub-millisecond.
--
-- TIER: YELLOW (purely additive; cannot break existing readers; rollback below).
--
-- ROLLBACK (undo — safe anytime, no deploy needed):
--   DROP INDEX IF EXISTS public.idx_jobs_lead_tech_id;
--   DROP INDEX IF EXISTS public.idx_invoices_estimate_id;
--   DROP INDEX IF EXISTS public.idx_estimates_converted_invoice_id;
--   DROP INDEX IF EXISTS public.idx_job_documents_sign_request_id;
--   DROP INDEX IF EXISTS public.idx_sign_requests_contact_id;
--   DROP INDEX IF EXISTS public.idx_job_time_entries_continued_from;
--   DROP INDEX IF EXISTS public.idx_conversation_participants_contact_id;
-- ════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_jobs_lead_tech_id
  ON public.jobs (lead_tech_id);

CREATE INDEX IF NOT EXISTS idx_invoices_estimate_id
  ON public.invoices (estimate_id);

CREATE INDEX IF NOT EXISTS idx_estimates_converted_invoice_id
  ON public.estimates (converted_invoice_id);

CREATE INDEX IF NOT EXISTS idx_job_documents_sign_request_id
  ON public.job_documents (sign_request_id);

CREATE INDEX IF NOT EXISTS idx_sign_requests_contact_id
  ON public.sign_requests (contact_id);

CREATE INDEX IF NOT EXISTS idx_job_time_entries_continued_from
  ON public.job_time_entries (continued_from);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_contact_id
  ON public.conversation_participants (contact_id);
