-- Catalog-only S1e apply-window preflight. This does not select lead or recording values.
DO $test$
DECLARE
  v_get oid;
  v_upsert oid;
BEGIN
  ASSERT (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'mobile_employee_identity_containment'
  ) <= 1,
    'S1e refuses duplicate employee identity containment ledger entries';
  ASSERT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = to_regclass('public.employees')
      AND relation.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ),
    'S1e employee owner/RLS dependency drift';
  ASSERT EXISTS (
    SELECT 1
    FROM pg_roles role_record
    WHERE role_record.rolname = 'service_role'
      AND role_record.rolbypassrls
  ),
    'S1e service role dependency drift';
  ASSERT (
    SELECT array_agg(policy.polname ORDER BY policy.polname)
    FROM pg_policy policy
    WHERE policy.polrelid = to_regclass('public.employees')
  ) = ARRAY['employees_self_identity_read']::name[],
    'S1e employee policy set drift';
  ASSERT EXISTS (
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
  ),
    'S1e authenticated employee read policy drift';
  ASSERT (
    SELECT COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
      ARRAY[]::text[]
    )
    FROM pg_class relation
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          relation.relacl,
          acldefault('r', relation.relowner)
        )
      ) acl
    JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE relation.oid = to_regclass('public.employees')
      AND grantee_role.rolname = 'anon'
  ) = ARRAY[]::text[],
    'S1e anonymous employee ACL drift';
  ASSERT (
    SELECT COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
      ARRAY[]::text[]
    )
    FROM pg_class relation
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          relation.relacl,
          acldefault('r', relation.relowner)
        )
      ) acl
    JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE relation.oid = to_regclass('public.employees')
      AND grantee_role.rolname = 'authenticated'
  ) = ARRAY[]::text[],
    'S1e authenticated employee ACL drift';
  ASSERT NOT has_table_privilege('anon', 'public.employees', 'SELECT'),
    'S1e anonymous effective employee privilege drift';
  ASSERT NOT has_table_privilege(
    'authenticated',
    'public.employees',
    'SELECT'
  ),
    'S1e authenticated table-level employee SELECT drift';
  ASSERT NOT has_table_privilege(
    'anon',
    'public.employees',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
  ),
    'S1e anonymous inherited employee write privilege drift';
  ASSERT NOT has_table_privilege(
    'authenticated',
    'public.employees',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
  ),
    'S1e authenticated inherited employee write privilege drift';
  ASSERT (
    SELECT COALESCE(
      array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type),
      ARRAY[]::text[]
    )
    FROM pg_class relation
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          relation.relacl,
          acldefault('r', relation.relowner)
        )
      ) acl
    JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE relation.oid = to_regclass('public.employees')
      AND grantee_role.rolname = 'service_role'
  ) = ARRAY[
    'DELETE',
    'INSERT',
    'MAINTAIN',
    'REFERENCES',
    'SELECT',
    'TRIGGER',
    'TRUNCATE',
    'UPDATE'
  ]::text[],
    'S1e service-role employee ACL drift';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    CROSS JOIN LATERAL
      aclexplode(
        COALESCE(
          relation.relacl,
          acldefault('r', relation.relowner)
        )
      ) acl
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
  ),
    'S1e employee PUBLIC/grant-option ACL drift';
  ASSERT (
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
  ) = ARRAY[
    'auth_user_id',
    'id',
    'is_active',
    'is_external',
    'role'
  ]::text[],
    'S1e authenticated employee column SELECT drift';
  ASSERT NOT EXISTS (
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
  ),
    'S1e unexpected employee column ACL drift';

  v_get := to_regprocedure('public.get_inbound_leads(integer)');
  v_upsert := to_regprocedure(
    'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)'
  );

  ASSERT v_get IS NOT NULL;
  ASSERT md5((SELECT prosrc FROM pg_proc WHERE oid = v_get))
    = '8e9119ed1af57bd45c6af4ed227ef38f';
  ASSERT NOT has_function_privilege('anon', v_get, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', v_get, 'EXECUTE');
  ASSERT v_upsert IS NOT NULL;
  ASSERT md5((SELECT prosrc FROM pg_proc WHERE oid = v_upsert))
    = 'd5abd852ebe5c3dfa2e440f45d40c4b3';
  ASSERT has_function_privilege('authenticated', v_upsert, 'EXECUTE');
  ASSERT to_regclass('public.inbound_lead_recording_sources') IS NULL;
  ASSERT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_roles owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = to_regclass('public.inbound_leads')
      AND relation.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND relation.relacl IS NOT DISTINCT FROM
          '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'::aclitem[]
  ),
    'S1e inbound_leads owner/RLS/ACL precondition drift';
  ASSERT (
    SELECT array_agg(policy.polname ORDER BY policy.polname)
    FROM pg_policy policy
    WHERE policy.polrelid = to_regclass('public.inbound_leads')
  ) = ARRAY['inbound_leads_all']::name[],
    'S1e inbound_leads precondition policy set drift';
  ASSERT EXISTS (
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
  ),
    'S1e inbound_leads precondition policy drift';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid = to_regclass('public.inbound_leads')
      AND NOT trigger_record.tgisinternal
  ),
    'S1e inbound_leads precondition trigger drift';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel publication_relation
    WHERE publication_relation.prrelid =
          to_regclass('public.inbound_leads')
  ),
    'S1e refuses a transient raw recording URL on a published inbound_leads table';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_publication publication
    WHERE publication.puballtables
  ),
    'S1e refuses a transient raw recording URL under an all-tables publication';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass('public.inbound_leads')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
      AND cardinality(attribute.attacl) > 0
  ),
    'S1e inbound_leads column ACL drift';
END
$test$;
