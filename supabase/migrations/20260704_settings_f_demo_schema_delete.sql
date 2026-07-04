-- ════════════════════════════════════════════════════════════════════════
-- Settings Overhaul — Phase F (Foundation)
-- Drift-capture of the live demo_sheet_schemas RPC family + a SAFE
-- delete_demo_schema(p_id) that refuses to delete any version that is active,
-- was ever published, or is referenced by a saved sheet.
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY: `demo_sheet_schemas` and its RPCs were created live (never tracked in
--   supabase/migrations/ — schema drift, UPR-Web-Context 937-957). Phase F
--   captures the live definitions via pg_get_functiondef so they are now
--   schema-as-code, and adds a delete path safe enough to protect the
--   60-second rollback runbook (.claude/rules/scope-sheet-rollback.md), which
--   depends on retaining every previously-published version for re-publishing.
--
-- ADDITIVE ONLY: one new nullable column (`published_at`), one new function
--   (`delete_demo_schema`), and CREATE OR REPLACE of already-live functions
--   with identical bodies (plus one backward-compatible enhancement to
--   `publish_demo_schema` that stamps `published_at`). No table drops, no
--   column drops, no signature changes.
--
-- CONSUMER: the new delete_demo_schema RPC is consumed by Settings Overhaul P6
--   (Scope Sheets page) which replaces the raw `db.delete('demo_sheet_schemas',
--   …)`. Foundation ships the RPC; P6 wires the UI.

-- ── 1. Track "was ever published" (additive column) ──────────────────────────
-- The table had no way to tell a never-published draft from a retired-but-once-
-- live version. Without this, delete_demo_schema could only protect the CURRENT
-- active row, and a previously-published rollback target (is_active=false) would
-- be deletable — breaking the runbook. `published_at` makes "ever published"
-- detectable: publish_demo_schema stamps it, and the backfill below seeds it for
-- everything that is currently active OR already carries saved sheets (a sheet
-- can only have been built while its schema was the active/published one).
ALTER TABLE public.demo_sheet_schemas
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE public.demo_sheet_schemas s
   SET published_at = COALESCE(s.updated_at, s.created_at, now())
 WHERE s.published_at IS NULL
   AND (
     s.is_active = true
     OR EXISTS (
       SELECT 1 FROM public.forms f
        WHERE f.schema_id = s.id AND f.form_type = 'demo_sheet'
     )
   );

-- ── 2. Drift-capture: live RPC family (identical bodies) ─────────────────────
-- Captured 2026-07-04 via pg_get_functiondef against project glsmljpabrwonfiltiqm.

CREATE OR REPLACE FUNCTION public.demo_sheet_schemas_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_demo_schema()
 RETURNS TABLE(id uuid, version integer, name text, definition jsonb, updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, version, name, definition, updated_at
  FROM demo_sheet_schemas
  WHERE is_active = true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_demo_schema(p_id uuid)
 RETURNS TABLE(id uuid, version integer, name text, is_active boolean, definition jsonb, updated_at timestamp with time zone, notes text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, version, name, is_active, definition, updated_at, notes
  FROM demo_sheet_schemas
  WHERE id = p_id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.list_demo_schemas()
 RETURNS TABLE(id uuid, version integer, name text, is_active boolean, updated_at timestamp with time zone, notes text, created_by uuid, sheet_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.version, s.name, s.is_active, s.updated_at, s.notes, s.created_by,
         (SELECT count(*) FROM forms f WHERE f.schema_id = s.id AND f.form_type = 'demo_sheet') AS sheet_count
  FROM demo_sheet_schemas s
  ORDER BY s.version DESC;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_demo_schema(p_id uuid, p_name text, p_definition jsonb, p_notes text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_version INT;
BEGIN
  IF p_id IS NULL THEN
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM demo_sheet_schemas;
    INSERT INTO demo_sheet_schemas (version, name, is_active, definition, notes, created_by)
    VALUES (v_version, p_name, false, p_definition, p_notes, p_created_by)
    RETURNING id INTO v_id;
  ELSE
    UPDATE demo_sheet_schemas
       SET name = p_name,
           definition = p_definition,
           notes = COALESCE(p_notes, notes)
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$function$;

-- publish_demo_schema — drift-capture + additive enhancement: stamp published_at
-- so a version that has EVER been live is permanently protected from deletion.
-- Signature + return semantics unchanged (activation flip + FOUND).
CREATE OR REPLACE FUNCTION public.publish_demo_schema(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE demo_sheet_schemas SET is_active = false WHERE is_active = true;
  UPDATE demo_sheet_schemas
     SET is_active = true,
         published_at = COALESCE(published_at, now())
   WHERE id = p_id;
  RETURN FOUND;
END;
$function$;

-- ── 3. NEW: safe delete_demo_schema(p_id) ────────────────────────────────────
-- Refuses (RAISE) if the version is active, was ever published, or is referenced
-- by a saved demo_sheet form. Only a never-published, unreferenced draft can be
-- deleted. Returns true on success. Consumed by P6's Scope Sheets page.
CREATE OR REPLACE FUNCTION public.delete_demo_schema(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active       boolean;
  v_published_at timestamptz;
  v_version      integer;
  v_sheets       bigint;
BEGIN
  SELECT is_active, published_at, version
    INTO v_active, v_published_at, v_version
    FROM demo_sheet_schemas
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scope Sheet schema % not found', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_active THEN
    RAISE EXCEPTION 'Cannot delete the active Scope Sheet version (v%). Publish a different version first, then delete this one.', v_version
      USING ERRCODE = 'raise_exception';
  END IF;

  IF v_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete a previously-published Scope Sheet version (v%) — published versions are retained for rollback. Only never-published drafts can be deleted.', v_version
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT count(*) INTO v_sheets
    FROM forms f
   WHERE f.schema_id = p_id AND f.form_type = 'demo_sheet';

  IF v_sheets > 0 THEN
    RAISE EXCEPTION 'Cannot delete Scope Sheet version (v%) — % saved sheet(s) still reference it.', v_version, v_sheets
      USING ERRCODE = 'raise_exception';
  END IF;

  DELETE FROM demo_sheet_schemas WHERE id = p_id;
  RETURN true;
END;
$function$;

-- ── 4. Grants (idempotent; anon+authenticated, matching the live family) ─────
GRANT EXECUTE ON FUNCTION public.get_active_demo_schema()          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_demo_schema(uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_demo_schemas()             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_demo_schema(uuid, text, jsonb, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_demo_schema(uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_demo_schema(uuid)        TO anon, authenticated;
