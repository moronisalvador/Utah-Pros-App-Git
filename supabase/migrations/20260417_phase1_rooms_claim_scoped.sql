-- Phase 1 refactor — rooms are claim-scoped, not job-scoped
--
-- Physical rooms belong to the property (claim), not to the service type (job).
-- On a single claim we often have water + mold + reconstruction jobs all
-- touching the same kitchen, basement, etc. Our earlier schema (rooms.job_id)
-- would have forced techs to re-create "Kitchen" for every job on the claim.
--
-- Rooms table was empty at migration time (verified: SELECT COUNT(*) = 0), so
-- this swap is safe without a backfill. Frontend RPC signatures are preserved —
-- callers still pass p_job_id and the function resolves claim_id internally.

-- ── Swap rooms.job_id → rooms.claim_id ───────────────────────────────────────

ALTER TABLE rooms DROP COLUMN IF EXISTS job_id;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS claim_id UUID;
ALTER TABLE rooms ALTER COLUMN claim_id SET NOT NULL;

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_claim_id_fkey;
ALTER TABLE rooms
  ADD CONSTRAINT rooms_claim_id_fkey
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS rooms_job_idx;
CREATE INDEX IF NOT EXISTS rooms_claim_idx
  ON rooms(claim_id)
  WHERE deleted_at IS NULL;

-- ── get_job_rooms: preserve signature, resolve claim internally ──────────────
-- Return shape changes (job_id column → claim_id column) so we must DROP first.

DROP FUNCTION IF EXISTS get_job_rooms(UUID);

CREATE OR REPLACE FUNCTION get_job_rooms(p_job_id UUID)
RETURNS TABLE (
  id                 UUID,
  claim_id           UUID,
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
DECLARE
  v_claim_id UUID;
BEGIN
  SELECT j.claim_id INTO v_claim_id FROM jobs j WHERE j.id = p_job_id;
  IF v_claim_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT
      r.id, r.claim_id, r.name, r.area_sqft, r.ceiling_height_ft,
      r.sort_order, r.client_id, r.created_by, r.created_at, r.deleted_at,
      COALESCE((
        SELECT COUNT(*)::INT
        FROM job_documents d
        WHERE d.room_id = r.id
          AND d.category = 'photo'
      ), 0) AS photo_count,
      0::INT AS reading_count
    FROM rooms r
    WHERE r.claim_id = v_claim_id
      AND r.deleted_at IS NULL
    ORDER BY r.sort_order ASC, r.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_job_rooms TO anon, authenticated;

-- ── get_claim_rooms: direct claim-level lookup (for the future claim UI) ─────

CREATE OR REPLACE FUNCTION get_claim_rooms(p_claim_id UUID)
RETURNS TABLE (
  id                 UUID,
  claim_id           UUID,
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
      r.id, r.claim_id, r.name, r.area_sqft, r.ceiling_height_ft,
      r.sort_order, r.client_id, r.created_by, r.created_at, r.deleted_at,
      COALESCE((
        SELECT COUNT(*)::INT
        FROM job_documents d
        WHERE d.room_id = r.id
          AND d.category = 'photo'
      ), 0) AS photo_count,
      0::INT AS reading_count
    FROM rooms r
    WHERE r.claim_id = p_claim_id
      AND r.deleted_at IS NULL
    ORDER BY r.sort_order ASC, r.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_claim_rooms TO anon, authenticated;

-- ── create_room: preserve signature, look up claim from job ──────────────────

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
  v_claim_id UUID;
  result rooms;
BEGIN
  SELECT j.claim_id INTO v_claim_id FROM jobs j WHERE j.id = p_job_id;
  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'create_room: job % not found or has no claim', p_job_id;
  END IF;

  INSERT INTO rooms (
    claim_id, name, area_sqft, ceiling_height_ft, sort_order, client_id, created_by
  )
  VALUES (
    v_claim_id, p_name, p_area_sqft, p_ceiling_height_ft, p_sort_order, p_client_id, p_created_by
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

-- ── create_room_for_claim: direct variant for the claim-level UI ─────────────

CREATE OR REPLACE FUNCTION create_room_for_claim(
  p_claim_id           UUID,
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
    claim_id, name, area_sqft, ceiling_height_ft, sort_order, client_id, created_by
  )
  VALUES (
    p_claim_id, p_name, p_area_sqft, p_ceiling_height_ft, p_sort_order, p_client_id, p_created_by
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

GRANT EXECUTE ON FUNCTION create_room_for_claim TO anon, authenticated;

SELECT bust_postgrest_cache();
