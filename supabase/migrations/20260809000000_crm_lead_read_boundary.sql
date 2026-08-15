-- ════════════════════════════════════════════════
-- MIGRATION: 20260809000000_crm_lead_read_boundary
-- Phase: Native office surfaces — Phase 5 step 5 (Lead Center)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops everyone who can log in from being able to read and rearrange the
--   sales pipeline. Today any signed-in account — a field technician, an
--   estimator, a supervisor — can ask the database for every lead's notes and
--   full call activity, and can move any lead to any stage on the board. They
--   do not need a screen for it; the request works straight from a session.
--
--   After this, only the people who work leads get an answer: an admin, the
--   office, project managers, and our outside CRM partners. Everyone else is
--   refused. The people who use the board today keep seeing exactly what they
--   see now.
--
-- WHY NOW:
--   Lead Center is being added to the phone. Widening where a screen can be
--   opened is only safe once the data behind it is gated server-side
--   (AGENTS.md §16 — a UI gate is never the only control). This is the same
--   closure 20260808050037 did for the five money reports and 20260808210324
--   did for get_estimates.
--
--   Measured live 2026-08-08 before this migration: 19 active employees could
--   call all five RPCs — 5 admins, 1 project manager, 6 field technicians,
--   1 supervisor and 6 CRM partners.
--
-- ════════════════════════════════════════════════
-- WHY NOT billing_edit_access() — the instrument was wrong, not the decision
-- ════════════════════════════════════════════════
--   The owner's decision was "office roles: admin, office, project_manager".
--   billing_edit_access() is exactly that set, and it is the WRONG predicate
--   here, for two measured reasons:
--
--   1. It EXCLUDES crm_partner. get_pipeline_stages and move_lead_to_stage are
--      also called by src/pages/crm/CrmLeads.jsx — the desktop kanban — which
--      6 active crm_partner users work daily. Gating those two on
--      billing_edit_access() would lock them out of their own board. This is
--      the get_pipeline_summary mistake in a new costume: a boundary drawn
--      around the screen you are thinking about, silently breaking the one you
--      are not.
--
--   2. It DISAGREES with the list the screen already loads.
--      public.get_inbound_leads() — untouched by this migration — already
--      resolves access from nav_permissions/employee_page_access on the
--      `crm_call_log` key. Gating its five siblings on a different predicate
--      would give one screen two different answers about who may use it.
--
--   So the gate is the predicate the surface ALREADY uses, extracted into one
--   named helper: public.crm_lead_access(). It resolves exactly the way
--   canAccess() does in the client (auth-and-authorization.md):
--     Layer 1  admin            → allowed outright
--     Layer 2  employee_page_access override for the employee, if a row exists
--     Layer 3  nav_permissions for the employee's role
--   over EITHER CRM lead nav key (`crm_leads` or `crm_call_log`).
--
--   That predicate is not self-granting: nav_permissions and
--   employee_page_access both carry an is_active_internal_admin() write policy,
--   so only an admin can hand the key out — and can hand it out from CRM
--   Settings without another migration, which billing_edit_access() cannot.
--
--   Live nav rows today (measured 2026-08-08):
--     crm_leads     → crm_partner, office
--     crm_call_log  → crm_partner, office
--   project_manager holds NEITHER, so a PM is refused by get_inbound_leads
--   today and would be refused by this gate too. The owner's decision includes
--   PM, so the two rows are granted below — one row each, ON CONFLICT DO
--   NOTHING, the same shape as 20260808200000.
--
-- ════════════════════════════════════════════════
-- THE BACK DOOR THIS ALSO CLOSES (found by looking, not by reading the plan)
-- ════════════════════════════════════════════════
--   Gating move_lead_to_stage alone would have been theatre. Measured live:
--     lead_pipeline_stage  ALL  USING (true) WITH CHECK (true)  TO authenticated
--     lead_stage_history   ALL  USING (true) WITH CHECK (true)  TO authenticated
--     pipeline_stages      ALL  USING (true) WITH CHECK (true)  TO authenticated
--   all three with a full arwdDxtm table grant to `authenticated`. So a field
--   technician could skip the RPC entirely, UPDATE lead_pipeline_stage directly,
--   and move a lead with no lead_stage_history row and no system_events audit —
--   or DELETE the company's pipeline stages.
--
--   Every browser writer already goes through an RPC (traced repo-wide: the only
--   direct client access is four SELECTs of lead_pipeline_stage — CrmLeads,
--   CrmOverview, ForecastWidget, AdminLeadCenter). SECURITY DEFINER functions
--   run as the owner and bypass RLS, so removing the authenticated write
--   policies breaks nothing and closes the door.
--
-- ADDITIVE-ONLY: one new function, five bodies replaced, three policies
--   replaced, two nav rows inserted. No table, column, index, constraint or
--   trigger is created, altered or dropped. Every RPC keeps its exact signature,
--   argument defaults and return shape (database-standard.md §3, FE-contract
--   freeze).
--
-- WHO GAINS, WHO LOSES, WHO IS UNTOUCHED (database-standard.md §5b):
--   GAINS:     project_manager — two nav_permissions rows, so a PM can finally
--              open Lead Center at all. Nothing else gains anything.
--   KEEPS:     admin (Layer 1), office and crm_partner (Layer 3 rows above),
--              and service_role, which bypasses the guard so
--              functions/api/transcribe-call.js keeps advancing stages.
--   LOSES:     field_tech, estimator, supervisor — the point of the change.
--   UNTOUCHED: get_inbound_leads (already gated, deliberately not re-replaced),
--              every lead row, and the CRM kanban's behaviour for the roles
--              that keep access.
--
-- THE plpgsql CONVERSION TRAP (recorded because it nearly shipped on 20260807):
--   LANGUAGE sql applies an implicit assignment cast at the result boundary;
--   plpgsql's RETURN QUERY requires an EXACT row-type match and raises
--   "structure of query does not match function result type" for EVERY caller
--   otherwise. Three of these five are sql today. Every returned column was
--   re-checked against information_schema: all text/timestamptz/jsonb/uuid, no
--   enum and no varchar. The only untyped expressions are the bare string
--   literals inside get_lead_activity's CASE arms, and those are given an
--   explicit ::text below rather than left to UNION type resolution. The
--   behavioural proof EXECUTES all five rather than trusting that reading.
--
-- ════════════════════════════════════════════════
-- ROLLBACK: supabase/rollbacks/20260809000000_crm_lead_read_boundary.rollback.sql
--   Restores all five bodies to the exact definitions this replaces (their md5s
--   are pinned in the drift guard below), restores the three always-true
--   policies, and drops crm_lead_access(). It deliberately LEAVES the two
--   project_manager nav rows in place — they are a grant the owner asked for,
--   not part of the boundary, and removing them would silently take Lead Center
--   away from the PM. Delete them by hand if that is really wanted.
-- ════════════════════════════════════════════════

