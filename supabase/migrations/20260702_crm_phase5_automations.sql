-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 5 — Automation recipes (linear visual builder)
--
-- ONE additive migration (post-wave single session — manifest §7 amends §4 for
-- Phase 5): two NEW tables + this phase's OWN SECURITY DEFINER RPCs created
-- directly (no stub ceremony — nothing cross-session consumes them). Nothing
-- here ALTERs or DROPs a live table; the orphan automation_rules stays untouched.
--
--   Tables
--     • crm_automations       — the rules (trigger → AND-conditions → ordered actions)
--     • crm_automation_runs    — one row per (rule, triggering event); the engine's
--                                idempotency ledger. UNIQUE(automation_id,
--                                triggering_event_id) is the dedup key — system_events
--                                has no cursor, so run-creation dedups on this.
--   RPCs (SECURITY DEFINER + GRANT anon, authenticated)
--     • get_crm_automations, upsert_crm_automation, set_automation_enabled,
--       delete_crm_automation, get_automation_runs  — the five API RPCs.
--     • crm_fixed_automation_conflict  — the S1 collision predicate (shared by the
--       two guarded RPCs; mirrored in the engine's FIXED_AUTOMATION_TRIGGERS).
--     • enqueue_automation_run  — idempotent INSERT … ON CONFLICT DO NOTHING the
--       cron worker calls (the REST client's upsert MERGES, which would overwrite a
--       live run; the bus is RPC-fed so dedup is ours).
--   Data
--     • feature:crm_automations flag — dev-only for Moroni (isolation; owner opens it).
--
-- S1 (double-send between the two engines): run-automations.js (fixed four) and
-- process-crm-automations.js keep dedup markers in namespaces that cannot see each
-- other. crm_fixed_automation_conflict refuses an ENABLED rule whose trigger
-- duplicates an ENABLED fixed automation, and the engine skips such rules at fire
-- time — TCPA penalties are per message. See docs/crm-roadmap.md "Phase 5 re-plan".
--
-- ADDITIVE + backward-compatible: one shared Supabase, so these are live in dev and
-- main the moment they apply, but every consumer is behind page:crm + the new
-- feature:crm_automations sub-flag (dev-only), so nothing is user-visible yet.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. crm_automations — the configurable rules ═══
CREATE TABLE IF NOT EXISTS crm_automations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES crm_orgs(id),
  name               text NOT NULL,
  description        text,
  trigger_event_type text NOT NULL,                       -- a system_events.event_type
  conditions         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{field, op, value}] — AND-filters
  actions            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ordered [{type, config, delay_hours}]
  enabled            boolean NOT NULL DEFAULT false,
  created_by         uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_automations_org_trigger
  ON crm_automations(org_id, trigger_event_type) WHERE enabled;

