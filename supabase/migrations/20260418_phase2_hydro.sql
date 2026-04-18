-- Phase 2 — Hydro: moisture readings + equipment placements (IICRC S500 compliant)
--
-- Adds per-job moisture readings and equipment placements, both optionally
-- scoped to a room (room_id nullable — rooms live on claims, see Phase 1.5).
-- Readings carry material + environmentals (MC%, RH%, temp, GPP, dew point)
-- and support IICRC-style dry standard / drying goal tracking. Equipment
-- placements track dehus, air movers, AFDs, HEPAs, etc. with placed/removed
-- lifecycle and can be referenced from readings (e.g. "reading near LGR-1").
--
-- Offline-safe: both tables carry a UUID client_id unique key so the tech
-- app can retry inserts from its outbox without creating duplicates.
--
-- Edit/delete window: readings are only mutable for 10 minutes after they
-- were taken. After that they become an immutable audit record.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE material_type AS ENUM (
    'drywall','wood_subfloor','wood_framing','wood_hardwood','wood_engineered',
    'concrete','carpet','carpet_pad','tile','laminate','vinyl','insulation','other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE equipment_type AS ENUM (
    'dehu_lgr','dehu_conventional','dehu_desiccant',
    'air_mover','air_mover_axial','afd','hepa','heater','other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── moisture_readings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS moisture_readings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  room_id              UUID NULL REFERENCES rooms(id) ON DELETE SET NULL,
  equipment_id         UUID NULL,          -- FK added after equipment_placements is created
  reading_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  material             material_type NOT NULL,
  location_description TEXT NULL,
  mc_pct               NUMERIC NULL,
  rh_pct               NUMERIC NULL,
  temp_f               NUMERIC NULL,
  gpp                  NUMERIC NULL,
  dew_point_f          NUMERIC NULL,
  dry_standard_pct     NUMERIC NULL,
  drying_goal_pct      NUMERIC NULL,
  is_affected          BOOLEAN NOT NULL DEFAULT true,
  taken_by             UUID NULL REFERENCES employees(id),
  taken_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at            TIMESTAMPTZ NULL,
  edited_by            UUID NULL REFERENCES employees(id),
  notes                TEXT NULL,
  client_id            UUID NULL UNIQUE,    -- offline idempotency
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moisture_job_idx
  ON moisture_readings(job_id, reading_date DESC);
CREATE INDEX IF NOT EXISTS moisture_room_material_idx
  ON moisture_readings(room_id, material, reading_date DESC);

-- ── equipment_placements ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_placements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  room_id         UUID NULL REFERENCES rooms(id) ON DELETE SET NULL,
  equipment_type  equipment_type NOT NULL,
  nickname        TEXT NULL,
  serial_number   TEXT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  placed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ NULL,
  placed_by       UUID NULL REFERENCES employees(id),
  removed_by      UUID NULL REFERENCES employees(id),
  notes           TEXT NULL,
  client_id       UUID NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equip_job_active_idx
  ON equipment_placements(job_id)
  WHERE status = 'active';

-- Wire the FK from moisture_readings.equipment_id now that the target exists.
ALTER TABLE moisture_readings
  DROP CONSTRAINT IF EXISTS moisture_equipment_fk;
ALTER TABLE moisture_readings
  ADD CONSTRAINT moisture_equipment_fk
  FOREIGN KEY (equipment_id) REFERENCES equipment_placements(id) ON DELETE SET NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE moisture_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "moisture_authenticated_all" ON moisture_readings;
CREATE POLICY "moisture_authenticated_all" ON moisture_readings
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE equipment_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "equip_authenticated_all" ON equipment_placements;
CREATE POLICY "equip_authenticated_all" ON equipment_placements
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ── insert_reading ────────────────────────────────────────────────────────────
-- Idempotent on client_id. Dry standard logic:
--   * If p_is_affected = false and no dry_standard exists yet for this
--     (job_id, material), this reading BECOMES the dry standard for the pair,
--     drying_goal = dry_standard + 2. Then backfill any existing affected
--     readings for the same (job, material) where dry_standard_pct IS NULL.
--   * If p_is_affected = true and a dry standard already exists for this
--     (job, material), copy it (and drying_goal) forward onto the new row.

CREATE OR REPLACE FUNCTION insert_reading(
  p_job_id        UUID,
  p_room_id       UUID,
  p_material      material_type,
  p_location      TEXT,
  p_mc            NUMERIC,
  p_rh            NUMERIC,
  p_temp_f        NUMERIC,
  p_gpp           NUMERIC,
  p_dew_point     NUMERIC,
  p_is_affected   BOOLEAN,
  p_equipment_id  UUID,
  p_taken_by      UUID,
  p_notes         TEXT,
  p_client_id     UUID,
  p_taken_at      TIMESTAMPTZ DEFAULT now()
)
RETURNS moisture_readings
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_existing_standard NUMERIC;
  v_existing_goal     NUMERIC;
  v_dry_standard      NUMERIC;
  v_drying_goal       NUMERIC;
  result              moisture_readings;
BEGIN
  -- Look for an already-established dry standard for this (job, material).
  SELECT mr.dry_standard_pct, mr.drying_goal_pct
    INTO v_existing_standard, v_existing_goal
    FROM moisture_readings mr
   WHERE mr.job_id = p_job_id
     AND mr.material = p_material
     AND mr.dry_standard_pct IS NOT NULL
   ORDER BY mr.taken_at ASC
   LIMIT 1;

  IF p_is_affected = false AND v_existing_standard IS NULL AND p_mc IS NOT NULL THEN
    -- This unaffected reading sets the standard for the pair.
    v_dry_standard := p_mc;
    v_drying_goal  := p_mc + 2;
  ELSIF v_existing_standard IS NOT NULL THEN
    -- Carry the existing standard forward onto every new reading.
    v_dry_standard := v_existing_standard;
    v_drying_goal  := COALESCE(v_existing_goal, v_existing_standard + 2);
  ELSE
    v_dry_standard := NULL;
    v_drying_goal  := NULL;
  END IF;

  INSERT INTO moisture_readings (
    job_id, room_id, equipment_id, material, location_description,
    mc_pct, rh_pct, temp_f, gpp, dew_point_f,
    dry_standard_pct, drying_goal_pct,
    is_affected, taken_by, taken_at, notes, client_id
  )
  VALUES (
    p_job_id, p_room_id, p_equipment_id, p_material, p_location,
    p_mc, p_rh, p_temp_f, p_gpp, p_dew_point,
    v_dry_standard, v_drying_goal,
    p_is_affected, p_taken_by, p_taken_at, p_notes, p_client_id
  )
  ON CONFLICT (client_id) DO UPDATE
    SET room_id              = EXCLUDED.room_id,
        equipment_id         = EXCLUDED.equipment_id,
        material             = EXCLUDED.material,
        location_description = EXCLUDED.location_description,
        mc_pct               = EXCLUDED.mc_pct,
        rh_pct               = EXCLUDED.rh_pct,
        temp_f               = EXCLUDED.temp_f,
        gpp                  = EXCLUDED.gpp,
        dew_point_f          = EXCLUDED.dew_point_f,
        dry_standard_pct     = EXCLUDED.dry_standard_pct,
        drying_goal_pct      = EXCLUDED.drying_goal_pct,
        is_affected          = EXCLUDED.is_affected,
        notes                = EXCLUDED.notes
  RETURNING * INTO result;

  -- If we just established the standard, backfill any prior affected readings
  -- for the same (job, material) that were logged before the standard existed.
  IF p_is_affected = false AND v_existing_standard IS NULL AND v_dry_standard IS NOT NULL THEN
    UPDATE moisture_readings
       SET dry_standard_pct = v_dry_standard,
           drying_goal_pct  = v_drying_goal
     WHERE job_id = p_job_id
       AND material = p_material
       AND dry_standard_pct IS NULL
       AND id <> result.id;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_reading TO anon, authenticated;

-- ── update_reading (10 minute window) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_reading(
  p_reading_id  UUID,
  p_material    material_type,
  p_location    TEXT,
  p_mc          NUMERIC,
  p_rh          NUMERIC,
  p_temp_f      NUMERIC,
  p_gpp         NUMERIC,
  p_dew_point   NUMERIC,
  p_is_affected BOOLEAN,
  p_notes       TEXT,
  p_edited_by   UUID
)
RETURNS moisture_readings
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_taken_at TIMESTAMPTZ;
  result     moisture_readings;
BEGIN
  SELECT taken_at INTO v_taken_at
    FROM moisture_readings
   WHERE id = p_reading_id;

  IF v_taken_at IS NULL THEN
    RAISE EXCEPTION 'update_reading: reading % not found', p_reading_id;
  END IF;

  IF v_taken_at <= now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'update_reading: edit window closed (readings are immutable after 10 minutes)';
  END IF;

  UPDATE moisture_readings
     SET material             = p_material,
         location_description = p_location,
         mc_pct               = p_mc,
         rh_pct               = p_rh,
         temp_f               = p_temp_f,
         gpp                  = p_gpp,
         dew_point_f          = p_dew_point,
         is_affected          = p_is_affected,
         notes                = p_notes,
         edited_at            = now(),
         edited_by            = p_edited_by
   WHERE id = p_reading_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION update_reading TO anon, authenticated;

-- ── delete_reading (10 minute window) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_reading(p_reading_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_taken_at TIMESTAMPTZ;
BEGIN
  SELECT taken_at INTO v_taken_at
    FROM moisture_readings
   WHERE id = p_reading_id;

  IF v_taken_at IS NULL THEN
    RAISE EXCEPTION 'delete_reading: reading % not found', p_reading_id;
  END IF;

  IF v_taken_at <= now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'delete_reading: delete window closed (readings are immutable after 10 minutes)';
  END IF;

  DELETE FROM moisture_readings WHERE id = p_reading_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_reading TO anon, authenticated;

-- ── get_job_readings ──────────────────────────────────────────────────────────
-- Returns every reading for the job with the room name joined in, plus a
-- per-row is_stalled flag. A reading is flagged stalled when it IS the latest
-- reading for its (room, material) pair AND mc_pct > drying_goal_pct AND a
-- prior reading for the same (room, material) taken at least 36 hours before
-- this one shows less than 1.0 point of drop (prior.mc_pct - this.mc_pct < 1.0).

CREATE OR REPLACE FUNCTION get_job_readings(p_job_id UUID)
RETURNS TABLE (
  id                   UUID,
  job_id               UUID,
  room_id              UUID,
  room_name            TEXT,
  equipment_id         UUID,
  reading_date         DATE,
  material             material_type,
  location_description TEXT,
  mc_pct               NUMERIC,
  rh_pct               NUMERIC,
  temp_f               NUMERIC,
  gpp                  NUMERIC,
  dew_point_f          NUMERIC,
  dry_standard_pct     NUMERIC,
  drying_goal_pct      NUMERIC,
  is_affected          BOOLEAN,
  taken_by             UUID,
  taken_at             TIMESTAMPTZ,
  edited_at            TIMESTAMPTZ,
  edited_by            UUID,
  notes                TEXT,
  client_id            UUID,
  created_at           TIMESTAMPTZ,
  is_stalled           BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH latest_per_pair AS (
    -- Latest reading per (room_id, material) for this job.
    SELECT DISTINCT ON (mr.room_id, mr.material)
           mr.id AS latest_id,
           mr.room_id,
           mr.material,
           mr.mc_pct        AS latest_mc,
           mr.drying_goal_pct AS latest_goal,
           mr.taken_at      AS latest_taken_at
      FROM moisture_readings mr
     WHERE mr.job_id = p_job_id
     ORDER BY mr.room_id, mr.material, mr.taken_at DESC
  ),
  stall_check AS (
    -- For each latest row, find a prior reading >=36h older in same pair.
    SELECT lpp.latest_id,
           (lpp.latest_mc IS NOT NULL
            AND lpp.latest_goal IS NOT NULL
            AND lpp.latest_mc > lpp.latest_goal
            AND EXISTS (
              SELECT 1
                FROM moisture_readings prior
               WHERE prior.job_id    = p_job_id
                 AND prior.room_id IS NOT DISTINCT FROM lpp.room_id
                 AND prior.material  = lpp.material
                 AND prior.id       <> lpp.latest_id
                 AND prior.taken_at <= lpp.latest_taken_at - interval '36 hours'
                 AND prior.mc_pct   IS NOT NULL
                 AND (prior.mc_pct - lpp.latest_mc) < 1.0
            )) AS is_stalled
      FROM latest_per_pair lpp
  )
  SELECT
    mr.id, mr.job_id, mr.room_id,
    r.name AS room_name,
    mr.equipment_id, mr.reading_date, mr.material, mr.location_description,
    mr.mc_pct, mr.rh_pct, mr.temp_f, mr.gpp, mr.dew_point_f,
    mr.dry_standard_pct, mr.drying_goal_pct,
    mr.is_affected, mr.taken_by, mr.taken_at, mr.edited_at, mr.edited_by,
    mr.notes, mr.client_id, mr.created_at,
    COALESCE(sc.is_stalled, false) AS is_stalled
    FROM moisture_readings mr
    LEFT JOIN rooms r        ON r.id = mr.room_id
    LEFT JOIN stall_check sc ON sc.latest_id = mr.id
   WHERE mr.job_id = p_job_id
   ORDER BY mr.reading_date DESC, mr.taken_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_job_readings TO anon, authenticated;

-- ── get_job_equipment ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_job_equipment(
  p_job_id           UUID,
  p_include_removed  BOOLEAN DEFAULT false
)
RETURNS TABLE (
  id              UUID,
  job_id          UUID,
  room_id         UUID,
  room_name       TEXT,
  equipment_type  equipment_type,
  nickname        TEXT,
  serial_number   TEXT,
  status          TEXT,
  placed_at       TIMESTAMPTZ,
  removed_at      TIMESTAMPTZ,
  placed_by       UUID,
  removed_by      UUID,
  notes           TEXT,
  client_id       UUID,
  created_at      TIMESTAMPTZ,
  days_onsite     INT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT
      ep.id, ep.job_id, ep.room_id,
      r.name AS room_name,
      ep.equipment_type, ep.nickname, ep.serial_number, ep.status,
      ep.placed_at, ep.removed_at, ep.placed_by, ep.removed_by,
      ep.notes, ep.client_id, ep.created_at,
      EXTRACT(DAY FROM (COALESCE(ep.removed_at, now()) - ep.placed_at))::INT AS days_onsite
      FROM equipment_placements ep
      LEFT JOIN rooms r ON r.id = ep.room_id
     WHERE ep.job_id = p_job_id
       AND (p_include_removed OR ep.status = 'active')
     ORDER BY
       CASE WHEN ep.status = 'active' THEN 0 ELSE 1 END ASC,
       ep.placed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_job_equipment TO anon, authenticated;

-- ── place_equipment (idempotent on client_id) ─────────────────────────────────

CREATE OR REPLACE FUNCTION place_equipment(
  p_job_id          UUID,
  p_room_id         UUID,
  p_equipment_type  equipment_type,
  p_nickname        TEXT,
  p_serial          TEXT,
  p_placed_by       UUID,
  p_client_id       UUID,
  p_notes           TEXT
)
RETURNS equipment_placements
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result equipment_placements;
BEGIN
  INSERT INTO equipment_placements (
    job_id, room_id, equipment_type, nickname, serial_number,
    placed_by, client_id, notes
  )
  VALUES (
    p_job_id, p_room_id, p_equipment_type, p_nickname, p_serial,
    p_placed_by, p_client_id, p_notes
  )
  ON CONFLICT (client_id) DO UPDATE
    SET room_id        = EXCLUDED.room_id,
        equipment_type = EXCLUDED.equipment_type,
        nickname       = EXCLUDED.nickname,
        serial_number  = EXCLUDED.serial_number,
        notes          = EXCLUDED.notes
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION place_equipment TO anon, authenticated;

-- ── remove_equipment (no-op if already removed) ───────────────────────────────

CREATE OR REPLACE FUNCTION remove_equipment(
  p_equipment_id UUID,
  p_removed_by   UUID
)
RETURNS equipment_placements
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result equipment_placements;
BEGIN
  UPDATE equipment_placements
     SET status     = 'removed',
         removed_at = now(),
         removed_by = p_removed_by
   WHERE id = p_equipment_id
     AND status = 'active'
  RETURNING * INTO result;

  -- If the row was already removed, just return it as-is.
  IF result.id IS NULL THEN
    SELECT * INTO result FROM equipment_placements WHERE id = p_equipment_id;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_equipment TO anon, authenticated;

-- ── get_stalled_materials ─────────────────────────────────────────────────────
-- One row per (room, material) pair on the job that is currently flagged
-- stalled. Stall logic: latest reading's mc_pct is above drying_goal_pct AND
-- there exists a reading in the same pair taken >=36h before the latest where
-- (prior.mc_pct - latest.mc_pct) < 1.0 — i.e. less than a point of drop in
-- a day and a half.

CREATE OR REPLACE FUNCTION get_stalled_materials(p_job_id UUID)
RETURNS TABLE (
  room_id            UUID,
  room_name          TEXT,
  material           material_type,
  latest_mc          NUMERIC,
  latest_reading_at  TIMESTAMPTZ,
  mc_36h_ago         NUMERIC,
  drying_goal_pct    NUMERIC,
  days_stalled       INT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH latest_per_pair AS (
    SELECT DISTINCT ON (mr.room_id, mr.material)
           mr.id,
           mr.room_id,
           mr.material,
           mr.mc_pct           AS latest_mc,
           mr.drying_goal_pct  AS latest_goal,
           mr.taken_at         AS latest_taken_at
      FROM moisture_readings mr
     WHERE mr.job_id = p_job_id
     ORDER BY mr.room_id, mr.material, mr.taken_at DESC
  ),
  prior_per_pair AS (
    -- For each latest row, pick the most recent prior reading that is >=36h
    -- older — that's our "a day and a half ago" comparison point.
    SELECT lpp.id AS latest_id,
           (
             SELECT prior.mc_pct
               FROM moisture_readings prior
              WHERE prior.job_id    = p_job_id
                AND prior.room_id IS NOT DISTINCT FROM lpp.room_id
                AND prior.material  = lpp.material
                AND prior.id       <> lpp.id
                AND prior.taken_at <= lpp.latest_taken_at - interval '36 hours'
                AND prior.mc_pct   IS NOT NULL
              ORDER BY prior.taken_at DESC
              LIMIT 1
           ) AS prior_mc,
           (
             SELECT prior.taken_at
               FROM moisture_readings prior
              WHERE prior.job_id    = p_job_id
                AND prior.room_id IS NOT DISTINCT FROM lpp.room_id
                AND prior.material  = lpp.material
                AND prior.id       <> lpp.id
                AND prior.taken_at <= lpp.latest_taken_at - interval '36 hours'
                AND prior.mc_pct   IS NOT NULL
              ORDER BY prior.taken_at DESC
              LIMIT 1
           ) AS prior_taken_at
      FROM latest_per_pair lpp
  )
  SELECT
    lpp.room_id,
    r.name              AS room_name,
    lpp.material,
    lpp.latest_mc,
    lpp.latest_taken_at AS latest_reading_at,
    ppp.prior_mc        AS mc_36h_ago,
    lpp.latest_goal     AS drying_goal_pct,
    EXTRACT(DAY FROM (lpp.latest_taken_at - ppp.prior_taken_at))::INT AS days_stalled
    FROM latest_per_pair lpp
    LEFT JOIN rooms r         ON r.id = lpp.room_id
    LEFT JOIN prior_per_pair ppp ON ppp.latest_id = lpp.id
   WHERE lpp.latest_mc IS NOT NULL
     AND lpp.latest_goal IS NOT NULL
     AND lpp.latest_mc > lpp.latest_goal
     AND ppp.prior_mc IS NOT NULL
     AND (ppp.prior_mc - lpp.latest_mc) < 1.0
   ORDER BY lpp.latest_taken_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stalled_materials TO anon, authenticated;

-- ── Bust PostgREST schema cache so new tables + RPCs are visible ─────────────

SELECT bust_postgrest_cache();
