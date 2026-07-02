-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 6a — contacts read & segments (function-body fills only)
--
-- Fills the bodies of Phase F's signature-frozen 6a stubs and body-replaces the
-- live get_duplicate_contacts to add normalized-email detection. Per
-- .claude/rules/crm-wave-ownership.md §3–4 this migration changes function
-- BODIES only — no signature change, no schema/table/column/policy change (the
-- crm_segments table + all consent columns already ship from Phase F / earlier).
-- migration-safety-checker enforces the frozen signatures.
--
-- ADDITIVE + backward-compatible: one shared Supabase, so these are live in dev
-- and main the moment they apply, but every CRM consumer is behind page:crm.
-- get_duplicate_contacts keeps its exact RETURNS TABLE shape so its one shipped
-- caller (DevTools "Scan for Duplicates") keeps working unchanged.
--
-- Consent model (get_contact_consent): a contact is do-not-contact when ANY of
--   • contacts.dnd (SMS do-not-disturb), OR
--   • contacts.opt_out_at IS NOT NULL (explicit SMS opt-out — STOP), OR
--   • their email is in email_suppressions (case/space-insensitive).
-- opt_in_status is NOT used: it defaults false for every contact (an un-opted-in
-- state, not an opt-out) so keying DNC off it would flag the whole book.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ get_crm_contacts — searchable, paged directory ═══
-- SETOF json; each row carries total_count (window count over the full match set,
-- pre-pagination) so the directory can page without a second count round-trip.
-- contacts has no org_id (a single global book) so p_org_id is accepted for the
-- frozen signature but does not scope the rows.
CREATE OR REPLACE FUNCTION get_crm_contacts(
  p_search text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH s AS (SELECT nullif(btrim(p_search), '') AS term),
  d AS (SELECT regexp_replace(COALESCE((SELECT term FROM s), ''), '[^0-9]', '', 'g') AS digits),
  matched AS (
    SELECT c.*
    FROM contacts c
    WHERE (SELECT term FROM s) IS NULL
       OR c.name    ILIKE '%' || (SELECT term FROM s) || '%'
       OR c.email   ILIKE '%' || (SELECT term FROM s) || '%'
       OR c.company ILIKE '%' || (SELECT term FROM s) || '%'
       OR ((SELECT digits FROM d) <> ''
           AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') LIKE '%' || (SELECT digits FROM d) || '%')
  )
  SELECT json_build_object(
    'id', id, 'name', name, 'phone', phone, 'email', email,
    'company', company, 'role', role, 'lifecycle_status', lifecycle_status,
    'owner_id', owner_id, 'tags', COALESCE(tags, '[]'::jsonb), 'created_at', created_at,
    'total_count', total_count
  )
  FROM (
    SELECT m.*, count(*) OVER () AS total_count FROM matched m
  ) x
  ORDER BY (x.name IS NULL), lower(x.name), x.created_at DESC
  LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
GRANT EXECUTE ON FUNCTION get_crm_contacts(text, int, int, uuid) TO anon, authenticated;

-- ═══ get_contact_consent — unified do-not-contact read ═══
CREATE OR REPLACE FUNCTION get_contact_consent(p_contact_id uuid)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT json_build_object(
    'contact_id', c.id,
    'do_not_contact',
      COALESCE(c.dnd, false)
      OR c.opt_out_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM email_suppressions es
                 WHERE c.email IS NOT NULL AND lower(btrim(es.email)) = lower(btrim(c.email))),
    'sms', json_build_object(
      'dnd', COALESCE(c.dnd, false),
      'opted_out', c.opt_out_at IS NOT NULL,
      'opt_out_at', c.opt_out_at,
      'opt_out_reason', c.opt_out_reason
    ),
    'email', json_build_object(
      'address', c.email,
      'suppressed', EXISTS (SELECT 1 FROM email_suppressions es
                 WHERE c.email IS NOT NULL AND lower(btrim(es.email)) = lower(btrim(c.email))),
      'reason', (SELECT es.reason FROM email_suppressions es
                 WHERE c.email IS NOT NULL AND lower(btrim(es.email)) = lower(btrim(c.email))
                 ORDER BY es.suppressed_at DESC NULLS LAST LIMIT 1),
      'suppressed_at', (SELECT es.suppressed_at FROM email_suppressions es
                 WHERE c.email IS NOT NULL AND lower(btrim(es.email)) = lower(btrim(c.email))
                 ORDER BY es.suppressed_at DESC NULLS LAST LIMIT 1)
    )
  )
  FROM contacts c
  WHERE c.id = p_contact_id;
$$;
GRANT EXECUTE ON FUNCTION get_contact_consent(uuid) TO anon, authenticated;

-- ═══ Segments CRUD — filter jsonb reuses the preview_email_audience shape ═══
-- filter keys: { referral_source, role, tag, city, company, search } — the exact
-- shape preview_email_audience(jsonb,…) consumes, so a saved segment's filter is
-- a drop-in campaign audience.
CREATE OR REPLACE FUNCTION upsert_segment(
  p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_description text DEFAULT NULL,
  p_filter jsonb DEFAULT '{}'::jsonb, p_org_id uuid DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS crm_segments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_name   text := nullif(btrim(p_name), '');
  v_row    crm_segments;
BEGIN
  IF p_id IS NULL THEN
    IF v_name IS NULL THEN RAISE EXCEPTION 'a segment name is required'; END IF;
    INSERT INTO crm_segments (org_id, name, description, filter, created_by)
    VALUES (v_org_id, v_name, nullif(btrim(p_description), ''), COALESCE(p_filter, '{}'::jsonb), p_created_by)
    RETURNING * INTO v_row;
  ELSE
    UPDATE crm_segments SET
      name        = COALESCE(v_name, name),
      description  = nullif(btrim(p_description), ''),
      filter      = COALESCE(p_filter, filter),
      updated_at  = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'segment % not found', p_id; END IF;
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION upsert_segment(uuid, text, text, jsonb, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_segments(p_org_id uuid DEFAULT NULL)
RETURNS SETOF crm_segments
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT * FROM crm_segments
  WHERE org_id = COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1))
  ORDER BY lower(name);
$$;
GRANT EXECUTE ON FUNCTION get_segments(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION delete_segment(p_segment_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM crm_segments WHERE id = p_segment_id;
$$;
GRANT EXECUTE ON FUNCTION delete_segment(uuid) TO anon, authenticated;

-- ═══ get_duplicate_contacts — body-replace: add normalized-email detection ═══
-- Backward-compatible: identical RETURNS TABLE shape; the existing phone-based
-- groups are unchanged and email-normalized groups are UNION-ed in. For an email
-- group the phone_normalized column carries the normalized email (lower+trim) —
-- the column is the group's match key, not necessarily a phone. The one shipped
-- caller (DevTools) reads the same columns and keeps working.
CREATE OR REPLACE FUNCTION get_duplicate_contacts()
RETURNS TABLE(phone_normalized text, contact_ids uuid[], names text[], count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = 'public', 'extensions', 'pg_temp'
AS $$
  WITH phone_groups AS (
    SELECT
      regexp_replace(phone, '[^0-9]', '', 'g') AS match_key,
      array_agg(id ORDER BY created_at)         AS contact_ids,
      array_agg(COALESCE(name, phone) ORDER BY created_at) AS names,
      COUNT(*)                                   AS count
    FROM contacts
    WHERE phone IS NOT NULL AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
    GROUP BY 1
    HAVING COUNT(*) > 1
  ),
  email_groups AS (
    SELECT
      lower(btrim(email))                        AS match_key,
      array_agg(id ORDER BY created_at)          AS contact_ids,
      array_agg(COALESCE(name, email) ORDER BY created_at) AS names,
      COUNT(*)                                    AS count
    FROM contacts
    WHERE email IS NOT NULL AND btrim(email) <> ''
    GROUP BY 1
    HAVING COUNT(*) > 1
  )
  SELECT match_key, contact_ids, names, count FROM phone_groups
  UNION ALL
  SELECT match_key, contact_ids, names, count FROM email_groups
  ORDER BY count DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION get_duplicate_contacts() TO anon, authenticated;
