-- ════════════════════════════════════════════════
-- ROLLBACK: 20260817020000_hydro_legacy_access_hardening
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the two older moisture tables back the way they were: anyone logged
--   into the app can once again read and delete every moisture reading and every
--   equipment record in the company, and the two functions that write them stop
--   checking who is calling.
--
-- ⚠ THIS RE-OPENS A REAL HOLE. It is not a neutral undo.
--   Running this restores `USING (true)` access for every authenticated
--   identity, including outside CRM partners, disabled accounts and external
--   users, and re-grants `ALL` to `anon` at the table level. Only run it if the
--   hardening is actively breaking something, and close the hole forward
--   instead as soon as possible.
--
--   Because that is the situation, this file does NOT restore the `anon` GRANT
--   silently: `-- public:` below records why the line exists, and it is exactly
--   the line to delete if you are rolling back for an unrelated reason.
--
-- The function bodies below are the live pre-hardening definitions, restored
-- byte-for-byte from the production schema dump (db/baseline/schema.sql), not
-- retyped from memory.
-- ════════════════════════════════════════════════

BEGIN;

-- ── 1. Restore the always-true policies ───────────────────────────────────────

DROP POLICY IF EXISTS moisture_internal_read ON public.moisture_readings;
CREATE POLICY moisture_authenticated_all ON public.moisture_readings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS equip_internal_read ON public.equipment_placements;
CREATE POLICY equip_authenticated_all ON public.equipment_placements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Restore the prior grants ───────────────────────────────────────────────
-- public: restoring the exact pre-2026-08-17 grant state, which included a
-- table-level GRANT ALL to anon on both legacy hydro tables. It was inert (RLS
-- on, no anon policy) and it is inert again here, but this file exists to
-- reproduce the prior state faithfully rather than to improve on it. Delete
-- these two lines if you are rolling back for an unrelated reason — nothing
-- depends on them.
GRANT ALL ON TABLE public.moisture_readings    TO anon;
GRANT ALL ON TABLE public.equipment_placements TO anon;
GRANT ALL ON TABLE public.moisture_readings    TO authenticated;
GRANT ALL ON TABLE public.equipment_placements TO authenticated;

-- ── 3. Restore the ungated function bodies ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.insert_reading(
  p_job_id        uuid,
  p_room_id       uuid,
  p_material      public.material_type,
  p_location      text,
  p_mc            numeric,
  p_rh            numeric,
  p_temp_f        numeric,
  p_gpp           numeric,
  p_dew_point     numeric,
  p_is_affected   boolean,
  p_equipment_id  uuid,
  p_taken_by      uuid,
  p_notes         text,
  p_client_id     uuid,
  p_taken_at      timestamptz DEFAULT now()
)
RETURNS public.moisture_readings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
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

REVOKE EXECUTE ON FUNCTION public.insert_reading(
  uuid, uuid, public.material_type, text, numeric, numeric, numeric, numeric,
  numeric, boolean, uuid, uuid, text, uuid, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_reading(
  uuid, uuid, public.material_type, text, numeric, numeric, numeric, numeric,
  numeric, boolean, uuid, uuid, text, uuid, timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.place_equipment(
  p_job_id uuid, p_room_id uuid, p_equipment_type public.equipment_type,
  p_nickname text, p_serial text, p_placed_by uuid, p_client_id uuid, p_notes text
)
RETURNS public.equipment_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE result equipment_placements;
BEGIN
  INSERT INTO equipment_placements (
    job_id, room_id, equipment_type, nickname, serial_number,
    placed_by, client_id, notes
  )
  VALUES (p_job_id, p_room_id, p_equipment_type, p_nickname, p_serial,
          p_placed_by, p_client_id, p_notes)
  ON CONFLICT (client_id) DO UPDATE
    SET room_id=EXCLUDED.room_id, equipment_type=EXCLUDED.equipment_type,
        nickname=EXCLUDED.nickname, serial_number=EXCLUDED.serial_number,
        notes=EXCLUDED.notes
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_equipment(
  uuid, uuid, public.equipment_type, text, text, uuid, uuid, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_equipment(
  uuid, uuid, public.equipment_type, text, text, uuid, uuid, text
) TO authenticated, service_role;

-- ── Rollback postconditions ───────────────────────────────────────────────────
-- Prove the re-opening actually happened; a rollback that silently half-applies
-- is worse than one that fails.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'moisture_readings'
       AND policyname = 'moisture_authenticated_all'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK POSTCONDITION: moisture_authenticated_all was not restored'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('insert_reading', 'place_equipment')
       AND position('NOT_AUTHORIZED' IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'ROLLBACK POSTCONDITION: a caller gate survived the rollback'
      USING ERRCODE = '55000';
  END IF;

  -- hydro_access() belongs to 20260817010000 and must NOT be removed here.
  IF to_regproc('public.hydro_access') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POSTCONDITION: hydro_access() was removed — it is owned '
      'by 20260817010000, not by this rollback' USING ERRCODE = '55000';
  END IF;
END $$;

COMMIT;
