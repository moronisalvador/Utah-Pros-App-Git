-- ─────────────────────────────────────────────────────────────────────────────
-- Admin UI support for setting per-employee commission rates (Settings →
-- Commissions). Reads/writes employees.commission_percent / commission_flat
-- (added in 20260630_commission_foundation.sql). A rate set ⇒ that person earns;
-- both null ⇒ none. commission_flat wins over commission_percent (see
-- get_commissions). SECURITY DEFINER + granted to authenticated, like the other
-- Settings lookup RPCs (the Settings page is admin-gated in the UI).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_employee_commissions()
RETURNS TABLE (
  id                 uuid,
  full_name          text,
  role               text,
  is_active          boolean,
  commission_percent numeric,
  commission_flat    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.full_name, e.role::text, e.is_active, e.commission_percent, e.commission_flat
  FROM public.employees e
  ORDER BY (e.is_active IS NOT TRUE), e.full_name;
$$;
GRANT EXECUTE ON FUNCTION public.get_employee_commissions() TO authenticated;

-- Set (or clear) one employee's rate. Pass a percent OR a flat amount; pass both
-- NULL to remove their commission entirely.
CREATE OR REPLACE FUNCTION public.upsert_employee_commission(
  p_employee_id uuid,
  p_percent     numeric DEFAULT NULL,
  p_flat        numeric DEFAULT NULL
)
RETURNS public.employees LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE r public.employees;
BEGIN
  UPDATE public.employees
     SET commission_percent = p_percent,
         commission_flat    = p_flat,
         updated_at         = now()
   WHERE id = p_employee_id
   RETURNING * INTO r;
  RETURN r;
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_employee_commission(uuid, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
