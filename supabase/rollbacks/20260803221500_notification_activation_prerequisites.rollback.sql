-- Recovery for 20260803221500_notification_activation_prerequisites.
-- The secret-table ACL tightening is intentionally retained fail-closed.

DROP INDEX IF EXISTS public.notification_delivery_claims_employee_idx;
DROP INDEX IF EXISTS public.notification_delivery_claims_event_idx;
DROP INDEX IF EXISTS public.notification_producer_occurrences_type_key_idx;

REVOKE ALL PRIVILEGES ON TABLE
  public.billing_2fa_codes,
  public.integration_config,
  public.user_google_accounts
FROM PUBLIC, anon, authenticated;

DO $postflight$
DECLARE
  v_table text;
BEGIN
  IF to_regclass('public.notification_delivery_claims_employee_idx') IS NOT NULL
     OR to_regclass('public.notification_delivery_claims_event_idx') IS NOT NULL
     OR to_regclass('public.notification_producer_occurrences_type_key_idx') IS NOT NULL THEN
    RAISE EXCEPTION
      'notification activation prerequisites rollback: index removal failed';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'billing_2fa_codes',
    'integration_config',
    'user_google_accounts'
  ]
  LOOP
    IF EXISTS (
         SELECT 1
         FROM pg_class table_record
         CROSS JOIN LATERAL aclexplode(
           COALESCE(
             table_record.relacl,
             acldefault('r', table_record.relowner)
           )
         ) acl
         WHERE table_record.oid = to_regclass('public.' || v_table)
           AND acl.grantee = 0
           AND acl.privilege_type IN (
             'SELECT',
             'INSERT',
             'UPDATE',
             'DELETE',
             'TRUNCATE',
             'REFERENCES',
             'TRIGGER'
           )
       )
       OR has_table_privilege(
         'anon',
         to_regclass('public.' || v_table),
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       OR has_table_privilege(
         'authenticated',
         to_regclass('public.' || v_table),
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       OR EXISTS (
         SELECT 1
         FROM pg_attribute column_record
         CROSS JOIN LATERAL aclexplode(column_record.attacl) acl
         WHERE column_record.attrelid = to_regclass('public.' || v_table)
           AND column_record.attnum > 0
           AND NOT column_record.attisdropped
           AND column_record.attacl IS NOT NULL
           AND acl.grantee IN (
             0,
             to_regrole('anon')::oid,
             to_regrole('authenticated')::oid
           )
           AND acl.privilege_type IN (
             'SELECT',
             'INSERT',
             'UPDATE',
             'REFERENCES'
           )
       ) THEN
      RAISE EXCEPTION
        'notification activation prerequisites rollback: secret-table ACL drift for %',
        v_table;
    END IF;
  END LOOP;
END;
$postflight$;
