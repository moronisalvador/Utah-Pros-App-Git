-- ============================================================================
-- ROLLBACK: 20260726183409_inbound_lead_recording_source_boundary
-- ============================================================================
--
-- Restores the exact pre-S1e get_inbound_leads body, grants and broad
-- authenticated policy, copies raw provider URLs back to inbound_leads, and
-- removes the service-only source table. Applying this rollback deliberately
-- reopens browser/RPC scalar recording-source exposure. It cannot reconstruct
-- privacy-safe recording keys removed from raw_payload during forward apply.
--
-- This rollback is intentionally unsafe. The owner must explicitly opt in:
--   SET upr.allow_unsafe_s1e_rollback = 'on';

BEGIN;

DO $preflight$
DECLARE
  v_get oid := to_regprocedure('public.get_inbound_leads(integer)');
  v_upsert oid := to_regprocedure(
    'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)'
  );
BEGIN
  IF current_setting('upr.allow_unsafe_s1e_rollback', true)
       IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'Unsafe S1e rollback refused; owner must SET upr.allow_unsafe_s1e_rollback = on';
  END IF;

  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_containment'
     ) > 1
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
     ) IS DISTINCT FROM ARRAY['employees_self_identity_read']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'employees_self_identity_read'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) =
               'auth_user_id = auth.uid()'
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
     ) IS DISTINCT FROM ARRAY[]::text[]
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
     ) IS DISTINCT FROM ARRAY[]::text[]
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
     ) IS DISTINCT FROM ARRAY[
       'DELETE',
       'INSERT',
       'MAINTAIN',
       'REFERENCES',
       'SELECT',
       'TRIGGER',
       'TRUNCATE',
       'UPDATE'
     ]::text[]
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
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
     OR (
       SELECT array_agg(
                attribute.attname::text
                ORDER BY attribute.attname
              )
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND grantee_role.rolname = 'authenticated'
         AND acl.privilege_type = 'SELECT'
     ) IS DISTINCT FROM ARRAY[
       'auth_user_id',
       'id',
       'is_active',
       'is_external',
       'role'
     ]::text[]
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       JOIN pg_class relation ON relation.oid = attribute.attrelid
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND (
           acl.grantor <> relation.relowner
           OR grantee_role.rolname IS DISTINCT FROM 'authenticated'
           OR acl.privilege_type <> 'SELECT'
           OR attribute.attname NOT IN (
             'id',
             'auth_user_id',
             'role',
             'is_active',
             'is_external'
           )
           OR acl.is_grantable
         )
     ) THEN
    RAISE EXCEPTION
      'S1e rollback preflight employee identity containment is absent or drifted';
  END IF;

  IF to_regclass('public.inbound_lead_recording_sources') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid =
               to_regclass('public.inbound_lead_recording_sources')
         AND relation.relkind = 'r'
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND relation.relforcerowsecurity
         AND relation.relacl @>
             '{postgres=arwdDxtm/postgres,service_role=arwd/postgres}'::aclitem[]
         AND cardinality(relation.relacl) = 2
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid =
             to_regclass('public.inbound_lead_recording_sources')
     ) IS DISTINCT FROM
       ARRAY['inbound_lead_recording_sources_service_role_all']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid =
             to_regclass('public.inbound_lead_recording_sources')
         AND policy.polname =
               'inbound_lead_recording_sources_service_role_all'
         AND policy.polcmd = '*'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'service_role')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND pg_get_expr(policy.polwithcheck, policy.polrelid, true) = 'true'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.inbound_leads')
         AND relation.relkind = 'r'
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
         AND relation.relacl @>
             '{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}'::aclitem[]
         AND cardinality(relation.relacl) = 3
     )
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.inbound_leads')
     ) IS DISTINCT FROM
       ARRAY['inbound_leads_active_internal_select']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.inbound_leads')
         AND policy.polname = 'inbound_leads_active_internal_select'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND policy.polwithcheck IS NULL
         AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%auth.uid()%'
         AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%is_active = true%'
         AND pg_get_expr(policy.polqual, policy.polrelid) LIKE '%is_external = false%'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_publication_rel publication_relation
       WHERE publication_relation.prrelid IN (
         to_regclass('public.inbound_leads'),
         to_regclass('public.inbound_lead_recording_sources')
       )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_publication publication
       WHERE publication.puballtables
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid IN (
         to_regclass('public.inbound_leads'),
         to_regclass('public.inbound_lead_recording_sources')
       )
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     )
     OR (
       SELECT array_agg(trigger_record.tgname ORDER BY trigger_record.tgname)
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = to_regclass('public.inbound_leads')
         AND NOT trigger_record.tgisinternal
     ) IS DISTINCT FROM ARRAY[
       'protect_inbound_lead_recording_source',
       'sanitize_inbound_lead_recording_payload'
     ]::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = to_regclass('public.inbound_leads')
         AND trigger_record.tgname = 'protect_inbound_lead_recording_source'
         AND trigger_record.tgenabled = 'O'
         AND trigger_record.tgtype = 21
         AND trigger_record.tgfoid =
               to_regprocedure('public.protect_inbound_lead_recording_source()')
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = to_regclass('public.inbound_leads')
         AND trigger_record.tgname = 'sanitize_inbound_lead_recording_payload'
         AND trigger_record.tgenabled = 'O'
         AND trigger_record.tgtype = 23
         AND trigger_record.tgfoid =
               to_regprocedure('public.sanitize_inbound_lead_recording_payload()')
     )
  THEN
    RAISE EXCEPTION
      'S1e rollback preflight table/policy/trigger state is absent or drifted';
  END IF;

  IF v_get IS NULL
     OR md5((SELECT procedure.prosrc FROM pg_proc procedure
             WHERE procedure.oid = v_get))
          IS DISTINCT FROM 'f6456487bf2871ce343f0a82b508b584'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language ON language.oid = procedure.prolang
       JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = v_get
         AND language.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_arguments(procedure.oid) =
               'p_limit integer DEFAULT 100'
         AND pg_get_function_result(procedure.oid) = 'jsonb'
         AND procedure.prosecdef
         AND NOT procedure.proisstrict
         AND NOT procedure.proleakproof
         AND procedure.provolatile = 's'
         AND procedure.prokind = 'f'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
     )
     OR v_upsert IS NULL
     OR md5((SELECT procedure.prosrc FROM pg_proc procedure
             WHERE procedure.oid = v_upsert))
          IS DISTINCT FROM 'd5abd852ebe5c3dfa2e440f45d40c4b3'
     OR to_regprocedure('public.strip_recording_sources(jsonb)') IS NULL
     OR md5((
       SELECT procedure.prosrc
       FROM pg_proc procedure
       WHERE procedure.oid =
             to_regprocedure('public.strip_recording_sources(jsonb)')
     )) IS DISTINCT FROM '2a1f0ce38c9be975f82b87c0756da0eb'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language ON language.oid = procedure.prolang
       JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
             to_regprocedure('public.strip_recording_sources(jsonb)')
         AND language.lanname = 'sql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_result(procedure.oid) = 'jsonb'
         AND NOT procedure.prosecdef
         AND procedure.provolatile = 'i'
         AND procedure.prokind = 'f'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
     )
     OR to_regprocedure(
          'public.sanitize_inbound_lead_recording_payload()'
        ) IS NULL
     OR md5((
       SELECT procedure.prosrc
       FROM pg_proc procedure
       WHERE procedure.oid =
             to_regprocedure(
               'public.sanitize_inbound_lead_recording_payload()'
             )
     )) IS DISTINCT FROM 'a256cccfd36b0f81d7d258a5b6f6e779'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language ON language.oid = procedure.prolang
       JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
             to_regprocedure(
               'public.sanitize_inbound_lead_recording_payload()'
             )
         AND language.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_result(procedure.oid) = 'trigger'
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.prokind = 'f'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
     )
     OR to_regprocedure(
          'public.protect_inbound_lead_recording_source()'
        ) IS NULL
     OR md5((
       SELECT procedure.prosrc
       FROM pg_proc procedure
       WHERE procedure.oid =
             to_regprocedure(
               'public.protect_inbound_lead_recording_source()'
             )
     )) IS DISTINCT FROM '9bbf983b2d260cece45366a56732c564'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language ON language.oid = procedure.prolang
       JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
       WHERE procedure.oid =
             to_regprocedure(
               'public.protect_inbound_lead_recording_source()'
             )
         AND language.lanname = 'plpgsql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_result(procedure.oid) = 'trigger'
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.prokind = 'f'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
     )
     OR has_function_privilege('anon', v_get, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_get, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_get, 'EXECUTE')
     OR has_function_privilege('authenticated', v_upsert, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_upsert, 'EXECUTE')
     OR has_function_privilege(
          'authenticated',
          'public.strip_recording_sources(jsonb)',
          'EXECUTE'
        )
     OR NOT has_function_privilege(
          'service_role',
          'public.strip_recording_sources(jsonb)',
          'EXECUTE'
        )
     OR NOT has_function_privilege(
          'service_role',
          'public.sanitize_inbound_lead_recording_payload()',
          'EXECUTE'
        )
     OR NOT has_function_privilege(
          'service_role',
          'public.protect_inbound_lead_recording_source()',
          'EXECUTE'
        )
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL
         aclexplode(
           COALESCE(
             procedure.proacl,
             acldefault('f', procedure.proowner)
           )
         ) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE procedure.oid IN (
         v_get,
         v_upsert,
         to_regprocedure('public.strip_recording_sources(jsonb)'),
         to_regprocedure('public.sanitize_inbound_lead_recording_payload()'),
         to_regprocedure('public.protect_inbound_lead_recording_source()')
       )
         AND (
           acl.privilege_type <> 'EXECUTE'
           OR acl.grantor <> procedure.proowner
           OR acl.is_grantable
           OR acl.grantee = 0
           OR (
             acl.grantee <> procedure.proowner
             AND (
               COALESCE(grantee_role.rolname, '') NOT IN (
                 'authenticated',
                 'service_role'
               )
               OR (
                 procedure.oid <> v_get
                 AND grantee_role.rolname = 'authenticated'
               )
             )
           )
         )
     )
     OR has_function_privilege(
          'authenticated',
          'public.sanitize_inbound_lead_recording_payload()',
          'EXECUTE'
        )
     OR has_function_privilege(
          'authenticated',
          'public.protect_inbound_lead_recording_source()',
          'EXECUTE'
        )
     OR EXISTS (
       SELECT 1
       FROM public.inbound_leads lead
       LEFT JOIN public.inbound_lead_recording_sources source
         ON source.lead_id = lead.id
       WHERE (
         lead.recording_url IS NOT NULL
         AND lead.recording_url <> 'upr-recording://available'
       )
       OR (
         COALESCE(
           lead.recording_url = 'upr-recording://available',
           false
         )
         IS DISTINCT FROM (source.lead_id IS NOT NULL)
       )
     )
     OR EXISTS (
       SELECT 1
       FROM public.inbound_leads
       WHERE raw_payload IS DISTINCT FROM
             public.strip_recording_sources(raw_payload)
     ) THEN
    RAISE EXCEPTION
      'S1e rollback preflight function/ACL/data state drift';
  END IF;
