-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 0 — progress tracking + shell skeleton
--
-- docs/crm-roadmap.md, "Phase 0 — Progress tracking + shell skeleton". First CRM
-- migration: crm_orgs (the org_id tenancy seam every later CRM table carries),
-- crm_build_phases + crm_build_stages (the always-current build tracker so the
-- build never loses track of where it stopped), their RPCs, and the page:crm
-- feature flag.
--
-- ALL ADDITIVE: three new tables, three new functions, one feature_flags seed row.
-- No existing object is altered. RLS enabled at creation on every new table, per
-- CLAUDE.md Rule 7 / the CRM Phase Workflow additive-only rule.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. crm_orgs — the org_id tenancy seam every later CRM table carries ─────────
CREATE TABLE IF NOT EXISTS crm_orgs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_test    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm_orgs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_orgs_all" ON crm_orgs;
CREATE POLICY "crm_orgs_all" ON crm_orgs
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Seeded once, guarded by name so re-running this migration never duplicates rows.
INSERT INTO crm_orgs (name, is_test)
SELECT 'Utah Pros Restoration', false
WHERE NOT EXISTS (SELECT 1 FROM crm_orgs WHERE name = 'Utah Pros Restoration');

INSERT INTO crm_orgs (name, is_test)
SELECT 'Utah Pros — TEST', true
WHERE NOT EXISTS (SELECT 1 FROM crm_orgs WHERE name = 'Utah Pros — TEST');

-- 2. crm_build_phases — one row per roadmap phase ──────────────────────────────
CREATE TABLE IF NOT EXISTS crm_build_phases (
  phase_key  text PRIMARY KEY,
  title      text NOT NULL,
  status     text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'shipped')),
  shipped_at timestamptz,
  sort_order int NOT NULL DEFAULT 0
);

ALTER TABLE crm_build_phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_build_phases_all" ON crm_build_phases;
CREATE POLICY "crm_build_phases_all" ON crm_build_phases
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO crm_build_phases (phase_key, title, sort_order) VALUES
  ('0',  'Progress tracking + shell skeleton',        0),
  ('1',  'CRM shell + CallRail lead ingestion',        1),
  ('2',  'Ad spend ingestion',                         2),
  ('3',  'Attribution + funnel dashboard',              3),
  ('4a', 'Lead pipeline',                               4),
  ('4b', 'Text-blast campaigns',                        5),
  ('4c', 'Email campaigns',                             6),
  ('4d', 'Fixed automations',                           7),
  ('5',  'Visual automation builder',                   8)
ON CONFLICT (phase_key) DO UPDATE
  SET title = EXCLUDED.title,
      sort_order = EXCLUDED.sort_order;

-- 3. crm_build_stages — the sub-steps/to-dos inside each phase ─────────────────
-- Seeded from each phase's committed close-out checklist in docs/crm-roadmap.md.
CREATE TABLE IF NOT EXISTS crm_build_stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_key  text NOT NULL REFERENCES crm_build_phases(phase_key) ON DELETE CASCADE,
  title      text NOT NULL,
  status     text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (phase_key, title)
);
CREATE INDEX IF NOT EXISTS idx_crm_build_stages_phase ON crm_build_stages(phase_key);

