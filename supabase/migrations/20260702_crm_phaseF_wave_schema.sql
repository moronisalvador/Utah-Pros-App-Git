-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase F — Foundation wave schema
--
-- docs/crm-roadmap.md, "Phase F — Foundation". Phase F owns 100% of the
-- parallel wave's SCHEMA — every table, column, constraint, policy and index
-- the downstream phases (4d, 6a, 6b, 7, 8, 9, 10) consume. Those sessions ship
-- ZERO schema migrations; they only fill the bodies of the frozen RPC stubs
-- (a separate Phase F migration) against the tables created here.
--
-- ALL ADDITIVE (CLAUDE.md Rule 7 + the CRM phase rule "new tables/columns
-- only; no ALTER/DROP/rename of a live table"): new tables + new columns only,
-- nothing existing is altered/dropped/retyped. Every new table is RLS-enabled
-- with an explicit anon+authenticated policy at creation; every CRM parent
-- carries org_id from day one (children mirror the lead_pipeline_stage seam);
-- external ids (form public_id, submission_token) are UNIQUE.
--
-- One shared Supabase across dev + main — everything here is live in both the
-- moment it applies. The /crm/* surface stays invisible behind the page:crm
-- feature flag, so no user sees these tables until each phase opens its screen.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. automation_settings — per-org fixed-automation toggles + SMS kill-switch ═══
-- One row per org. sms_sending_enabled is the global SMS kill-switch (default
-- OFF): the completed functions/lib/automated-send.js sms branch refuses to
-- send while it is false, so 4d/8 can build SMS steps that stay dark until
-- Phase 4b flips this ON after A2P 10DLC carrier approval. Bodies of
-- get_automation_settings / set_automation_setting are Phase 4d's frozen stubs.
CREATE TABLE IF NOT EXISTS automation_settings (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        uuid NOT NULL UNIQUE REFERENCES crm_orgs(id),
  sms_sending_enabled           boolean NOT NULL DEFAULT false,
  speed_to_lead_enabled         boolean NOT NULL DEFAULT false,
  missed_call_textback_enabled  boolean NOT NULL DEFAULT false,
  no_response_followup_enabled  boolean NOT NULL DEFAULT false,
  review_request_enabled        boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automation_settings_all" ON automation_settings;
CREATE POLICY "automation_settings_all" ON automation_settings
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Seed one row per org (real + disposable TEST) with everything OFF.
INSERT INTO automation_settings (org_id)
SELECT o.id FROM crm_orgs o
WHERE NOT EXISTS (SELECT 1 FROM automation_settings a WHERE a.org_id = o.id);

-- ═══ 2. crm_tasks — CRM to-dos (Phase 7) ═══
CREATE TABLE IF NOT EXISTS crm_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES crm_orgs(id),
  title        text NOT NULL,
  notes        text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  due_at       timestamptz,
  remind_at    timestamptz,
  assignee_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id      uuid REFERENCES inbound_leads(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_org_status_due ON crm_tasks(org_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee ON crm_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact ON crm_tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead ON crm_tasks(lead_id);

ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_tasks_all" ON crm_tasks;
CREATE POLICY "crm_tasks_all" ON crm_tasks
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 3. lead_stage_history — append-only pipeline movement log (Phases 7, 9) ═══
-- lead_pipeline_stage is current-stage-only (UNIQUE lead_id); this is the
-- history the shared move_lead_to_stage REPLACE writes one row into per move.
-- Pipeline-movement / speed reports accrue from Foundation's replace onward.
CREATE TABLE IF NOT EXISTS lead_stage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES inbound_leads(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES crm_orgs(id),
  stage_id      uuid NOT NULL REFERENCES pipeline_stages(id),
  from_stage_id uuid REFERENCES pipeline_stages(id),
  lost_reason   text,
  moved_by      uuid REFERENCES employees(id) ON DELETE SET NULL,
  moved_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead ON lead_stage_history(lead_id, moved_at);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_org ON lead_stage_history(org_id, moved_at);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_stage ON lead_stage_history(stage_id);

ALTER TABLE lead_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_stage_history_all" ON lead_stage_history;
CREATE POLICY "lead_stage_history_all" ON lead_stage_history
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 4. inbound_leads.lost_reason — win/loss reason on drop into a lost stage (Phase 7) ═══
ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS lost_reason text;

-- ═══ 5. crm_segments — saved audience filters (Phase 6a; reused by 8's enroll + campaigns) ═══
CREATE TABLE IF NOT EXISTS crm_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES crm_orgs(id),
  name        text NOT NULL,
  description text,
  filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_segments_org ON crm_segments(org_id, name);

ALTER TABLE crm_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_segments_all" ON crm_segments;
CREATE POLICY "crm_segments_all" ON crm_segments
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 6. crm_import_batches — CSV import audit (Phase 6b) ═══
CREATE TABLE IF NOT EXISTS crm_import_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES crm_orgs(id),
  filename      text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  total_rows    int NOT NULL DEFAULT 0,
  created_count int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  error_count   int NOT NULL DEFAULT 0,
  errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by    uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_import_batches_org ON crm_import_batches(org_id, created_at DESC);

ALTER TABLE crm_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_import_batches_all" ON crm_import_batches;
CREATE POLICY "crm_import_batches_all" ON crm_import_batches
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 7. contacts.owner_id + contacts.lifecycle_status — ownership + lifecycle (Phase 6b) ═══
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_status text;

-- ═══ 8. crm_sequences / steps / enrollments — drip nurture (Phase 8) ═══
CREATE TABLE IF NOT EXISTS crm_sequences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES crm_orgs(id),
  name               text NOT NULL,
  description        text,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  exit_on_reply      boolean NOT NULL DEFAULT true,
  exit_on_conversion boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sequences_org ON crm_sequences(org_id, status);

ALTER TABLE crm_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_sequences_all" ON crm_sequences;
CREATE POLICY "crm_sequences_all" ON crm_sequences
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS crm_sequence_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES crm_orgs(id),
  step_order  int NOT NULL DEFAULT 0,
  channel     text NOT NULL CHECK (channel IN ('email', 'sms')),
  delay_hours int NOT NULL DEFAULT 0,
  subject     text,
  body        text,
  template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_crm_sequence_steps_seq ON crm_sequence_steps(sequence_id, step_order);

ALTER TABLE crm_sequence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_sequence_steps_all" ON crm_sequence_steps;
CREATE POLICY "crm_sequence_steps_all" ON crm_sequence_steps
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- UNIQUE(sequence_id, contact_id) backs Phase 8's enrollment idempotency test.
CREATE TABLE IF NOT EXISTS crm_sequence_enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id  uuid NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES crm_orgs(id),
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'exited')),
  current_step int NOT NULL DEFAULT 0,
  next_run_at  timestamptz,
  exit_reason  text,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_sequence_enrollments_due ON crm_sequence_enrollments(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_crm_sequence_enrollments_contact ON crm_sequence_enrollments(contact_id);

ALTER TABLE crm_sequence_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_sequence_enrollments_all" ON crm_sequence_enrollments;
CREATE POLICY "crm_sequence_enrollments_all" ON crm_sequence_enrollments
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 9. pipeline_stages.win_probability — weighted forecast (Phase 9) ═══
-- Fraction 0..1 (NULL → stageWeight() falls back to the positional ramp).
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS win_probability numeric
  CHECK (win_probability IS NULL OR (win_probability >= 0 AND win_probability <= 1));

-- ═══ 10. inbound_leads.lead_score + lead_score_factors — lead scoring (Phase 9) ═══
ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS lead_score int;

CREATE TABLE IF NOT EXISTS lead_score_factors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid NOT NULL REFERENCES inbound_leads(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES crm_orgs(id),
  factor     text NOT NULL,
  points     int NOT NULL DEFAULT 0,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  scored_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_score_factors_lead ON lead_score_factors(lead_id);

ALTER TABLE lead_score_factors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_score_factors_all" ON lead_score_factors;
CREATE POLICY "lead_score_factors_all" ON lead_score_factors
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 11. form_definitions / versions / submissions — embeddable lead capture (Phase 10) ═══
-- public_id is the external id in the hosted-form URL (functions/f/[public_id].js) —
-- UNIQUE per the migration-safety-checker external-id rule.
CREATE TABLE IF NOT EXISTS form_definitions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES crm_orgs(id),
  public_id            text NOT NULL UNIQUE,
  name                 text NOT NULL,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_version_id uuid,
  theme                jsonb NOT NULL DEFAULT '{}'::jsonb,
  turnstile_enabled    boolean NOT NULL DEFAULT false,
  created_by           uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_definitions_org ON form_definitions(org_id, status);

ALTER TABLE form_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_definitions_all" ON form_definitions;
CREATE POLICY "form_definitions_all" ON form_definitions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Immutable published snapshots — draft→publish never mutates a published row.
CREATE TABLE IF NOT EXISTS form_definition_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id      uuid NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES crm_orgs(id),
  version      int NOT NULL,
  schema       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by   uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);

CREATE INDEX IF NOT EXISTS idx_form_definition_versions_form ON form_definition_versions(form_id, version);

ALTER TABLE form_definition_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_definition_versions_all" ON form_definition_versions;
CREATE POLICY "form_definition_versions_all" ON form_definition_versions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Now that versions exists, wire the published-version pointer (new table, not live).
ALTER TABLE form_definitions
  DROP CONSTRAINT IF EXISTS form_definitions_published_version_fk;
ALTER TABLE form_definitions
  ADD CONSTRAINT form_definitions_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES form_definition_versions(id) ON DELETE SET NULL;

-- submission_token is the idempotency key (upsert_lead_from_form dedupes on
-- callrail_id = 'form:' || submission_token) — UNIQUE per the external-id rule.
CREATE TABLE IF NOT EXISTS form_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id          uuid NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
  version_id       uuid REFERENCES form_definition_versions(id) ON DELETE SET NULL,
  org_id           uuid NOT NULL REFERENCES crm_orgs(id),
  submission_token text NOT NULL UNIQUE,
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  utm              jsonb NOT NULL DEFAULT '{}'::jsonb,
  lead_id          uuid REFERENCES inbound_leads(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ip_address       text,
  user_agent       text,
  is_spam          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id, created_at DESC);

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_submissions_all" ON form_submissions;
CREATE POLICY "form_submissions_all" ON form_submissions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
