-- ═════════════════════════════════════════════════════════════════════════════
-- supabase/tests/db_foundation_p3_anon_closure.sql
-- DB-Foundation Phase P3 — post-wave anon-closure drift gate  [roadmap item ⑥]
--   docs/db-foundation-roadmap.md → Phase P3; database-standard.md §2 allowlist;
--   ownership manifest §8 (deferred-hardening).
--
-- WHAT THIS DOES (plain language):
--   Run this AFTER the two RED P3 revoke migrations apply. It fails loudly
--   (RAISE EXCEPTION) if the anonymous (anon) browser role can still reach ANY
--   public-schema table policy or function EXECUTE that is not on the sanctioned
--   allowlist. It is the "zero anon outside the allowlist" assertion — the
--   regression guard that keeps a future migration from silently re-opening anon.
--
-- HOW TO RUN: paste into Supabase SQL editor / MCP execute_sql, or psql. Read-only
--   except that it RAISEs on violation. Prints NOTICE + a clean SELECT on success.
--
-- KNOWN, SANCTIONED anon exceptions (everything else must be closed):
--   RPCs (database-standard §2): get_feature_flags, get_employee_page_access,
--     get_crm_build_progress, upsert_lead_from_form, get_sign_request_by_token,
--     get_sign_document_templates.
--   Table policies (§2 login/devLogin bootstrap reads): employees, feature_flags,
--     employee_page_access, nav_permissions (SELECT-only after P3's narrow).
--   Deferred tables (manifest §8 — TEMPORARY: anon stays until the owning in-flight
--     phase merges, then a follow-up closes them): messages, conversations,
--     conversation_participants, email_campaigns, email_campaign_recipients,
--     email_campaign_exclusions, email_suppressions, crm_automations,
--     crm_automation_runs, jobs, job_phase_history, appointments, claims, contacts,
--     automation_settings.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_allow_rpcs text[] := ARRAY[
    'get_feature_flags','get_employee_page_access','get_crm_build_progress',
    'upsert_lead_from_form','get_sign_request_by_token','get_sign_document_templates'
  ];
  v_allow_policy_tables text[] := ARRAY[
    'employees','feature_flags','employee_page_access','nav_permissions'
  ];
  -- §8 deferred-hardening — TEMPORARY exceptions; delete from this list as each merges.
  v_deferred_tables text[] := ARRAY[
    'messages','conversations','conversation_participants','email_campaigns',
    'email_campaign_recipients','email_campaign_exclusions','email_suppressions',
    'crm_automations','crm_automation_runs','jobs','job_phase_history',
    'appointments','claims','contacts','automation_settings'
  ];
  v_bad_policies int;
  v_bad_fns int;
  v_bad_list text;
BEGIN
  -- (1) Policies: any public policy naming anon on a table NOT in allowlist ∪ deferred.
  SELECT count(*),
         string_agg(tablename || '.' || policyname, ', ')
    INTO v_bad_policies, v_bad_list
  FROM pg_policies
  WHERE schemaname = 'public'
    AND 'anon' = ANY(roles)
    AND tablename <> ALL(v_allow_policy_tables)
    AND tablename <> ALL(v_deferred_tables);

  IF v_bad_policies > 0 THEN
    RAISE EXCEPTION 'P3 anon-closure drift: % public policy(ies) still grant anon outside the allowlist: %',
      v_bad_policies, v_bad_list;
  END IF;

  -- (1b) nav_permissions must be SELECT-only for anon (P3 narrowed it).
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='nav_permissions'
      AND 'anon' = ANY(roles) AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'P3 anon-closure drift: nav_permissions still has a non-SELECT anon policy (should be SELECT-only).';
  END IF;

  -- (2) Functions: any public function anon can EXECUTE outside the allowlist.
  SELECT count(*),
         string_agg(p.proname, ', ')
    INTO v_bad_fns, v_bad_list
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname <> ALL(v_allow_rpcs);

  IF v_bad_fns > 0 THEN
    RAISE EXCEPTION 'P3 anon-closure drift: % function(s) still anon-EXECUTE outside the allowlist: %',
      v_bad_fns, v_bad_list;
  END IF;

  RAISE NOTICE 'P3 anon-closure gate PASSED — zero anon policies/EXECUTEs outside the allowlist (+ % deferred tables still open by design).', array_length(v_deferred_tables, 1);
END $$;

-- Convenience read-out (safe to run anytime): current anon surface, bucketed.
SELECT 'policies_outside_allowlist' AS metric,
       count(*) AS n
FROM pg_policies
WHERE schemaname='public' AND 'anon' = ANY(roles)
  AND tablename NOT IN ('employees','feature_flags','employee_page_access','nav_permissions')
  AND tablename NOT IN ('messages','conversations','conversation_participants','email_campaigns',
    'email_campaign_recipients','email_campaign_exclusions','email_suppressions','crm_automations',
    'crm_automation_runs','jobs','job_phase_history','appointments','claims','contacts','automation_settings')
UNION ALL
SELECT 'functions_anon_execute_outside_allowlist',
       count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND p.proname NOT IN ('get_feature_flags','get_employee_page_access','get_crm_build_progress',
    'upsert_lead_from_form','get_sign_request_by_token','get_sign_document_templates');