-- NO TOP-LEVEL TRANSACTION:
--   database-standard.md §5 — the Supabase migration executor owns the
--   transaction, which wraps both this SQL and its schema_migrations ledger write.

-- ── DRIFT GUARD ──────────────────────────────────────────────────────────────
-- Refuse to replace a body that is not the one reviewed. All five measured live
-- 2026-08-08. If another session has since edited any of them this aborts the
-- whole migration instead of silently discarding their change.
DO $guard$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'add_lead_note',       'a60fba7b2d1f2b6e9d1dd54d701ff923',
    'get_lead_activity',   '1c490cbf16b5a04f548282bdfd4362f6',
    'get_lead_notes',      '26ff69a26f9faaa6e3d5b6690993cf7e',
    'get_pipeline_stages', '977cebe1be0e548297d8180ef6b1830b',
    'move_lead_to_stage',  'b56fa64c1ee916c075bab69c0a23dd00'
  );
  v_name text;
  v_live text;
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(p.prosrc) INTO v_live
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_live IS NULL THEN
      RAISE EXCEPTION 'public.%() does not exist — refusing to create it blind', v_name;
    END IF;
    IF v_live IS DISTINCT FROM (v_expected ->> v_name) THEN
      RAISE EXCEPTION
        '% body drifted: live md5 % does not match the reviewed %. Re-review against the live body before applying.',
        v_name, v_live, (v_expected ->> v_name);
    END IF;
  END LOOP;
  RAISE NOTICE 'drift guard passed: all five live lead RPC bodies are the reviewed ones';
