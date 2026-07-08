-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p6_reporting_views.sql
-- DB-Foundation Phase P6 — Reporting-views foundation layer  [roadmap item ①]
--   docs/db-foundation-roadmap.md → Phase P6 block.
--
-- WHAT THIS DOES (plain language):
--   Adds a small, clean set of read-only "reporting views" over the core business
--   tables (jobs, invoices, payments, inbound leads, time entries). Each view is a
--   plain, faithful projection of its table — same rows — plus a few convenience
--   columns future dashboards keep re-deriving by hand: the Mountain-Time calendar
--   day of each timestamp (via mt_date), a QBO-synced flag, computed labor cost,
--   answered/missed-call flags, and invoice days-outstanding. This is the
--   "reporting foundation" the DB-Foundation initiative set out to establish
--   (there were 0 tracked views before this); no widget consumes them yet, so they
--   are purely additive scaffolding for later reporting work.
--
-- SECURITY (database-standard §1/§2):
--   • WITH (security_invoker = true) — the view runs with the QUERYING user's
--     rights, so each caller only sees rows their own RLS allows. Without this a
--     view runs as its OWNER and would silently bypass RLS on the base tables.
--   • REVOKE ALL FROM PUBLIC, anon, authenticated after each; then GRANT SELECT to
--     authenticated + service_role. So authenticated gets SELECT ONLY (the project
--     default-privileges GRANT ALL to authenticated on new objects is stripped —
--     honoring §1 least-privilege intent; no escalation either way since
--     security_invoker routes any write through base-table RLS). service_role keeps
--     its trusted-backend default. Never anon (not on the §2 public allowlist).
--
-- FE-CONTRACT / FREEZE (manifest §5): NEW names only (rv_* — verified zero
--   collisions live on 2026-07-08). No existing object is renamed, dropped, or
--   changed. Nothing the deployed frontend reads is touched.
--
-- ADDITIVE / SAFE: new views only. One shared Supabase (dev + prod) — live in both
--   on apply; no consumer references them yet, so applying first is safe.
--   Requires PostgreSQL 15+ for security_invoker (live is 17 — verified).
--   Column names verified live against information_schema.columns on 2026-07-08.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.rv_jobs;
--   DROP VIEW IF EXISTS public.rv_invoices;
--   DROP VIEW IF EXISTS public.rv_payments;
--   DROP VIEW IF EXISTS public.rv_leads;
--   DROP VIEW IF EXISTS public.rv_time_entries;
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── rv_jobs — one faithful row per job, MT day + rolled-up cost ─────────────
CREATE OR REPLACE VIEW public.rv_jobs WITH (security_invoker = true) AS
SELECT
  j.id                            AS job_id,
  j.job_number,
  j.division::text                AS division,
  j.phase,
  j.status,
  j.source::text                  AS source,
  j.lead_source,
  j.primary_contact_id,
  j.claim_id,
  j.project_manager_id,
  j.lead_tech_id,
  j.is_real_job,
  j.created_at,
  public.mt_date(j.created_at)    AS created_day,
  j.received_date,
  j.date_of_loss,
  j.target_completion,
  j.actual_completion,
  j.lead_converted_at,
  public.mt_date(j.lead_converted_at) AS converted_day,
  j.estimated_value,
  j.approved_value,
  j.invoiced_value,
  j.collected_value,
  j.deductible,
  j.total_labor_cost,
  j.total_material_cost,
  j.total_equipment_cost,
  j.total_sub_cost,
  j.total_other_cost,
  (COALESCE(j.total_labor_cost, 0)
   + COALESCE(j.total_material_cost, 0)
   + COALESCE(j.total_equipment_cost, 0)
   + COALESCE(j.total_sub_cost, 0)
   + COALESCE(j.total_other_cost, 0)) AS total_cost
FROM public.jobs j;

REVOKE ALL ON public.rv_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rv_jobs TO authenticated, service_role;

