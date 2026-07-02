-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 8 — drip / nurture sequences (function-body fills only)
--
-- Fills the bodies of Phase F's four signature-frozen Phase 8 stubs:
--   upsert_sequence, get_sequences, delete_sequence, enroll_in_sequence.
-- Per .claude/rules/crm-wave-ownership.md §3–4 this migration changes function
-- BODIES only — no signature change, no schema/table/column/policy/index change
-- (crm_sequences / crm_sequence_steps / crm_sequence_enrollments and their
-- UNIQUE(sequence_id, contact_id) idempotency constraint all ship from Phase F).
-- migration-safety-checker enforces the frozen signatures.
--
-- ADDITIVE + backward-compatible: one shared Supabase, so these are live in dev
-- and main the moment they apply, but every consumer is behind page:crm.
--
-- Consent model: enrollment is NOT a send. It never bypasses consent — every
-- actual message is dispatched by functions/api/process-sequences.js through
-- sendAutomatedMessage() (functions/lib/automated-send.js), which gates each
-- send on the SMS kill-switch + TCPA opt-in / email suppression. So enrollment
-- may include a contact who will be durably skipped at send time; the segment
-- resolver here mirrors preview_email_audience's filter keys (referral_source,
-- role, tag) WITHOUT the email-only / consent constraints, because a sequence
-- can carry SMS steps and consent is enforced per-step at send, not at enroll.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ upsert_sequence — create or edit a sequence + replace its steps ═══
-- p_steps semantics:
--   • a jsonb array (incl. '[]') → REPLACE the step set with it.
--   • NULL                        → leave the existing steps untouched (used by
--                                    status-only edits: pause / activate / archive).
-- The default is '[]' (frozen signature), so a caller wanting a status-only edit
-- must pass p_steps => null explicitly.
-- Steps are renumbered to a contiguous 0-based step_order (respecting any
-- provided step_order, then array position) so UNIQUE(sequence_id, step_order)
-- can never be violated by caller input.
CREATE OR REPLACE FUNCTION upsert_sequence(
  p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_status text DEFAULT NULL, p_steps jsonb DEFAULT '[]'::jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_sequences
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_name   text := nullif(btrim(p_name), '');
  v_row    crm_sequences;
BEGIN
  IF p_id IS NULL THEN
    IF v_name IS NULL THEN RAISE EXCEPTION 'a sequence name is required'; END IF;
    INSERT INTO crm_sequences (org_id, name, description, status, created_by)
    VALUES (v_org_id, v_name, nullif(btrim(p_description), ''),
            COALESCE(nullif(btrim(p_status), ''), 'draft'), p_created_by)
    RETURNING * INTO v_row;
  ELSE
    UPDATE crm_sequences SET
      name        = COALESCE(v_name, name),
      description  = nullif(btrim(p_description), ''),
      status      = COALESCE(nullif(btrim(p_status), ''), status),
      updated_at  = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'sequence % not found', p_id; END IF;
  END IF;

  -- Replace steps only when a step array was actually supplied (NULL = leave as-is).
  IF p_steps IS NOT NULL THEN
    DELETE FROM crm_sequence_steps WHERE sequence_id = v_row.id;
    INSERT INTO crm_sequence_steps (sequence_id, org_id, step_order, channel, delay_hours, subject, body, template_id)
    SELECT
      v_row.id, v_org_id,
      (row_number() OVER (ORDER BY COALESCE((e.elem->>'step_order')::int, (e.ord - 1)::int), e.ord) - 1)::int,
      e.elem->>'channel',
      GREATEST(COALESCE((e.elem->>'delay_hours')::int, 0), 0),
      nullif(e.elem->>'subject', ''),
      nullif(e.elem->>'body', ''),
      nullif(e.elem->>'template_id', '')::uuid
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(elem, ord);
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_sequence(uuid, text, text, text, jsonb, uuid, uuid) TO anon, authenticated;

-- ═══ get_sequences — list with ordered steps, enrollment stats + roster ═══
-- SETOF json (one object per sequence). `enrollments` is capped at 200 rows
-- (most-recent first) for the per-sequence roster; `stats` counts the full set.
CREATE OR REPLACE FUNCTION get_sequences(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT json_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'status', s.status,
    'exit_on_reply', s.exit_on_reply,
    'exit_on_conversion', s.exit_on_conversion,
    'created_at', s.created_at,
    'updated_at', s.updated_at,
    'steps', COALESCE((
      SELECT json_agg(json_build_object(
        'id', st.id, 'step_order', st.step_order, 'channel', st.channel,
        'delay_hours', st.delay_hours, 'subject', st.subject, 'body', st.body,
        'template_id', st.template_id
      ) ORDER BY st.step_order)
      FROM crm_sequence_steps st WHERE st.sequence_id = s.id
    ), '[]'::json),
    'stats', (
      SELECT json_build_object(
        'active',    count(*) FILTER (WHERE e.status = 'active'),
        'paused',    count(*) FILTER (WHERE e.status = 'paused'),
        'completed', count(*) FILTER (WHERE e.status = 'completed'),
        'exited',    count(*) FILTER (WHERE e.status = 'exited'),
        'total',     count(*)
      )
      FROM crm_sequence_enrollments e WHERE e.sequence_id = s.id
    ),
    'enrollments', COALESCE((
      SELECT json_agg(en) FROM (
        SELECT e.id, e.contact_id, c.name AS contact_name, c.phone AS contact_phone,
               e.status, e.current_step, e.next_run_at, e.enrolled_at,
               e.completed_at, e.exit_reason
        FROM crm_sequence_enrollments e
        LEFT JOIN contacts c ON c.id = e.contact_id
        WHERE e.sequence_id = s.id
        ORDER BY e.enrolled_at DESC
        LIMIT 200
      ) en
    ), '[]'::json)
  )
  FROM crm_sequences s
  WHERE s.org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
  ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_sequences(uuid) TO anon, authenticated;

-- ═══ delete_sequence — cascade removes steps + enrollments (FK ON DELETE CASCADE) ═══
CREATE OR REPLACE FUNCTION delete_sequence(p_sequence_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM crm_sequences WHERE id = p_sequence_id;
$$;
GRANT EXECUTE ON FUNCTION delete_sequence(uuid) TO anon, authenticated;

-- ═══ enroll_in_sequence — enroll a single contact OR a whole segment ═══
-- Idempotent via UNIQUE(sequence_id, contact_id): re-enrolling a contact is a
-- no-op that returns the existing row. next_run_at is scheduled from the first
-- step's delay_hours (NULL when the sequence has no steps yet). Returns the full
-- enrollment set (new + already-existing) for the targeted contacts.
CREATE OR REPLACE FUNCTION enroll_in_sequence(
  p_sequence_id uuid, p_contact_id uuid DEFAULT NULL, p_segment_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF crm_sequence_enrollments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id      uuid := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_filter      jsonb;
  v_first_delay int;
  v_next        timestamptz;
BEGIN
  IF p_sequence_id IS NULL THEN RAISE EXCEPTION 'a sequence id is required'; END IF;
  IF p_contact_id IS NULL AND p_segment_id IS NULL THEN
    RAISE EXCEPTION 'enroll_in_sequence needs a contact or a segment';
  END IF;

  SELECT delay_hours INTO v_first_delay
  FROM crm_sequence_steps WHERE sequence_id = p_sequence_id ORDER BY step_order LIMIT 1;
  v_next := CASE WHEN v_first_delay IS NULL THEN NULL
                 ELSE now() + make_interval(hours => v_first_delay) END;

  IF p_contact_id IS NOT NULL THEN
    INSERT INTO crm_sequence_enrollments (sequence_id, org_id, contact_id, status, current_step, next_run_at)
    VALUES (p_sequence_id, v_org_id, p_contact_id, 'active', 0, v_next)
    ON CONFLICT (sequence_id, contact_id) DO NOTHING;

    RETURN QUERY
      SELECT * FROM crm_sequence_enrollments
      WHERE sequence_id = p_sequence_id AND contact_id = p_contact_id;
  ELSE
    SELECT filter INTO v_filter FROM crm_segments WHERE id = p_segment_id;
    IF v_filter IS NULL THEN RAISE EXCEPTION 'segment % not found', p_segment_id; END IF;

    INSERT INTO crm_sequence_enrollments (sequence_id, org_id, contact_id, status, current_step, next_run_at)
    SELECT p_sequence_id, v_org_id, c.id, 'active', 0, v_next
    FROM contacts c
    WHERE (v_filter->>'referral_source' IS NULL OR c.referral_source = v_filter->>'referral_source')
      AND (v_filter->>'role' IS NULL OR c.role = v_filter->>'role')
      AND (v_filter->>'tag' IS NULL OR c.tags @> to_jsonb(ARRAY[v_filter->>'tag']))
    ON CONFLICT (sequence_id, contact_id) DO NOTHING;

    RETURN QUERY
      SELECT e.* FROM crm_sequence_enrollments e
      WHERE e.sequence_id = p_sequence_id
        AND e.contact_id IN (
          SELECT c.id FROM contacts c
          WHERE (v_filter->>'referral_source' IS NULL OR c.referral_source = v_filter->>'referral_source')
            AND (v_filter->>'role' IS NULL OR c.role = v_filter->>'role')
            AND (v_filter->>'tag' IS NULL OR c.tags @> to_jsonb(ARRAY[v_filter->>'tag']))
        );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION enroll_in_sequence(uuid, uuid, uuid, uuid) TO anon, authenticated;
