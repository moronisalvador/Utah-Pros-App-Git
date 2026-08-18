-- ════════════════════════════════════════════════
-- MIGRATION: 20260803221500_notification_activation_prerequisites
-- Phase: MOB-PUSH-017 appointment-reminder activation prerequisites
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES:
--   Adds the three covering indexes required before the five guarded notification
--   producer tables reach Production. It also removes unused browser table ACLs
--   from three RLS/no-policy secret stores. RLS remains enabled and the existing
--   service-role access remains unchanged.
--
-- DEPENDS ON:
--   20260801215912_notification_producer_authorization
--
-- SAFETY:
--   Additive indexes plus privilege revocation only. No notification flag, cron,
--   provider, business row, or secret value is changed.
--
-- ROLLBACK:
--   The paired rollback drops only these indexes and deliberately retains the
--   least-privilege secret-table revocations.
-- ════════════════════════════════════════════════

DO $preflight$
DECLARE
  v_table text;
BEGIN
  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL THEN
    RAISE EXCEPTION
      'notification activation prerequisites: producer tables missing';
  END IF;

  IF to_regclass('public.notification_producer_occurrences_type_key_idx') IS NOT NULL
     OR to_regclass('public.notification_delivery_claims_event_idx') IS NOT NULL
     OR to_regclass('public.notification_delivery_claims_employee_idx') IS NOT NULL THEN
    RAISE EXCEPTION
      'notification activation prerequisites: candidate index already exists';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.notification_producer_occurrences'::regclass
         AND conname = 'notification_producer_occurrences_type_key_fkey'
         AND pg_get_constraintdef(oid) =
           'FOREIGN KEY (type_key) REFERENCES notification_types(type_key)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.notification_delivery_claims'::regclass
         AND conname = 'notification_delivery_claims_notification_event_id_fkey'
         AND pg_get_constraintdef(oid) =
           'FOREIGN KEY (notification_event_id) REFERENCES notification_producer_occurrences(id) ON DELETE CASCADE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.notification_delivery_claims'::regclass
         AND conname = 'notification_delivery_claims_employee_id_fkey'
         AND pg_get_constraintdef(oid) =
           'FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE'
     ) THEN
    RAISE EXCEPTION
      'notification activation prerequisites: producer foreign-key drift';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'billing_2fa_codes',
    'integration_config',
    'user_google_accounts'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION
        'notification activation prerequisites: %.% missing',
        'public',
        v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class table_record
      WHERE table_record.oid = to_regclass('public.' || v_table)
        AND pg_get_userbyid(table_record.relowner) = 'postgres'
        AND table_record.relrowsecurity
    ) OR EXISTS (
      SELECT 1
      FROM pg_policy
      WHERE polrelid = to_regclass('public.' || v_table)
    ) THEN
      RAISE EXCEPTION
        'notification activation prerequisites: secret-table boundary drift for %',
        v_table;
    END IF;

    IF NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'SELECT'
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'INSERT'
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'UPDATE'
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'DELETE'
       ) THEN
      RAISE EXCEPTION
        'notification activation prerequisites: service access drift for %',
        v_table;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE INDEX notification_producer_occurrences_type_key_idx
  ON public.notification_producer_occurrences(type_key);
CREATE INDEX notification_delivery_claims_event_idx
  ON public.notification_delivery_claims(notification_event_id);
CREATE INDEX notification_delivery_claims_employee_idx
  ON public.notification_delivery_claims(employee_id);

REVOKE ALL PRIVILEGES ON TABLE
  public.billing_2fa_codes,
  public.integration_config,
  public.user_google_accounts
FROM PUBLIC, anon, authenticated;

DO $postflight$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'notification_producer_occurrences'
         AND indexname = 'notification_producer_occurrences_type_key_idx'
         AND indexdef =
           'CREATE INDEX notification_producer_occurrences_type_key_idx ON public.notification_producer_occurrences USING btree (type_key)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'notification_delivery_claims'
         AND indexname = 'notification_delivery_claims_event_idx'
         AND indexdef =
           'CREATE INDEX notification_delivery_claims_event_idx ON public.notification_delivery_claims USING btree (notification_event_id)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'notification_delivery_claims'
         AND indexname = 'notification_delivery_claims_employee_idx'
         AND indexdef =
           'CREATE INDEX notification_delivery_claims_employee_idx ON public.notification_delivery_claims USING btree (employee_id)'
     ) THEN
    RAISE EXCEPTION
      'notification activation prerequisites: covering-index postflight failed';
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
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'SELECT'
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'INSERT'
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'UPDATE'
       )
       OR NOT has_table_privilege(
         'service_role',
         to_regclass('public.' || v_table),
         'DELETE'
       ) THEN
      RAISE EXCEPTION
        'notification activation prerequisites: secret-table ACL postflight failed for %',
        v_table;
    END IF;
  END LOOP;
END;
$postflight$;
