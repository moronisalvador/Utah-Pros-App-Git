-- ════════════════════════════════════════════════
-- MIGRATION: 20260713_uxq_fb_sync_appointment_crew
-- Phase: UX-Quality F-B (backend foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one database helper that replaces the whole crew list on an appointment
--   in a single, all-or-nothing step. Today three screens do this by deleting
--   every crew row and then inserting the new ones one-by-one in a loop — if the
--   phone drops signal mid-loop, the appointment can end up with no crew or only
--   half the crew. This helper does the delete + all inserts inside one function
--   call, so it either fully succeeds or fully fails, never a half state.
--
-- ADDITIVE-ONLY:
--   New SECURITY DEFINER function only. No table DROP/RENAME/ALTER COLUMN, no data
--   backfill. Least-privilege grants (authenticated + service_role; never anon).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sync_appointment_crew(uuid, jsonb);
--   (The three callers keep working on their existing delete-then-insert loop
--    until they are swapped to this RPC, so dropping it is safe pre-cutover.)
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_appointment_crew(
  p_appointment_id uuid,
  p_crew           jsonb DEFAULT '[]'::jsonb
)
RETURNS SETOF public.appointment_crew
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'sync_appointment_crew: p_appointment_id is required';
  END IF;

  -- Atomic replace: the DELETE and the INSERT run in the same implicit
  -- transaction (one function body), so a crash between them cannot leave a
  -- partially-synced crew — the whole call rolls back.
  DELETE FROM public.appointment_crew WHERE appointment_id = p_appointment_id;

  RETURN QUERY
  INSERT INTO public.appointment_crew (appointment_id, employee_id, role)
  SELECT DISTINCT ON ((elem->>'employee_id')::uuid)
         p_appointment_id,
         (elem->>'employee_id')::uuid,
         NULLIF(elem->>'role', '')
  FROM jsonb_array_elements(COALESCE(p_crew, '[]'::jsonb)) AS elem
  WHERE COALESCE(elem->>'employee_id', '') <> ''
  RETURNING *;
END;
$$;

-- Least-privilege: managed-Supabase re-applies EXECUTE TO PUBLIC to every new
-- function at ddl_command_end, so revoke explicitly before granting.
REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb) TO authenticated, service_role;
