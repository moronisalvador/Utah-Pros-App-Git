-- ════════════════════════════════════════════════
-- MIGRATION: 20260817020000_hydro_legacy_access_hardening
-- Phase: Hydro F2 (close the legacy holes)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Locks down the two older moisture tables. Right now anyone who can log into
--   the app at all — including an outside CRM partner, a disabled account, or an
--   estimator — can read AND DELETE every moisture reading and every piece of
--   equipment the company has ever recorded, straight from the browser. It also
--   makes the two functions that write those tables check who is calling before
--   they write. Nothing a technician or office user legitimately does today
--   changes.
--
-- WHY THIS IS SAFE, TRACED RATHER THAN ASSUMED:
--   Every path that touches these two tables goes through a SECURITY DEFINER
--   RPC — `get_job_readings`, `insert_reading`, `place_equipment`,
--   `remove_equipment`. Definers bypass RLS, so narrowing the table policies
--   cannot affect them. A repository-wide search for direct table access from
--   `src/` and `functions/` found only documentation-header mentions and no
--   `db.select('moisture_readings')`-style call anywhere. So the policies being
--   replaced here are currently protecting nothing and reachable only by a
--   hand-written PostgREST request.
--
--   Both tables also hold ZERO rows (verified 2026-08-17), so even a mistake
--   here cannot lose data.
--
-- DEPENDS ON: 20260817010000_hydro_drying_spine, which creates
--   `public.hydro_access()`. Apply in timestamp order.
--
-- ADDITIVE / attribute-only:
--   Replaces two policies, revokes over-broad grants, and replaces two function
--   BODIES. No table, column, index, trigger or row changes. Both function
--   signatures and return types are unchanged, so the deployed frontend keeps
--   working — `readingDispatcher.js` and `equipmentDispatcher.js` call these by
--   name with the same parameters.
--
-- WHY THE DRIFT GUARD IS MARKER-BASED, NOT md5:
--   The house pattern pins md5(prosrc). That is the stronger check and it is
--   used where the applying session could read the live body first. This
--   migration was authored without production SQL access, and a GUESSED md5
--   would abort every apply — a guard that always fires is worse than one that
--   is honest about its reach. Instead it asserts the live bodies still carry
--   their distinctive logic AND do not already carry the gate. Whoever applies
--   this should still read the live bodies first; if they do, replacing these
--   markers with real md5 pins is a strict improvement.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260817020000_hydro_legacy_access_hardening.rollback.sql
--   Restores the two `USING (true)` policies and the ungated function bodies
--   byte-for-byte. That is a deliberate RE-OPENING of company-wide read/delete
--   access, so the rollback says so and is not something to run casually.
-- ════════════════════════════════════════════════

-- ── Preflight drift guard ─────────────────────────────────────────────────────

DO $$
DECLARE
  v_insert_src text;
  v_place_src  text;
BEGIN
  IF to_regproc('public.hydro_access') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.hydro_access() is missing — apply '
      '20260817010000_hydro_drying_spine first' USING ERRCODE = '55000';
  END IF;

  SELECT p.prosrc INTO v_insert_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'insert_reading';

  SELECT p.prosrc INTO v_place_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'place_equipment';

  IF v_insert_src IS NULL OR v_place_src IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: insert_reading or place_equipment is missing'
      USING ERRCODE = '55000';
  END IF;

  -- The dry-standard carry-forward is insert_reading's distinctive logic; if it
  -- is gone, the live body is not what this migration was written against.
  IF position('dry_standard_pct' IN v_insert_src) = 0
     OR position('ON CONFLICT' IN v_insert_src) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: insert_reading body has drifted from the reviewed '
      'source (missing dry-standard or ON CONFLICT logic)' USING ERRCODE = '55000';
  END IF;

  IF position('ON CONFLICT' IN v_place_src) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: place_equipment body has drifted from the reviewed '
      'source (missing ON CONFLICT logic)' USING ERRCODE = '55000';
  END IF;

  -- Already hardened? Then this migration has effectively been applied and
  -- re-running it would be a no-op at best and a silent overwrite at worst.
  IF position('NOT_AUTHORIZED' IN v_insert_src) > 0
     OR position('NOT_AUTHORIZED' IN v_place_src) > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: a caller gate is already present — refusing to '
      'overwrite an already-hardened body' USING ERRCODE = '55000';
  END IF;
