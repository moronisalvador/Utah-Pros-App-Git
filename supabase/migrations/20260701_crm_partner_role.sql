-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Partner user type — role + external-account marker
--
-- New restricted account type for outside partners (marketing agency running
-- leads/advertising) who should see only the CRM side of the app. This
-- migration adds the role value and an is_external marker; access scoping
-- (nav_permissions seed, RLS tightening) is done in the migrations that follow
-- it in this same batch.
--
-- ALL ADDITIVE: one new enum value, one new column with a safe default. No
-- existing row's behavior changes (is_external defaults to false for every
-- current employee).
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot be used in the same transaction as the
-- new value — this migration only adds the value, nothing here references
-- 'crm_partner' yet (that happens in the next migration).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'crm_partner';

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_external boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.is_external IS 'True for non-staff accounts (e.g. marketing-agency CRM partners). Reporting/audit marker only — access is still enforced via role + nav_permissions + RLS.';