ALTER TABLE crm_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_automations_all" ON crm_automations;
CREATE POLICY "crm_automations_all" ON crm_automations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 2. crm_automation_runs — one row per (rule, triggering event) ═══
-- UNIQUE(automation_id, triggering_event_id) is the S1 / idempotency key. `held`
-- runs stay due (retried) — a text held by the kill-switch / quiet-hours is never
-- dropped and never advanced past (imported Phase-8 hold semantics).
CREATE TABLE IF NOT EXISTS crm_automation_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id       uuid NOT NULL REFERENCES crm_automations(id) ON DELETE CASCADE,
  org_id              uuid NOT NULL REFERENCES crm_orgs(id),
  triggering_event_id uuid NOT NULL,                       -- system_events.id (no FK — append-only bus)
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  entity_type         text,
  entity_id           uuid,
  current_action      int NOT NULL DEFAULT 0,               -- cursor into actions[]
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'failed', 'skipped', 'held')),
  next_run_at         timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, triggering_event_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_automation_runs_due
  ON crm_automation_runs(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_crm_automation_runs_automation
  ON crm_automation_runs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_automation_runs_org
  ON crm_automation_runs(org_id, created_at DESC);

ALTER TABLE crm_automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_automation_runs_all" ON crm_automation_runs;
CREATE POLICY "crm_automation_runs_all" ON crm_automation_runs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ 3. crm_fixed_automation_conflict — the S1 collision predicate ═══
-- TRUE when p_trigger_event_type is already handled by an ENABLED fixed automation
-- for the org. The trigger sets below MUST stay in sync with the engine's
-- FIXED_AUTOMATION_TRIGGERS (process-crm-automations.js). no_response_followup is a
-- time-window scan with no discrete triggering event, so it collides with nothing.
CREATE OR REPLACE FUNCTION crm_fixed_automation_conflict(p_org_id uuid, p_trigger_event_type text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_settings automation_settings;
  v_blocked  text[] := '{}';
BEGIN
  IF p_org_id IS NULL OR nullif(btrim(p_trigger_event_type), '') IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_settings FROM automation_settings WHERE org_id = p_org_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_settings.speed_to_lead_enabled THEN
    v_blocked := v_blocked || ARRAY['crm_lead_created', 'crm_lead_created_manual'];
  END IF;
  IF v_settings.missed_call_textback_enabled THEN
    v_blocked := v_blocked || ARRAY['crm_lead_created', 'crm_lead_created_manual'];
  END IF;
  IF v_settings.review_request_enabled THEN
    v_blocked := v_blocked || ARRAY['job.phase_changed', 'job.status_changed'];
  END IF;
  -- no_response_followup: no discrete event trigger → nothing to block.

  RETURN btrim(p_trigger_event_type) = ANY(v_blocked);
END;
$$;
GRANT EXECUTE ON FUNCTION crm_fixed_automation_conflict(uuid, text) TO anon, authenticated;

-- ═══ 4. upsert_crm_automation — create/edit a rule (S1 guard lives here) ═══
-- p_enabled NULL = leave as-is (so a partial edit never silently flips a rule off);
-- p_conditions / p_actions default '[]' → a save always writes the full arrays.
CREATE OR REPLACE FUNCTION upsert_crm_automation(
  p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_trigger_event_type text DEFAULT NULL, p_conditions jsonb DEFAULT '[]'::jsonb,
  p_actions jsonb DEFAULT '[]'::jsonb, p_enabled boolean DEFAULT NULL,
  p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_automations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id   uuid := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_name     text := nullif(btrim(p_name), '');
  v_trigger  text;
  v_enabled  boolean;
  v_existing crm_automations;
  v_row      crm_automations;
BEGIN
  IF p_id IS NULL THEN
    IF v_name IS NULL THEN RAISE EXCEPTION 'an automation name is required'; END IF;
    v_trigger := nullif(btrim(p_trigger_event_type), '');
    IF v_trigger IS NULL THEN RAISE EXCEPTION 'a trigger event type is required'; END IF;
    v_enabled := COALESCE(p_enabled, false);
    IF v_enabled AND crm_fixed_automation_conflict(v_org_id, v_trigger) THEN
      RAISE EXCEPTION 'trigger "%" is already handled by an enabled fixed automation — disable one of them first (S1 collision guard)', v_trigger;
    END IF;
    INSERT INTO crm_automations (org_id, name, description, trigger_event_type, conditions, actions, enabled, created_by)
    VALUES (v_org_id, v_name, nullif(btrim(p_description), ''), v_trigger,
            COALESCE(p_conditions, '[]'::jsonb), COALESCE(p_actions, '[]'::jsonb), v_enabled, p_created_by)
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_existing FROM crm_automations WHERE id = p_id;
    IF v_existing.id IS NULL THEN RAISE EXCEPTION 'automation % not found', p_id; END IF;
    v_trigger := COALESCE(nullif(btrim(p_trigger_event_type), ''), v_existing.trigger_event_type);
    v_enabled := COALESCE(p_enabled, v_existing.enabled);
    IF v_enabled AND crm_fixed_automation_conflict(v_existing.org_id, v_trigger) THEN
      RAISE EXCEPTION 'trigger "%" is already handled by an enabled fixed automation — disable one of them first (S1 collision guard)', v_trigger;
    END IF;
    UPDATE crm_automations SET
      name               = COALESCE(v_name, name),
      description        = nullif(btrim(p_description), ''),
      trigger_event_type = v_trigger,
      conditions        = COALESCE(p_conditions, conditions),
      actions           = COALESCE(p_actions, actions),
      enabled           = v_enabled,
      updated_at        = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_crm_automation(uuid, text, text, text, jsonb, jsonb, boolean, uuid, uuid) TO anon, authenticated;

-- ═══ 5. set_automation_enabled — toggle (re-checks the S1 guard when enabling) ═══
CREATE OR REPLACE FUNCTION set_automation_enabled(p_id uuid, p_enabled boolean)
RETURNS crm_automations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row crm_automations;
BEGIN
  SELECT * INTO v_row FROM crm_automations WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'automation % not found', p_id; END IF;
  IF COALESCE(p_enabled, false) AND crm_fixed_automation_conflict(v_row.org_id, v_row.trigger_event_type) THEN
    RAISE EXCEPTION 'trigger "%" is already handled by an enabled fixed automation — disable one of them first (S1 collision guard)', v_row.trigger_event_type;
  END IF;
  UPDATE crm_automations SET enabled = COALESCE(p_enabled, enabled), updated_at = now()
  WHERE id = p_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION set_automation_enabled(uuid, boolean) TO anon, authenticated;

-- ═══ 6. delete_crm_automation — cascade removes its runs (FK ON DELETE CASCADE) ═══
CREATE OR REPLACE FUNCTION delete_crm_automation(p_automation_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM crm_automations WHERE id = p_automation_id;
$$;
GRANT EXECUTE ON FUNCTION delete_crm_automation(uuid) TO anon, authenticated;

-- ═══ 7. get_crm_automations — list with per-rule run stats ═══
CREATE OR REPLACE FUNCTION get_crm_automations(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT json_build_object(
    'id', a.id, 'name', a.name, 'description', a.description,
    'trigger_event_type', a.trigger_event_type,
    'conditions', a.conditions, 'actions', a.actions,
    'enabled', a.enabled, 'created_at', a.created_at, 'updated_at', a.updated_at,
    'stats', (
      SELECT json_build_object(
        'active',    count(*) FILTER (WHERE r.status = 'active'),
        'held',      count(*) FILTER (WHERE r.status = 'held'),
        'completed', count(*) FILTER (WHERE r.status = 'completed'),
        'skipped',   count(*) FILTER (WHERE r.status = 'skipped'),
        'failed',    count(*) FILTER (WHERE r.status = 'failed'),
        'total',     count(*)
      ) FROM crm_automation_runs r WHERE r.automation_id = a.id
    )
  )
  FROM crm_automations a
  WHERE a.org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
  ORDER BY a.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_crm_automations(uuid) TO anon, authenticated;

-- ═══ 8. get_automation_runs — the per-rule run log ═══
-- When p_automation_id is given, the automation already scopes the rows, so the
-- org filter is skipped (lets a caller read a specific rule's log — incl. a TEST
-- org's — without resolving the real org). The org filter applies only to the
-- unfiltered "all runs" listing.
CREATE OR REPLACE FUNCTION get_automation_runs(
  p_automation_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL, p_limit int DEFAULT 100)
RETURNS SETOF json
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT json_build_object(
    'id', r.id, 'automation_id', r.automation_id, 'triggering_event_id', r.triggering_event_id,
    'contact_id', r.contact_id, 'contact_name', c.name,
    'entity_type', r.entity_type, 'entity_id', r.entity_id,
    'current_action', r.current_action, 'status', r.status,
    'next_run_at', r.next_run_at, 'last_error', r.last_error,
    'created_at', r.created_at, 'updated_at', r.updated_at
  )
  FROM crm_automation_runs r
  LEFT JOIN contacts c ON c.id = r.contact_id
  WHERE (p_automation_id IS NULL OR r.automation_id = p_automation_id)
    AND (p_automation_id IS NOT NULL
         OR r.org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1)))
  ORDER BY r.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
$$;
GRANT EXECUTE ON FUNCTION get_automation_runs(uuid, uuid, int) TO anon, authenticated;

-- ═══ 9. enqueue_automation_run — idempotent run-creation (the dedup door) ═══
-- Returns the new run id, or NULL when a run for this (rule, event) already exists.
-- This is where UNIQUE(automation_id, triggering_event_id) makes a re-scan a no-op.
CREATE OR REPLACE FUNCTION enqueue_automation_run(
  p_automation_id uuid, p_org_id uuid, p_triggering_event_id uuid,
  p_contact_id uuid DEFAULT NULL, p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL, p_next_run_at timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO crm_automation_runs
    (automation_id, org_id, triggering_event_id, contact_id, entity_type, entity_id, status, current_action, next_run_at)
  VALUES
    (p_automation_id, p_org_id, p_triggering_event_id, p_contact_id, p_entity_type, p_entity_id, 'active', 0, COALESCE(p_next_run_at, now()))
  ON CONFLICT (automation_id, triggering_event_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION enqueue_automation_run(uuid, uuid, uuid, uuid, text, uuid, timestamptz) TO anon, authenticated;

-- ═══ 10. feature:crm_automations — dev-only sub-flag (isolation) ═══
-- The whole /crm/* tree already sits behind page:crm (dev-only for Moroni). This
-- sub-flag keeps the Automations screen invisible to other staff even after
-- page:crm opens, until the owner flips it. Registered as a DB row (not in
-- featureFlags.js — that file is out of this phase's ownership); a missing row
-- would default OPEN, so seeding it is what actually gates the screen.
INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_at)
VALUES (
  'feature:crm_automations',
  false,
  'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da',
  'feature',
  'CRM · Automations',
  'Configurable automation recipes (CRM Phase 5). Dev-only for Moroni until the owner opens it to staff.',
  now()
)
ON CONFLICT (key) DO NOTHING;