END;
$guard$;

-- ── THE SHARED PREDICATE ─────────────────────────────────────────────────────
-- One definition, consumed by all five. Mirrors the resolution already inside
-- get_inbound_leads so the screen cannot give two answers about who may use it.
CREATE OR REPLACE FUNCTION public.crm_lead_access()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_override boolean;
  v_role_allowed boolean;
BEGIN
  SELECT e.*
    INTO v_employee
    FROM public.employees e
   WHERE e.auth_user_id = (SELECT auth.uid())
     AND e.is_active IS TRUE
     AND e.is_external IS FALSE
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Layer 1 — an admin is allowed outright, exactly as canAccess() does.
  IF v_employee.role::text = 'admin' THEN
    RETURN true;
  END IF;

  -- Layer 2 — a per-employee override wins over the role default, in BOTH
  -- directions. A row with can_view = false is a deliberate revocation and must
  -- not fall through to the role table.
  SELECT bool_or(epa.can_view IS TRUE)
    INTO v_override
    FROM public.employee_page_access epa
   WHERE epa.employee_id = v_employee.id
     AND epa.nav_key IN ('crm_leads', 'crm_call_log');

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  -- Layer 3 — the role default, over either CRM lead nav key.
  SELECT bool_or(np.can_view IS TRUE)
    INTO v_role_allowed
    FROM public.nav_permissions np
   WHERE np.role = v_employee.role::text
     AND np.nav_key IN ('crm_leads', 'crm_call_log');

  RETURN COALESCE(v_role_allowed, false);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.crm_lead_access() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_lead_access() TO authenticated;

