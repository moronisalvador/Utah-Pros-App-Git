-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726220000_permission_write_gates
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the permission system back exactly as it was: any logged-in employee
--   can again change who sees which page, and switch features on and off.
--
--   Understand what that restores. Before this migration, a field technician
--   could grant themselves admin access to everything, by two separate routes.
--   Run this only if the tightening actually broke something, and treat it as
--   temporary.
--
--   It does NOT restore the CRM partner's edit rights on CRM and Settings —
--   that was a data correction the owner asked for, and re-granting edit access
--   to an external role during a rollback would be the wrong default. Re-grant
--   it from the Roles screen if it was actually wanted.
--
-- VERIFIED-BEFORE STATE (live catalog, 2026-07-26):
--   nav_permissions.nav_permissions_auth_all             ALL / {authenticated} / true / true
--   employee_page_access.auth_write_employee_page_access ALL / {authenticated} / true / true
--   feature_flags.auth_write_flags                       ALL / {authenticated} / true / true
--   All six functions: SECURITY DEFINER, granted to authenticated, no caller check.
-- ════════════════════════════════════════════════

-- ─── 1. Policies ───

DROP POLICY IF EXISTS nav_permissions_admin_write ON public.nav_permissions;
DROP POLICY IF EXISTS nav_permissions_auth_read ON public.nav_permissions;
CREATE POLICY nav_permissions_auth_all ON public.nav_permissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS employee_page_access_admin_write ON public.employee_page_access;
CREATE POLICY auth_write_employee_page_access ON public.employee_page_access
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS feature_flags_admin_write ON public.feature_flags;
CREATE POLICY auth_write_flags ON public.feature_flags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── 2. Ungated function bodies (verbatim prior definitions) ───

CREATE OR REPLACE FUNCTION public.upsert_permission(
  p_role text, p_nav_key text, p_can_view boolean, p_can_edit boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  result nav_permissions;
BEGIN
  INSERT INTO nav_permissions (role, nav_key, can_view, can_edit)
  VALUES (p_role, p_nav_key, p_can_view, p_can_edit)
  ON CONFLICT (role, nav_key)
  DO UPDATE SET can_view = p_can_view, can_edit = p_can_edit
  RETURNING * INTO result;

  RETURN row_to_json(result)::jsonb;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_employee_page_access(
  p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid DEFAULT NULL::uuid
)
RETURNS employee_page_access
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  INSERT INTO employee_page_access (employee_id, nav_key, can_view, updated_by, updated_at)
  VALUES (p_employee_id, p_nav_key, p_can_view, p_updated_by, now())
  ON CONFLICT (employee_id, nav_key) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING *;
$function$;

CREATE OR REPLACE FUNCTION public.delete_employee_page_access(
  p_employee_id uuid, p_nav_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  DELETE FROM employee_page_access WHERE employee_id = p_employee_id AND nav_key = p_nav_key;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_feature_flag(
  p_key text, p_enabled boolean, p_dev_only_user_id uuid DEFAULT NULL::uuid,
  p_category text DEFAULT 'page'::text, p_label text DEFAULT ''::text,
  p_description text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid
)
RETURNS SETOF feature_flags
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_by, updated_at)
  VALUES (p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description, p_updated_by, now())
  ON CONFLICT (key) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    dev_only_user_id = EXCLUDED.dev_only_user_id,
    category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING *;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_feature_flag(
  p_key text, p_enabled boolean, p_dev_only_user_id uuid DEFAULT NULL::uuid,
  p_category text DEFAULT 'page'::text, p_label text DEFAULT ''::text,
  p_description text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid,
  p_force_disabled boolean DEFAULT false
)
RETURNS feature_flags
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_by, updated_at, force_disabled)
  VALUES (p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description, p_updated_by, now(), p_force_disabled)
  ON CONFLICT (key) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    dev_only_user_id = EXCLUDED.dev_only_user_id,
    category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_by = EXCLUDED.updated_by,
    updated_at = now(),
    force_disabled = EXCLUDED.force_disabled
  RETURNING *;
$function$;

CREATE OR REPLACE FUNCTION public.delete_feature_flag(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  DELETE FROM feature_flags WHERE key = p_key;
$function$;

-- ─── 3. Helper ───
-- Dropped last: the policies above referenced it.

DROP FUNCTION IF EXISTS public.is_active_internal_admin();
