-- ════════════════════════════════════════════════
-- MIGRATION: 20260726220000_permission_write_gates
-- Phase: Least-privilege — backlog items 0d + 0e
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes the Roles & Permissions screen actually mean something.
--
--   Today the screen looks like an admin control, but the database does not
--   enforce that. Any logged-in employee — including a field technician — can
--   give themselves admin access to every page, or switch any feature on and
--   off. They can do it two different ways: by calling the helper functions the
--   screen uses, or by writing straight to the settings tables. Both doors are
--   open, so this closes both.
--
--   It also fixes a specific case the owner asked about: the external CRM
--   partner role currently has EDIT rights on the CRM and Settings areas, and
--   those two rows are not even shown on the Roles screen, so they could not be
--   turned off from the app.
--
--   Nobody legitimate loses anything. The three screens involved are already
--   admin-only or owner-only in the app; this just makes the database agree.
--
-- ADDITIVE-ONLY:
--   No — a deliberate authorization tightening (RED tier). It adds one helper
--   function, replaces three write policies, adds one read policy, gates six
--   functions (body-only, signatures unchanged), and corrects two data rows.
--   No table, column or index is created or dropped.
--
-- EVIDENCE (live catalog, 2026-07-26):
--   Functions — all SECURITY DEFINER, all granted to `authenticated`, and NONE
--   references auth.uid() (verified via prosrc):
--     upsert_permission, upsert_employee_page_access,
--     delete_employee_page_access, upsert_feature_flag (BOTH overloads),
--     delete_feature_flag
--   Tables — every one carries an always-true write policy:
--     nav_permissions.nav_permissions_auth_all         ALL / {authenticated} / true
--     employee_page_access.auth_write_employee_page_access ALL / {authenticated} / true
--     feature_flags.auth_write_flags                   ALL / {authenticated} / true
--   Data — nav_permissions has crm_partner can_edit = true on nav_key 'crm' and
--     'settings'; neither key is rendered by src/pages/settings/Roles.jsx.
--   Callers — all browser pages, no Workers: Roles.jsx (AdminRoute),
--     PageAccess.jsx (AdminRoute), DevTools.jsx (DevRoute/owner).
--
-- ⚠️ THE TRAP THIS MIGRATION AVOIDS:
--   nav_permissions has NO authenticated SELECT policy of its own — every
--   logged-in read is served by the same always-true ALL policy being replaced.
--   Replacing it without adding a read policy would break the navigation menu
--   for every non-admin user in the app. A dedicated read policy is added below.
--   employee_page_access and feature_flags each already have their own SELECT
--   policy (used by the pre-login bootstrap, database-standard.md §2), so their
--   reads are unaffected.
--
-- DISCLOSED GAP vs THE APP'S INTENT (accepted, not fixed here):
--   src/App.jsx:190-196 restricts DevTools — where the feature-flag RPCs are
--   called — to the owner alone (`isMoroni`), with the comment "Even other admins
--   can't access this via direct URL." This gate accepts ANY active internal
--   admin, so a second admin would gain a database-legal path to flip feature
--   flags that the UI deliberately hides from them. That is still a large
--   improvement on today's any-employee state, and feature flags are lower
--   consequence than roles or page access, so it is accepted rather than
--   narrowed to a single hardcoded identity. Revisit if a second admin is ever
--   added who should not control rollout.
--
-- DISCLOSED BEHAVIOR CHANGE:
--   The gate excludes is_external. The [Local Dev Test Account] is an external
--   admin, so it can no longer edit roles, page access, or feature flags. That
--   is deliberate — an external account should not be able to grant privileges —
--   but it is a real change to local-dev testing. Easily reversed by dropping
--   `AND NOT e.is_external` from is_active_internal_admin().
--
-- NOTE ON THE SHIPPED PRECEDENT:
--   qbo_attachments_select uses role IN ('admin','manager'). `manager` is not in
--   the employees.role enum (admin, office, project_manager, field_tech,
--   estimator, supervisor, crm_partner) — that arm of the shipped predicate is
--   dead. This migration uses 'admin' only and records the drift rather than
--   copying it forward.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726220000_permission_write_gates.rollback.sql
--   (restores all three always-true write policies, drops the added read policy
--    and the helper, restores the six ungated function bodies, and restores the
--    two crm_partner can_edit rows).
-- ════════════════════════════════════════════════

