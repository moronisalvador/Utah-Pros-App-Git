-- UPR security drift check. #1,#2,#4 should return ZERO rows; #3 zero.
SELECT 'anon_table_policy' chk, tablename, policyname FROM pg_policies WHERE schemaname='public' AND 'anon'=ANY(roles);
SELECT 'anon_grant' chk, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public';
SELECT 'secdef_no_searchpath' chk, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'::text[])) c WHERE c LIKE 'search_path=%');
SELECT 'anon_storage_policy' chk, policyname FROM pg_policies WHERE schemaname='storage' AND 'anon'=ANY(roles);
