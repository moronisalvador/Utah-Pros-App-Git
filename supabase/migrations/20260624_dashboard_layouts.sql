-- Per-user Overview dashboard layout (drag/resize/reorder persistence, Phase 3).
-- Applied to the live DB via MCP on 2026-06-24; committed here for the record.
CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  layout      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS-locked: NO policies → no direct PostgREST access; only the SECURITY DEFINER RPCs below.
ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- Read the calling user's own layout (NULL if none saved yet).
CREATE OR REPLACE FUNCTION public.get_dashboard_layout()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dl.layout
  FROM public.dashboard_layouts dl
  JOIN public.employees e ON e.id = dl.employee_id
  WHERE e.auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- Upsert the calling user's layout. No-op if the auth user isn't an employee.
CREATE OR REPLACE FUNCTION public.save_dashboard_layout(p_layout jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid;
BEGIN
  SELECT id INTO v_emp FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp IS NULL THEN RETURN; END IF;
  INSERT INTO public.dashboard_layouts (employee_id, layout, updated_at)
  VALUES (v_emp, p_layout, now())
  ON CONFLICT (employee_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_layout() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_dashboard_layout(jsonb) TO authenticated;