-- ── 1/5  get_pipeline_stages ─────────────────────────────────────────────────
-- sql → plpgsql. SETOF pipeline_stages with a bare SELECT *, so the row type is
-- the table's own and cannot drift from the declaration.
--
-- `IS DISTINCT FROM`, never `<>`: auth.role() is NULL outside a PostgREST
-- request, and `NULL <> 'service_role'` is NULL, which PL/pgSQL's IF treats as
-- false — silently skipping the guard.
CREATE OR REPLACE FUNCTION public.get_pipeline_stages(p_org_id uuid DEFAULT NULL::uuid)
RETURNS SETOF public.pipeline_stages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.crm_lead_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
    FROM pipeline_stages
   WHERE org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
   ORDER BY sort_order;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_pipeline_stages(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pipeline_stages(uuid) TO authenticated;

-- ── 2/5  move_lead_to_stage ──────────────────────────────────────────────────
-- Already plpgsql; the body is unchanged apart from the guard and one honest
-- improvement: p_moved_by is caller-supplied, and AdminLeadCenter never sends
-- it — so every stage move from the phone currently records moved_by = NULL in
-- lead_stage_history and system_events. It is now filled in from the caller's
-- own session when the argument is absent, which a caller cannot forge. An
-- explicitly-passed p_moved_by is still honoured, so CrmLeads is unaffected.
CREATE OR REPLACE FUNCTION public.move_lead_to_stage(
  p_lead_id uuid,
  p_stage_id uuid,
  p_moved_by uuid DEFAULT NULL::uuid,
  p_lost_reason text DEFAULT NULL::text
)
RETURNS public.lead_pipeline_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id   uuid;
  v_from     uuid;
  v_actor    uuid;
  v_row      lead_pipeline_stage;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.crm_lead_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(
    p_moved_by,
    (SELECT e.id FROM employees e WHERE e.auth_user_id = (SELECT auth.uid()) LIMIT 1)
  );

  SELECT org_id INTO v_org_id FROM inbound_leads WHERE id = p_lead_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE id = p_stage_id) THEN
    RAISE EXCEPTION 'unknown pipeline_stages id: %', p_stage_id;
  END IF;

  SELECT stage_id INTO v_from FROM lead_pipeline_stage WHERE lead_id = p_lead_id;

  INSERT INTO lead_pipeline_stage (lead_id, org_id, stage_id, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, v_actor)
  ON CONFLICT (lead_id) DO UPDATE SET
    stage_id   = EXCLUDED.stage_id,
    moved_by   = EXCLUDED.moved_by,
    updated_at = now()
  RETURNING * INTO v_row;

  IF p_lost_reason IS NOT NULL THEN
    UPDATE inbound_leads SET lost_reason = p_lost_reason, updated_at = now()
    WHERE id = p_lead_id;
  END IF;

  INSERT INTO lead_stage_history (lead_id, org_id, stage_id, from_stage_id, lost_reason, moved_by)
  VALUES (p_lead_id, v_org_id, p_stage_id, v_from, p_lost_reason, v_actor);

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_stage_changed', 'inbound_lead', p_lead_id, v_actor,
          jsonb_build_object('stage_id', p_stage_id, 'from_stage_id', v_from, 'lost_reason', p_lost_reason));

  RETURN v_row;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.move_lead_to_stage(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.move_lead_to_stage(uuid, uuid, uuid, text) TO authenticated;

-- ── 3/5  get_lead_activity ───────────────────────────────────────────────────
-- sql → plpgsql. The five UNION ALL branches are copied verbatim; the only
-- change beyond the guard is an explicit ::text on the CASE arms and titles, so
-- the row type is stated rather than inferred (see the conversion trap above).
CREATE OR REPLACE FUNCTION public.get_lead_activity(p_lead_id uuid)
RETURNS TABLE(
  activity_type text,
  occurred_at timestamp with time zone,
  title text,
  body text,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.crm_lead_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    'lead'::text,
    COALESCE(il.occurred_at, il.created_at),
    (CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END)::text,
    il.transcription,
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis
    )
  FROM inbound_leads il
  WHERE il.id = p_lead_id

  UNION ALL

  SELECT
    'note'::text,
    ln.created_at,
    'Note'::text,
    ln.body,
    jsonb_build_object('note_id', ln.id, 'author_name', COALESCE(en.display_name, en.full_name))
  FROM crm_lead_notes ln
  LEFT JOIN employees en ON en.id = ln.created_by
  WHERE ln.lead_id = p_lead_id
     OR ln.lead_id IN (SELECT id FROM inbound_leads WHERE merged_into_lead_id = p_lead_id)

  UNION ALL

  SELECT
    'task'::text,
    COALESCE(t.due_at, t.created_at),
    t.title::text,
    t.notes,
    jsonb_build_object(
      'status', t.status, 'due_at', t.due_at, 'task_id', t.id,
      'created_by_name', COALESCE(ec.display_name, ec.full_name),
      'assignee_name', COALESCE(ea.display_name, ea.full_name)
    )
  FROM crm_tasks t
  LEFT JOIN employees ec ON ec.id = t.created_by
  LEFT JOIN employees ea ON ea.id = t.assignee_id
  WHERE t.lead_id = p_lead_id

  UNION ALL

  SELECT
    'stage_change'::text,
    lsh.moved_at,
    ('Moved to ' || ps.name)::text,
    NULL::text,
    jsonb_build_object(
      'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason,
      'moved_by_name', COALESCE(em.display_name, em.full_name)
    )
  FROM lead_stage_history lsh
  JOIN pipeline_stages ps ON ps.id = lsh.stage_id
  LEFT JOIN employees em ON em.id = lsh.moved_by
  WHERE lsh.lead_id = p_lead_id

  UNION ALL

  SELECT
    'follow_up_call'::text,
    COALESCE(fu.occurred_at, fu.created_at),
    (CASE WHEN fu.source_type = 'call' THEN 'Follow-up call' ELSE 'Follow-up web form' END)::text,
    fu.transcription,
    jsonb_build_object(
      'source_type', fu.source_type, 'duration_sec', fu.duration_sec,
      'caller_number', fu.caller_number, 'recording_url', fu.recording_url,
      'transcript_analysis', fu.transcript_analysis, 'merged_lead_id', fu.id
    )
  FROM inbound_leads fu
  WHERE fu.merged_into_lead_id = p_lead_id

  ORDER BY 2 DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_lead_activity(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_lead_activity(uuid) TO authenticated;

-- ── 4/5  get_lead_notes ──────────────────────────────────────────────────────
-- sql → plpgsql. SETOF json; the body is copied verbatim.
CREATE OR REPLACE FUNCTION public.get_lead_notes(p_lead_id uuid)
RETURNS SETOF json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.crm_lead_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT json_build_object(
    'id', ln.id,
    'lead_id', ln.lead_id,
    'body', ln.body,
    'created_at', ln.created_at,
    'created_by', ln.created_by,
    'author_name', COALESCE(e.display_name, e.full_name)
  )
  FROM crm_lead_notes ln
  LEFT JOIN employees e ON e.id = ln.created_by
  WHERE ln.lead_id = p_lead_id
     OR ln.lead_id IN (SELECT id FROM inbound_leads WHERE merged_into_lead_id = p_lead_id)
  ORDER BY ln.created_at DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_lead_notes(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_lead_notes(uuid) TO authenticated;

-- ── 5/5  add_lead_note ───────────────────────────────────────────────────────
-- Already plpgsql; body unchanged apart from the guard and the same
-- server-derived actor fallback as move_lead_to_stage, for the same reason.
CREATE OR REPLACE FUNCTION public.add_lead_note(
  p_lead_id uuid,
  p_body text,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id     uuid;
  v_contact_id uuid;
  v_actor      uuid;
  v_row        crm_lead_notes;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.crm_lead_access() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'note body is required';
  END IF;

  v_actor := COALESCE(
    p_created_by,
    (SELECT e.id FROM employees e WHERE e.auth_user_id = (SELECT auth.uid()) LIMIT 1)
  );

  SELECT org_id, contact_id INTO v_org_id, v_contact_id
  FROM inbound_leads WHERE id = p_lead_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  INSERT INTO crm_lead_notes (lead_id, org_id, contact_id, body, created_by)
  VALUES (p_lead_id, v_org_id, v_contact_id, btrim(p_body), v_actor)
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'id', v_row.id,
    'lead_id', v_row.lead_id,
    'body', v_row.body,
    'created_at', v_row.created_at,
    'created_by', v_row.created_by,
    'author_name', (SELECT COALESCE(e.display_name, e.full_name) FROM employees e WHERE e.id = v_row.created_by)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.add_lead_note(uuid, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_lead_note(uuid, text, uuid) TO authenticated;

-- ── THE TABLES UNDERNEATH ────────────────────────────────────────────────────
-- Replace the three always-true authenticated policies. Reads stay open to the
-- same people the RPCs serve (four client SELECTs depend on lead_pipeline_stage
-- and the CRM surfaces read pipeline_stages); writes leave the browser roles
-- entirely, because every legitimate writer is a SECURITY DEFINER function and
-- those bypass RLS. database-standard.md §1: an always-true authenticated policy
-- is not the default floor.
DROP POLICY IF EXISTS lead_pipeline_stage_all ON public.lead_pipeline_stage;
CREATE POLICY lead_pipeline_stage_read ON public.lead_pipeline_stage
  FOR SELECT TO authenticated
  USING (public.crm_lead_access());

DROP POLICY IF EXISTS pipeline_stages_all ON public.pipeline_stages;
CREATE POLICY pipeline_stages_read ON public.pipeline_stages
  FOR SELECT TO authenticated
  USING (public.crm_lead_access());

-- lead_stage_history has no client reader at all (CrmReports reads it only
-- through get_pipeline_movement, a definer RPC), so it gets no browser policy.
DROP POLICY IF EXISTS lead_stage_history_all ON public.lead_stage_history;

-- All three carry a full arwdDxtm table grant to `anon` inherited from the
-- pre-2026-07-08 blanket template. RLS already refuses anon (no anon policy has
-- ever existed on them), so this changes no behaviour — it removes a grant that
-- only one missing policy stands between and a public pipeline.
REVOKE ALL ON TABLE public.lead_pipeline_stage FROM anon;
REVOKE ALL ON TABLE public.lead_stage_history  FROM anon;
REVOKE ALL ON TABLE public.pipeline_stages     FROM anon;

-- ── THE NAV ROWS THE OWNER'S DECISION NEEDS ──────────────────────────────────
-- Without these a project_manager is refused by get_inbound_leads and by the
-- gate above, so Lead Center would open to an error rather than a list. Same
-- shape as 20260808200000: additive, idempotent, no UPDATE of an existing row.
INSERT INTO public.nav_permissions (nav_key, role, can_view)
VALUES ('crm_leads', 'project_manager', true),
       ('crm_call_log', 'project_manager', true)
ON CONFLICT (nav_key, role) DO NOTHING;

-- ── POSTCONDITIONS ───────────────────────────────────────────────────────────
-- Assert the properties that carry the guarantee, not a body hash (which would
-- break on a whitespace edit while proving nothing extra).
DO $post$
DECLARE
  v_name text;
  p pg_proc%ROWTYPE;
  v_open int;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'get_pipeline_stages', 'move_lead_to_stage', 'get_lead_activity',
    'get_lead_notes', 'add_lead_note'
  ] LOOP
    SELECT * INTO p FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
     WHERE n.nspname = 'public' AND pr.proname = v_name;

    IF p.prosrc NOT LIKE '%crm_lead_access()%' THEN
      RAISE EXCEPTION 'postcondition failed: % does not consume crm_lead_access()', v_name;
    END IF;
    IF p.prosrc NOT LIKE '%IS DISTINCT FROM ''service_role''%' THEN
      RAISE EXCEPTION 'postcondition failed: the service_role bypass in % must use IS DISTINCT FROM, not <>', v_name;
    END IF;
    IF p.prosrc LIKE '%''field_tech''%' OR p.prosrc LIKE '%''crm_partner''%' THEN
      RAISE EXCEPTION 'postcondition failed: % inlines a role literal instead of using the shared predicate', v_name;
    END IF;
    IF NOT p.prosecdef THEN
      RAISE EXCEPTION 'postcondition failed: % is no longer SECURITY DEFINER', v_name;
    END IF;
    IF has_function_privilege('anon', p.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondition failed: anon can execute %', v_name;
    END IF;
    IF NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'postcondition failed: authenticated lost EXECUTE on % — the gate is inside the body, not the grant', v_name;
    END IF;
  END LOOP;

  -- No always-true authenticated policy may survive on the three tables.
  SELECT count(*) INTO v_open
    FROM pg_policy po
    JOIN pg_class c ON c.oid = po.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('lead_pipeline_stage', 'pipeline_stages', 'lead_stage_history')
     AND pg_get_expr(po.polqual, po.polrelid) = 'true';
  IF v_open > 0 THEN
    RAISE EXCEPTION 'postcondition failed: % always-true policies still stand on the pipeline tables', v_open;
  END IF;

  -- The two rows the owner's decision depends on.
  IF (SELECT count(*) FROM public.nav_permissions
       WHERE role = 'project_manager' AND nav_key IN ('crm_leads', 'crm_call_log') AND can_view) <> 2 THEN
    RAISE EXCEPTION 'postcondition failed: project_manager did not end up with both CRM lead nav rows';
  END IF;

  RAISE NOTICE 'postconditions passed: five RPCs gated by crm_lead_access(), pipeline tables closed to browser writes, PM granted';
END;
$post$;
