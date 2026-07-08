-- ════════════════════════════════════════════════
-- MIGRATION: 20260708_dbf_p1_advisor_quick_wins
-- Phase: DB-Foundation P1 (advisor quick wins)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Two low-risk, behavior-preserving security/perf fixes flagged by the
--   Supabase advisors:
--     1. Pins search_path = public on 25 functions that currently have a
--        role-mutable search_path (the `function_search_path_mutable` WARN).
--        This is an ATTRIBUTE change only — no function body changes. Every one
--        of the 25 was read live first: all reference only public objects,
--        pg_catalog built-ins, and explicitly-qualified auth.uid(), so a
--        public-pinned path resolves identically (pg_catalog is always searched).
--     2. Drops the duplicate btree(job_id) index on job_notes, keeping one.
--
-- ADDITIVE / ATTRIBUTE-ONLY: no table DROP/RENAME/ALTER COLUMN, no data change.
--
-- ── DEFERRED (NOT in this migration): pg_net out of public ──
--   The roadmap's `ALTER EXTENSION pg_net SET SCHEMA extensions` was verified
--   live and it ERRORS: pg_net is non-relocatable
--   ("extension pg_net does not support SET SCHEMA"). The only way to relocate
--   it is DROP EXTENSION + CREATE EXTENSION ... SCHEMA extensions, which is
--   DESTRUCTIVE (drops net.http_request_queue with any in-flight async requests
--   and momentarily breaks the 4 pg_cron jobs that call net.http_post) and
--   violates P1's additive/attribute-only, no-DROP constraint. Flagged for a
--   separate reviewed RED-tier change. See the PR body.
--
-- ── ALSO NOTED (owner dashboard toggle, no migration): leaked-password ──
--   Enable "Leaked password protection" in Supabase Dashboard →
--   Authentication → Providers/Policies (the `auth_leaked_password_protection`
--   advisor). Cannot be done via SQL migration. See the PR body.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   -- (1) un-pin search_path on all 25 functions:
--   --   ALTER FUNCTION public.<name>(<argtypes>) RESET search_path;
--   --   (repeat for each function listed below, same signatures)
--   -- (2) recreate the dropped duplicate index:
--   --   CREATE INDEX idx_job_notes_job_id ON public.job_notes USING btree (job_id);
-- ════════════════════════════════════════════════
-- APPLY NOTE: search_path pins are YELLOW-tier (attribute-only, auto-applyable).
-- The DROP INDEX at the end is RED-tier (any DROP) per the roadmap autonomy
-- ledger — applied here under the task dispatch's explicit "apply live" +
-- named "drop the duplicate job_notes index" deliverable (per-item owner
-- authorization). Fully reversible via the rollback above.
-- ════════════════════════════════════════════════

-- ─── 1a. search_path pin — 7 SECURITY DEFINER functions (highest priority) ───
ALTER FUNCTION public.get_property_meld_melds(boolean) SET search_path = public;
ALTER FUNCTION public.get_purgeable_feedback_media(integer) SET search_path = public;
ALTER FUNCTION public.get_tech_feedback() SET search_path = public;
ALTER FUNCTION public.insert_tech_feedback(uuid, text, text, text, jsonb, jsonb, text) SET search_path = public;
ALTER FUNCTION public.mark_feedback_attachments_purged(uuid) SET search_path = public;
ALTER FUNCTION public.update_tech_feedback(uuid, text, text) SET search_path = public;
ALTER FUNCTION public.upsert_property_meld_meld(
  text, text, text, text, text, text, text, boolean, text, text, text, text,
  text, text, text, text, text, boolean, text, text, text, text, timestamptz
) SET search_path = public;

-- ─── 1b. search_path pin — 18 SECURITY INVOKER functions (triggers/helpers) ───
ALTER FUNCTION public.calc_time_entry_cost() SET search_path = public;
ALTER FUNCTION public.dash_division_bucket(text) SET search_path = public;
ALTER FUNCTION public.demo_sheet_schemas_touch_updated_at() SET search_path = public;
ALTER FUNCTION public.enforce_private_appointment_role() SET search_path = public;
ALTER FUNCTION public.generate_claim_number() SET search_path = public;
ALTER FUNCTION public.generate_job_number(text) SET search_path = public;
ALTER FUNCTION public.log_phase_change() SET search_path = public;
ALTER FUNCTION public.trigger_auto_job_number() SET search_path = public;
ALTER FUNCTION public.trigger_claim_events() SET search_path = public;
ALTER FUNCTION public.trigger_job_events() SET search_path = public;
ALTER FUNCTION public.trigger_note_events() SET search_path = public;
ALTER FUNCTION public.update_appointments_updated_at() SET search_path = public;
ALTER FUNCTION public.update_contact_addresses_updated_at() SET search_path = public;
ALTER FUNCTION public.update_employees_updated_at() SET search_path = public;
ALTER FUNCTION public.update_invoice_paid() SET search_path = public;
ALTER FUNCTION public.update_job_tasks_updated_at() SET search_path = public;
ALTER FUNCTION public.update_sign_requests_updated_at() SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;

-- ─── 2. Drop the duplicate btree(job_id) index on job_notes ───
-- Live catalog showed two identical non-unique btree(job_id) indexes:
--   idx_job_notes_job_id  and  job_notes_job_idx
-- Keep job_notes_job_idx (matches the sibling naming: job_notes_author_idx,
-- job_notes_created_idx, job_notes_encircle_note_id_idx); drop the other.
-- Neither is a UNIQUE/constraint index, so this is safe.
DROP INDEX IF EXISTS public.idx_job_notes_job_id;
