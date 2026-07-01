-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 4a — Lead pipeline
--
-- docs/crm-roadmap.md, "Phase 4a — Lead pipeline". Adds the editable
-- pipeline_stages table (replacing the hardcoded New/Contacted/Qualified/
-- Estimate Sent/Won/Lost enum that used to live only as inbound_leads.
-- lead_status text and CrmCallLog.jsx's STATUS_OPTIONS array), a
-- lead_pipeline_stage table tracking each lead's current stage, and the
-- RPCs the Leads Kanban board + CRM Settings CRUD + contact activity
-- timeline read/write through.
--
-- lead_pipeline_stage is a NEW table rather than a column added to
-- inbound_leads — keeps this phase's migration to new tables only, with
-- zero touch to a table introduced in an earlier phase.
--
-- ALL ADDITIVE: two new tables, five new functions, no existing table
-- altered. RLS enabled at creation, per CLAUDE.md Rule 7. org_id carried
-- from day one on both new tables, same seam as inbound_leads/ad_spend.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. pipeline_stages — admin-editable Kanban columns ─────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES crm_orgs(id),
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  color       text NOT NULL DEFAULT '#6366f1',
  is_won      boolean NOT NULL DEFAULT false,
  is_lost     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_org_sort ON pipeline_stages(org_id, sort_order);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_stages_all" ON pipeline_stages;
CREATE POLICY "pipeline_stages_all" ON pipeline_stages
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Seed the default stage set for both the real org and the disposable TEST
-- org (Test-data isolation — CRM build sessions can move/delete test-org
-- stages without ever touching the real pipeline config).
INSERT INTO pipeline_stages (org_id, name, sort_order, color, is_won, is_lost)
SELECT o.id, s.name, s.sort_order, s.color, s.is_won, s.is_lost
FROM crm_orgs o
CROSS JOIN (VALUES
  ('New',           0, '#6366f1', false, false),
  ('Contacted',     1, '#0ea5e9', false, false),
  ('Qualified',     2, '#8b5cf6', false, false),
  ('Estimate Sent', 3, '#f59e0b', false, false),
  ('Won',           4, '#059669', true,  false),
  ('Lost',          5, '#dc2626', false, true)
) AS s(name, sort_order, color, is_won, is_lost)
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.org_id = o.id);

-- 2. lead_pipeline_stage — current stage per lead ─────────────────────────────
-- One row per lead that has been placed on the board; a lead with no row
-- here reads as sitting in the first stage (lowest sort_order) — see
-- get_leads_pipeline() and src/lib/crmPipeline.js's groupLeadsByStage(),
-- which apply the same fallback on the frontend.
CREATE TABLE IF NOT EXISTS lead_pipeline_stage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL UNIQUE REFERENCES inbound_leads(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES crm_orgs(id),
  stage_id    uuid NOT NULL REFERENCES pipeline_stages(id),
  moved_by    uuid REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_pipeline_stage_stage ON lead_pipeline_stage(stage_id);
CREATE INDEX IF NOT EXISTS idx_lead_pipeline_stage_org ON lead_pipeline_stage(org_id);

ALTER TABLE lead_pipeline_stage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_pipeline_stage_all" ON lead_pipeline_stage;
CREATE POLICY "lead_pipeline_stage_all" ON lead_pipeline_stage
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 3. get_pipeline_stages(...) — read helper for the board + Settings ─────────
CREATE OR REPLACE FUNCTION get_pipeline_stages(p_org_id uuid DEFAULT NULL)
RETURNS SETOF pipeline_stages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM pipeline_stages
  WHERE org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
  ORDER BY sort_order;
$$;

GRANT EXECUTE ON FUNCTION get_pipeline_stages(uuid) TO anon, authenticated;

-- 4. upsert_pipeline_stage(...) — the Settings CRUD RPC ───────────────────────
-- Add (p_id NULL), or rename/recolor/reorder/toggle won-lost (p_id set) —
-- a stage never needs a code change, only a row edit, per the roadmap's
-- "not a hardcoded enum" requirement.
CREATE OR REPLACE FUNCTION upsert_pipeline_stage(
  p_id          uuid DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_color       text DEFAULT '#6366f1',
  p_sort_order  int DEFAULT NULL,
  p_is_won      boolean DEFAULT false,
  p_is_lost     boolean DEFAULT false,
  p_org_id      uuid DEFAULT NULL
)
RETURNS pipeline_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row    pipeline_stages;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'pipeline stage name is required';
  END IF;
  IF p_is_won AND p_is_lost THEN
    RAISE EXCEPTION 'a pipeline stage cannot be both is_won and is_lost';
  END IF;

  v_org_id := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));

  IF p_id IS NULL THEN
    INSERT INTO pipeline_stages (org_id, name, color, sort_order, is_won, is_lost)
    VALUES (
      v_org_id, btrim(p_name), COALESCE(p_color, '#6366f1'),
      COALESCE(p_sort_order, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM pipeline_stages WHERE org_id = v_org_id)),
      p_is_won, p_is_lost
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE pipeline_stages
       SET name       = btrim(p_name),
           color      = COALESCE(p_color, color),
           sort_order = COALESCE(p_sort_order, sort_order),
           is_won     = p_is_won,
           is_lost    = p_is_lost,
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown pipeline_stages id: %', p_id;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_pipeline_stage(uuid, text, text, int, boolean, boolean, uuid) TO anon, authenticated;

