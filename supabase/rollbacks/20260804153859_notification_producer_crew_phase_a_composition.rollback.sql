-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: 20260804153859_notification_producer_crew_phase_a_composition
-- Phase: Mobile readiness — notification producer / crew Phase-A composition
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Contains the five still-disabled notification producers if their composed
--   successor must be withdrawn. It turns every producer catalog flag off,
--   revokes the producer emit/claim/write capabilities, and retains the two
--   durable ledgers as service-role read-only forensic evidence.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   This is not the older M1 rollback. It never restores its pre-Phase-A crew
--   RPC, policy, grant, or actor model. The live atomic
--   sync_appointment_crew(uuid,jsonb) overload, its service-only explicit
--   actor overload, Phase-A appointment/crew RLS, immutable audit trigger,
--   and narrowly guarded legacy installed-client DML bridge remain exactly as
--   they were. Phase B is a separately adoption-gated revocation and is not
--   smuggled into this recovery path.
--
-- RECOVERY POSTURE:
--   Idempotent and fail closed. This rollback intentionally leaves the
--   generic service-only notify_emit transport intact for non-producer callers;
--   producer emission is made inert by disabled flags and its own direct
--   capability revoke. Reapplication of the reviewed forward composition is
--   required to resume producer claims or emission.
-- ═══════════════════════════════════════════════════════════════════════════

DO $composition_rollback_preflight$
DECLARE
  v_required constant text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ]::text[];
  v_function oid;
