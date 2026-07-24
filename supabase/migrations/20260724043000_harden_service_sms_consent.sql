-- ════════════════════════════════════════════════
-- MIGRATION: harden service SMS consent serialization
-- ════════════════════════════════════════════════
--
-- The foundation migration is already live as ledger version
-- 20260724035913_attest_prior_sms_consent. This follow-up preserves its exact
-- signatures and response shapes while closing three fail-open edges:
--   1. revalidate and lock the contact phone after entering the phone advisory
--      lock, so suppression for an old phone cannot authorize a new phone; and
--   2. require a strictly later processed START to supersede an unresolved STOP.
--   3. hold a share lock on the authorizing employee row through attestation.
--
-- This exact-source patch intentionally fails if the prior function body is not
-- the reviewed foundation definition. It is safe on a fresh rebuild because the
-- foundation migration runs first.
--
-- ROLLBACK:
--   Do not operationally roll back these fail-closed checks. If an emergency
--   compatibility rollback is owner-approved, restore both exact function
--   definitions from commit e71e759 and reapply the ACL statements below in a
--   separate reviewed migration. Tables and consent evidence remain untouched.
-- ════════════════════════════════════════════════

DO $migration$
DECLARE
  v_status_definition text;
  v_attest_definition text;
  v_original text;
  v_needle text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_service_sms_consent_status(uuid,text)'::regprocedure
  )
  INTO v_status_definition;

  IF v_status_definition IS NULL THEN
    RAISE EXCEPTION 'get_service_sms_consent_status(uuid,text) is missing';
  END IF;
  IF md5(v_status_definition) <> '891963fb670ffffc47652154b2181c02'
     OR octet_length(v_status_definition) <> 4470 THEN
    RAISE EXCEPTION 'status definition does not match reviewed live foundation';
  END IF;

  v_needle := E'  v_phone_digits text;\n  v_phone_key text;\n  v_destination_digits text;';
  IF (length(v_status_definition) - length(replace(v_status_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'status declaration patch must match exactly once';
  END IF;
  v_original := v_status_definition;
  v_status_definition := replace(
    v_status_definition,
    v_needle,
    E'  v_phone_digits text;\n  v_phone_key text;\n  v_locked_phone_digits text;\n  v_locked_phone_key text;\n  v_destination_digits text;'
  );
  IF v_status_definition = v_original THEN
    RAISE EXCEPTION 'status declaration patch did not match reviewed foundation';
  END IF;

  v_needle := E'  PERFORM pg_advisory_xact_lock(hashtextextended(''messaging-phone:'' || v_phone_key, 0));\n\n  IF EXISTS (';
  IF (length(v_status_definition) - length(replace(v_status_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'status phone-lock patch must match exactly once';
  END IF;
  v_original := v_status_definition;
  v_status_definition := replace(
    v_status_definition,
    v_needle,
    E'  PERFORM pg_advisory_xact_lock(hashtextextended(''messaging-phone:'' || v_phone_key, 0));\n\n'
    E'  -- Pin and revalidate the target after entering the phone boundary.\n'
    E'  SELECT *\n'
    E'  INTO v_contact\n'
    E'  FROM public.contacts\n'
    E'  WHERE id = p_contact_id\n'
    E'  FOR SHARE;\n\n'
    E'  v_locked_phone_digits := regexp_replace(COALESCE(v_contact.phone, ''''), ''[^0-9]'', '''', ''g'');\n'
    E'  IF length(v_locked_phone_digits) = 10 THEN\n'
    E'    v_locked_phone_key := v_locked_phone_digits;\n'
    E'  ELSIF length(v_locked_phone_digits) = 11 AND left(v_locked_phone_digits, 1) = ''1'' THEN\n'
    E'    v_locked_phone_key := right(v_locked_phone_digits, 10);\n'
    E'  END IF;\n\n'
    E'  IF v_contact.id IS NULL\n'
    E'     OR v_locked_phone_key IS NULL\n'
    E'     OR v_locked_phone_key <> v_phone_key THEN\n'
    E'    RETURN jsonb_build_object(\n'
    E'      ''allowed'', false,\n'
    E'      ''code'', ''CONTACT_PHONE_CHANGED'',\n'
    E'      ''contact_id'', p_contact_id\n'
    E'    );\n'
    E'  END IF;\n\n'
    E'  IF EXISTS ('
  );
  IF v_status_definition = v_original THEN
    RAISE EXCEPTION 'status phone-lock patch did not match reviewed foundation';
  END IF;

  v_needle := E'      AND regexp_replace(lower(trim(COALESCE(e.content, ''''))), ''[^a-z0-9]'', '''', ''g'')\n'
    E'        = ANY (ARRAY[''stop'', ''stopall'', ''unsubscribe'', ''cancel'', ''end'', ''quit''])\n'
    E'  ) THEN';
  IF (length(v_status_definition) - length(replace(v_status_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'status STOP chronology patch must match exactly once';
  END IF;
  v_original := v_status_definition;
  v_status_definition := replace(
    v_status_definition,
    v_needle,
    E'      AND regexp_replace(lower(trim(COALESCE(e.content, ''''))), ''[^a-z0-9]'', '''', ''g'')\n'
    E'        = ANY (ARRAY[''stop'', ''stopall'', ''unsubscribe'', ''cancel'', ''end'', ''quit''])\n'
    E'      AND NOT EXISTS (\n'
    E'        SELECT 1\n'
    E'        FROM public.message_provider_events later_event\n'
    E'        WHERE later_event.direction = ''inbound''\n'
    E'          AND later_event.message_type IN (''sms'', ''mms'')\n'
    E'          AND later_event.processing_state = ''processed''\n'
    E'          AND right(\n'
    E'            regexp_replace(COALESCE(later_event.sender_address, ''''), ''[^0-9]'', '''', ''g''),\n'
    E'            10\n'
    E'          ) = v_phone_key\n'
    E'          AND later_event.occurred_at > e.occurred_at\n'
    E'          AND regexp_replace(\n'
    E'            lower(trim(COALESCE(later_event.content, ''''))),\n'
    E'            ''[^a-z0-9]'',\n'
    E'            '''',\n'
    E'            ''g''\n'
    E'          ) = ANY (ARRAY[''start'', ''unstop'', ''subscribe'', ''yes''])\n'
    E'      )\n'
    E'  ) THEN'
  );
  IF v_status_definition = v_original THEN
    RAISE EXCEPTION 'status STOP chronology patch did not match reviewed foundation';
  END IF;

  EXECUTE v_status_definition;

  SELECT pg_get_functiondef(
    'public.attest_prior_sms_consent(uuid,uuid,text,date,text,text)'::regprocedure
  )
  INTO v_attest_definition;

  IF v_attest_definition IS NULL THEN
    RAISE EXCEPTION 'attest_prior_sms_consent(uuid,uuid,text,date,text,text) is missing';
  END IF;
  IF md5(v_attest_definition) <> 'a579ea7ed3a1a97b45e5256e13e821a4'
     OR octet_length(v_attest_definition) <> 7721 THEN
    RAISE EXCEPTION 'attestation definition does not match reviewed live foundation';
  END IF;

  v_needle := E'  v_phone_digits text;\n  v_phone_key text;\n  v_recorded_at timestamptz';
  IF (length(v_attest_definition) - length(replace(v_attest_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'attestation declaration patch must match exactly once';
  END IF;
  v_original := v_attest_definition;
  v_attest_definition := replace(
    v_attest_definition,
    v_needle,
    E'  v_phone_digits text;\n  v_phone_key text;\n  v_locked_phone_digits text;\n  v_locked_phone_key text;\n  v_recorded_at timestamptz'
  );
  IF v_attest_definition = v_original THEN
    RAISE EXCEPTION 'attestation declaration patch did not match reviewed foundation';
  END IF;

  v_needle := E'  WHERE id = p_actor_id\n  LIMIT 1;';
  IF (length(v_attest_definition) - length(replace(v_attest_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'attestation actor-lock patch must match exactly once';
  END IF;
  v_attest_definition := replace(
    v_attest_definition,
    v_needle,
    E'  WHERE id = p_actor_id\n  LIMIT 1\n  FOR SHARE;'
  );

  v_needle := E'  ORDER BY c.id\n  FOR UPDATE;\n\n'
    E'  SELECT *\n'
    E'  INTO v_contact\n'
    E'  FROM public.contacts\n'
    E'  WHERE id = p_contact_id;\n\n'
    E'  IF EXISTS (';
  IF (length(v_attest_definition) - length(replace(v_attest_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'attestation phone-lock patch must match exactly once';
  END IF;
  v_original := v_attest_definition;
  v_attest_definition := replace(
    v_attest_definition,
    v_needle,
    E'  ORDER BY c.id\n  FOR UPDATE;\n\n'
    E'  SELECT *\n'
    E'  INTO v_contact\n'
    E'  FROM public.contacts\n'
    E'  WHERE id = p_contact_id\n'
    E'  FOR UPDATE;\n\n'
    E'  v_locked_phone_digits := regexp_replace(COALESCE(v_contact.phone, ''''), ''[^0-9]'', '''', ''g'');\n'
    E'  IF length(v_locked_phone_digits) = 10 THEN\n'
    E'    v_locked_phone_key := v_locked_phone_digits;\n'
    E'  ELSIF length(v_locked_phone_digits) = 11 AND left(v_locked_phone_digits, 1) = ''1'' THEN\n'
    E'    v_locked_phone_key := right(v_locked_phone_digits, 10);\n'
    E'  END IF;\n\n'
    E'  IF v_contact.id IS NULL\n'
    E'     OR v_locked_phone_key IS NULL\n'
    E'     OR v_locked_phone_key <> v_phone_key THEN\n'
    E'    RETURN jsonb_build_object(''ok'', false, ''code'', ''CONTACT_PHONE_CHANGED'');\n'
    E'  END IF;\n\n'
    E'  IF EXISTS ('
  );
  IF v_attest_definition = v_original THEN
    RAISE EXCEPTION 'attestation phone-lock patch did not match reviewed foundation';
  END IF;

  v_needle := E'      AND regexp_replace(lower(trim(COALESCE(e.content, ''''))), ''[^a-z0-9]'', '''', ''g'')\n'
    E'        = ANY (ARRAY[''stop'', ''stopall'', ''unsubscribe'', ''cancel'', ''end'', ''quit''])\n'
    E'  ) THEN';
  IF (length(v_attest_definition) - length(replace(v_attest_definition, v_needle, '')))
       / length(v_needle) <> 1 THEN
    RAISE EXCEPTION 'attestation STOP chronology patch must match exactly once';
  END IF;
  v_original := v_attest_definition;
  v_attest_definition := replace(
    v_attest_definition,
    v_needle,
    E'      AND regexp_replace(lower(trim(COALESCE(e.content, ''''))), ''[^a-z0-9]'', '''', ''g'')\n'
    E'        = ANY (ARRAY[''stop'', ''stopall'', ''unsubscribe'', ''cancel'', ''end'', ''quit''])\n'
    E'      AND NOT EXISTS (\n'
    E'        SELECT 1\n'
    E'        FROM public.message_provider_events later_event\n'
    E'        WHERE later_event.direction = ''inbound''\n'
    E'          AND later_event.message_type IN (''sms'', ''mms'')\n'
    E'          AND later_event.processing_state = ''processed''\n'
    E'          AND right(\n'
    E'            regexp_replace(COALESCE(later_event.sender_address, ''''), ''[^0-9]'', '''', ''g''),\n'
    E'            10\n'
    E'          ) = v_phone_key\n'
    E'          AND later_event.occurred_at > e.occurred_at\n'
    E'          AND regexp_replace(\n'
    E'            lower(trim(COALESCE(later_event.content, ''''))),\n'
    E'            ''[^a-z0-9]'',\n'
    E'            '''',\n'
    E'            ''g''\n'
    E'          ) = ANY (ARRAY[''start'', ''unstop'', ''subscribe'', ''yes''])\n'
    E'      )\n'
    E'  ) THEN'
  );
  IF v_attest_definition = v_original THEN
    RAISE EXCEPTION 'attestation STOP chronology patch did not match reviewed foundation';
  END IF;

  EXECUTE v_attest_definition;
END;
$migration$;

ALTER FUNCTION public.get_service_sms_consent_status(uuid, text)
  SECURITY INVOKER
  SET search_path = '';
ALTER FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  SECURITY INVOKER
  SET search_path = '';

REVOKE ALL ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_service_sms_consent_status(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attest_prior_sms_consent(uuid, uuid, text, date, text, text)
  TO service_role;