-- ─── rv_invoices — AR-oriented projection, MT day + days-outstanding ─────────
CREATE OR REPLACE VIEW public.rv_invoices WITH (security_invoker = true) AS
SELECT
  i.id                            AS invoice_id,
  i.job_id,
  i.contact_id,
  i.invoice_number,
  i.invoice_type,
  i.status,
  i.subtotal,
  i.tax,
  i.total,
  i.amount_paid,
  i.balance_due,
  i.insurance_responsibility,
  i.homeowner_responsibility,
  i.insurance_paid,
  i.homeowner_paid,
  i.invoice_date,
  i.due_date,
  i.sent_at,
  i.paid_at,
  i.created_at,
  public.mt_date(i.created_at)    AS created_day,
  i.carrier_name,
  i.claim_number,
  (i.qbo_invoice_id IS NOT NULL)  AS is_qbo_synced,
  CASE
    WHEN i.status IS DISTINCT FROM 'paid'
     AND COALESCE(i.balance_due, 0) > 0
     AND i.invoice_date IS NOT NULL
    THEN GREATEST(public.mt_today() - i.invoice_date, 0)
  END                             AS days_outstanding
FROM public.invoices i;

REVOKE ALL ON public.rv_invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rv_invoices TO authenticated, service_role;

-- ─── rv_payments — payments with MT day + QBO-synced flag ────────────────────
CREATE OR REPLACE VIEW public.rv_payments WITH (security_invoker = true) AS
SELECT
  p.id                            AS payment_id,
  p.invoice_id,
  p.job_id,
  p.contact_id,
  p.amount,
  p.payment_method,
  p.payment_date,
  p.payer_type,
  p.payer_name,
  p.is_deductible,
  p.is_depreciation_release,
  p.source,
  p.stripe_fee,
  p.refunded_amount,
  p.created_at,
  public.mt_date(p.created_at)    AS created_day,
  (p.qbo_payment_id IS NOT NULL)  AS is_qbo_synced
FROM public.payments p;

REVOKE ALL ON public.rv_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rv_payments TO authenticated, service_role;

-- ─── rv_leads — inbound leads with MT day + answered/missed-call flags ───────
CREATE OR REPLACE VIEW public.rv_leads WITH (security_invoker = true) AS
SELECT
  il.id                           AS lead_id,
  il.org_id,
  il.contact_id,
  il.source_type,
  il.source,
  il.medium,
  il.campaign,
  il.lead_status,
  il.value,
  il.lead_score,
  il.duration_sec,
  (il.source_type = 'call' AND COALESCE(il.duration_sec, 0) > 0)  AS is_answered_call,
  (il.source_type = 'call' AND COALESCE(il.duration_sec, 0) = 0)  AS is_missed_call,
  COALESCE(il.spam_flag, false)   AS spam_flag,
  il.lost_reason,
  COALESCE(il.occurred_at, il.created_at)                     AS occurred_at,
  public.mt_date(COALESCE(il.occurred_at, il.created_at))     AS occurred_day,
  il.created_at,
  public.mt_date(il.created_at)   AS created_day
FROM public.inbound_leads il;

REVOKE ALL ON public.rv_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rv_leads TO authenticated, service_role;

-- ─── rv_time_entries — labor with MT day + total (travel+on-site) labor cost ─
CREATE OR REPLACE VIEW public.rv_time_entries WITH (security_invoker = true) AS
SELECT
  t.id                            AS time_entry_id,
  t.job_id,
  t.employee_id,
  t.appointment_id,
  t.work_date,
  t.hours,
  t.travel_minutes,
  t.total_paused_minutes,
  t.hourly_rate,
  t.total_cost,
  -- Full labor cost = (travel + on-site) hours × rate (tech-mobile-ux time model).
  ((COALESCE(t.travel_minutes, 0) / 60.0) + COALESCE(t.hours, 0))
    * COALESCE(t.hourly_rate, 0)  AS computed_labor_cost,
  t.work_type,
  t.approved,
  t.source,
  t.clock_in,
  t.clock_out,
  t.created_at,
  public.mt_date(t.created_at)    AS created_day
FROM public.job_time_entries t;

REVOKE ALL ON public.rv_time_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rv_time_entries TO authenticated, service_role;
