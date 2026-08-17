-- ════════════════════════════════════════════════
-- ROLLBACK: 20260817010000_hydro_drying_spine
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes everything the drying-record migration added: the four new tables,
--   the four new functions and the five new types.
--
-- ⚠ THIS IS A CLEAN UNDO ONLY WHILE NO READING EXISTS.
--   The forward migration is purely additive, so while the tables are empty this
--   returns the database exactly to its prior state. The moment a technician
--   logs a real reading, running this is DATA LOSS — it destroys the drying
--   record for every job. `database-standard.md` §6 requires that be said out
--   loud rather than dressed up as an undo.
--
--   The guard below therefore ABORTS if any hydro table holds a row. To
--   deliberately discard real drying data, set the escape flag in the same
--   session — an explicit act, recorded in the session, that cannot happen by
--   pasting this file:
--
--       SET LOCAL upr.confirm_hydro_data_loss = 'yes';
--
--   After first field use, prefer forward repair over this file.
--
-- ORDER: functions, then tables child-to-parent, then types. `hydro_readings`
--   references points, chambers and equipment_placements; points reference
--   chambers. Dropping out of order fails on dependencies.
-- ════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_rows bigint := 0;
  v_confirm text := current_setting('upr.confirm_hydro_data_loss', true);
BEGIN
  -- to_regclass keeps this runnable even if a prior partial rollback already
  -- removed some tables.
  IF to_regclass('public.hydro_readings') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.hydro_readings' INTO v_rows;
  END IF;

  IF v_rows > 0 AND COALESCE(v_confirm, '') <> 'yes' THEN
    RAISE EXCEPTION
      'REFUSING ROLLBACK: % hydro reading(s) exist. This drops real drying records. '
      'Set upr.confirm_hydro_data_loss = ''yes'' in this session to proceed deliberately.',
      v_rows
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_hydro_log(uuid);

DROP FUNCTION IF EXISTS public.hydro_insert_reading(
  uuid, public.hydro_reading_kind, uuid, numeric, uuid, uuid, uuid, uuid,
  public.hydro_control_source, numeric, numeric, numeric, public.material_type,
  text, numeric, numeric, numeric, smallint, text, text, timestamptz
);

DROP FUNCTION IF EXISTS public.hydro_upsert_point(
  uuid, public.material_type, uuid, uuid, uuid, text, integer, numeric, numeric
);

DROP FUNCTION IF EXISTS public.hydro_upsert_chamber(
  uuid, text, uuid, public.hydro_water_category, public.hydro_water_class,
  integer, numeric, numeric, numeric, numeric, numeric, uuid[],
  public.hydro_chamber_status, text
);

-- destructive-approved: this IS the paired rollback for 20260817010000; dropping
-- what that migration created is its entire purpose, and the guard above refuses
-- to run once real drying data exists.
DROP TABLE IF EXISTS public.hydro_readings;
DROP TABLE IF EXISTS public.hydro_monitoring_points;
DROP TABLE IF EXISTS public.hydro_chamber_rooms;
DROP TABLE IF EXISTS public.hydro_drying_chambers;

-- hydro_access() is dropped last: the policies that referenced it are gone with
-- their tables.
DROP FUNCTION IF EXISTS public.hydro_access();

DROP TYPE IF EXISTS public.hydro_chamber_status;
DROP TYPE IF EXISTS public.hydro_water_class;
DROP TYPE IF EXISTS public.hydro_water_category;
DROP TYPE IF EXISTS public.hydro_control_source;
DROP TYPE IF EXISTS public.hydro_reading_kind;

-- Confirm the legacy path this migration promised not to touch is still intact.
DO $$
BEGIN
  IF to_regclass('public.moisture_readings') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK POSTCONDITION: moisture_readings is missing — this '
      'rollback must never have touched it' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_job_readings') THEN
    RAISE EXCEPTION 'ROLLBACK POSTCONDITION: get_job_readings is missing'
      USING ERRCODE = '55000';
  END IF;
END $$;

COMMIT;
