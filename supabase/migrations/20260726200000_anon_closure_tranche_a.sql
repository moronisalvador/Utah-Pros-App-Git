-- ════════════════════════════════════════════════
-- MIGRATION: 20260726200000_anon_closure_tranche_a
-- Phase: Anon closure, tranche (a) — highest-consequence tables first
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops anyone on the internet from changing two settings tables they should
--   never have been able to touch.
--
--   The key that the website uses to talk to the database is public by design —
--   it ships inside the browser bundle. Today that key can switch customer
--   texting on or off, and can delete the list of people who asked us to stop
--   emailing them. Nobody has to log in to do either. This closes both.
--
--   It also makes the customer-texting switch admin-only. Closing the table
--   alone was not enough: the switch can also be flipped through a helper
--   function that ANY logged-in employee could call, including a field
--   technician.
--
--   Nothing a person actually uses changes. The two screens that read these
--   settings go through helper functions that keep working exactly as before.
--
-- ADDITIVE-ONLY:
--   No — this is a deliberate REVOKE (RED tier), which is the point. It drops
--   two always-true policies and revokes table privileges from the browser
--   roles, plus one function-body-only CREATE OR REPLACE. It creates and drops
--   no table, column, or index, and changes no row of business data.
--
-- EVIDENCE (live catalog, 2026-07-26):
--   - automation_settings: policy `automation_settings_all` = ALL / {anon,
--     authenticated} / USING true / WITH CHECK true. On PostgreSQL 17, anon
--     holds all eight table privileges, including MAINTAIN.
--     privileges. Same shape on email_suppressions.
--   - Caller inventory: NO src/ code touches either table directly.
--     automation_settings is reached only via get_automation_settings /
--     set_automation_setting (both SECURITY DEFINER, search_path pinned, so
--     they bypass RLS and are unaffected by this revoke). email_suppressions
--     has zero browser references. Its only WRITERS are email-unsubscribe (via
--     the SECURITY DEFINER email_unsubscribe RPC) and resend-webhook (via
--     record_email_suppression), both invoked through the service-role Worker
--     client. conversation-email READS it; email-consent is a pure predicate
--     with no database access at all. So the customer-facing unsubscribe path
--     survives this revoke — it never depended on a browser-role table grant.
--   - Precedent for RLS-on-with-no-policy + explicit revoke:
--     20260724180000_crm_lead_notes.sql:83-89.
--
-- NOT IN SCOPE (deliberately):
--   The database-standard.md §2 public allowlist — login/session bootstrap,
--   /status, public e-sign retrieval, public job-file read — is untouched here.
--   Those are the paths whose breakage would stop logins or customer signing,
--   and they get their own tranche with their own proof.
--
-- COORDINATION:
--   automation_settings sits in db-foundation-wave-ownership.md §8's
--   deferred-hardening bucket keyed to CRM 4b. CRM 4b is unbuilt and blocked on
--   A2P carrier approval, so there is no in-flight caller to regress. Disclosed
--   rather than assumed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260726200000_anon_closure_tranche_a.rollback.sql
--   (recreates both always-true policies verbatim, re-grants the browser roles,
--    and restores the previous set_automation_setting body without the gate).
-- ════════════════════════════════════════════════

-- ATOMICITY:
--   The Supabase migration executor owns the transaction that includes both this
--   SQL and its schema_migrations ledger row. Do not add transaction-control
--   statements here.

DO $db1_tranche_a_preflight$
DECLARE
  v_table_name text;
  v_policy_name text;
  v_function_oid oid;
