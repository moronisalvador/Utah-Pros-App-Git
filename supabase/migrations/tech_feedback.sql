-- Tech Feedback table + RPC
-- Run this in Supabase SQL Editor before using the feedback feature

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tech_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id),
  type          TEXT NOT NULL CHECK (type IN ('bug', 'feature')),
  title         TEXT NOT NULL,
  description   TEXT,
  screenshots   JSONB DEFAULT '[]'::jsonb,   -- array of storage paths
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved', 'dismissed')),
  admin_notes   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tech_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tech_feedback_all" ON tech_feedback
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ── Insert RPC ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION insert_tech_feedback(
  p_employee_id UUID,
  p_type        TEXT,
  p_title       TEXT,
  p_description TEXT DEFAULT NULL,
  p_screenshots JSONB DEFAULT '[]'::jsonb
)
RETURNS tech_feedback
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result tech_feedback;
BEGIN
  INSERT INTO tech_feedback (employee_id, type, title, description, screenshots)
  VALUES (p_employee_id, p_type, p_title, p_description, p_screenshots)
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_tech_feedback TO anon, authenticated;
