-- ════════════════════════════════════════════════
-- MIGRATION: 20260817010000_hydro_drying_spine
-- Phase: Hydro F1 (the spine)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Builds the structure UPR needs to document drying a water-damaged building
--   the way an insurance adjuster expects. Today the app stores one flat list of
--   moisture numbers. A real drying record needs four different KINDS of number
--   (air in the wet rooms, air somewhere unaffected to compare against, moisture
--   inside materials like drywall, and the air coming out of a dehumidifier),
--   and it needs a "drying chamber" that says up front what dry means for this
--   job, so every later number can be judged against it. This adds all of that.
--   Nothing here changes any screen; no existing table or function is touched.
--
-- ADDITIVE-ONLY:
--   Creates new types, four new `hydro_*` tables, one access helper and four new
--   functions. No DROP, no RENAME, no ALTER COLUMN, no data change, and no edit
--   to `moisture_readings`, `equipment_placements`, `insert_reading`,
--   `place_equipment` or `get_job_readings`. The legacy path keeps working
--   byte-for-byte; hardening it is the separate `20260817020000` migration.
--
-- WHY A NEW TABLE RATHER THAN EXTENDING moisture_readings:
--   `moisture_readings` holds ZERO rows in production (verified 2026-08-16 and
--   again 2026-08-17), so nothing is being migrated or abandoned. Extending it
--   would mean making its `material` column nullable (no atmosphere reading has
--   a material), living with a name that describes one of four kinds, and
--   keeping `reading_date DATE DEFAULT CURRENT_DATE` — a column `insert_reading`
--   never sets, which buckets in the database session's timezone and so violates
--   `database-standard.md` §7. A new table costs one migration and avoids all
--   three.
--
-- UNITS — deliberate divergence from Encircle:
--   Encircle's API stores Kelvin. UPR stores °F and inHg because that is what
--   technicians read off their meters, and every conversion is a chance to be
--   wrong. Import from Encircle converts at the boundary.
--
-- THE ELEVATION FIX (this is the point of `atmospheric_pressure_inhg`):
--   GPP depends on barometric pressure. `src/lib/psychrometric.js` hard-codes
--   29.92 inHg — sea level — while UPR works at ~4,300 ft, where it is 25.63.
--   Measured: every GPP the app computes is 14.6% LOW on the Wasatch Front and
--   22% low in Park City. GPP differential IS the drying log, so this is a
--   correctness defect in the headline number. Two things fix it here:
--     1. the chamber carries `site_elevation_ft`, so pressure is derived from
--        the real site rather than assumed; and
--     2. every reading stores the `atmospheric_pressure_inhg` actually used
--        plus `psychrometric_version`. A reading must re-derive to the same
--        number in five years when an adjuster disputes it, even if the formula
--        or the site elevation is corrected afterwards. Encircle does the same
--        thing — its API returns a stored `specific_humidity` beside its inputs.
--
-- AUTHORIZATION POSTURE:
--   Tables are RLS-enabled with NO browser write grant at all. `authenticated`
--   receives SELECT only; every insert and update goes through a SECURITY
--   DEFINER RPC that validates the caller with `public.hydro_access()`. This is
--   the posture the CRM lead boundary (`20260808230000`) established, and it is
--   deliberately stricter than the legacy hydro tables, whose `USING (true)`
--   policies let any authenticated identity delete company data.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260817010000_hydro_drying_spine.rollback.sql
--   Drops the four functions, the four tables and the five types, in dependency
--   order. That undo is CLEAN ONLY WHILE NO READING EXISTS. The moment a
--   technician logs a real reading, running the rollback is DATA LOSS, not an
--   undo — per database-standard.md §6 that is stated here rather than papered
--   over. After first field use, prefer forward repair.
-- ════════════════════════════════════════════════