-- PREREQUISITE:
--   20260726180000_mobile_employee_identity_authority must already be recorded
--   and must still make employees read-only to browser roles. The predicates
--   below trust auth_user_id, role, is_active, and is_external; creating them
--   while an authenticated caller can edit those fields would enable
--   self-binding, self-promotion, and account reactivation.

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction-control
--   statements here.

DO $permission_write_employee_authority_preflight$
DECLARE
  v_policy_names text[];
  v_anon_privileges text[];
  v_authenticated_privileges text[];
  v_service_privileges text[];
  v_public_privilege_count integer;
  v_grantable_privilege_count integer;
  v_unexpected_grantee_count integer;
  v_unexpected_grantor_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'mobile_employee_identity_authority'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'permission write gates preflight: exactly one mobile_employee_identity_authority migration must be recorded';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_namespace namespace
         ON namespace.oid = relation.relnamespace
       JOIN pg_roles owner_role
         ON owner_role.oid = relation.relowner
       WHERE namespace.nspname = 'public'
         AND relation.relname = 'employees'
         AND relation.relkind = 'r'
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles role_record
       WHERE role_record.rolname = 'service_role'
         AND role_record.rolbypassrls
     ) THEN
    RAISE EXCEPTION
      'permission write gates preflight: employees owner/RLS state drift';
  END IF;

  SELECT array_agg(policy.policyname ORDER BY policy.policyname)
    INTO v_policy_names
  FROM pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'employees';

  IF v_policy_names IS DISTINCT FROM
       ARRAY[
         'allow_anon_read_employees',
         'allow_authenticated_employees'
       ]::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polpermissive
         AND policy.polroles =
           ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND policy.polcmd = 'r'
         AND pg_get_expr(
               policy.polqual,
               policy.polrelid,
               true
             ) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_anon_read_employees'
         AND policy.polpermissive
         AND policy.polroles =
           ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'anon')]
         AND policy.polcmd = 'r'
         AND pg_get_expr(
               policy.polqual,
               policy.polrelid,
               true
             ) = 'true'
         AND policy.polwithcheck IS NULL
     ) THEN
    RAISE EXCEPTION
      'permission write gates preflight: employees policy drift: %',
      v_policy_names;
  END IF;

  SELECT
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'anon'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'authenticated'),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
        FILTER (WHERE grantee_role.rolname = 'service_role'),
      ARRAY[]::text[]
    ),
    count(*) FILTER (WHERE acl.grantee = 0),
    count(*) FILTER (
      WHERE acl.is_grantable
        AND acl.grantee <> relation.relowner
    ),
    count(*) FILTER (
      WHERE acl.grantee <> relation.relowner
        AND acl.grantee <> 0
        AND COALESCE(grantee_role.rolname, '') NOT IN (
          'anon',
          'authenticated',
          'service_role'
        )
    ),
    count(*) FILTER (WHERE acl.grantor <> relation.relowner)
    INTO
      v_anon_privileges,
      v_authenticated_privileges,
      v_service_privileges,
      v_public_privilege_count,
      v_grantable_privilege_count,
      v_unexpected_grantee_count,
      v_unexpected_grantor_count
  FROM pg_class relation
  CROSS JOIN LATERAL
    aclexplode(
      COALESCE(
        relation.relacl,
        acldefault('r', relation.relowner)
      )
    ) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE relation.oid = to_regclass('public.employees');

  IF v_anon_privileges IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR v_authenticated_privileges IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR v_service_privileges IS DISTINCT FROM
       ARRAY[
         'DELETE',
         'INSERT',
         'MAINTAIN',
         'REFERENCES',
         'SELECT',
         'TRIGGER',
         'TRUNCATE',
         'UPDATE'
       ]::text[]
     OR v_public_privilege_count <> 0
     OR v_grantable_privilege_count <> 0
     OR v_unexpected_grantee_count <> 0
     OR v_unexpected_grantor_count <> 0
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
       IS DISTINCT FROM true
     OR has_table_privilege('authenticated', 'public.employees', 'SELECT')
       IS DISTINCT FROM true
     OR has_table_privilege('anon', 'public.employees', 'INSERT')
     OR has_table_privilege('anon', 'public.employees', 'UPDATE')
     OR has_table_privilege('anon', 'public.employees', 'DELETE')
     OR has_table_privilege('anon', 'public.employees', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.employees', 'REFERENCES')
     OR has_table_privilege('anon', 'public.employees', 'TRIGGER')
     OR has_table_privilege('anon', 'public.employees', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.employees', 'INSERT')
     OR has_table_privilege('authenticated', 'public.employees', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.employees', 'DELETE')
     OR has_table_privilege('authenticated', 'public.employees', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.employees', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.employees', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.employees', 'MAINTAIN') THEN
    RAISE EXCEPTION
      'permission write gates preflight: employees browser privileges are not SELECT-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass('public.employees')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND cardinality(attribute.attacl) > 0
  ) THEN
    RAISE EXCEPTION
      'permission write gates preflight: unexpected employees column privileges';
  END IF;
END;
$permission_write_employee_authority_preflight$;

-- ─── 1. Shared predicate ───
-- SECURITY DEFINER so it can read `employees` without tripping RLS recursion
-- when used inside a policy. This is the seed of the shared assert/predicate
-- pair that backlog item 3.2 wants instead of 342 individual reviews.

CREATE OR REPLACE FUNCTION public.is_active_internal_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM employees e
    WHERE e.auth_user_id = auth.uid()
      AND e.is_active
      AND NOT e.is_external
      AND e.role::text = 'admin'
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.is_active_internal_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_internal_admin() TO authenticated, service_role;

-- ─── 2. nav_permissions ───
-- Read stays open to logged-in staff (the nav menu needs it); writes go admin-only.

DROP POLICY IF EXISTS nav_permissions_auth_all ON public.nav_permissions;

CREATE POLICY nav_permissions_auth_read ON public.nav_permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY nav_permissions_admin_write ON public.nav_permissions
  FOR ALL TO authenticated
  USING (public.is_active_internal_admin())
  WITH CHECK (public.is_active_internal_admin());

-- ─── 3. employee_page_access ───
-- anon_read_employee_page_access already serves SELECT; only the write changes.

DROP POLICY IF EXISTS auth_write_employee_page_access ON public.employee_page_access;

CREATE POLICY employee_page_access_admin_write ON public.employee_page_access
  FOR ALL TO authenticated
  USING (public.is_active_internal_admin())
  WITH CHECK (public.is_active_internal_admin());

-- ─── 4. feature_flags ───
-- anon_read_flags already serves SELECT; only the write changes.

DROP POLICY IF EXISTS auth_write_flags ON public.feature_flags;

CREATE POLICY feature_flags_admin_write ON public.feature_flags
  FOR ALL TO authenticated
  USING (public.is_active_internal_admin())
  WITH CHECK (public.is_active_internal_admin());

-- ─── 5. Gate the six functions ───
-- Body-only CREATE OR REPLACE. Signatures, return types and search_path are
-- byte-identical to the live definitions; the ONLY behavioral change is the
-- authorization check. service_role is allowed through so a future Worker or
-- seed path is not broken by this gate.
--
-- NOT byte-identical: four of the six move from `LANGUAGE sql` to `plpgsql`
-- (upsert_employee_page_access, delete_employee_page_access, delete_feature_flag
-- and both upsert_feature_flag overloads). A pure-SQL function cannot RAISE
-- conditionally, so the gate requires plpgsql. LANGUAGE is invisible to callers
-- — the signature, return type and result are unchanged — but it is a real
-- difference and this header exists so a reviewer can trust it without
-- re-deriving the diff.

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
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_row employee_page_access;
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  -- p_updated_by is caller-supplied and therefore spoofable. Prefer the real
  -- authenticated employee; fall back to the parameter for service-role callers.
  SELECT e.id INTO v_actor FROM employees e WHERE e.auth_user_id = auth.uid();

  INSERT INTO employee_page_access (employee_id, nav_key, can_view, updated_by, updated_at)
  VALUES (p_employee_id, p_nav_key, p_can_view, COALESCE(v_actor, p_updated_by), now())
  ON CONFLICT (employee_id, nav_key) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_employee_page_access(
  p_employee_id uuid, p_nav_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  DELETE FROM employee_page_access WHERE employee_id = p_employee_id AND nav_key = p_nav_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_feature_flag(
  p_key text, p_enabled boolean, p_dev_only_user_id uuid DEFAULT NULL::uuid,
  p_category text DEFAULT 'page'::text, p_label text DEFAULT ''::text,
  p_description text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid
)
RETURNS SETOF feature_flags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  SELECT e.id INTO v_actor FROM employees e WHERE e.auth_user_id = auth.uid();

  RETURN QUERY
  INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_by, updated_at)
  VALUES (p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description,
          COALESCE(v_actor, p_updated_by), now())
  ON CONFLICT (key) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    dev_only_user_id = EXCLUDED.dev_only_user_id,
    category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING *;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_feature_flag(
  p_key text, p_enabled boolean, p_dev_only_user_id uuid DEFAULT NULL::uuid,
  p_category text DEFAULT 'page'::text, p_label text DEFAULT ''::text,
  p_description text DEFAULT NULL::text, p_updated_by uuid DEFAULT NULL::uuid,
  p_force_disabled boolean DEFAULT false
)
RETURNS feature_flags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_row feature_flags;
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  SELECT e.id INTO v_actor FROM employees e WHERE e.auth_user_id = auth.uid();

  INSERT INTO feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_by, updated_at, force_disabled)
  VALUES (p_key, p_enabled, p_dev_only_user_id, p_category, p_label, p_description,
          COALESCE(v_actor, p_updated_by), now(), p_force_disabled)
  ON CONFLICT (key) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    dev_only_user_id = EXCLUDED.dev_only_user_id,
    category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_by = EXCLUDED.updated_by,
    updated_at = now(),
    force_disabled = EXCLUDED.force_disabled
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_feature_flag(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_active_internal_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: admin only' USING errcode = '42501';
  END IF;

  DELETE FROM feature_flags WHERE key = p_key;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): EXECUTE TO PUBLIC is
-- re-applied to replaced functions, so revoke explicitly before granting.
REVOKE EXECUTE ON FUNCTION public.upsert_permission(text, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_employee_page_access(uuid, text, boolean, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_employee_page_access(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_feature_flag(text, boolean, uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_feature_flag(text, boolean, uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_feature_flag(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.upsert_permission(text, text, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_employee_page_access(uuid, text, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_employee_page_access(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_feature_flag(text, boolean, uuid, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_feature_flag(text, boolean, uuid, text, text, text, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_feature_flag(text) TO authenticated, service_role;

-- ─── 6. Data fix (0e): CRM partner is read-only ───
-- Owner decision 2026-07-26: "CRM partner should only have read view of the CRM
-- for now, but the roles and permissions page should let me change that if I
-- want to." Editing stays possible through the Roles screen (as an admin); this
-- only corrects today's incorrect state.

-- Scoped to the two keys named in the evidence block. An unscoped UPDATE would
-- do MORE than what was reviewed: on a shared production database the owner can
-- change rows between evidence capture and the apply window, and a data fix must
-- perform exactly the change that was signed off. A crm_partner edit right on
-- some other nav_key appearing in the interim is a new decision, not this one.
UPDATE public.nav_permissions
   SET can_edit = false
 WHERE role = 'crm_partner'
   AND can_edit = true
   AND nav_key IN ('crm', 'settings');
