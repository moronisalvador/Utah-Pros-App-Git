-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback Media — Phase F (Foundation) schema + RPC cutover
--
-- docs/feedback-media-roadmap.md, "Phase F — Foundation". Supersedes the
-- undated supabase/migrations/tech_feedback.sql (never edited, per protocol).
-- Phase F owns 100% of the wave's schema: Sessions B (TechFeedback rebuild)
-- and C (AdminFeedback rebuild + gallery) ship ZERO schema migrations.
--
-- ALL ADDITIVE (CLAUDE.md Rule 7): new columns on tech_feedback only, nothing
-- existing is altered/dropped/retyped. One shared Supabase across dev + main —
-- everything here is live in production the moment it applies, so the RPC
-- bodies mirror BOTH directions (screenshots→attachments for the live
-- TechFeedback.jsx caller, image attachments→screenshots for new callers) so
-- no deploy order can break either rendering path.
--
-- ⚠️ insert_tech_feedback is DROP + CREATE, NOT `CREATE OR REPLACE`: replacing
-- with a longer parameter list would leave the old 5-arg function alongside a
-- new 7-arg one — an ambiguous overload PostgREST refuses to resolve (HTTP
-- 300), instantly breaking every live tech submit. get_tech_feedback is
-- DROP + CREATE because its RETURNS TABLE gains columns (Postgres forbids OR
-- REPLACE on a changed result type). update_tech_feedback keeps its exact
-- signature → plain OR REPLACE. EXECUTE is re-granted after every DROP+CREATE
-- (grants die with the function).
--
-- Path formats (the seam between old and new):
--   screenshots  — legacy: bare path strings WITH the bucket prefix
--                  ("job-files/feedback/{emp}/{ts}-{name}") — exactly what the
--                  live AdminFeedback.jsx feeds to /storage/v1/object/public/.
--   attachments  — new: [{path,name,mime,size,original_size,width?,height?,
--                  duration?}] records, path bucket-LESS
--                  ("feedback/{emp}/{ts}-{name}") — the bucket is the
--                  uploader's concern (src/lib/mediaCompress.js
--                  buildStoragePath / stripBucketPrefix).
--
-- ⚠️ Double-encoding discovered live: TechFeedback.jsx sends
-- p_screenshots: JSON.stringify(paths), which PostgREST casts to a jsonb
-- STRING scalar ("[\"job-files/…\"]"), not an array — verified on the live
-- table (jsonb_typeof = 'string'). AdminFeedback's Array.isArray check then
-- silently drops such screenshots (latent live bug). This migration
-- normalizes existing double-encoded values, and the new insert function
-- decodes string-scalar input, so the old caller's screenshots become real
-- arrays that actually render. All jsonb_array_length() calls are guarded via
-- CASE (Postgres AND does not guarantee evaluation order).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══ 1. Columns (additive only) ═══════════════════════════════════════════════

ALTER TABLE tech_feedback
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tech'
    CHECK (source IN ('tech', 'desktop')),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachments_purged_at timestamptz;

-- ═══ 2. Backfill ══════════════════════════════════════════════════════════════