BEGIN
  -- The marker is deliberately on notify_emit, which the forward composition
  -- owns without changing its existing signature. Refuse a partial/foreign
  -- rollout instead of attempting a best-effort rollback.
  IF to_regprocedure('public.notify_emit(text,jsonb)') IS NULL
     OR COALESCE(
          obj_description(
            to_regprocedure('public.notify_emit(text,jsonb)'),
            'pg_proc'
          ),
          ''
        ) NOT LIKE 'UPR notification producer/crew Phase-A composition v1:%' THEN
    RAISE EXCEPTION
      'notification/crew composition recovery refused: exact composition marker absent'
      USING ERRCODE = '55000';
  END IF;

  -- Preserve Phase-A as an independently owned, live compatibility contract.
  -- These assertions also make an accidental use of the historical M1 crew
  -- body fail before any notification containment action occurs.
  IF to_regprocedure('public.sync_appointment_crew(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.sync_appointment_crew(uuid,jsonb,uuid)') IS NULL
     OR to_regprocedure('public.audit_appointment_crew_change()') IS NULL
     OR COALESCE(
          obj_description(
            to_regprocedure('public.sync_appointment_crew(uuid,jsonb)'),
            'pg_proc'
          ),
          ''
        ) NOT LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     OR COALESCE(
          obj_description(
            to_regprocedure('public.sync_appointment_crew(uuid,jsonb,uuid)'),
            'pg_proc'
          ),
          ''
        ) NOT LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     OR COALESCE(
          obj_description(
            to_regprocedure('public.audit_appointment_crew_change()'),
            'pg_proc'
          ),
          ''
        ) NOT LIKE 'UPR appointment crew atomic save/audit repair v1:%'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = 'public.appointment_crew'::regclass
         AND trigger_record.tgname = 'trg_appointment_crew_actor_audit'
         AND trigger_record.tgfoid =
           to_regprocedure('public.audit_appointment_crew_change()')
         AND trigger_record.tgenabled = 'O'
         AND NOT trigger_record.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger trigger_record
       WHERE trigger_record.tgrelid = 'public.appointments'::regclass
         AND trigger_record.tgname = 'trg_appointments_atomic_command_guard'
         AND trigger_record.tgfoid =
           to_regprocedure('public.guard_appointment_command_write()')
         AND trigger_record.tgenabled = 'O'
         AND NOT trigger_record.tgisinternal
     )
     OR EXISTS (
       SELECT 1
       FROM pg_policies policy_record
       WHERE policy_record.schemaname = 'public'
         AND policy_record.tablename IN ('appointments', 'appointment_crew')
         AND 'anon'::name = ANY (policy_record.roles)
     )
     -- Phase A explicitly retained this temporary installed-client bridge.
     -- Assert it before snapshotting so a prior accidental Phase-B revocation
     -- cannot be misreported as a successful notification-only rollback.
     OR NOT has_table_privilege('authenticated', 'public.appointments', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.appointments', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'DELETE') THEN
    RAISE EXCEPTION
      'notification/crew composition recovery refused: Phase-A crew contract drift'
      USING ERRCODE = '55000';
  END IF;

  -- All producer entry points and their private ledgers must exist together.
  -- This makes a second execution safe while rejecting an interrupted/manual
  -- object removal that could otherwise mask a release incident.
  IF to_regclass('public.notification_producer_occurrences') IS NULL
     OR to_regclass('public.notification_delivery_claims') IS NULL
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         to_regprocedure('public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
         to_regprocedure('public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)'),
         to_regprocedure('public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)'),
         to_regprocedure('public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)'),
         to_regprocedure('public.release_notification_delivery_claim(uuid)'),
         to_regprocedure('public.emit_notification_producer_event(text,text,text,uuid,jsonb)')
       ]) AS required(function_oid)
       WHERE required.function_oid IS NULL
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery refused: producer contract is partial'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT count(*)
    FROM public.notification_types catalog
    WHERE catalog.type_key = ANY (v_required)
  ) <> cardinality(v_required) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery refused: required catalog keys drift'
      USING ERRCODE = '55000';
  END IF;

  -- Capture the exact Phase-A surface before containment. The postflight
  -- equality checks prove this rollback did not replace or revoke it.
  CREATE TEMP TABLE IF NOT EXISTS upr_composition_phase_a_snapshot (
    kind text NOT NULL, identity text NOT NULL, source_hash text NOT NULL,
    acl text NOT NULL, config text NOT NULL, comment text NOT NULL
  ) ON COMMIT PRESERVE ROWS;
  TRUNCATE pg_temp.upr_composition_phase_a_snapshot;
  INSERT INTO pg_temp.upr_composition_phase_a_snapshot
  SELECT
    'function'::text AS kind,
    procedure.oid::text AS identity,
    md5(concat_ws(
      '|', procedure.prosrc, procedure.proowner::text,
      procedure.prosecdef::text, procedure.prolang::text
    )) AS source_hash,
    COALESCE(procedure.proacl::text, '') AS acl,
    COALESCE(procedure.proconfig::text, '') AS config,
    COALESCE(obj_description(procedure.oid, 'pg_proc'), '') AS comment
  FROM pg_proc procedure
  WHERE COALESCE(obj_description(procedure.oid, 'pg_proc'), '') LIKE
    'UPR appointment crew atomic save/audit repair v1:%'
  UNION ALL
  SELECT
    'trigger'::text,
    trigger_record.tgname,
    md5(
      concat_ws(
        '|', trigger_record.tgfoid::text, trigger_record.tgtype::text,
        trigger_record.tgenabled::text, trigger_record.tgqual::text,
        trigger_record.tgattr::text, trigger_record.tgnargs::text,
        encode(trigger_record.tgargs, 'hex'),
        trigger_record.tgconstraint::text
      )
    ),
    '', '', ''
  FROM pg_trigger trigger_record
  WHERE (trigger_record.tgrelid, trigger_record.tgname) IN (
    ('public.appointments'::regclass, 'trg_appointments_atomic_command_guard'),
    ('public.appointment_crew'::regclass, 'trg_appointment_crew_actor_audit')
  )
    AND NOT trigger_record.tgisinternal
  UNION ALL
  SELECT
    'policy'::text,
    policy_record.tablename || ':' || policy_record.policyname,
    md5(
      concat_ws(
        '|', policy_record.cmd, policy_record.permissive,
        policy_record.roles::text,
        policy_record.qual, policy_record.with_check
      )
    ),
    '', '', ''
  FROM pg_policies policy_record
  WHERE policy_record.schemaname = 'public'
    AND policy_record.tablename IN ('appointments', 'appointment_crew')
  UNION ALL
  SELECT
    'table-acl'::text,
    relation_record.oid::text,
    md5(concat_ws(
      '|',
      relation_record.relowner::text,
      relation_record.relrowsecurity::text,
      relation_record.relforcerowsecurity::text,
      relation_record.relacl::text
    )),
    '', '', ''
  FROM pg_class relation_record
  WHERE relation_record.oid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass,
    'public.system_events'::regclass
  );

  INSERT INTO pg_temp.upr_composition_phase_a_snapshot
  SELECT
    'column-acl'::text,
    attribute_record.attrelid::text || ':' || attribute_record.attnum::text,
    md5(COALESCE(attribute_record.attacl::text, '')),
    '', '', ''
  FROM pg_attribute attribute_record
  WHERE attribute_record.attrelid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass,
    'public.system_events'::regclass
  )
    AND attribute_record.attnum > 0
    AND NOT attribute_record.attisdropped;

  IF (SELECT count(*) FROM pg_temp.upr_composition_phase_a_snapshot) < 20 THEN
    RAISE EXCEPTION
      'notification/crew composition recovery refused: incomplete Phase-A snapshot'
      USING ERRCODE = '55000';
  END IF;
END;
$composition_rollback_preflight$;