BEGIN
  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
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
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM
       ARRAY[
         'allow_anon_read_employees',
         'allow_authenticated_employees'
       ]::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_anon_read_employees'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'anon')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'anon'
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'authenticated'
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'service_role'
     ) IS DISTINCT FROM
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
     OR NOT has_table_privilege('anon', 'public.employees', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR EXISTS (
       SELECT 1
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND (
           acl.grantor <> relation.relowner
           OR acl.grantee = 0
           OR (
             acl.grantee <> relation.relowner
             AND COALESCE(grantee_role.rolname, '') NOT IN (
               'anon',
               'authenticated',
               'service_role'
             )
           )
           OR (
             acl.is_grantable
             AND acl.grantee <> relation.relowner
           )
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A preflight: mobile employee identity authority is absent or drifted';
  END IF;

  FOR v_table_name, v_policy_name IN
    SELECT *
    FROM (
      VALUES
        ('automation_settings', 'automation_settings_all'),
        ('email_suppressions', 'email_suppressions_all')
    ) expected(table_name, policy_name)
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM pg_class relation
         JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND relation.relkind = 'r'
           AND owner_role.rolname = 'postgres'
           AND relation.relrowsecurity
       )
       OR (
         SELECT array_agg(policy.polname ORDER BY policy.polname)
         FROM pg_policy policy
         WHERE policy.polrelid =
               to_regclass(format('public.%I', v_table_name))
       ) IS DISTINCT FROM ARRAY[v_policy_name]::name[]
       OR NOT EXISTS (
         SELECT 1
         FROM pg_policy policy
         WHERE policy.polrelid =
               to_regclass(format('public.%I', v_table_name))
           AND policy.polname = v_policy_name
           AND policy.polcmd = '*'
           AND policy.polpermissive
           AND (
             SELECT array_agg(role_oid ORDER BY role_oid)
             FROM unnest(policy.polroles) role_oid
           ) = (
             SELECT array_agg(role_record.oid ORDER BY role_record.oid)
             FROM pg_roles role_record
             WHERE role_record.rolname IN ('anon', 'authenticated')
           )
           AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
           AND pg_get_expr(policy.polwithcheck, policy.polrelid, true) = 'true'
       )
       OR (
         SELECT COALESCE(
           array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
           ARRAY[]::text[]
         )
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND grantee_role.rolname = 'anon'
       ) IS DISTINCT FROM
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
       OR (
         SELECT COALESCE(
           array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
           ARRAY[]::text[]
         )
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND grantee_role.rolname = 'authenticated'
       ) IS DISTINCT FROM
         ARRAY[
           'DELETE',
           'INSERT',
           'MAINTAIN',
           'REFERENCES',
           'SELECT',
           'TRIGGER',
           'TRUNCATE',
           'UPDATE'
         ]::text[] THEN
      RAISE EXCEPTION
        'DB-1 tranche A preflight: %.% input policy/ACL drift',
        'public',
        v_table_name;
    END IF;
  END LOOP;

  SELECT procedure.oid
    INTO v_function_oid
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
  JOIN pg_language language_record ON language_record.oid = procedure.prolang
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'set_automation_setting'
    AND pg_get_function_identity_arguments(procedure.oid) =
          'p_key text, p_value boolean, p_org_id uuid'
    AND pg_get_function_result(procedure.oid) = 'automation_settings'
    AND owner_role.rolname = 'postgres'
    AND language_record.lanname = 'plpgsql'
    AND procedure.prosecdef
    AND procedure.provolatile = 'v'
    AND procedure.proconfig = ARRAY['search_path=public']::text[]
    AND procedure.prosrc NOT LIKE '%NOT_AUTHORIZED:%'
    AND procedure.prosrc NOT LIKE '%automation_setting_changed%';

  IF v_function_oid IS NULL
     OR (
       SELECT array_agg(
                CASE
                  WHEN acl.grantee = 0 THEN 'PUBLIC'
                  ELSE grantee_role.rolname
                END
                ORDER BY
                  CASE
                    WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE grantee_role.rolname
                  END
              )
       FROM pg_proc procedure
       CROSS JOIN LATERAL
         aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE procedure.oid = v_function_oid
         AND acl.privilege_type = 'EXECUTE'
     ) IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL
         aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
       WHERE procedure.oid = v_function_oid
         AND acl.privilege_type = 'EXECUTE'
         AND acl.is_grantable
     ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A preflight: set_automation_setting metadata/body/ACL drift';
  END IF;
END;
$db1_tranche_a_preflight$;

-- ─── 1. automation_settings — RPC-only ───

DROP POLICY IF EXISTS automation_settings_all ON public.automation_settings;

ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.automation_settings FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.automation_settings IS
  'RPC-only. Read via get_automation_settings, written via set_automation_setting '
  '(both SECURITY DEFINER). Browser roles hold no table privilege: the anon key is '
  'public, and this table carries the customer-SMS kill switch.';

-- ─── 2. email_suppressions — service-role only ───

DROP POLICY IF EXISTS email_suppressions_all ON public.email_suppressions;

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_suppressions FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.email_suppressions IS
  'Service-role only. Every writer is a Worker (resend-webhook, email-unsubscribe, '
  'conversation-email, email-consent). This is the opt-out list: anonymous DELETE '
  'was a CAN-SPAM exposure.';

-- ─── 3. set_automation_setting — gate the kill switch ───
-- Function-body-only CREATE OR REPLACE. Signature, return type, language,
-- volatility and search_path are byte-identical to the live definition
-- (crm-wave-ownership.md §3 freezes the Phase 4d signature). The ONLY change is
-- the authorization block at the top.
--
-- Two tiers, because the keys are not equally dangerous:
--   * sms_sending_enabled is the TCPA kill switch — admin only.
--   * the four feature toggles — admin or office.
-- Both exclude is_external: an external account must not be able to arm
-- customer texting. NOTE: the shipped p9_assert_admin() helper does NOT check
-- is_external; that gap is recorded for the 3.2 shared-assert pass rather than
-- silently diverging here.

CREATE OR REPLACE FUNCTION public.set_automation_setting(
  p_key text,
  p_value boolean,
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS automation_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_row automation_settings;
  v_actor uuid;
BEGIN
  IF p_key NOT IN (
    'sms_sending_enabled', 'speed_to_lead_enabled', 'missed_call_textback_enabled',
    'no_response_followup_enabled', 'review_request_enabled'
  ) THEN
    RAISE EXCEPTION 'set_automation_setting: invalid key %', p_key;
  END IF;

  -- Authorization: validated INSIDE the definer, per database-standard.md §1.
  IF p_key = 'sms_sending_enabled' THEN
    IF auth.role() <> 'service_role' AND NOT EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
        AND role = 'admin'
        AND is_active
        AND NOT is_external
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: sms_sending_enabled is admin only'
        USING errcode = '42501';
    END IF;
  ELSE
    IF auth.role() <> 'service_role' AND NOT EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'office')
        AND is_active
        AND NOT is_external
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: admin or office only'
        USING errcode = '42501';
    END IF;
  END IF;

  v_org := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'set_automation_setting: no org resolved';
  END IF;

  INSERT INTO automation_settings (org_id) VALUES (v_org) ON CONFLICT (org_id) DO NOTHING;

  EXECUTE format(
    'UPDATE automation_settings SET %I = $1, updated_at = now() WHERE org_id = $2 RETURNING *', p_key
  ) INTO v_row USING p_value, v_org;

  -- Audit trail. Deliberately INSIDE the transaction and NOT exception-swallowed:
  -- if we cannot record who armed customer texting, we do not arm it. TCPA
  -- penalties are per message and incident response starts with "who did this,
  -- and when".
  --
  -- On an sms_sending_enabled -> true transition the whole resulting row is
  -- captured, because that flip does not just enable one thing: every
  -- pre-armed automation goes live at that instant. missed_call_textback_enabled
  -- is already true in one org row today, so the flip has a real blast radius
  -- that the key/value pair alone would not record.
  SELECT e.id INTO v_actor FROM employees e WHERE e.auth_user_id = auth.uid();

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES (
    'automation_setting_changed',
    'automation_settings',
    v_org,
    v_actor,
    jsonb_build_object(
      'key', p_key,
      'value', p_value,
      'org_id', v_org,
      'actor_auth_uid', auth.uid(),
      'armed_state', CASE
        WHEN p_key = 'sms_sending_enabled' AND p_value THEN to_jsonb(v_row)
        ELSE NULL
      END
    )
  );

  RETURN v_row;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): this project re-applies
-- EXECUTE TO PUBLIC to every new/replaced function at ddl_command_end, so the
-- revoke must be explicit and must precede the grant.
REVOKE EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, uuid) TO authenticated, service_role;

