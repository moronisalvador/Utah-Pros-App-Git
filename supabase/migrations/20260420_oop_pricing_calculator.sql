-- ─────────────────────────────────────────────────────────────────────────────
-- OOP Pricing Calculator — Phase 1
-- Out-of-pocket quote builder for water mitigation + mold remediation jobs.
-- Dev-only behind `tool:oop_pricing` feature flag (Moroni only initially).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oop_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('water','mold')),

  insured_name TEXT,
  address TEXT,

  tech_hours NUMERIC(8,2) DEFAULT 0,
  bill_rate NUMERIC(8,2) DEFAULT 92,

  air_mover_count INT DEFAULT 0,
  air_mover_days INT DEFAULT 0,
  lgr_count INT DEFAULT 0,
  lgr_days INT DEFAULT 0,
  xlgr_count INT DEFAULT 0,
  xlgr_days INT DEFAULT 0,
  air_scrubber_count INT DEFAULT 0,
  air_scrubber_days INT DEFAULT 0,
  neg_air_count INT DEFAULT 0,
  neg_air_days INT DEFAULT 0,

  materials_actual_cost NUMERIC(10,2) DEFAULT 0,
  antimicrobial_sqft NUMERIC(10,2) DEFAULT 0,
  disposal_trips INT DEFAULT 0,

  containment_linear_ft NUMERIC(10,2) DEFAULT 0,
  prv_invoice_cost NUMERIC(10,2) DEFAULT 0,

  quote_total NUMERIC(10,2),
  net_margin_pct NUMERIC(6,2),

  notes TEXT,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oop_quotes_job ON oop_quotes(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oop_quotes_created ON oop_quotes(created_at DESC);

ALTER TABLE oop_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oop_quotes authenticated read" ON oop_quotes;
CREATE POLICY "oop_quotes authenticated read"
  ON oop_quotes FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "oop_quotes authenticated write" ON oop_quotes;
CREATE POLICY "oop_quotes authenticated write"
  ON oop_quotes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Quote number generator ───────────────────────────────────────────────────
-- Format: OOP-YYMM-XXX (e.g., OOP-2604-001). Sequence resets implicitly per
-- YYMM by counting existing rows with the current prefix.
CREATE OR REPLACE FUNCTION generate_oop_quote_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'OOP-' || to_char(now(), 'YYMM') || '-';
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM oop_quotes
  WHERE quote_number LIKE v_prefix || '%';
  RETURN v_prefix || lpad((v_count + 1)::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_oop_quote_number() TO authenticated;

-- 3. Upsert quote ─────────────────────────────────────────────────────────────
-- p_id NULL → insert (auto-generates quote_number)
-- p_id set  → update existing
CREATE OR REPLACE FUNCTION upsert_oop_quote(
  p_id UUID,
  p_job_id UUID,
  p_job_type TEXT,
  p_insured_name TEXT,
  p_address TEXT,
  p_tech_hours NUMERIC,
  p_bill_rate NUMERIC,
  p_air_mover_count INT, p_air_mover_days INT,
  p_lgr_count INT, p_lgr_days INT,
  p_xlgr_count INT, p_xlgr_days INT,
  p_air_scrubber_count INT, p_air_scrubber_days INT,
  p_neg_air_count INT, p_neg_air_days INT,
  p_materials_actual_cost NUMERIC,
  p_antimicrobial_sqft NUMERIC,
  p_disposal_trips INT,
  p_containment_linear_ft NUMERIC,
  p_prv_invoice_cost NUMERIC,
  p_quote_total NUMERIC,
  p_net_margin_pct NUMERIC,
  p_notes TEXT,
  p_created_by UUID
)
RETURNS oop_quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row oop_quotes;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO oop_quotes (
      quote_number, job_id, job_type, insured_name, address,
      tech_hours, bill_rate,
      air_mover_count, air_mover_days,
      lgr_count, lgr_days,
      xlgr_count, xlgr_days,
      air_scrubber_count, air_scrubber_days,
      neg_air_count, neg_air_days,
      materials_actual_cost, antimicrobial_sqft, disposal_trips,
      containment_linear_ft, prv_invoice_cost,
      quote_total, net_margin_pct, notes, created_by
    ) VALUES (
      generate_oop_quote_number(), p_job_id, p_job_type, p_insured_name, p_address,
      COALESCE(p_tech_hours,0), COALESCE(p_bill_rate,92),
      COALESCE(p_air_mover_count,0), COALESCE(p_air_mover_days,0),
      COALESCE(p_lgr_count,0), COALESCE(p_lgr_days,0),
      COALESCE(p_xlgr_count,0), COALESCE(p_xlgr_days,0),
      COALESCE(p_air_scrubber_count,0), COALESCE(p_air_scrubber_days,0),
      COALESCE(p_neg_air_count,0), COALESCE(p_neg_air_days,0),
      COALESCE(p_materials_actual_cost,0), COALESCE(p_antimicrobial_sqft,0), COALESCE(p_disposal_trips,0),
      COALESCE(p_containment_linear_ft,0), COALESCE(p_prv_invoice_cost,0),
      p_quote_total, p_net_margin_pct, p_notes, p_created_by
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE oop_quotes SET
      job_id = p_job_id,
      job_type = p_job_type,
      insured_name = p_insured_name,
      address = p_address,
      tech_hours = COALESCE(p_tech_hours,0),
      bill_rate = COALESCE(p_bill_rate,92),
      air_mover_count = COALESCE(p_air_mover_count,0),
      air_mover_days = COALESCE(p_air_mover_days,0),
      lgr_count = COALESCE(p_lgr_count,0),
      lgr_days = COALESCE(p_lgr_days,0),
      xlgr_count = COALESCE(p_xlgr_count,0),
      xlgr_days = COALESCE(p_xlgr_days,0),
      air_scrubber_count = COALESCE(p_air_scrubber_count,0),
      air_scrubber_days = COALESCE(p_air_scrubber_days,0),
      neg_air_count = COALESCE(p_neg_air_count,0),
      neg_air_days = COALESCE(p_neg_air_days,0),
      materials_actual_cost = COALESCE(p_materials_actual_cost,0),
      antimicrobial_sqft = COALESCE(p_antimicrobial_sqft,0),
      disposal_trips = COALESCE(p_disposal_trips,0),
      containment_linear_ft = COALESCE(p_containment_linear_ft,0),
      prv_invoice_cost = COALESCE(p_prv_invoice_cost,0),
      quote_total = p_quote_total,
      net_margin_pct = p_net_margin_pct,
      notes = p_notes,
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_oop_quote(
  UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC,
  INT, INT, INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, NUMERIC, INT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID
) TO authenticated;

-- 4. Get list ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_oop_quotes(p_limit INT DEFAULT 50, p_job_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID, quote_number TEXT, job_id UUID, job_type TEXT,
  insured_name TEXT, address TEXT,
  quote_total NUMERIC, net_margin_pct NUMERIC,
  created_at TIMESTAMPTZ, created_by UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.quote_number, q.job_id, q.job_type,
         q.insured_name, q.address,
         q.quote_total, q.net_margin_pct,
         q.created_at, q.created_by
  FROM oop_quotes q
  WHERE (p_job_id IS NULL OR q.job_id = p_job_id)
  ORDER BY q.created_at DESC
  LIMIT COALESCE(p_limit, 50);
$$;

GRANT EXECUTE ON FUNCTION get_oop_quotes(INT, UUID) TO authenticated;

-- 5. Get single ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_oop_quote(p_id UUID)
RETURNS oop_quotes
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM oop_quotes WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION get_oop_quote(UUID) TO authenticated;

-- 6. Delete ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_oop_quote(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM oop_quotes WHERE id = p_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_oop_quote(UUID) TO authenticated;

-- 7. Feature flag seed (dev-only for Moroni) ─────────────────────────────────
INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_at)
VALUES (
  'tool:oop_pricing',
  false,
  'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da',
  'tool',
  'OOP Pricing Calculator',
  'Out-of-pocket quote builder for water mitigation + mold remediation. Dev-only until rolled out.',
  now()
)
ON CONFLICT (key) DO UPDATE
  SET dev_only_user_id = EXCLUDED.dev_only_user_id,
      category = EXCLUDED.category,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      updated_at = now();

-- 8. Nav permissions seed ─────────────────────────────────────────────────────
-- Admins always see everything; this grants access to other roles for when we
-- eventually flip the feature flag on.
INSERT INTO nav_permissions (role, nav_key, can_view, can_edit)
VALUES
  ('admin',           'oop_pricing', TRUE,  TRUE),
  ('project_manager', 'oop_pricing', TRUE,  TRUE),
  ('office',          'oop_pricing', TRUE,  FALSE),
  ('supervisor',      'oop_pricing', FALSE, FALSE),
  ('field_tech',      'oop_pricing', FALSE, FALSE)
ON CONFLICT (role, nav_key) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;

-- 9. Bust PostgREST schema cache ──────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
