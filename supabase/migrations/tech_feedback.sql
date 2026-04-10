-- Tech Feedback table + RPCs
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

-- ── Insert RPC (tech submits feedback) ─────────────────────────────────────────

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

-- ── Get all feedback (admin view) ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_tech_feedback()
RETURNS TABLE (
  id            UUID,
  employee_id   UUID,
  employee_name TEXT,
  type          TEXT,
  title         TEXT,
  description   TEXT,
  screenshots   JSONB,
  status        TEXT,
  admin_notes   TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT
      f.id, f.employee_id,
      e.full_name AS employee_name,
      f.type, f.title, f.description,
      f.screenshots, f.status, f.admin_notes,
      f.created_at
    FROM tech_feedback f
    JOIN employees e ON e.id = f.employee_id
    ORDER BY f.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_tech_feedback TO anon, authenticated;

-- ── Update feedback status/notes (admin action) ───────────────────────────────

CREATE OR REPLACE FUNCTION update_tech_feedback(
  p_id          UUID,
  p_status      TEXT,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS tech_feedback
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result tech_feedback;
BEGIN
  UPDATE tech_feedback
  SET status      = p_status,
      admin_notes = COALESCE(p_admin_notes, admin_notes)
  WHERE id = p_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION update_tech_feedback TO anon, authenticated;
