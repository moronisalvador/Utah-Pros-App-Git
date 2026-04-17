-- Phase 1 — Rooms table + RPCs + job_documents.room_id link
-- Adds per-job room tracking so photos, notes, and (later) moisture readings
-- can be grouped by room. insert_job_document is extended with p_room_id at
-- the end to preserve backward compatibility with existing callers
-- (TechAppointment.jsx line 110 passes no p_room_id → defaults to NULL).

-- ── Rooms table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rooms (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  area_sqft          NUMERIC NULL,
  ceiling_height_ft  NUMERIC NULL,
  sort_order         INT NOT NULL DEFAULT 0,
  client_id          UUID NULL UNIQUE,                       -- offline idempotency key
  created_by         UUID NULL REFERENCES employees(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS rooms_job_idx
  ON rooms(job_id)
  WHERE deleted_at IS NULL;

-- ── Link job_documents → rooms (nullable; photos without a room stay valid) ──

ALTER TABLE job_documents
  ADD COLUMN IF NOT EXISTS room_id UUID NULL REFERENCES rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_documents_room_idx
  ON job_documents(room_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_authenticated_all" ON rooms
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ── Get rooms for a job (with photo + reading counts) ────────────────────────

CREATE OR REPLACE FUNCTION get_job_rooms(p_job_id UUID)
RETURNS TABLE (
  id                 UUID,
  job_id             UUID,
  name               TEXT,
  area_sqft          NUMERIC,
  ceiling_height_ft  NUMERIC,
  sort_order         INT,
  client_id          UUID,
  created_by         UUID,
  created_at         TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ,
  photo_count        INT,
  reading_count      INT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT
      r.id, r.job_id, r.name, r.area_sqft, r.ceiling_height_ft,
      r.sort_order, r.client_id, r.created_by, r.created_at, r.deleted_at,
      COALESCE((
        SELECT COUNT(*)::INT
        FROM job_documents d
        WHERE d.room_id = r.id
          AND d.category = 'photo'
      ), 0) AS photo_count,
      0::INT AS reading_count  -- Phase 2: replace with moisture_readings count
    FROM rooms r
    WHERE r.job_id = p_job_id
      AND r.deleted_at IS NULL
    ORDER BY r.sort_order ASC, r.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_job_rooms TO anon, authenticated;

-- ── Create / upsert a room (offline-safe via client_id) ──────────────────────

CREATE OR REPLACE FUNCTION create_room(
  p_job_id             UUID,
  p_name               TEXT,
  p_area_sqft          NUMERIC DEFAULT NULL,
  p_ceiling_height_ft  NUMERIC DEFAULT NULL,
  p_sort_order         INT     DEFAULT 0,
  p_client_id          UUID    DEFAULT NULL,
  p_created_by         UUID    DEFAULT NULL
)
RETURNS rooms
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result rooms;
BEGIN
  INSERT INTO rooms (
    job_id, name, area_sqft, ceiling_height_ft, sort_order, client_id, created_by
  )
  VALUES (
    p_job_id, p_name, p_area_sqft, p_ceiling_height_ft, p_sort_order, p_client_id, p_created_by
  )
  ON CONFLICT (client_id) DO UPDATE
    SET name              = EXCLUDED.name,
        area_sqft         = EXCLUDED.area_sqft,
        ceiling_height_ft = EXCLUDED.ceiling_height_ft,
        sort_order        = EXCLUDED.sort_order
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION create_room TO anon, authenticated;

-- ── Update an existing room ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_room(
  p_room_id            UUID,
  p_name               TEXT,
  p_area_sqft          NUMERIC,
  p_ceiling_height_ft  NUMERIC,
  p_sort_order         INT
)
RETURNS rooms
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result rooms;
BEGIN
  UPDATE rooms
     SET name              = p_name,
         area_sqft         = p_area_sqft,
         ceiling_height_ft = p_ceiling_height_ft,
         sort_order        = p_sort_order
   WHERE id = p_room_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION update_room TO anon, authenticated;

-- ── Soft-delete a room (and unlink any photos attached to it) ────────────────

CREATE OR REPLACE FUNCTION delete_room(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE job_documents
     SET room_id = NULL
   WHERE room_id = p_room_id;

  UPDATE rooms
     SET deleted_at = now()
   WHERE id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_room TO anon, authenticated;

-- ── Move a photo between rooms (NULL = unassigned) ───────────────────────────

CREATE OR REPLACE FUNCTION move_photo_to_room(
  p_document_id UUID,
  p_room_id     UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE job_documents
     SET room_id = p_room_id
   WHERE id = p_document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION move_photo_to_room TO anon, authenticated;

-- ── Extend insert_job_document with optional room_id (BACKWARD COMPATIBLE) ───
-- Existing DB has two overloads (7-param and 8-param) with p_description BEFORE
-- p_appointment_id. All callers use NAMED PostgREST args via db.rpc(), so we can
-- safely drop both overloads and replace with a single canonical 9-param version
-- (p_appointment_id and p_description retain DEFAULT NULL for backward compat).

DROP FUNCTION IF EXISTS insert_job_document(uuid, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS insert_job_document(uuid, text, text, text, text, uuid, text, uuid);

CREATE OR REPLACE FUNCTION insert_job_document(
  p_job_id         UUID,
  p_name           TEXT,
  p_file_path      TEXT,
  p_mime_type      TEXT,
  p_category       TEXT,
  p_uploaded_by    UUID,
  p_appointment_id UUID DEFAULT NULL,
  p_description    TEXT DEFAULT NULL,
  p_room_id        UUID DEFAULT NULL
)
RETURNS job_documents
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result job_documents;
BEGIN
  INSERT INTO job_documents (
    job_id, name, file_path, mime_type, category,
    uploaded_by, appointment_id, description, room_id
  )
  VALUES (
    p_job_id, p_name, p_file_path, p_mime_type, p_category,
    p_uploaded_by, p_appointment_id, p_description, p_room_id
  )
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_job_document TO anon, authenticated;

-- ── Bust PostgREST schema cache so new table + RPCs are visible ──────────────

SELECT bust_postgrest_cache();
