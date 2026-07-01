-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Partner — access-control plumbing
--
-- Two additive pieces:
--   1. A `nav_permissions` row for the new `crm_partner` role, scoped to the
--      `crm` nav_key only. Not currently load-bearing (the CRM nav item isn't
--      in the sidebar's NAV_ITEMS yet, and CRM access is actually gated by the
--      `page:crm` feature flag + a role bypass added in AuthContext.jsx), but
--      seeded now so canAccess('crm') is correct the moment a sidebar entry
--      exists, and so every other nav_key correctly defaults to "no access"
--      for this role (no rows inserted for jobs/claims/customers/etc. — layer
--      4 of canAccess() denies by default when no row matches).
--   2. is_crm_partner(uuid) — a SECURITY DEFINER helper so RLS policies can
--      exclude this role without every policy re-deriving the employees join.
--      Used by the RLS-tightening migrations that follow.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nav_permissions (role, nav_key, can_view, can_edit)
SELECT 'crm_partner', 'crm', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM nav_permissions WHERE role = 'crm_partner' AND nav_key = 'crm'
);

CREATE OR REPLACE FUNCTION is_crm_partner(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE auth_user_id = p_auth_user_id AND role = 'crm_partner'
  );
$$;

GRANT EXECUTE ON FUNCTION is_crm_partner(uuid) TO anon, authenticated;