ALTER TABLE crm_build_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_build_stages_all" ON crm_build_stages;
CREATE POLICY "crm_build_stages_all" ON crm_build_stages
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO crm_build_stages (phase_key, title, sort_order) VALUES
  -- Phase 0
  ('0', 'Test-first: status RPCs stamp shipped_at + stage rollup counts (integration test)', 0),
  ('0', 'Acceptance: /crm/roadmap renders phases/stages/progress, gated page:crm; crm_orgs seeded (real + TEST)', 1),
  ('0', 'npm run test + npm run build + npx eslint pass', 2),
  ('0', 'upr-pattern-checker clean; crm-phase-reviewer sign-off', 3),
  ('0', 'Visual: /crm/roadmap progress page on the branch preview', 4),
  ('0', 'Dogfood: mark phase-0 stages done + phase-0 shipped via the RPCs', 5),
  ('0', 'UPR-Web-Context.md updated', 6),

  -- Phase 1
  ('1', 'Test-first: upsert_lead_from_callrail idempotency (b) + shouldCreateContact spam filter (c)', 0),
  ('1', 'Every Phase 1 acceptance criterion passes', 1),
  ('1', 'npm run test + npm run build + npx eslint pass', 2),
  ('1', 'upr-pattern-checker clean; crm-phase-reviewer signs off', 3),
  ('1', 'Visual check vs the Stitch handoff — Call Log + Integrations screens', 4),
  ('1', 'UPR-Web-Context.md updated', 5),
  ('1', 'Set phase-1 shipped; delete test rows by the dev tracking number', 6),
  ('1', 'Pushed to dev, verified on dev.utahpros.app, then dev → main PR opened', 7),

  -- Phase 2
  ('2', 'Test-first: Mountain-Time date helpers (d) — mountainYesterday / isStale', 0),
  ('2', 'Acceptance: daily cron upserts ad_spend idempotently; backfill matches tolerance; Google + Meta connect via integration_credentials; worker_runs row per sync', 1),
  ('2', 'npm run test + npm run build + npx eslint pass', 2),
  ('2', 'upr-pattern-checker clean; crm-phase-reviewer sign-off', 3),
  ('2', 'Visual: n/a (backend ingestion) — verify rows land; branch preview stays green', 4),
  ('2', 'UPR-Web-Context.md updated', 5),
  ('2', 'Set phase-2 shipped; delete any test spend rows', 6),
  ('2', 'Pushed to dev, verified, dev → main PR opened', 7),

  -- Phase 3
  ('3', 'Test-first: attribution calc functions — cost-per-lead, ROAS, cost-per-job, rollup, funnel conversion, null-for-zero-spend, div-by-zero guards', 0),
  ('3', 'Acceptance: dashboard spend → leads → estimates → won → revenue; CallRail + won jobs are source of truth; zero-spend sources render —', 1),
  ('3', 'npm run test + npm run build + npx eslint pass', 2),
  ('3', 'upr-pattern-checker clean; crm-phase-reviewer sign-off weighted on attribution math', 3),
  ('3', 'Visual: Attribution, Overview funnel, Reports screens vs the handoff', 4),
  ('3', 'Set phase-3 shipped', 5),
  ('3', 'UPR-Web-Context.md updated; pushed, verified, dev → main PR opened', 6),

  -- Phase 4a
  ('4a', 'Test-first: pipeline value math + stage ordering respects pipeline_stages.sort_order', 0),
  ('4a', 'Acceptance: Kanban driven by pipeline_stages; unified contact activity timeline; columns reorder/rename from Settings, no code change', 1),
  ('4a', 'npm run test + npm run build + npx eslint pass; upr-pattern-checker clean; crm-phase-reviewer sign-off', 2),
  ('4a', 'Visual: Leads (pipeline board) + contact timeline vs the handoff', 3),
  ('4a', 'Set phase-4a shipped; UPR-Web-Context.md updated; pushed, verified, dev → main PR opened', 4),

  -- Phase 4b
  ('4b', 'Test-first: consentAllows(row) consent gate (a)', 0),
  ('4b', 'Acceptance: recipients segmented; every send routes through sendAutomatedMessage() → consent gate; sends via send-message.js', 1),
  ('4b', 'npm run test + npm run build + npx eslint pass; upr-pattern-checker clean; crm-phase-reviewer sign-off weighted on the consent gate', 2),
  ('4b', 'Visual: campaign builder/list vs the handoff', 3),
  ('4b', 'Set phase-4b shipped; delete test campaign/recipient rows; UPR-Web-Context.md updated; pushed, verified, dev → main PR opened', 4),

  -- Phase 4c
  ('4c', 'Test-first: unsubscribe-suppression predicate (emailAllows)', 0),
  ('4c', 'Acceptance: segmented bulk email via Resend; simple template UI; unsubscribe handling wired', 1),
  ('4c', 'npm run test + npm run build + npx eslint pass; upr-pattern-checker clean; crm-phase-reviewer sign-off', 2),
  ('4c', 'Visual: email campaign builder vs the handoff', 3),
  ('4c', 'Set phase-4c shipped; UPR-Web-Context.md updated; pushed, verified, dev → main PR opened', 4),

  -- Phase 4d
  ('4d', 'Test-first: isStale() no-response trigger; each automation''s trigger predicate fires the right system_events type; consent gate reused', 0),
  ('4d', 'Acceptance: 4 fixed automations route through sendAutomatedMessage() → consent gate, fire system_events, on/off toggleable via automation_settings', 1),
  ('4d', 'npm run test + npm run build + npx eslint pass; upr-pattern-checker clean; crm-phase-reviewer sign-off weighted on consent gate + trigger correctness', 2),
  ('4d', 'Visual: automation_settings toggles in Settings', 3),
  ('4d', 'Set phase-4d shipped; delete test automation rows; UPR-Web-Context.md updated; pushed, verified, dev → main PR opened', 4),

  -- Phase 5
  ('5', 'Close-out checklist defined when this phase is actually scheduled — inherits the generic close-out rule', 0)