END $$;

-- ── 1. Replace the always-true policies ───────────────────────────────────────
-- `FOR ALL ... USING (true) WITH CHECK (true)` to `authenticated` is the
-- pre-2026-07-08 template that database-standard.md §1 explicitly supersedes.
-- Read is scoped to an active internal employee; there is no browser write
-- policy at all, because every writer is a definer.

DROP POLICY IF EXISTS moisture_authenticated_all ON public.moisture_readings;
CREATE POLICY moisture_internal_read ON public.moisture_readings
  FOR SELECT TO authenticated USING (public.hydro_access());

DROP POLICY IF EXISTS equip_authenticated_all ON public.equipment_placements;
CREATE POLICY equip_internal_read ON public.equipment_placements
  FOR SELECT TO authenticated USING (public.hydro_access());

-- ── 2. Withdraw the over-broad table grants ───────────────────────────────────
-- `GRANT ALL ... TO anon` is inert today (RLS is on and no anon policy exists),
-- but it is exactly what anon-grant-auditor flags and it is one deleted policy
-- away from being live. `authenticated` keeps SELECT only.

REVOKE ALL ON TABLE public.moisture_readings    FROM anon;
REVOKE ALL ON TABLE public.equipment_placements FROM anon;
REVOKE ALL ON TABLE public.moisture_readings    FROM authenticated;
REVOKE ALL ON TABLE public.equipment_placements FROM authenticated;

GRANT SELECT ON TABLE public.moisture_readings    TO authenticated;
GRANT SELECT ON TABLE public.equipment_placements TO authenticated;

-- ── 3. Gate the two live writers ──────────────────────────────────────────────
-- Body-only replacement. Signatures, parameter names, defaults and return types
-- are identical to the live definitions, so `readingDispatcher.js` and
-- `equipmentDispatcher.js` continue to call them unchanged.
--
-- `IS DISTINCT FROM`, never `<>`: outside a PostgREST request `auth.role()` is
-- NULL, and with `<>` the whole condition evaluates to NULL, which PL/pgSQL's IF
-- treats as false — silently skipping the gate. That exact trap is recorded
-- against 20260805020000.

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
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.hydro_access() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

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
  p_job_id         uuid,
  p_room_id        uuid,
  p_equipment_type public.equipment_type,
  p_nickname       text,
  p_serial         text,
  p_placed_by      uuid,
  p_client_id      uuid,
  p_notes          text
)
RETURNS public.equipment_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  result equipment_placements;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.hydro_access() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.place_equipment(
  uuid, uuid, public.equipment_type, text, text, uuid, uuid, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_equipment(
  uuid, uuid, public.equipment_type, text, text, uuid, uuid, text
) TO authenticated, service_role;

-- ── Postconditions ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('moisture_readings', 'equipment_placements')
       AND policyname IN ('moisture_authenticated_all', 'equip_authenticated_all')
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: an always-true legacy policy survived'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'moisture_readings'
       AND policyname = 'moisture_internal_read'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'equipment_placements'
       AND policyname = 'equip_internal_read'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: a replacement read policy is missing'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('moisture_readings', 'equipment_placements')
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: anon still holds a grant on a legacy hydro table'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('moisture_readings', 'equipment_placements')
       AND grantee = 'authenticated'
       AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: authenticated retains a write grant on a legacy table'
      USING ERRCODE = '55000';
  END IF;

  -- Both writers must now carry the gate, and must still carry their own logic.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'insert_reading'
       AND position('NOT_AUTHORIZED' IN p.prosrc) > 0
       AND position('IS DISTINCT FROM' IN p.prosrc) > 0
       AND position('dry_standard_pct' IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: insert_reading is not correctly gated'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'place_equipment'
       AND position('NOT_AUTHORIZED' IN p.prosrc) > 0
       AND position('IS DISTINCT FROM' IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION: place_equipment is not correctly gated'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege('anon', 'public.insert_reading(uuid, uuid, public.material_type, text, numeric, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, uuid, timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDITION: anon can execute insert_reading' USING ERRCODE = '55000';
  END IF;
END $$;