-- Containment comes before every capability change. It is deliberately
-- redundant with forward pre/postflight so a future catalog edit cannot turn
-- recovery into a send path.
UPDATE public.notification_types
SET enabled = false
WHERE type_key IN (
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
  'timesheet.change_requested',
  'timesheet.change_reviewed'
);

-- Keep occurrence/claim history for audit and replay prevention, but remove
-- every direct mutation route. No browser role obtains any access.
REVOKE ALL PRIVILEGES ON TABLE public.notification_producer_occurrences
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_producer_occurrences TO service_role;
REVOKE ALL PRIVILEGES ON TABLE public.notification_delivery_claims
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_delivery_claims TO service_role;

-- `notify_emit` stays service-only because it is shared transport for
-- non-producer notification types. The six APIs below are the composed
-- producer/claim capability surface and are closed for every role.
REVOKE EXECUTE ON FUNCTION public.claim_notification_delivery(
  uuid, uuid, uuid, text, text, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.validate_notification_producer_delivery(
  uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_guarded_native_push_delivery(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_guarded_notification_target_delivery(
  uuid, uuid, uuid, text, text, uuid, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_notification_delivery_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.emit_notification_producer_event(
  text, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

DO $composition_rollback_postflight$
DECLARE
  v_required constant text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ]::text[];
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.notification_types catalog
       WHERE catalog.type_key = ANY (v_required)
         AND catalog.enabled IS TRUE
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery did not disable every producer flag'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_class relation_record
       CROSS JOIN LATERAL aclexplode(
         COALESCE(relation_record.relacl, acldefault('r', relation_record.relowner))
       ) acl_record
       WHERE relation_record.oid IN (
         'public.notification_producer_occurrences'::regclass,
         'public.notification_delivery_claims'::regclass
       )
         AND acl_record.grantee = 0
     )
     OR has_table_privilege('anon', 'public.notification_producer_occurrences', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notification_producer_occurrences', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.notification_producer_occurrences', 'SELECT')
     OR has_table_privilege('service_role', 'public.notification_producer_occurrences', 'INSERT')
     OR has_table_privilege('service_role', 'public.notification_producer_occurrences', 'UPDATE')
     OR has_table_privilege('service_role', 'public.notification_producer_occurrences', 'DELETE')
     OR has_table_privilege('service_role', 'public.notification_producer_occurrences', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.notification_producer_occurrences', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.notification_producer_occurrences', 'TRIGGER')
     OR has_table_privilege('anon', 'public.notification_delivery_claims', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notification_delivery_claims', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.notification_delivery_claims', 'SELECT')
     OR has_table_privilege('service_role', 'public.notification_delivery_claims', 'INSERT')
     OR has_table_privilege('service_role', 'public.notification_delivery_claims', 'UPDATE')
     OR has_table_privilege('service_role', 'public.notification_delivery_claims', 'DELETE')
     OR has_table_privilege('service_role', 'public.notification_delivery_claims', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.notification_delivery_claims', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.notification_delivery_claims', 'TRIGGER') THEN
    RAISE EXCEPTION
      'notification/crew composition recovery found private evidence ACL drift'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('public.notification_producer_occurrences'::regclass),
           ('public.notification_delivery_claims'::regclass)
       ) AS evidence(relation_id)
       CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role_record(role_name)
       CROSS JOIN (
         VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
       ) AS privilege_record(privilege_name)
       WHERE has_table_privilege(
         role_record.role_name,
         evidence.relation_id,
         privilege_record.privilege_name
       )
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery exposed evidence-table mutation'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         to_regprocedure('public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
         to_regprocedure('public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)'),
         to_regprocedure('public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)'),
         to_regprocedure('public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)'),
         to_regprocedure('public.release_notification_delivery_claim(uuid)'),
         to_regprocedure('public.emit_notification_producer_event(text,text,text,uuid,jsonb)')
       ]) AS producer(function_oid)
       WHERE has_function_privilege('anon', producer.function_oid, 'EXECUTE')
          OR has_function_privilege('authenticated', producer.function_oid, 'EXECUTE')
          OR has_function_privilege('service_role', producer.function_oid, 'EXECUTE')
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery left producer capability executable'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM pg_proc procedure
       CROSS JOIN LATERAL aclexplode(
         COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
       ) acl_record
       WHERE procedure.oid IN (
         to_regprocedure('public.claim_notification_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid)'),
         to_regprocedure('public.validate_notification_producer_delivery(uuid,text,text,uuid,uuid)'),
         to_regprocedure('public.claim_guarded_native_push_delivery(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text)'),
         to_regprocedure('public.claim_guarded_notification_target_delivery(uuid,uuid,uuid,text,text,uuid,text,uuid,uuid,text)'),
         to_regprocedure('public.release_notification_delivery_claim(uuid)'),
         to_regprocedure('public.emit_notification_producer_event(text,text,text,uuid,jsonb)')
       )
         AND acl_record.grantee = 0
         AND acl_record.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery left producer capability public'
      USING ERRCODE = '55000';
  END IF;

  -- Materialize the current state before comparing. Keeping EXCEPT away from
  -- the snapshot-building UNION chain avoids set-operator precedence drift.
  CREATE TEMP TABLE IF NOT EXISTS upr_composition_phase_a_current (
    kind text NOT NULL, identity text NOT NULL, source_hash text NOT NULL,
    acl text NOT NULL, config text NOT NULL, comment text NOT NULL
  ) ON COMMIT PRESERVE ROWS;
  TRUNCATE pg_temp.upr_composition_phase_a_current;
  INSERT INTO pg_temp.upr_composition_phase_a_current
  SELECT
    'function'::text,
    procedure.oid::text,
    md5(concat_ws(
      '|', procedure.prosrc, procedure.proowner::text,
      procedure.prosecdef::text, procedure.prolang::text
    )),
    COALESCE(procedure.proacl::text, ''),
    COALESCE(procedure.proconfig::text, ''),
    COALESCE(obj_description(procedure.oid, 'pg_proc'), '')
  FROM pg_proc procedure
  WHERE COALESCE(obj_description(procedure.oid, 'pg_proc'), '') LIKE
    'UPR appointment crew atomic save/audit repair v1:%'
  UNION ALL
  SELECT
    'trigger'::text,
    trigger_record.tgname,
    md5(concat_ws(
      '|', trigger_record.tgfoid::text, trigger_record.tgtype::text,
      trigger_record.tgenabled::text, trigger_record.tgqual::text,
      trigger_record.tgattr::text, trigger_record.tgnargs::text,
      encode(trigger_record.tgargs, 'hex'),
      trigger_record.tgconstraint::text
    )),
    '', '', ''
  FROM pg_trigger trigger_record
  WHERE (trigger_record.tgrelid, trigger_record.tgname) IN (
    ('public.appointments'::regclass, 'trg_appointments_atomic_command_guard'),
    ('public.appointment_crew'::regclass, 'trg_appointment_crew_actor_audit')
  )
    AND NOT trigger_record.tgisinternal
  UNION ALL
  SELECT
    'policy'::text,
    policy_record.tablename || ':' || policy_record.policyname,
    md5(concat_ws(
      '|', policy_record.cmd, policy_record.permissive,
      policy_record.roles::text, policy_record.qual,
      policy_record.with_check
    )),
    '', '', ''
  FROM pg_policies policy_record
  WHERE policy_record.schemaname = 'public'
    AND policy_record.tablename IN ('appointments', 'appointment_crew')
  UNION ALL
  SELECT
    'table-acl'::text,
    relation_record.oid::text,
    md5(concat_ws(
      '|', relation_record.relowner::text,
      relation_record.relrowsecurity::text,
      relation_record.relforcerowsecurity::text,
      relation_record.relacl::text
    )),
    '', '', ''
  FROM pg_class relation_record
  WHERE relation_record.oid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass,
    'public.system_events'::regclass
  );

  INSERT INTO pg_temp.upr_composition_phase_a_current
  SELECT
    'column-acl'::text,
    attribute_record.attrelid::text || ':' || attribute_record.attnum::text,
    md5(COALESCE(attribute_record.attacl::text, '')),
    '', '', ''
  FROM pg_attribute attribute_record
  WHERE attribute_record.attrelid IN (
    'public.appointments'::regclass,
    'public.appointment_crew'::regclass,
    'public.system_events'::regclass
  )
    AND attribute_record.attnum > 0
    AND NOT attribute_record.attisdropped;

  IF EXISTS (
       (
         SELECT *
         FROM pg_temp.upr_composition_phase_a_snapshot
         EXCEPT ALL
         SELECT *
         FROM pg_temp.upr_composition_phase_a_current
       )
       UNION ALL
       (
         SELECT *
         FROM pg_temp.upr_composition_phase_a_current
         EXCEPT ALL
         SELECT *
         FROM pg_temp.upr_composition_phase_a_snapshot
       )
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery changed the Phase-A crew surface'
      USING ERRCODE = '55000';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.sync_appointment_crew(uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.sync_appointment_crew(uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.sync_appointment_crew(uuid,jsonb,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.sync_appointment_crew(uuid,jsonb,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'notification/crew composition recovery changed Phase-A crew RPC grants'
      USING ERRCODE = '55000';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.appointments', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.appointments', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'DELETE') THEN
    RAISE EXCEPTION
      'notification/crew composition recovery revoked the Phase-A legacy DML bridge'
      USING ERRCODE = '55000';
  END IF;
END;
$composition_rollback_postflight$;
