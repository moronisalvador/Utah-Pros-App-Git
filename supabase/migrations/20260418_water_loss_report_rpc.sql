-- Phase 3 Water Loss Report — aggregation RPC
--
-- Returns a single JSONB blob with everything the report PDF needs in one
-- round trip: job/claim header, summary metrics, per-room photos +
-- readings-by-material + equipment, job-wide equipment log, attestation
-- metadata. The worker (generate-water-loss-report.js) formats this into
-- a multi-page PDF.
--
-- Design notes:
--   - Rooms come from get_claim_rooms (filtered to rooms with any
--     reading, photo, or equipment activity for this job — so empty rooms
--     don't clutter the report).
--   - Readings sort newest-first per material so the "latest vs goal"
--     read is the first element.
--   - Photos are scoped to the job (photos carry job_id; their room_id
--     may be NULL if the tech didn't tag them).
--   - Summary metrics: affected_rooms, total_readings, peak_gpp,
--     current_avg_mc (for affected latest-per-pair readings),
--     days_drying (span between first and latest reading), equipment_days.

CREATE OR REPLACE FUNCTION get_water_loss_report_data(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_claim_id UUID;
  result     JSONB;
BEGIN
  SELECT claim_id INTO v_claim_id FROM jobs WHERE id = p_job_id;
  IF v_claim_id IS NULL THEN
    RAISE EXCEPTION 'get_water_loss_report_data: job % not found', p_job_id;
  END IF;

  WITH job_info AS (
    SELECT j.id, j.job_number, j.division, j.phase, j.address, j.city,
           j.insured_name, j.client_phone, j.client_email,
           j.adjuster, j.insurance_company, j.policy_number,
           j.date_of_loss, j.type_of_loss, c.claim_number,
           c.loss_address, c.loss_city, c.loss_state, c.loss_zip
      FROM jobs j
      LEFT JOIN claims c ON c.id = j.claim_id
     WHERE j.id = p_job_id
  ),
  job_readings AS (
    SELECT mr.*, r.name AS room_name
      FROM moisture_readings mr
      LEFT JOIN rooms r ON r.id = mr.room_id
     WHERE mr.job_id = p_job_id
  ),
  job_equipment AS (
    SELECT ep.*, r.name AS room_name,
           EXTRACT(DAY FROM (COALESCE(ep.removed_at, now()) - ep.placed_at))::INT AS days_onsite
      FROM equipment_placements ep
      LEFT JOIN rooms r ON r.id = ep.room_id
     WHERE ep.job_id = p_job_id
  ),
  job_photos AS (
    SELECT jd.id, jd.room_id, jd.file_path, jd.description, jd.created_at
      FROM job_documents jd
     WHERE jd.job_id = p_job_id AND jd.category = 'photo'
     ORDER BY jd.created_at ASC
  ),
  -- Rooms that matter: any reading, photo, or equipment activity on this job
  active_rooms AS (
    SELECT DISTINCT r.id, r.name, r.area_sqft, r.ceiling_height_ft, r.sort_order
      FROM rooms r
     WHERE r.claim_id = v_claim_id
       AND r.deleted_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM job_readings mr WHERE mr.room_id = r.id) OR
         EXISTS (SELECT 1 FROM job_photos   jp WHERE jp.room_id  = r.id) OR
         EXISTS (SELECT 1 FROM job_equipment ep WHERE ep.room_id = r.id)
       )
     ORDER BY r.sort_order ASC, r.name ASC
  ),
  latest_affected AS (
    -- Latest affected reading per (room, material) — used for current_avg_mc
    -- and as the "current" value in the room's readings_by_material section.
    SELECT DISTINCT ON (room_id, material)
           mr.room_id, mr.material, mr.mc_pct, mr.drying_goal_pct, mr.taken_at
      FROM job_readings mr
     WHERE mr.is_affected = true AND mr.mc_pct IS NOT NULL
     ORDER BY room_id, material, taken_at DESC
  ),
  summary AS (
    SELECT
      (SELECT COUNT(*)::INT FROM active_rooms)                            AS affected_rooms,
      (SELECT COUNT(*)::INT FROM job_readings)                            AS total_readings,
      (SELECT COALESCE(MAX(gpp),0)::NUMERIC FROM job_readings)            AS peak_gpp,
      (SELECT COALESCE(AVG(mc_pct),0)::NUMERIC FROM latest_affected)      AS current_avg_mc,
      (SELECT COALESCE(EXTRACT(DAY FROM (MAX(taken_at) - MIN(taken_at)))::INT, 0)
         FROM job_readings)                                               AS days_drying,
      (SELECT COALESCE(SUM(days_onsite),0)::INT FROM job_equipment)       AS equipment_days
  )
  SELECT jsonb_build_object(
    'job', (
      SELECT jsonb_build_object(
        'id',               ji.id,
        'job_number',       ji.job_number,
        'division',         ji.division,
        'phase',            ji.phase,
        'address',          COALESCE(ji.loss_address, ji.address),
        'city',             COALESCE(ji.loss_city, ji.city),
        'state',            ji.loss_state,
        'zip',              ji.loss_zip,
        'insured_name',     ji.insured_name,
        'client_phone',     ji.client_phone,
        'client_email',     ji.client_email,
        'adjuster',         ji.adjuster,
        'insurance_company', ji.insurance_company,
        'policy_number',    ji.policy_number,
        'claim_number',     ji.claim_number,
        'date_of_loss',     ji.date_of_loss,
        'type_of_loss',     ji.type_of_loss
      ) FROM job_info ji
    ),
    'summary',       (SELECT row_to_json(summary.*)::jsonb FROM summary),
    'rooms', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id',                 ar.id,
          'name',               ar.name,
          'area_sqft',          ar.area_sqft,
          'ceiling_height_ft',  ar.ceiling_height_ft,
          'photos', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id',          jp.id,
              'file_path',   jp.file_path,
              'description', jp.description,
              'created_at',  jp.created_at
            ) ORDER BY jp.created_at ASC), '[]'::jsonb)
              FROM job_photos jp WHERE jp.room_id = ar.id
          ),
          'readings_by_material', (
            SELECT COALESCE(jsonb_object_agg(m.material, m.readings), '{}'::jsonb) FROM (
              SELECT mr.material::text AS material,
                     jsonb_agg(jsonb_build_object(
                       'date',             mr.reading_date,
                       'mc',               mr.mc_pct,
                       'rh',               mr.rh_pct,
                       'temp',             mr.temp_f,
                       'gpp',              mr.gpp,
                       'dew_point',        mr.dew_point_f,
                       'is_affected',      mr.is_affected,
                       'dry_standard',     mr.dry_standard_pct,
                       'goal',             mr.drying_goal_pct,
                       'taken_at',         mr.taken_at,
                       'location',         mr.location_description
                     ) ORDER BY mr.taken_at ASC) AS readings
                FROM job_readings mr
               WHERE mr.room_id = ar.id
               GROUP BY mr.material
            ) m
          ),
          'equipment', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'type',       ep.equipment_type,
              'nickname',   ep.nickname,
              'placed_at',  ep.placed_at,
              'removed_at', ep.removed_at,
              'days',       ep.days_onsite
            ) ORDER BY ep.placed_at ASC), '[]'::jsonb)
              FROM job_equipment ep WHERE ep.room_id = ar.id
          )
        )
      ), '[]'::jsonb)
      FROM active_rooms ar
    ),
    'equipment_log', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'type',       ep.equipment_type,
        'nickname',   ep.nickname,
        'room_name',  ep.room_name,
        'placed_at',  ep.placed_at,
        'removed_at', ep.removed_at,
        'days',       ep.days_onsite,
        'status',     ep.status
      ) ORDER BY ep.placed_at DESC), '[]'::jsonb)
        FROM job_equipment ep
    ),
    'attestation', jsonb_build_object(
      'taken_by_names', (
        SELECT COALESCE(jsonb_agg(DISTINCT e.full_name), '[]'::jsonb)
          FROM job_readings mr
          JOIN employees e ON e.id = mr.taken_by
      ),
      'date_range', jsonb_build_object(
        'start', (SELECT MIN(taken_at) FROM job_readings),
        'end',   (SELECT MAX(taken_at) FROM job_readings)
      )
    ),
    'generated_at', now()
  )
  INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_water_loss_report_data TO anon, authenticated;

SELECT bust_postgrest_cache();
