-- ═══════════════════════════════════════════════════════════════════════════
-- UPR Collections / A-R Dashboard — Migration
-- Run once in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Add A-R columns to jobs table ────────────────────────────────────────
-- These are safe to add even if the job already has partial data.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS invoiced_value      NUMERIC(12,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_value     NUMERIC(12,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ar_status           TEXT           DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ar_notes            TEXT,
  ADD COLUMN IF NOT EXISTS invoiced_date       DATE,
  ADD COLUMN IF NOT EXISTS last_followup_date  DATE,
  ADD COLUMN IF NOT EXISTS deductible          NUMERIC(10,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductible_collected       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deductible_collected_date  DATE,
  ADD COLUMN IF NOT EXISTS depreciation_held          NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_released      NUMERIC(10,2) DEFAULT 0;

-- ar_status valid values: open | invoiced | partial | paid | disputed | written_off
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_ar_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_ar_status_check
  CHECK (ar_status IN ('open','invoiced','partial','paid','disputed','written_off'));


-- ── 2. Add nav_permissions row for collections ───────────────────────────────
-- Admins see all pages regardless; this grants access to other roles.

INSERT INTO nav_permissions (role, nav_key, can_view, can_edit)
VALUES
  ('admin',   'collections', TRUE, TRUE),
  ('manager', 'collections', TRUE, TRUE),
  ('office',  'collections', TRUE, TRUE)
ON CONFLICT (role, nav_key) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit  = EXCLUDED.can_edit;


-- ── 3. Create get_ar_jobs RPC ────────────────────────────────────────────────
-- Returns every job with its financials, primary contact, claim, and adjuster info.
-- The frontend calls this via db.rpc('get_ar_jobs', {}).

DROP FUNCTION IF EXISTS get_ar_jobs();

CREATE OR REPLACE FUNCTION get_ar_jobs()
RETURNS TABLE (
  -- Job identity
  id                          UUID,
  job_number                  TEXT,
  division                    TEXT,
  phase                       TEXT,
  created_at                  TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ,

  -- A-R financials
  invoiced_value              NUMERIC,
  collected_value             NUMERIC,
  ar_status                   TEXT,
  ar_notes                    TEXT,
  invoiced_date               DATE,
  last_followup_date          DATE,
  deductible                  NUMERIC,
  deductible_collected        BOOLEAN,
  deductible_collected_date   DATE,
  depreciation_held           NUMERIC,
  depreciation_released       NUMERIC,

  -- Claim / insurance
  claim_id                    UUID,
  claim_number                TEXT,
  insurance_company           TEXT,
  policy_number               TEXT,
  date_of_loss                DATE,

  -- Homeowner (primary insured)
  insured_name                TEXT,
  client_phone                TEXT,
  client_email                TEXT,

  -- Adjuster
  adjuster_name               TEXT,
  adjuster_phone              TEXT,
  adjuster_email              TEXT,

  -- Phase timing (for aging when invoiced_date is null)
  phase_entered_at            TIMESTAMPTZ,
  received_date               TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    j.id,
    j.job_number,
    j.division,
    j.phase,
    j.created_at,
    j.updated_at,

    -- financials (default 0 if null)
    COALESCE(j.invoiced_value,     0) AS invoiced_value,
    COALESCE(j.collected_value,    0) AS collected_value,
    COALESCE(j.ar_status,     'open') AS ar_status,
    j.ar_notes,
    j.invoiced_date,
    j.last_followup_date,
    COALESCE(j.deductible,         0) AS deductible,
    COALESCE(j.deductible_collected, FALSE) AS deductible_collected,
    j.deductible_collected_date,
    COALESCE(j.depreciation_held,      0) AS depreciation_held,
    COALESCE(j.depreciation_released,  0) AS depreciation_released,

    -- claim / insurance
    c.id           AS claim_id,
    c.claim_number,
    c.insurance_company,
    c.policy_number,
    c.date_of_loss,

    -- primary insured contact
    ins.full_name  AS insured_name,
    ins.phone      AS client_phone,
    ins.email      AS client_email,

    -- adjuster
    adj.full_name  AS adjuster_name,
    adj.phone      AS adjuster_phone,
    adj.email      AS adjuster_email,

    -- timing fallbacks for aging
    NULL::TIMESTAMPTZ AS phase_entered_at,   -- extend later if you track phase transitions
    j.created_at      AS received_date

  FROM jobs j

  -- Claim (nullable — some jobs may have no claim yet)
  LEFT JOIN claims c ON c.id = j.claim_id

  -- Primary homeowner: join via contact_jobs where role = 'homeowner' / 'customer'
  LEFT JOIN contact_jobs cj_ins
    ON cj_ins.job_id = j.id
   AND cj_ins.is_primary = TRUE
   AND cj_ins.role IN ('homeowner', 'customer', 'client')
  LEFT JOIN contacts ins ON ins.id = cj_ins.contact_id

  -- Adjuster: from the claim's adjuster_contact_id
  LEFT JOIN contacts adj ON adj.id = c.adjuster_contact_id

  ORDER BY
    -- outstanding balances first, then by balance size
    (COALESCE(j.invoiced_value, 0) - COALESCE(j.collected_value, 0)) DESC,
    j.created_at DESC;
$$;

-- Grant to both anon and authenticated so the RPC works with the anon key
GRANT EXECUTE ON FUNCTION get_ar_jobs() TO anon, authenticated;


-- ── 4. RLS — allow anon/authenticated to update the new AR columns ───────────
-- The jobs table should already have RLS enabled with UPDATE policies.
-- If your existing policy covers all columns, nothing extra is needed.
-- If you have a column-level restriction, add the new columns to it.

-- Check current RLS policies:
-- SELECT * FROM pg_policies WHERE tablename = 'jobs';

-- ── Done ─────────────────────────────────────────────────────────────────────
-- After running this migration, navigate to /collections in the app.
-- If you see "Setup required" banner, double-check the function was created:
--   SELECT proname FROM pg_proc WHERE proname = 'get_ar_jobs';
