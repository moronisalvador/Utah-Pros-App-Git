-- Calendar Events — Phase 1
--
-- Extends `appointments` to support non-job calendar blocks (meetings, PTO,
-- training, etc.) that are still assignable to one or more technicians via
-- the existing `appointment_crew` junction.
--
-- Design:
--   * Reuses the appointments table (no parallel table) so all existing UI
--     behavior — drag, resize, crew pills, edit modal — inherits for free.
--   * `kind` column distinguishes 'job' (has job_id) vs 'event' (no job_id).
--   * `job_id` becomes nullable; a CHECK constraint keeps the two shapes honest.
--   * Existing `get_dispatch_board` is unchanged — it joins to jobs so events
--     are naturally excluded. Events are fetched separately via the new
--     `get_dispatch_events` RPC and merged client-side in the Schedule view.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Schema: nullable job_id + new kind column
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.appointments
  ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'job'
    CHECK (kind IN ('job', 'event'));

-- Shape invariant: jobs always have a job_id, events never do.
-- Use a name with IF NOT EXISTS pattern via DO block so re-runs are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_kind_shape'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_kind_shape CHECK (
        (kind = 'job'   AND job_id IS NOT NULL) OR
        (kind = 'event' AND job_id IS NULL)
      );
  END IF;
END $$;

-- Partial index for event range scans (the common query path).
CREATE INDEX IF NOT EXISTS idx_appointments_events_date
  ON public.appointments (date)
  WHERE kind = 'event';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RPC: get_dispatch_events
--    Returns non-job calendar events in [p_start_date, p_end_date] with their
--    assigned crew. Shape mirrors the per-appointment object inside
--    get_dispatch_board so the frontend can render them with the same
--    components.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dispatch_events(
  p_start_date date,
  p_end_date   date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT jsonb_agg(
       jsonb_build_object(
         'id',          a.id,
         'kind',        a.kind,
         'title',       a.title,
         'date',        a.date,
         'time_start',  a.time_start,
         'time_end',    a.time_end,
         'type',        a.type,
         'status',      a.status,
         'notes',       a.notes,
         'color',       a.color,
         'crew', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id',           ac.id,
             'employee_id',  ac.employee_id,
             'role',         ac.role,
             'display_name', e.display_name,
             'full_name',    e.full_name,
             'color',        e.color,
             'avatar_url',   e.avatar_url
           ))
           FROM appointment_crew ac
           JOIN employees e ON e.id = ac.employee_id
           WHERE ac.appointment_id = a.id
         ), '[]'::jsonb)
       ) ORDER BY a.date, a.time_start NULLS LAST
     )
     FROM appointments a
     WHERE a.kind = 'event'
       AND a.date >= p_start_date
       AND a.date <= p_end_date),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dispatch_events(date, date)
  TO anon, authenticated;

-- Refresh PostgREST's schema cache so the new column + RPC are visible
-- without a redeploy.
NOTIFY pgrst, 'reload schema';