-- 5. delete_pipeline_stage(...) — refuses to orphan leads already on it ──────
CREATE OR REPLACE FUNCTION delete_pipeline_stage(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM lead_pipeline_stage WHERE stage_id = p_stage_id) THEN
    RAISE EXCEPTION 'cannot delete a pipeline stage with leads on it — move them first';
  END IF;

  DELETE FROM pipeline_stages WHERE id = p_stage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown pipeline_stages id: %', p_stage_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_pipeline_stage(uuid) TO anon, authenticated;

-- 6. move_lead_to_stage(...) — drag-and-drop / stage-picker write RPC ────────
CREATE OR REPLACE FUNCTION move_lead_to_stage(
  p_lead_id   uuid,
  p_stage_id  uuid,
  p_moved_by  uuid DEFAULT NULL
)
RETURNS lead_pipeline_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_row    lead_pipeline_stage;
BEGIN
  SELECT org_id INTO v_org_id FROM inbound_leads WHERE id = p_lead_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE id = p_stage_id) THEN
    RAISE EXCEPTION 'unknown pipeline_stages id: %', p_stage_id;
  END IF;

  INSERT INTO lead_pipeline_stage (lead_id, org_id, stage_id, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, p_moved_by)
  ON CONFLICT (lead_id) DO UPDATE SET
    stage_id   = EXCLUDED.stage_id,
    moved_by   = EXCLUDED.moved_by,
    updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_stage_changed', 'inbound_lead', p_lead_id, p_moved_by, jsonb_build_object('stage_id', p_stage_id));

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION move_lead_to_stage(uuid, uuid, uuid) TO anon, authenticated;

-- 7. get_contact_activity(...) — the unified contact activity timeline ──────
-- Merges every activity source Phase 4a asks for: calls/forms (inbound_leads),
-- SMS (messages, joined through conversation_participants since messages
-- itself only records the sender contact, not every participant), notes
-- (job_notes, joined through contact_jobs since notes are job-scoped), and
-- estimate history (estimates.contact_id is direct).
CREATE OR REPLACE FUNCTION get_contact_activity(p_contact_id uuid)
RETURNS TABLE(
  activity_type text,
  occurred_at    timestamptz,
  title          text,
  body           text,
  meta           jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'lead'::text,
    COALESCE(il.occurred_at, il.created_at),
    CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
    COALESCE(il.transcription, il.notes),
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url
    )
  FROM inbound_leads il
  WHERE il.contact_id = p_contact_id

  UNION ALL

  SELECT
    'sms'::text,
    m.created_at,
    CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END,
    m.body,
    jsonb_build_object('channel', m.channel, 'status', m.status)
  FROM messages m
  WHERE m.conversation_id IN (
    SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'note'::text,
    jn.created_at,
    'Note'::text,
    jn.body,
    jsonb_build_object('job_id', jn.job_id, 'author_name', jn.author_name)
  FROM job_notes jn
  WHERE jn.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'estimate'::text,
    e.created_at,
    'Estimate ' || COALESCE(e.estimate_number, e.id::text),
    NULL::text,
    jsonb_build_object('status', e.status, 'amount', e.amount, 'estimate_id', e.id)
  FROM estimates e
  WHERE e.contact_id = p_contact_id

  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION get_contact_activity(uuid) TO anon, authenticated;

-- 8. Bust PostgREST schema cache ───────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