END
$preflight$;

DROP TRIGGER protect_inbound_lead_recording_source ON public.inbound_leads;
DROP FUNCTION public.protect_inbound_lead_recording_source();
DROP TRIGGER sanitize_inbound_lead_recording_payload ON public.inbound_leads;
DROP FUNCTION public.sanitize_inbound_lead_recording_payload();

UPDATE public.inbound_leads il
SET recording_url = src.recording_url
FROM public.inbound_lead_recording_sources src
WHERE src.lead_id = il.id;

CREATE OR REPLACE FUNCTION public.get_inbound_leads(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at DESC NULLS LAST, t.created_at DESC),
    '[]'::jsonb
  )
  FROM (
    SELECT il.*,
      CASE WHEN c.id IS NOT NULL
        THEN jsonb_build_object('name', c.name, 'phone', c.phone)
        ELSE NULL
      END AS contact
    FROM inbound_leads il
    LEFT JOIN contacts c ON c.id = il.contact_id
    ORDER BY il.occurred_at DESC NULLS LAST, il.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_inbound_leads(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inbound_leads(integer)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(
  text, text, text, text, integer, boolean, text, text, text, text, text,
  jsonb, text, numeric, text, timestamptz, jsonb, uuid
) TO authenticated, service_role;

DROP POLICY inbound_leads_active_internal_select ON public.inbound_leads;
CREATE POLICY inbound_leads_all
ON public.inbound_leads
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

GRANT ALL ON TABLE public.inbound_leads TO anon, authenticated;
DROP TABLE public.inbound_lead_recording_sources;
DROP FUNCTION public.strip_recording_sources(jsonb);

DO $postcondition$
DECLARE
  v_oid oid := 'public.get_inbound_leads(integer)'::regprocedure::oid;
  v_upsert oid :=
    'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)'::regprocedure::oid;
BEGIN
  IF (
       SELECT count(*)
       FROM supabase_migrations.schema_migrations migration
       WHERE migration.name = 'mobile_employee_identity_containment'
     ) > 1
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
     ) IS DISTINCT FROM ARRAY['employees_self_identity_read']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.employees')
         AND policy.polname = 'employees_self_identity_read'
         AND policy.polcmd = 'r'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) =
               'auth_user_id = auth.uid()'
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
     ) IS DISTINCT FROM ARRAY[]::text[]
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
     ) IS DISTINCT FROM ARRAY[]::text[]
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
     ) IS DISTINCT FROM ARRAY[
       'DELETE',
       'INSERT',
       'MAINTAIN',
       'REFERENCES',
       'SELECT',
       'TRIGGER',
       'TRUNCATE',
       'UPDATE'
     ]::text[]
     OR has_table_privilege('anon', 'public.employees', 'SELECT')
     OR has_table_privilege(
          'anon',
          'public.employees',
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
        )
     OR has_table_privilege(
          'authenticated',
          'public.employees',
          'SELECT'
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
     OR (
       SELECT array_agg(
                attribute.attname::text
                ORDER BY attribute.attname
              )
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND grantee_role.rolname = 'authenticated'
         AND acl.privilege_type = 'SELECT'
     ) IS DISTINCT FROM ARRAY[
       'auth_user_id',
       'id',
       'is_active',
       'is_external',
       'role'
     ]::text[]
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       JOIN pg_class relation ON relation.oid = attribute.attrelid
       WHERE attribute.attrelid = to_regclass('public.employees')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND (
           acl.grantor <> relation.relowner
           OR grantee_role.rolname IS DISTINCT FROM 'authenticated'
           OR acl.privilege_type <> 'SELECT'
           OR attribute.attname NOT IN (
             'id',
             'auth_user_id',
             'role',
             'is_active',
             'is_external'
           )
           OR acl.is_grantable
         )
     ) THEN
    RAISE EXCEPTION
      'S1e rollback postcondition employee identity containment changed';
  END IF;

  IF md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_oid))
       IS DISTINCT FROM '8e9119ed1af57bd45c6af4ed227ef38f'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_proc procedure
       JOIN pg_language language ON language.oid = procedure.prolang
       JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
       WHERE procedure.oid = v_oid
         AND language.lanname = 'sql'
         AND owner_role.rolname = 'postgres'
         AND pg_get_function_arguments(procedure.oid) =
               'p_limit integer DEFAULT 100'
         AND pg_get_function_result(procedure.oid) = 'jsonb'
         AND procedure.prosecdef
         AND NOT procedure.proisstrict
         AND NOT procedure.proleakproof
         AND procedure.provolatile = 's'
         AND procedure.prokind = 'f'
         AND procedure.proconfig = ARRAY['search_path=public']::text[]
     )
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR md5((SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_upsert))
          IS DISTINCT FROM 'd5abd852ebe5c3dfa2e440f45d40c4b3'
     OR has_function_privilege('anon', v_upsert, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_upsert, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_upsert, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL
         aclexplode(
           COALESCE(
             procedure.proacl,
             acldefault('f', procedure.proowner)
           )
         ) acl
       LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
       WHERE procedure.oid IN (v_oid, v_upsert)
         AND (
           acl.privilege_type <> 'EXECUTE'
           OR acl.grantor <> procedure.proowner
           OR acl.is_grantable
           OR acl.grantee = 0
           OR (
             acl.grantee <> procedure.proowner
             AND COALESCE(grantee_role.rolname, '') NOT IN (
               'authenticated',
               'service_role'
             )
           )
         )
     )
     OR to_regclass('public.inbound_lead_recording_sources') IS NOT NULL
     OR to_regprocedure('public.strip_recording_sources(jsonb)') IS NOT NULL
     OR to_regprocedure(
          'public.sanitize_inbound_lead_recording_payload()'
        ) IS NOT NULL
     OR to_regprocedure(
          'public.protect_inbound_lead_recording_source()'
        ) IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = to_regclass('public.inbound_leads')
         AND NOT trigger_record.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
       WHERE relation.oid = to_regclass('public.inbound_leads')
         AND relation.relkind = 'r'
         AND owner_role.rolname = 'postgres'
         AND relation.relrowsecurity
         AND NOT relation.relforcerowsecurity
         AND relation.relacl @>
             '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'::aclitem[]
         AND cardinality(relation.relacl) = 4
     )
     OR NOT has_table_privilege('anon', 'public.inbound_leads', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.inbound_leads', 'INSERT')
     OR (
       SELECT array_agg(policy.polname ORDER BY policy.polname)
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.inbound_leads')
     ) IS DISTINCT FROM ARRAY['inbound_leads_all']::name[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = to_regclass('public.inbound_leads')
         AND policy.polname = 'inbound_leads_all'
         AND policy.polcmd = '*'
         AND policy.polpermissive
         AND policy.polroles =
               ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
         AND pg_get_expr(policy.polqual, policy.polrelid, true) = 'true'
         AND pg_get_expr(policy.polwithcheck, policy.polrelid, true) = 'true'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_publication_rel publication_relation
       WHERE publication_relation.prrelid =
             to_regclass('public.inbound_leads')
     )
     OR EXISTS (
       SELECT 1
       FROM pg_publication publication
       WHERE publication.puballtables
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attribute attribute
       WHERE attribute.attrelid = to_regclass('public.inbound_leads')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND cardinality(attribute.attacl) > 0
     )
     OR EXISTS (
       SELECT 1
       FROM public.inbound_leads
       WHERE recording_url = 'upr-recording://available'
     )
  THEN
    RAISE EXCEPTION 'S1e rollback postcondition failed';
  END IF;
END
$postcondition$;

COMMIT;
