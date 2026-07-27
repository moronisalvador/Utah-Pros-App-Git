-- Mobile S1d notify_emit boundary — read-only apply-window preflight
--
-- Run immediately before the separately authorized shared-production apply. This selects catalog
-- metadata only. It does not invoke notify_emit, pg_net, a trigger, a provider, or a schedule, and
-- it does not read notification, customer, configuration, secret, or response contents.

WITH target AS (
  SELECT
    p.oid,
    n.nspname AS schema_name,
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS result_type,
    l.lanname AS language,
    owner_role.rolname AS owner,
    p.prosecdef AS security_definer,
    p.proisstrict AS strict,
    p.proleakproof AS leakproof,
    p.provolatile AS volatility,
    p.proparallel AS parallel,
    p.prokind AS kind,
    p.proconfig,
    p.proacl,
    md5(p.prosrc) AS body_md5,
    md5(pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  JOIN pg_roles owner_role ON owner_role.oid = p.proowner
  WHERE n.nspname = 'public'
    AND p.proname = 'notify_emit'
)
SELECT
  schema_name,
  proname,
  identity_arguments,
  result_type,
  language,
  owner,
  security_definer,
  strict,
  leakproof,
  volatility,
  parallel,
  kind,
  proconfig,
  proacl,
  body_md5,
  definition_md5,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', oid, 'EXECUTE') AS service_role_can_execute
FROM target;

WITH target AS (
  SELECT p.oid, p.proowner, p.proacl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'notify_emit'
    AND pg_get_function_identity_arguments(p.oid) = 'p_type_key text, p_body jsonb'
)
SELECT
  COALESCE(grantee_role.rolname, 'PUBLIC') AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM target
CROSS JOIN LATERAL
  aclexplode(COALESCE(target.proacl, acldefault('f', target.proowner))) acl
LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
ORDER BY grantee, acl.privilege_type;

SELECT
  p.oid::regprocedure::text AS caller,
  owner_role.rolname AS owner,
  p.prosecdef AS security_definer,
  p.proconfig,
  md5(p.prosrc) AS body_md5,
  regexp_count(
    p.prosrc,
    E'\\mnotify_emit[[:space:]]*\\('
  ) AS notify_emit_call_sites
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles owner_role ON owner_role.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.prosrc ~ E'\\mnotify_emit[[:space:]]*\\('
ORDER BY caller;

SELECT
  t.tgname AS trigger_name,
  relation.oid::regclass::text AS relation,
  t.tgfoid::regprocedure::text AS trigger_function,
  t.tgenabled,
  t.tgtype::integer AS trigger_type,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class relation ON relation.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgfoid IN (
    to_regprocedure('public.trg_appt_crew_notify()'),
    to_regprocedure('public.trg_appt_notify()'),
    to_regprocedure('public.trg_estimate_accepted_notify()')
  )
ORDER BY trigger_name;

SELECT
  jobid,
  jobname,
  schedule,
  command,
  username,
  active
FROM cron.job
WHERE jobname = 'upr_scan_abandoned_clocks';

SELECT
  version,
  name,
  cardinality(statements) AS statement_count,
  md5(array_to_string(statements, E'\n')) AS statements_md5
FROM supabase_migrations.schema_migrations
WHERE EXISTS (
  SELECT 1
  FROM unnest(statements) statement
  WHERE statement ILIKE '%notify_emit%'
)
ORDER BY version;
