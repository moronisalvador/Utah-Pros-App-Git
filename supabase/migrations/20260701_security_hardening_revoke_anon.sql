-- ════════════════════════════════════════════════════════════════════════════
-- Security hardening — revoke unauthenticated (anon) access + pin search_path
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY: The frontend talks to Postgres through PostgREST with the PUBLIC anon key
-- (shipped in the JS bundle) plus a logged-in user's JWT. A large set of
-- SECURITY DEFINER RPCs was granted EXECUTE to `anon`, which means ANYONE — with
-- no login at all — can call them with just the public key and read the whole
-- business (customers, claims, jobs, invoices, payments, employee pay rates) or
-- act as an admin. Confirmed live via Supabase `get_advisors(security)`
-- (243 anon-executable definer functions) and by reading the migrations.
--
-- ⚠️  APPLY ON `dev` FIRST, THEN VERIFY, THEN PROMOTE.
--     There is ONE shared Supabase project for dev AND main, so applying this
--     hits both immediately. These statements only remove access from the
--     `anon` (unauthenticated) role — logged-in employees use `authenticated`
--     and are unaffected — but confirm on dev that no public/anon flow regressed
--     before relying on it in production. Do NOT blind-apply to production.
--
-- SCOPE OF THIS FILE (safe, low-regression):
--   1. Revoke EXECUTE from `anon` on sensitive read/admin RPCs (all overloads).
--   2. Pin `search_path` on SECURITY DEFINER / trigger functions flagged mutable.
--
-- DELIBERATELY NOT IN THIS FILE (need schema-aware design + testing — see
-- SECURITY-AUDIT.md "Database remediation" for the plan):
--   - Time-entry "admin" RPCs authorize on a client-supplied `p_actor_id` instead
--     of `auth.uid()`; revoking anon here shrinks the blast radius from "anyone"
--     to "any authenticated employee", but the actor-id spoofing must still be
--     fixed in the function bodies (resolve the actor from auth.uid()).
--   - `employees` has an always-true UPDATE policy → a user can self-promote to
--     admin (`role='admin'`). Needs a restrictive policy (block self role change).
--   - 127 tables carry `USING (true)` RLS policies; the sensitive ones
--     (payments, invoices, contacts, claims, sign_requests, messages,
--     conversations, employees) need auth.uid()-scoped policies.
--   - Public storage buckets `job-files` / `message-attachments` allow listing
--     all objects; drop the broad SELECT policies / move to private + signed URLs.
--   - `set_billing_setting` payout-key exclusion ordering (re-opened by a later
--     migration) — verify the four stripe_payout_* keys are not writable here.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Revoke EXECUTE from anon on sensitive RPCs (covers every overload) ──────
-- Read RPCs expose the whole CRM/AR/financial book incl. employee pay rates.
-- The admin/settings RPCs must never be reachable without a session.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        -- Bulk data readers (PII / financial / labor cost)
        'global_search',
        'get_ar_invoices',
        'get_payments_ledger',
        'get_job_financials',
        'get_timesheet_entries_admin',
        'get_water_loss_report_data',
        'get_estimates',
        'get_upr_mcp_audit',
        'get_notifications',
        'get_tech_feedback',
        'get_billing_settings',
        -- Settings / admin mutations
        'set_billing_setting',
        -- Payroll "admin" writes (also see actor-id follow-up above)
        'admin_upsert_time_entry',
        'admin_clock_out_entry',
        'delete_time_entry',
        'review_time_entry_change_request',
        'submit_time_entry_change_request'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    RAISE NOTICE 'Revoked anon EXECUTE on %', r.sig;
  END LOOP;
END $$;

-- ── 2. Pin search_path on functions flagged `function_search_path_mutable` ─────
-- A SECURITY DEFINER / trigger function without a pinned search_path can be
-- hijacked via schema/function shadowing. Pinning to `public, pg_temp` is the
-- Supabase-recommended, behavior-preserving fix.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'log_phase_change',
        'update_sign_requests_updated_at',
        'trigger_job_events',
        'trigger_claim_events',
        'trigger_note_events',
        'trigger_auto_job_number',
        'generate_job_number',
        'demo_sheet_schemas_touch_updated_at',
        'update_contact_addresses_updated_at',
        'calc_time_entry_cost',
        'update_employees_updated_at',
        'update_updated_at',
        'update_appointments_updated_at',
        'update_job_tasks_updated_at',
        'generate_claim_number',
        'enforce_private_appointment_role',
        'update_invoice_paid',
        'dash_division_bucket'
      ])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    RAISE NOTICE 'Pinned search_path on %', r.sig;
  END LOOP;
END $$;