DO $db1_tranche_a_postcondition$
DECLARE
  v_table_name text;
  v_function_oid oid;
BEGIN
  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_authority'
     ) IS DISTINCT FROM 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.employees')
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
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
     ) IS DISTINCT FROM
       ARRAY[
         'allow_anon_read_employees',
         'allow_authenticated_employees'
       ]::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_anon_read_employees'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'anon')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'allow_authenticated_employees'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND policy.polwithcheck IS NULL
     )
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'anon'
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'authenticated'
     ) IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR (
       SELECT COALESCE(
         array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
         ARRAY[]::text[]
       )
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND grantee_role.rolname = 'service_role'
     ) IS DISTINCT FROM
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
     OR NOT has_table_privilege('anon', 'public.employees', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR EXISTS (
       SELECT 1
       FROM pg_class relation
       CROSS JOIN LATERAL
         aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE relation.oid = to_regclass('public.employees')
         AND (
           acl.grantor <> relation.relowner
           OR acl.grantee = 0
           OR (
             acl.grantee <> relation.relowner
             AND COALESCE(grantee_role.rolname, '') NOT IN (
               'anon',
               'authenticated',
               'service_role'
             )
           )
           OR (
             acl.is_grantable
             AND acl.grantee <> relation.relowner
           )
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A postcondition: mobile employee identity authority changed';
  END IF;

  FOREACH v_table_name IN ARRAY
    ARRAY['automation_settings', 'email_suppressions']::text[]
  LOOP
    IF NOT EXISTS (
         SELECT 1
         FROM pg_class relation
         JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND relation.relkind = 'r'
           AND owner_role.rolname = 'postgres'
           AND relation.relrowsecurity
       )
       OR EXISTS (
         SELECT 1
         FROM pg_policy policy
         WHERE policy.polrelid =
               to_regclass(format('public.%I', v_table_name))
       )
       OR has_table_privilege(
            'anon',
            format('public.%I', v_table_name),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
       OR has_table_privilege(
            'authenticated',
            format('public.%I', v_table_name),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          )
       OR (
         SELECT COALESCE(
           array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
           ARRAY[]::text[]
         )
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND grantee_role.rolname = 'service_role'
       ) IS DISTINCT FROM
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
       OR EXISTS (
         SELECT 1
         FROM pg_class relation
         CROSS JOIN LATERAL
           aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
         LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         WHERE relation.oid =
               to_regclass(format('public.%I', v_table_name))
           AND (
             acl.grantor <> relation.relowner
             OR acl.grantee = 0
             OR (
               acl.grantee <> relation.relowner
               AND COALESCE(grantee_role.rolname, '') NOT IN ('service_role')
             )
             OR (
               acl.is_grantable
               AND acl.grantee <> relation.relowner
             )
           )
       )
       OR EXISTS (
         SELECT 1
         FROM pg_attribute attribute
         WHERE attribute.attrelid =
               to_regclass(format('public.%I', v_table_name))
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND attribute.attacl IS NOT NULL
           AND cardinality(attribute.attacl) > 0
       ) THEN
      RAISE EXCEPTION
        'DB-1 tranche A postcondition: %.% browser/service boundary failed',
        'public',
        v_table_name;
    END IF;
  END LOOP;

  SELECT procedure.oid
    INTO v_function_oid
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
  JOIN pg_language language_record ON language_record.oid = procedure.prolang
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'set_automation_setting'
    AND pg_get_function_identity_arguments(procedure.oid) =
          'p_key text, p_value boolean, p_org_id uuid'
    AND pg_get_function_result(procedure.oid) = 'automation_settings'
    AND owner_role.rolname = 'postgres'
    AND language_record.lanname = 'plpgsql'
    AND procedure.prosecdef
    AND procedure.provolatile = 'v'
    AND procedure.proconfig = ARRAY['search_path=public']::text[]
    AND procedure.prosrc LIKE
          '%NOT_AUTHORIZED: sms_sending_enabled is admin only%'
    AND procedure.prosrc LIKE '%NOT_AUTHORIZED: admin or office only%'
    AND procedure.prosrc LIKE '%automation_setting_changed%'
    AND procedure.prosrc LIKE '%auth.role() <> ''service_role''%'
    AND procedure.prosrc LIKE '%AND NOT is_external%';

  IF v_function_oid IS NULL
     OR (
       SELECT array_agg(
                CASE
                  WHEN acl.grantee = 0 THEN 'PUBLIC'
                  ELSE grantee_role.rolname
                END
                ORDER BY
                  CASE
                    WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE grantee_role.rolname
                  END
              )
       FROM pg_proc procedure
       CROSS JOIN LATERAL
         aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE procedure.oid = v_function_oid
         AND acl.privilege_type = 'EXECUTE'
     ) IS DISTINCT FROM
       ARRAY['authenticated', 'postgres', 'service_role']::text[]
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL
         aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
       WHERE procedure.oid = v_function_oid
         AND acl.privilege_type = 'EXECUTE'
         AND acl.is_grantable
     )
     OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(
          'authenticated',
          v_function_oid,
          'EXECUTE'
        )
     OR NOT has_function_privilege(
          'service_role',
          v_function_oid,
          'EXECUTE'
        ) THEN
    RAISE EXCEPTION
      'DB-1 tranche A postcondition: set_automation_setting gate/ACL failed';
  END IF;
END;
$db1_tranche_a_postcondition$;