-- ── Types ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.hydro_reading_kind AS ENUM (
    'affected_air',   -- air inside the drying chamber
    'control_air',    -- the reference the chamber is compared against
    'material',       -- moisture content of a building material
    'dehumidifier'    -- air leaving a dehumidifier, i.e. is it actually working
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Encircle models this as `interior | interior_hvac | exterior`. A boolean
-- cannot express it, and the three are NOT interchangeable as a drying
-- reference: exterior air explains what the weather is doing to the building,
-- unaffected interior air is the true dry standard, and HVAC supply explains
-- what the building's own system is contributing.
DO $$ BEGIN
  CREATE TYPE public.hydro_control_source AS ENUM (
    'exterior', 'interior_unaffected', 'interior_hvac'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- IICRC S500 classification. Named to match Encircle's enum values exactly so
-- an import needs no translation table.
DO $$ BEGIN
  CREATE TYPE public.hydro_water_category AS ENUM (
    'category1', 'category2', 'category3', 'special_situation'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hydro_water_class AS ENUM (
    'class1', 'class2', 'class3', 'class4'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hydro_chamber_status AS ENUM (
    'in_drying', 'in_stabilization', 'dry'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Access helper ─────────────────────────────────────────────────────────────
-- One predicate for every hydro object. Modelled on `public.crm_lead_access()`.
--
-- Scope is deliberately "any active internal employee except crm_partner"
-- rather than "the crew assigned to this job". A drying log is an operational
-- record a project manager, an estimator writing the supplement, and a covering
-- technician all legitimately read; and narrowing access by crew is exactly the
-- change that locked every field technician out of every conversation for four
-- days on 2026-08-01. This is still a large tightening versus the legacy
-- `USING (true)` policies, which admit crm_partner, external and inactive
-- identities.
CREATE OR REPLACE FUNCTION public.hydro_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.employees e
     WHERE e.auth_user_id = (SELECT auth.uid())
       AND e.is_active IS TRUE
       AND e.is_external IS FALSE
       AND e.role::text <> 'crm_partner'
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.hydro_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hydro_access() TO authenticated, service_role;

-- ── hydro_drying_chambers ─────────────────────────────────────────────────────
-- The drying plan, and the spine of the whole model. This is the object UPR had
-- no equivalent for: it declares the S500 category and class and the target
-- envelope BEFORE readings are taken, which is what makes the resulting log
-- defensible rather than just a pile of numbers.

CREATE TABLE IF NOT EXISTS public.hydro_drying_chambers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                   uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  status                   public.hydro_chamber_status NOT NULL DEFAULT 'in_drying',
  water_category           public.hydro_water_category NULL,
  water_class              public.hydro_water_class NULL,

  -- Target envelope. Nullable because a technician establishes the chamber on
  -- arrival and may set targets a few minutes later; an alert simply cannot
  -- fire until the relevant bound exists.
  target_temp_min_f                numeric NULL,
  target_temp_max_f                numeric NULL,
  target_rh_min_pct                numeric NULL,
  target_rh_max_pct                numeric NULL,
  target_dew_point_differential_f  numeric NULL,

  -- See THE ELEVATION FIX above. NOT NULL with a Wasatch Front default: within
  -- ~250 ft of Salt Lake City, Provo, Orem and Sandy, which is under 1% GPP
  -- error there, against ~15% for the sea-level constant the app uses today. A
  -- job in Park City or St. George corrects it and the correction is recorded
  -- per reading, so past readings never silently change meaning.
  site_elevation_ft        integer NOT NULL DEFAULT 4500,

  drying_started_at        timestamptz NULL,
  drying_ended_at          timestamptz NULL,
  notes                    text NULL,

  created_by               uuid NULL REFERENCES public.employees(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  edited_by                uuid NULL REFERENCES public.employees(id),
  edited_at                timestamptz NULL,
  client_id                uuid NULL UNIQUE,   -- offline idempotency

  CONSTRAINT hydro_chamber_elevation_sane
    CHECK (site_elevation_ft BETWEEN -300 AND 15000),
  CONSTRAINT hydro_chamber_temp_range
    CHECK (target_temp_min_f IS NULL OR target_temp_max_f IS NULL
           OR target_temp_min_f <= target_temp_max_f),
  CONSTRAINT hydro_chamber_rh_range
    CHECK (target_rh_min_pct IS NULL OR target_rh_max_pct IS NULL
           OR target_rh_min_pct <= target_rh_max_pct),
  CONSTRAINT hydro_chamber_ended_after_started
    CHECK (drying_ended_at IS NULL OR drying_started_at IS NULL
           OR drying_ended_at >= drying_started_at)
);

CREATE INDEX IF NOT EXISTS hydro_chamber_job_idx
  ON public.hydro_drying_chambers(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hydro_chamber_created_by_idx
  ON public.hydro_drying_chambers(created_by);
CREATE INDEX IF NOT EXISTS hydro_chamber_edited_by_idx
  ON public.hydro_drying_chambers(edited_by);

-- ── hydro_chamber_rooms ───────────────────────────────────────────────────────
-- Which rooms make up the chamber. Also the affected-air route: the rooms in
-- here are the rooms a technician takes chamber air readings in each visit.

CREATE TABLE IF NOT EXISTS public.hydro_chamber_rooms (
  chamber_id uuid NOT NULL REFERENCES public.hydro_drying_chambers(id) ON DELETE CASCADE,
  room_id    uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chamber_id, room_id)
);

CREATE INDEX IF NOT EXISTS hydro_chamber_rooms_room_idx
  ON public.hydro_chamber_rooms(room_id);

-- ── hydro_monitoring_points ───────────────────────────────────────────────────
-- A durable, numbered place a material is measured — "point 3, subfloor under
-- the window". Encircle carries the same idea as `moisture_point_id` /
-- `moisture_point_number` on every material reading.
--
-- This is what turns the second visit from "create twelve readings" into "walk
-- the route and confirm twelve numbers", and it is what lets a chart show one
-- location drying over time instead of a scatter of unrelated observations.

CREATE TABLE IF NOT EXISTS public.hydro_monitoring_points (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  chamber_id       uuid NULL REFERENCES public.hydro_drying_chambers(id) ON DELETE SET NULL,
  room_id          uuid NULL REFERENCES public.rooms(id) ON DELETE SET NULL,
  point_number     integer NOT NULL,
  material         public.material_type NOT NULL,
  label            text NULL,

  -- The dry standard lives on the POINT, not on each reading: it is a property
  -- of that material in that building, established once. Readings still carry a
  -- copy (see hydro_readings) so a historical reading records the standard it
  -- was actually judged against.
  dry_standard_pct numeric NULL,
  drying_goal_pct  numeric NULL,

  retired_at       timestamptz NULL,
  created_by       uuid NULL REFERENCES public.employees(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  client_id        uuid NULL UNIQUE,

  CONSTRAINT hydro_point_number_positive CHECK (point_number > 0)
);

-- Point numbers are what the technician says out loud ("point 4 is still wet"),
-- so they must be unique and stable within a job.
CREATE UNIQUE INDEX IF NOT EXISTS hydro_point_job_number_uq
  ON public.hydro_monitoring_points(job_id, point_number);
CREATE INDEX IF NOT EXISTS hydro_point_chamber_idx
  ON public.hydro_monitoring_points(chamber_id);
CREATE INDEX IF NOT EXISTS hydro_point_room_idx
  ON public.hydro_monitoring_points(room_id);
CREATE INDEX IF NOT EXISTS hydro_point_created_by_idx
  ON public.hydro_monitoring_points(created_by);

-- ── hydro_readings ────────────────────────────────────────────────────────────
-- All four reading kinds in one table, discriminated by `kind`.
--
-- One table rather than Encircle's four endpoints because three of the four are
-- the same shape (temperature + humidity -> derived psychrometrics) and because
-- "every reading on this job today" — by far the most common query — would
-- otherwise be a four-way UNION. It also keeps ONE `client_id` idempotency
-- space, which the existing offline outbox in src/lib/dispatchers already
-- depends on. The per-kind CHECK below is what keeps a single table honest.

CREATE TABLE IF NOT EXISTS public.hydro_readings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  chamber_id     uuid NULL REFERENCES public.hydro_drying_chambers(id) ON DELETE SET NULL,
  room_id        uuid NULL REFERENCES public.rooms(id) ON DELETE SET NULL,
  point_id       uuid NULL REFERENCES public.hydro_monitoring_points(id) ON DELETE SET NULL,
  equipment_id   uuid NULL REFERENCES public.equipment_placements(id) ON DELETE SET NULL,

  kind           public.hydro_reading_kind NOT NULL,
  control_source public.hydro_control_source NULL,

  temp_f         numeric NULL,
  rh_pct         numeric NULL,
  mc_pct         numeric NULL,
  material       public.material_type NULL,
  meter_label    text NULL,        -- which meter; adjusters ask

  -- Derived values, STORED. See THE ELEVATION FIX in the header.
  gpp                        numeric NULL,
  dew_point_f                numeric NULL,
  vapor_pressure_inhg        numeric NULL,
  atmospheric_pressure_inhg  numeric NOT NULL,
  psychrometric_version      smallint NOT NULL DEFAULT 2,

  -- Snapshot of the standard this reading was judged against at the time.
  dry_standard_pct numeric NULL,
  drying_goal_pct  numeric NULL,

  meter_photo_path text NULL,      -- the time-stamped meter photo

  taken_at   timestamptz NOT NULL DEFAULT now(),
  taken_by   uuid NULL REFERENCES public.employees(id),
  notes      text NULL,
  edited_at  timestamptz NULL,
  edited_by  uuid NULL REFERENCES public.employees(id),
  client_id  uuid NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Sea level is 29.92 and Park City is 23.09; anything outside this band is a
  -- bug in the caller, not a mountain.
  CONSTRAINT hydro_reading_pressure_sane
    CHECK (atmospheric_pressure_inhg BETWEEN 15 AND 32),
  CONSTRAINT hydro_reading_rh_sane
    CHECK (rh_pct IS NULL OR (rh_pct >= 0 AND rh_pct <= 100)),
  CONSTRAINT hydro_reading_mc_sane
    CHECK (mc_pct IS NULL OR mc_pct >= 0),

  -- The discriminator's contract. Without this a single table degrades into a
  -- bag of nullable columns nobody can trust.
  CONSTRAINT hydro_reading_shape CHECK (
    CASE kind
      WHEN 'material' THEN
        point_id IS NOT NULL AND material IS NOT NULL AND mc_pct IS NOT NULL
        AND control_source IS NULL AND equipment_id IS NULL
      WHEN 'affected_air' THEN
        room_id IS NOT NULL AND temp_f IS NOT NULL AND rh_pct IS NOT NULL
        AND control_source IS NULL AND mc_pct IS NULL AND equipment_id IS NULL
      WHEN 'control_air' THEN
        control_source IS NOT NULL AND temp_f IS NOT NULL AND rh_pct IS NOT NULL
        AND mc_pct IS NULL AND equipment_id IS NULL
      WHEN 'dehumidifier' THEN
        equipment_id IS NOT NULL AND temp_f IS NOT NULL AND rh_pct IS NOT NULL
        AND control_source IS NULL AND mc_pct IS NULL
    END
  )
);

CREATE INDEX IF NOT EXISTS hydro_readings_job_taken_idx
  ON public.hydro_readings(job_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS hydro_readings_job_kind_taken_idx
  ON public.hydro_readings(job_id, kind, taken_at DESC);
CREATE INDEX IF NOT EXISTS hydro_readings_point_taken_idx
  ON public.hydro_readings(point_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS hydro_readings_chamber_idx
  ON public.hydro_readings(chamber_id);
CREATE INDEX IF NOT EXISTS hydro_readings_room_idx
  ON public.hydro_readings(room_id);
CREATE INDEX IF NOT EXISTS hydro_readings_equipment_idx
  ON public.hydro_readings(equipment_id);
CREATE INDEX IF NOT EXISTS hydro_readings_taken_by_idx
  ON public.hydro_readings(taken_by);
CREATE INDEX IF NOT EXISTS hydro_readings_edited_by_idx
  ON public.hydro_readings(edited_by);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Read through PostgREST, write only through the definer RPCs below. There is
-- deliberately NO INSERT/UPDATE/DELETE grant to `authenticated` on any of these
-- tables, so a browser cannot bypass the RPCs the way it can bypass
-- `insert_reading` today.

ALTER TABLE public.hydro_drying_chambers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydro_chamber_rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydro_monitoring_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydro_readings         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hydro_chambers_read ON public.hydro_drying_chambers;
CREATE POLICY hydro_chambers_read ON public.hydro_drying_chambers
  FOR SELECT TO authenticated USING (public.hydro_access());

DROP POLICY IF EXISTS hydro_chamber_rooms_read ON public.hydro_chamber_rooms;
CREATE POLICY hydro_chamber_rooms_read ON public.hydro_chamber_rooms
  FOR SELECT TO authenticated USING (public.hydro_access());

DROP POLICY IF EXISTS hydro_points_read ON public.hydro_monitoring_points;
CREATE POLICY hydro_points_read ON public.hydro_monitoring_points
  FOR SELECT TO authenticated USING (public.hydro_access());

DROP POLICY IF EXISTS hydro_readings_read ON public.hydro_readings;
CREATE POLICY hydro_readings_read ON public.hydro_readings
  FOR SELECT TO authenticated USING (public.hydro_access());

REVOKE ALL ON TABLE public.hydro_drying_chambers   FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.hydro_chamber_rooms     FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.hydro_monitoring_points FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.hydro_readings          FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.hydro_drying_chambers   TO authenticated;
GRANT SELECT ON TABLE public.hydro_chamber_rooms     TO authenticated;
GRANT SELECT ON TABLE public.hydro_monitoring_points TO authenticated;
GRANT SELECT ON TABLE public.hydro_readings          TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hydro_drying_chambers   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hydro_chamber_rooms     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hydro_monitoring_points TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hydro_readings          TO service_role;

-- ── hydro_upsert_chamber ──────────────────────────────────────────────────────
-- Idempotent on client_id so the offline outbox can retry safely.

CREATE OR REPLACE FUNCTION public.hydro_upsert_chamber(
  p_job_id           uuid,
  p_name             text,
  p_client_id        uuid,
  p_water_category   public.hydro_water_category DEFAULT NULL,
  p_water_class      public.hydro_water_class DEFAULT NULL,
  p_site_elevation_ft integer DEFAULT NULL,
  p_target_temp_min_f numeric DEFAULT NULL,
  p_target_temp_max_f numeric DEFAULT NULL,
  p_target_rh_min_pct numeric DEFAULT NULL,
  p_target_rh_max_pct numeric DEFAULT NULL,
  p_target_dew_point_differential_f numeric DEFAULT NULL,
  p_room_ids         uuid[] DEFAULT NULL,
  p_status           public.hydro_chamber_status DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS public.hydro_drying_chambers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_employee_id uuid;
  v_result      public.hydro_drying_chambers;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.hydro_access() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT e.id INTO v_employee_id
    FROM public.employees e
   WHERE e.auth_user_id = (SELECT auth.uid())
   LIMIT 1;

  INSERT INTO public.hydro_drying_chambers AS c (
    job_id, name, client_id, water_category, water_class,
    site_elevation_ft, target_temp_min_f, target_temp_max_f,
    target_rh_min_pct, target_rh_max_pct, target_dew_point_differential_f,
    status, notes, created_by, drying_started_at
  ) VALUES (
    p_job_id, p_name, p_client_id, p_water_category, p_water_class,
    COALESCE(p_site_elevation_ft, 4500),
    p_target_temp_min_f, p_target_temp_max_f,
    p_target_rh_min_pct, p_target_rh_max_pct, p_target_dew_point_differential_f,
    COALESCE(p_status, 'in_drying'), p_notes, v_employee_id, now()
  )
  ON CONFLICT (client_id) DO UPDATE
    SET name            = EXCLUDED.name,
        water_category  = COALESCE(EXCLUDED.water_category, c.water_category),
        water_class     = COALESCE(EXCLUDED.water_class, c.water_class),
        site_elevation_ft = EXCLUDED.site_elevation_ft,
        target_temp_min_f = COALESCE(EXCLUDED.target_temp_min_f, c.target_temp_min_f),
        target_temp_max_f = COALESCE(EXCLUDED.target_temp_max_f, c.target_temp_max_f),
        target_rh_min_pct = COALESCE(EXCLUDED.target_rh_min_pct, c.target_rh_min_pct),
        target_rh_max_pct = COALESCE(EXCLUDED.target_rh_max_pct, c.target_rh_max_pct),
        target_dew_point_differential_f =
          COALESCE(EXCLUDED.target_dew_point_differential_f, c.target_dew_point_differential_f),
        status          = COALESCE(EXCLUDED.status, c.status),
        notes           = COALESCE(EXCLUDED.notes, c.notes),
        edited_by       = v_employee_id,
        edited_at       = now()
  RETURNING * INTO v_result;

  -- Room membership is declarative: the supplied array becomes the chamber's
  -- rooms. NULL means "leave membership alone", which is what a targets-only
  -- edit sends.
  IF p_room_ids IS NOT NULL THEN
    DELETE FROM public.hydro_chamber_rooms r
     WHERE r.chamber_id = v_result.id
       AND NOT (r.room_id = ANY (p_room_ids));

    INSERT INTO public.hydro_chamber_rooms (chamber_id, room_id)
    SELECT v_result.id, rid FROM unnest(p_room_ids) AS rid
    ON CONFLICT (chamber_id, room_id) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.hydro_upsert_chamber(
  uuid, text, uuid, public.hydro_water_category, public.hydro_water_class,
  integer, numeric, numeric, numeric, numeric, numeric, uuid[],
  public.hydro_chamber_status, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hydro_upsert_chamber(
  uuid, text, uuid, public.hydro_water_category, public.hydro_water_class,
  integer, numeric, numeric, numeric, numeric, numeric, uuid[],
  public.hydro_chamber_status, text
) TO authenticated, service_role;

-- ── hydro_upsert_point ────────────────────────────────────────────────────────
-- Allocates the next point number for the job when the caller does not supply
-- one. The allocation takes a row lock on the job so two technicians creating
-- points at the same moment cannot both claim number 5.

CREATE OR REPLACE FUNCTION public.hydro_upsert_point(
  p_job_id           uuid,
  p_material         public.material_type,
  p_client_id        uuid,
  p_chamber_id       uuid DEFAULT NULL,
  p_room_id          uuid DEFAULT NULL,
  p_label            text DEFAULT NULL,
  p_point_number     integer DEFAULT NULL,
  p_dry_standard_pct numeric DEFAULT NULL,
  p_drying_goal_pct  numeric DEFAULT NULL
)
RETURNS public.hydro_monitoring_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_employee_id uuid;
  v_number      integer;
  v_result      public.hydro_monitoring_points;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.hydro_access() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT e.id INTO v_employee_id
    FROM public.employees e
   WHERE e.auth_user_id = (SELECT auth.uid())
   LIMIT 1;

  -- Serialize number allocation per job.
  PERFORM 1 FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;

  v_number := p_point_number;
  IF v_number IS NULL THEN
    SELECT COALESCE(MAX(mp.point_number), 0) + 1
      INTO v_number
      FROM public.hydro_monitoring_points mp
     WHERE mp.job_id = p_job_id;
  END IF;

  INSERT INTO public.hydro_monitoring_points AS mp (
    job_id, chamber_id, room_id, point_number, material, label,
    dry_standard_pct, drying_goal_pct, created_by, client_id
  ) VALUES (
    p_job_id, p_chamber_id, p_room_id, v_number, p_material, p_label,
    p_dry_standard_pct, p_drying_goal_pct, v_employee_id, p_client_id
  )
  ON CONFLICT (client_id) DO UPDATE
    SET chamber_id       = COALESCE(EXCLUDED.chamber_id, mp.chamber_id),
        room_id          = COALESCE(EXCLUDED.room_id, mp.room_id),
        material         = EXCLUDED.material,
        label            = COALESCE(EXCLUDED.label, mp.label),
        dry_standard_pct = COALESCE(EXCLUDED.dry_standard_pct, mp.dry_standard_pct),
        drying_goal_pct  = COALESCE(EXCLUDED.drying_goal_pct, mp.drying_goal_pct)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.hydro_upsert_point(
  uuid, public.material_type, uuid, uuid, uuid, text, integer, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hydro_upsert_point(
  uuid, public.material_type, uuid, uuid, uuid, text, integer, numeric, numeric
) TO authenticated, service_role;

-- ── hydro_insert_reading ──────────────────────────────────────────────────────
-- The write path for all four kinds. Idempotent on client_id.
--
-- Psychrometrics are computed CLIENT-side (src/lib/psychrometric.js) and stored
-- here rather than recomputed in SQL. That is a deliberate trade: one
-- implementation of the formula instead of two that can silently disagree, at
-- the cost of trusting the caller's arithmetic. What makes it auditable is that
-- the inputs travel with the result — `atmospheric_pressure_inhg` and
-- `psychrometric_version` are stored on every row, so any reading can be
-- re-derived and checked later.

CREATE OR REPLACE FUNCTION public.hydro_insert_reading(
  p_job_id        uuid,
  p_kind          public.hydro_reading_kind,
  p_client_id     uuid,
  p_atmospheric_pressure_inhg numeric,
  p_chamber_id    uuid DEFAULT NULL,
  p_room_id       uuid DEFAULT NULL,
  p_point_id      uuid DEFAULT NULL,
  p_equipment_id  uuid DEFAULT NULL,
  p_control_source public.hydro_control_source DEFAULT NULL,
  p_temp_f        numeric DEFAULT NULL,
  p_rh_pct        numeric DEFAULT NULL,
  p_mc_pct        numeric DEFAULT NULL,
  p_material      public.material_type DEFAULT NULL,
  p_meter_label   text DEFAULT NULL,
  p_gpp           numeric DEFAULT NULL,
  p_dew_point_f   numeric DEFAULT NULL,
  p_vapor_pressure_inhg numeric DEFAULT NULL,
  p_psychrometric_version smallint DEFAULT 2,
  p_meter_photo_path text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_taken_at      timestamptz DEFAULT now()
)
RETURNS public.hydro_readings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_employee_id uuid;
  v_std         numeric;
  v_goal        numeric;
  v_material    public.material_type;
  v_result      public.hydro_readings;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.hydro_access() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT e.id INTO v_employee_id
    FROM public.employees e
   WHERE e.auth_user_id = (SELECT auth.uid())
   LIMIT 1;

  -- A material reading inherits its standard and its material from the point it
  -- belongs to, so the two can never drift apart. The caller may still override
  -- the material explicitly; everything else comes from the point.
  v_material := p_material;
  IF p_kind = 'material' AND p_point_id IS NOT NULL THEN
    SELECT mp.dry_standard_pct, mp.drying_goal_pct, mp.material
      INTO v_std, v_goal, v_material
      FROM public.hydro_monitoring_points mp
     WHERE mp.id = p_point_id;
    v_material := COALESCE(p_material, v_material);
  END IF;

  INSERT INTO public.hydro_readings AS hr (
    job_id, chamber_id, room_id, point_id, equipment_id,
    kind, control_source, temp_f, rh_pct, mc_pct, material, meter_label,
    gpp, dew_point_f, vapor_pressure_inhg,
    atmospheric_pressure_inhg, psychrometric_version,
    dry_standard_pct, drying_goal_pct, meter_photo_path,
    taken_at, taken_by, notes, client_id
  ) VALUES (
    p_job_id, p_chamber_id, p_room_id, p_point_id, p_equipment_id,
    p_kind, p_control_source, p_temp_f, p_rh_pct, p_mc_pct, v_material, p_meter_label,
    p_gpp, p_dew_point_f, p_vapor_pressure_inhg,
    p_atmospheric_pressure_inhg, COALESCE(p_psychrometric_version, 2),
    v_std, v_goal, p_meter_photo_path,
    COALESCE(p_taken_at, now()), v_employee_id, p_notes, p_client_id
  )
  ON CONFLICT (client_id) DO UPDATE
    SET chamber_id     = EXCLUDED.chamber_id,
        room_id        = EXCLUDED.room_id,
        point_id       = EXCLUDED.point_id,
        equipment_id   = EXCLUDED.equipment_id,
        control_source = EXCLUDED.control_source,
        temp_f         = EXCLUDED.temp_f,
        rh_pct         = EXCLUDED.rh_pct,
        mc_pct         = EXCLUDED.mc_pct,
        material       = EXCLUDED.material,
        meter_label    = EXCLUDED.meter_label,
        gpp            = EXCLUDED.gpp,
        dew_point_f    = EXCLUDED.dew_point_f,
        vapor_pressure_inhg = EXCLUDED.vapor_pressure_inhg,
        atmospheric_pressure_inhg = EXCLUDED.atmospheric_pressure_inhg,
        psychrometric_version = EXCLUDED.psychrometric_version,
        meter_photo_path = COALESCE(EXCLUDED.meter_photo_path, hr.meter_photo_path),
        notes          = EXCLUDED.notes,
        edited_by      = v_employee_id,
        edited_at      = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.hydro_insert_reading(
  uuid, public.hydro_reading_kind, uuid, numeric, uuid, uuid, uuid, uuid,
  public.hydro_control_source, numeric, numeric, numeric, public.material_type,
  text, numeric, numeric, numeric, smallint, text, text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hydro_insert_reading(
  uuid, public.hydro_reading_kind, uuid, numeric, uuid, uuid, uuid, uuid,
  public.hydro_control_source, numeric, numeric, numeric, public.material_type,
  text, numeric, numeric, numeric, smallint, text, text, timestamptz
) TO authenticated, service_role;

-- ── get_hydro_log ─────────────────────────────────────────────────────────────
-- The read side for the new model.
--
-- `get_job_readings` is deliberately NOT touched by this migration. It still
-- reads the legacy table and still returns its exact shape, so the shipped
-- Dry Logs summary card and HubTools keep working unchanged. Re-pointing it
-- belongs to Phase C, alongside the UI that actually writes the new model.

CREATE OR REPLACE FUNCTION public.get_hydro_log(p_job_id uuid)
RETURNS TABLE (
  id uuid, job_id uuid, chamber_id uuid, chamber_name text,
  chamber_status public.hydro_chamber_status,
  room_id uuid, room_name text,
  point_id uuid, point_number integer, point_label text,
  equipment_id uuid,
  kind public.hydro_reading_kind, control_source public.hydro_control_source,
  temp_f numeric, rh_pct numeric, mc_pct numeric, material public.material_type,
  gpp numeric, dew_point_f numeric, vapor_pressure_inhg numeric,
  atmospheric_pressure_inhg numeric, psychrometric_version smallint,
  dry_standard_pct numeric, drying_goal_pct numeric,
  meter_label text, meter_photo_path text,
  taken_at timestamptz, taken_by uuid, notes text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.hydro_access() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT hr.id, hr.job_id, hr.chamber_id, c.name, c.status,
         hr.room_id, r.name,
         hr.point_id, mp.point_number, mp.label,
         hr.equipment_id,
         hr.kind, hr.control_source,
         hr.temp_f, hr.rh_pct, hr.mc_pct, hr.material,
         hr.gpp, hr.dew_point_f, hr.vapor_pressure_inhg,
         hr.atmospheric_pressure_inhg, hr.psychrometric_version,
         hr.dry_standard_pct, hr.drying_goal_pct,
         hr.meter_label, hr.meter_photo_path,
         hr.taken_at, hr.taken_by, hr.notes, hr.created_at
    FROM public.hydro_readings hr
    LEFT JOIN public.hydro_drying_chambers c ON c.id = hr.chamber_id
    LEFT JOIN public.rooms r ON r.id = hr.room_id
    LEFT JOIN public.hydro_monitoring_points mp ON mp.id = hr.point_id
   WHERE hr.job_id = p_job_id
   ORDER BY hr.taken_at DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_hydro_log(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hydro_log(uuid) TO authenticated, service_role;

-- ── Postconditions ────────────────────────────────────────────────────────────
-- Fail the apply loudly rather than leaving a half-built spine behind.

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'hydro_drying_chambers','hydro_chamber_rooms',
      'hydro_monitoring_points','hydro_readings'
    ]) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_tables p WHERE p.schemaname = 'public' AND p.tablename = t
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'POSTCONDITION: missing table(s): %', v_missing USING ERRCODE = '55000';
  END IF;

  -- Every hydro table must have RLS on and no anon reachability.
  IF EXISTS (
    SELECT 1 FROM pg_tables p
     WHERE p.schemaname = 'public'
       AND p.tablename LIKE 'hydro\_%'
       AND p.rowsecurity IS FALSE
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: a hydro table has RLS disabled' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public'
       AND g.table_name LIKE 'hydro\_%'
       AND g.grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: anon holds a grant on a hydro table' USING ERRCODE = '55000';
  END IF;

  -- No browser write path: authenticated must hold SELECT and nothing else.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public'
       AND g.table_name LIKE 'hydro\_%'
       AND g.grantee = 'authenticated'
       AND g.privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: authenticated holds a write grant on a hydro table'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege('anon', 'public.hydro_access()', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDITION: anon can execute hydro_access()' USING ERRCODE = '55000';
  END IF;

  -- The legacy path must be untouched by this migration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_job_readings'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: get_job_readings disappeared' USING ERRCODE = '55000';
  END IF;
END $$;
