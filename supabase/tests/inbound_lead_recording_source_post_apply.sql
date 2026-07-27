-- Catalog-only S1e post-apply proof. This does not select lead or recording values.
DO $employee_identity_post_apply$
BEGIN
  ASSERT (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations migration
    WHERE migration.name = 'mobile_employee_identity_containment'
  ) = 1,
    'S1e requires exactly one employee identity containment ledger entry';
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
    'S1e post-apply employee owner/RLS dependency drift';
  ASSERT EXISTS (
    SELECT 1
    FROM pg_roles role_record
    WHERE role_record.rolname = 'service_role'
      AND role_record.rolbypassrls
  ),
    'S1e post-apply service role dependency drift';
  ASSERT (
    SELECT array_agg(policy.polname ORDER BY policy.polname)
    FROM pg_policy policy
    WHERE policy.polrelid = to_regclass('public.employees')
  ) = ARRAY['employees_self_identity_read']::name[],
    'S1e post-apply employee policy set drift';
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
            '(auth_user_id = auth.uid())'
      AND policy.polwithcheck IS NULL
  ),
    'S1e post-apply authenticated employee read policy drift';
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
    'S1e post-apply anonymous employee ACL drift';
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
    'S1e post-apply authenticated employee ACL drift';
  ASSERT NOT has_table_privilege('anon', 'public.employees', 'SELECT'),
    'S1e post-apply anonymous effective employee privilege drift';
  ASSERT NOT has_table_privilege(
    'authenticated',
    'public.employees',
    'SELECT'
  ),
    'S1e post-apply authenticated table-level employee SELECT drift';
  ASSERT NOT has_table_privilege(
    'anon',
    'public.employees',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
  ),
    'S1e post-apply anonymous inherited employee write privilege drift';
  ASSERT NOT has_table_privilege(
    'authenticated',
    'public.employees',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
  ),
    'S1e post-apply authenticated inherited employee write privilege drift';
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
    'S1e post-apply service-role employee ACL drift';
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
    'S1e post-apply employee PUBLIC/grant-option ACL drift';
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
  ) = ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[],
    'S1e post-apply authenticated employee column SELECT drift';
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
          'is_active'
        )
        OR acl.is_grantable
      )
  ),
    'S1e post-apply unexpected employee column ACL drift';
END
$employee_identity_post_apply$;

DO $test$
DECLARE
  v_get oid := to_regprocedure('public.get_inbound_leads(integer)');
  v_upsert oid := to_regprocedure(
    'public.upsert_lead_from_callrail(text,text,text,text,integer,boolean,text,text,text,text,text,jsonb,text,numeric,text,timestamptz,jsonb,uuid)'
  );
BEGIN
  ASSERT to_regclass('public.inbound_lead_recording_sources') IS NOT NULL;
  ASSERT NOT has_table_privilege('anon', 'public.inbound_leads', 'SELECT');
  ASSERT has_table_privilege('authenticated', 'public.inbound_leads', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.inbound_leads', 'INSERT');
  ASSERT NOT has_table_privilege('authenticated', 'public.inbound_leads', 'MAINTAIN');
  ASSERT NOT has_table_privilege('authenticated', 'public.inbound_lead_recording_sources', 'SELECT');
  ASSERT has_table_privilege('service_role', 'public.inbound_lead_recording_sources', 'SELECT');
  ASSERT NOT has_function_privilege('anon', v_get, 'EXECUTE');
  ASSERT has_function_privilege('authenticated', v_get, 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', v_upsert, 'EXECUTE');
  ASSERT has_function_privilege('service_role', v_upsert, 'EXECUTE');
  ASSERT md5((SELECT procedure.prosrc FROM pg_proc procedure
              WHERE procedure.oid = v_get))
    = 'f6456487bf2871ce343f0a82b508b584';
  ASSERT md5((SELECT procedure.prosrc FROM pg_proc procedure
              WHERE procedure.oid = v_upsert))
    = 'd5abd852ebe5c3dfa2e440f45d40c4b3';
  ASSERT EXISTS (
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
  );
  ASSERT EXISTS (
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
  );
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel publication_relation
    WHERE publication_relation.prrelid IN (
      to_regclass('public.inbound_leads'),
      to_regclass('public.inbound_lead_recording_sources')
    )
  );
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_publication publication
    WHERE publication.puballtables
  );
  ASSERT NOT EXISTS (
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
  );
  ASSERT (
    SELECT array_agg(policy.polname ORDER BY policy.polname)
    FROM pg_policy policy
    WHERE policy.polrelid = to_regclass('public.inbound_leads')
  ) = ARRAY['inbound_leads_active_internal_select']::name[];
  ASSERT NOT EXISTS (
    SELECT 1
    FROM pg_policy policy
    WHERE policy.polrelid =
          to_regclass('public.inbound_lead_recording_sources')
  );
  ASSERT (
    SELECT array_agg(trigger_record.tgname ORDER BY trigger_record.tgname)
    FROM pg_trigger trigger_record
    WHERE trigger_record.tgrelid = to_regclass('public.inbound_leads')
      AND NOT trigger_record.tgisinternal
  ) = ARRAY[
    'protect_inbound_lead_recording_source',
    'sanitize_inbound_lead_recording_payload'
  ]::name[];
  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.inbound_leads'::regclass
      AND NOT t.tgisinternal
      AND t.tgname = 'sanitize_inbound_lead_recording_payload'
      AND t.tgenabled = 'O'
      AND t.tgtype = 23
      AND t.tgfoid =
            to_regprocedure('public.sanitize_inbound_lead_recording_payload()')
  );
  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.inbound_leads'::regclass
      AND NOT t.tgisinternal
      AND t.tgname = 'protect_inbound_lead_recording_source'
      AND t.tgenabled = 'O'
      AND t.tgtype = 21
      AND t.tgfoid =
            to_regprocedure('public.protect_inbound_lead_recording_source()')
  );
  ASSERT md5((
    SELECT procedure.prosrc
    FROM pg_proc procedure
    WHERE procedure.oid =
          to_regprocedure('public.strip_recording_sources(jsonb)')
  )) = '2a1f0ce38c9be975f82b87c0756da0eb';
  ASSERT md5((
    SELECT procedure.prosrc
    FROM pg_proc procedure
    WHERE procedure.oid =
          to_regprocedure('public.sanitize_inbound_lead_recording_payload()')
  )) = 'a256cccfd36b0f81d7d258a5b6f6e779';
  ASSERT md5((
    SELECT procedure.prosrc
    FROM pg_proc procedure
    WHERE procedure.oid =
          to_regprocedure('public.protect_inbound_lead_recording_source()')
  )) = '9bbf983b2d260cece45366a56732c564';
END
$test$;