ON CONFLICT (phase_key, title) DO NOTHING;

-- 4. get_crm_build_progress() — phases with nested stages + done/total rollups ──
CREATE OR REPLACE FUNCTION get_crm_build_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phases jsonb;
  v_overall_done  int;
  v_overall_total int;
BEGIN
  SELECT COALESCE(jsonb_agg(x.phase_obj ORDER BY x.sort_order), '[]'::jsonb)
    INTO v_phases
  FROM (
    SELECT
      p.sort_order,
      jsonb_build_object(
        'phase_key',   p.phase_key,
        'title',       p.title,
        'status',      p.status,
        'shipped_at',  p.shipped_at,
        'sort_order',  p.sort_order,
        'stages',      COALESCE(s.stages, '[]'::jsonb),
        'done_count',  COALESCE(s.done_count, 0),
        'total_count', COALESCE(s.total_count, 0)
      ) AS phase_obj
    FROM crm_build_phases p
    LEFT JOIN (
      SELECT
        cs.phase_key,
        jsonb_agg(
          jsonb_build_object('id', cs.id, 'title', cs.title, 'status', cs.status, 'sort_order', cs.sort_order)
          ORDER BY cs.sort_order
        ) AS stages,
        COUNT(*) FILTER (WHERE cs.status = 'done') AS done_count,
        COUNT(*) AS total_count
      FROM crm_build_stages cs
      GROUP BY cs.phase_key
    ) s ON s.phase_key = p.phase_key
  ) x;

  SELECT COALESCE(SUM((phase->>'done_count')::int), 0), COALESCE(SUM((phase->>'total_count')::int), 0)
    INTO v_overall_done, v_overall_total
  FROM jsonb_array_elements(v_phases) AS phase;

  RETURN jsonb_build_object(
    'phases',        v_phases,
    'overall_done',  v_overall_done,
    'overall_total', v_overall_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_crm_build_progress() TO anon, authenticated;

-- 5. set_crm_phase_status(p_phase_key, p_status) — stamps shipped_at on 'shipped' ─
CREATE OR REPLACE FUNCTION set_crm_phase_status(p_phase_key text, p_status text)
RETURNS crm_build_phases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row crm_build_phases;
BEGIN
  IF p_status NOT IN ('planned', 'in_progress', 'shipped') THEN
    RAISE EXCEPTION 'invalid crm phase status: %', p_status;
  END IF;

  UPDATE crm_build_phases
     SET status     = p_status,
         shipped_at = CASE WHEN p_status = 'shipped' THEN now() ELSE shipped_at END
   WHERE phase_key = p_phase_key
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown crm phase_key: %', p_phase_key;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION set_crm_phase_status(text, text) TO anon, authenticated;

-- 6. set_crm_stage_status(p_stage_id, p_status) ────────────────────────────────
CREATE OR REPLACE FUNCTION set_crm_stage_status(p_stage_id uuid, p_status text)
RETURNS crm_build_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row crm_build_stages;
BEGIN
  IF p_status NOT IN ('todo', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'invalid crm stage status: %', p_status;
  END IF;

  UPDATE crm_build_stages
     SET status = p_status
   WHERE id = p_stage_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown crm stage id: %', p_stage_id;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION set_crm_stage_status(uuid, text) TO anon, authenticated;

-- 7. page:crm feature flag — dev-only for Moroni until phased rollout ──────────
INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_at)
VALUES (
  'page:crm',
  false,
  'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da',
  'page',
  'CRM',
  'CallRail + ad-attribution CRM module (docs/crm-roadmap.md). Dev-only for Moroni until each phase is ready for wider rollout.',
  now()
)
ON CONFLICT (key) DO UPDATE
  SET dev_only_user_id = EXCLUDED.dev_only_user_id,
      category = EXCLUDED.category,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      updated_at = now();

-- 8. Bust PostgREST schema cache ────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