-- 2a. Normalize double-encoded screenshots (jsonb string scalar containing a
-- serialized array — see header) into real jsonb arrays. Values were produced
-- by JSON.stringify so the inner text is valid JSON; the regex guard keeps
-- non-array strings out of the cast.
UPDATE tech_feedback
SET screenshots = (screenshots #>> '{}')::jsonb
WHERE jsonb_typeof(screenshots) = 'string'
  AND (screenshots #>> '{}') ~ '^\s*\[';

-- 2b. Existing screenshot paths become {path}-only attachment records, bucket
-- prefix stripped so the attachments column is uniformly bucket-less.
UPDATE tech_feedback
SET attachments = COALESCE((
      SELECT jsonb_agg(jsonb_build_object('path', regexp_replace(elem, '^job-files/', '')))
      FROM jsonb_array_elements_text(screenshots) AS elem
    ), '[]'::jsonb)
WHERE attachments = '[]'::jsonb
  AND CASE WHEN jsonb_typeof(screenshots) = 'array'
           THEN jsonb_array_length(screenshots) > 0
           ELSE false END;

-- Rows already terminal get resolved_at stamped now — the retention clock for
-- media purging starts at migration time, never in the un-audited past.
UPDATE tech_feedback
SET resolved_at = now()
WHERE status IN ('resolved', 'dismissed')
  AND resolved_at IS NULL;

-- ═══ 3. insert_tech_feedback — DROP + CREATE 7-arg (see header) ═══════════════

DROP FUNCTION IF EXISTS insert_tech_feedback(uuid, text, text, text, jsonb);

CREATE FUNCTION insert_tech_feedback(
  p_employee_id uuid,
  p_type        text,
  p_title       text,
  p_description text  DEFAULT NULL,
  p_screenshots jsonb DEFAULT '[]'::jsonb,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_source      text  DEFAULT 'tech'
)
RETURNS tech_feedback
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_screenshots jsonb := COALESCE(p_screenshots, '[]'::jsonb);
  v_attachments jsonb := COALESCE(p_attachments, '[]'::jsonb);
  result        tech_feedback;
BEGIN
  -- The live TechFeedback.jsx sends p_screenshots as JSON.stringify(paths):
  -- PostgREST delivers a jsonb STRING scalar containing serialized JSON.
  -- Decode it so old-caller screenshots are stored as real arrays (and
  -- actually render in AdminFeedback — see header). Anything still not an
  -- array after decoding is dropped defensively.
  IF jsonb_typeof(v_screenshots) = 'string' THEN
    BEGIN
      v_screenshots := (v_screenshots #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      v_screenshots := '[]'::jsonb;
    END;
  END IF;
  IF jsonb_typeof(v_attachments) = 'string' THEN
    BEGIN
      v_attachments := (v_attachments #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      v_attachments := '[]'::jsonb;
    END;
  END IF;
  IF jsonb_typeof(v_screenshots) <> 'array' THEN v_screenshots := '[]'::jsonb; END IF;
  IF jsonb_typeof(v_attachments) <> 'array' THEN v_attachments := '[]'::jsonb; END IF;

  IF v_attachments = '[]'::jsonb AND jsonb_array_length(v_screenshots) > 0 THEN
    -- Old caller (live TechFeedback.jsx): mirror screenshots → attachments as
    -- {path}-only records, bucket prefix stripped.
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('path', regexp_replace(elem, '^job-files/', ''))),
             '[]'::jsonb)
    INTO v_attachments
    FROM jsonb_array_elements_text(v_screenshots) AS elem;
  ELSIF v_screenshots = '[]'::jsonb AND jsonb_array_length(v_attachments) > 0 THEN
    -- New caller: mirror IMAGE attachments → screenshots with the bucket
    -- prefix, so the live AdminFeedback.jsx keeps rendering them. Videos are
    -- not screenshots and are deliberately not mirrored.
    SELECT COALESCE(
             jsonb_agg('job-files/' || regexp_replace(att->>'path', '^job-files/', '')),
             '[]'::jsonb)
    INTO v_screenshots
    FROM jsonb_array_elements(v_attachments) AS att
    WHERE att->>'mime' LIKE 'image/%';
  END IF;

  INSERT INTO tech_feedback (employee_id, type, title, description, screenshots, attachments, source)
  VALUES (p_employee_id, p_type, p_title, p_description,
          v_screenshots, v_attachments, COALESCE(p_source, 'tech'))
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_tech_feedback(uuid, text, text, text, jsonb, jsonb, text)
  TO anon, authenticated;

-- ═══ 4. update_tech_feedback — same signature, plain OR REPLACE ═══════════════

CREATE OR REPLACE FUNCTION update_tech_feedback(
  p_id          uuid,
  p_status      text,
  p_admin_notes text DEFAULT NULL
)
RETURNS tech_feedback
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result tech_feedback;
BEGIN
  UPDATE tech_feedback
  SET status      = p_status,
      admin_notes = COALESCE(p_admin_notes, admin_notes),
      -- First transition into resolved/dismissed stamps resolved_at;
      -- terminal↔terminal keeps the original stamp (COALESCE); reopening
      -- NULLs it. attachments_purged_at is deliberately never touched here.
      resolved_at = CASE
        WHEN p_status IN ('resolved', 'dismissed') THEN COALESCE(resolved_at, now())
        ELSE NULL
      END
  WHERE id = p_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION update_tech_feedback(uuid, text, text) TO anon, authenticated;

-- ═══ 5. get_tech_feedback — DROP + CREATE (RETURNS TABLE gains columns) ═══════

DROP FUNCTION IF EXISTS get_tech_feedback();

CREATE FUNCTION get_tech_feedback()
RETURNS TABLE (
  id                    uuid,
  employee_id           uuid,
  employee_name         text,
  type                  text,
  title                 text,
  description           text,
  screenshots           jsonb,
  status                text,
  admin_notes           text,
  created_at            timestamptz,
  attachments           jsonb,
  source                text,
  resolved_at           timestamptz,
  attachments_purged_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- New columns are appended: the live AdminFeedback.jsx caller reads JSON
  -- objects by key and simply ignores the extra keys.
  RETURN QUERY
    SELECT
      f.id, f.employee_id,
      e.full_name AS employee_name,
      f.type, f.title, f.description,
      f.screenshots, f.status, f.admin_notes,
      f.created_at,
      f.attachments, f.source, f.resolved_at, f.attachments_purged_at
    FROM tech_feedback f
    JOIN employees e ON e.id = f.employee_id
    ORDER BY f.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_tech_feedback() TO anon, authenticated;

-- ═══ 6. get_purgeable_feedback_media — retention query for the future purge
--        endpoint (unauthenticated by cron convention, hence the clamp) ═══════

CREATE OR REPLACE FUNCTION get_purgeable_feedback_media(p_days int DEFAULT 90)
RETURNS TABLE (
  id          uuid,
  attachments jsonb,
  resolved_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  -- Clamp INSIDE the RPC: the purge endpoint that will call this runs
  -- unauthenticated (cron convention), so a caller-supplied p_days must never
  -- be able to shorten retention below 30 days.
  v_days int := GREATEST(COALESCE(p_days, 90), 30);
BEGIN
  RETURN QUERY
    SELECT f.id, f.attachments, f.resolved_at
    FROM tech_feedback f
    WHERE f.status IN ('resolved', 'dismissed')
      AND f.resolved_at IS NOT NULL
      AND f.resolved_at < now() - make_interval(days => v_days)
      AND f.attachments_purged_at IS NULL
      AND f.attachments <> '[]'::jsonb
    ORDER BY f.resolved_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_purgeable_feedback_media(int) TO anon, authenticated;

-- ═══ 7. mark_feedback_attachments_purged — idempotent purge stamp ═════════════

CREATE OR REPLACE FUNCTION mark_feedback_attachments_purged(p_id uuid)
RETURNS tech_feedback
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result tech_feedback;
BEGIN
  UPDATE tech_feedback
  SET attachments_purged_at = COALESCE(attachments_purged_at, now())  -- first stamp wins
  WHERE id = p_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_feedback_attachments_purged(uuid) TO anon, authenticated;

COMMIT;
