-- ════════════════════════════════════════════════
-- MIGRATION: 20260810182905_qbo_single_company_binding
-- Phase: Admin Mobile P4c
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Remembers which one QuickBooks company UPR belongs to even if its login
--   record is deleted. It refuses a different company before old customer,
--   invoice, estimate, payment, or attachment numbers can be reused there.
--
-- ADDITIVE-ONLY / trigger addition:
--   Adds one private table, one nullable column, two service-only functions, and one guard trigger; no table DROP/RENAME, no column removal/type change, and no ambiguous external-id backfill.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   The paired rollback removes the connection replace/refresh functions but keeps the
--   private binding, generation stamp, and credential guard as a security-sticky
--   record. A break-glass company replacement requires a separate reviewed data
--   reconciliation; deleting credentials is intentionally not a replacement.
-- ════════════════════════════════════════════════

-- Refuse to make an already-split catalog permanent. Payment/receipt records
-- and provider command ledgers carry authoritative realm attribution; inbound
-- webhook events are deliberately excluded because foreign-company noise is
-- not proof that UPR ever owned that company. This block intentionally runs
-- before any DDL so a direct psql apply also fails without a partial boundary.
DO $realm_evidence_preflight$
DECLARE
  v_expected_environment text;
  v_expected_realm text;
  v_credential_environment text;
  v_credential_realm text;
  v_evidence record;
  v_evidence_realm text;
  v_has_mismatch boolean;
  v_has_attributed_identity boolean := false;
  v_has_realm_evidence boolean := false;
BEGIN
  IF pg_catalog.to_regclass('public.qbo_company_binding') IS NOT NULL THEN
    EXECUTE
      'SELECT environment, realm_id FROM public.qbo_company_binding WHERE singleton'
      INTO v_expected_environment, v_expected_realm;
  END IF;

  SELECT
    CASE
      WHEN pg_catalog.lower(pg_catalog.btrim(COALESCE(c.environment, 'production'))) = 'sandbox'
        THEN 'sandbox'
      ELSE 'production'
    END,
    NULLIF(pg_catalog.btrim(c.realm_id), '')
    INTO v_credential_environment, v_credential_realm
    FROM public.integration_credentials c
   WHERE c.provider = 'quickbooks';

  IF v_expected_realm IS NULL THEN
    v_expected_environment := v_credential_environment;
    v_expected_realm := v_credential_realm;
  ELSIF v_credential_realm IS NOT NULL
        AND (
          v_credential_realm IS DISTINCT FROM v_expected_realm
          OR v_credential_environment IS DISTINCT FROM v_expected_environment
        ) THEN
    RAISE EXCEPTION 'QBO_COMPANY_BINDING_MISMATCH';
  END IF;
  v_has_attributed_identity := v_expected_realm IS NOT NULL;

  FOR v_evidence IN
    SELECT *
      FROM (VALUES
        ('payments', 'qbo_realm_id'),
        ('payment_receipts', 'qbo_realm_id'),
        ('payment_receipt_attempts', 'qbo_realm_id'),
        ('qbo_payment_allocation_fences', 'qbo_realm_id'),
        ('qbo_invoice_commands', 'realm_id'),
        ('qbo_invoice_command_reservations', 'realm_id'),
        ('qbo_estimate_commands', 'realm_id'),
        ('qbo_estimate_command_reservations', 'realm_id')
      ) AS evidence(table_name, column_name)
  LOOP
    IF pg_catalog.to_regclass('public.' || v_evidence.table_name) IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = pg_catalog.to_regclass('public.' || v_evidence.table_name)
            AND a.attname = v_evidence.column_name
            AND NOT a.attisdropped
       ) THEN
      CONTINUE;
    END IF;
    EXECUTE pg_catalog.format(
      'SELECT pg_catalog.btrim(%I::text) '
      || 'FROM public.%I '
      || 'WHERE NULLIF(pg_catalog.btrim(%I::text), '''') IS NOT NULL '
      || 'ORDER BY 1 LIMIT 1',
      v_evidence.column_name,
      v_evidence.table_name,
      v_evidence.column_name
    )
      INTO v_evidence_realm;
    IF v_evidence_realm IS NULL THEN
      CONTINUE;
    END IF;
    v_has_realm_evidence := true;
    IF v_expected_realm IS NULL THEN
      -- Realm-attributed artifacts can prove that two local surfaces disagree,
      -- but they still cannot authorize an automatic company binding after the
      -- credential was deleted. replace_qbo_connection keeps treating them as
      -- unscoped-links until a reviewed reconciliation is performed.
      v_expected_realm := v_evidence_realm;
    END IF;
    EXECUTE pg_catalog.format(
      'SELECT EXISTS ('
      || 'SELECT 1 FROM public.%I '
      || 'WHERE NULLIF(pg_catalog.btrim(%I::text), '''') IS NOT NULL '
      || 'AND pg_catalog.btrim(%I::text) IS DISTINCT FROM $1)',
      v_evidence.table_name,
      v_evidence.column_name,
      v_evidence.column_name
    )
      INTO v_has_mismatch
      USING v_expected_realm;
    IF v_has_mismatch THEN
      RAISE EXCEPTION 'QBO_COMPANY_BINDING_ARTIFACT_REALM_MISMATCH: %',
        v_evidence.table_name;
    END IF;
  END LOOP;

  IF NOT v_has_attributed_identity AND v_has_realm_evidence THEN
    RAISE EXCEPTION 'QBO_COMPANY_BINDING_UNATTRIBUTED_REALM_EVIDENCE';
  END IF;
END;
$realm_evidence_preflight$;

CREATE TABLE IF NOT EXISTS public.qbo_company_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('production', 'sandbox')),
  realm_id text NOT NULL CHECK (NULLIF(pg_catalog.btrim(realm_id), '') IS NOT NULL),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  bound_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qbo_company_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_company_binding FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qbo_company_binding FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.qbo_company_binding TO service_role;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'qbo_company_binding'
       AND policyname = 'qbo_company_binding_service_read'
  ) THEN
    CREATE POLICY qbo_company_binding_service_read
      ON public.qbo_company_binding
      FOR SELECT TO service_role
      USING (true);
  END IF;
END;
$policy$;

ALTER TABLE public.integration_credentials
  ADD COLUMN IF NOT EXISTS qbo_binding_generation bigint;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.integration_credentials'::regclass
       AND conname = 'integration_credentials_qbo_binding_generation_check'
  ) THEN
    ALTER TABLE public.integration_credentials
      ADD CONSTRAINT integration_credentials_qbo_binding_generation_check
      CHECK (qbo_binding_generation IS NULL OR qbo_binding_generation > 0)
      NOT VALID;
  END IF;
END;
$constraint$;
ALTER TABLE public.integration_credentials
  VALIDATE CONSTRAINT integration_credentials_qbo_binding_generation_check;

-- A credential with an attributed realm is the only safe automatic seed. QBO
-- document/customer IDs are deliberately not backfilled because their company
-- cannot be proven after the credential row has already disappeared.
INSERT INTO public.qbo_company_binding(singleton, environment, realm_id, generation)
SELECT true,
       CASE WHEN pg_catalog.lower(pg_catalog.btrim(COALESCE(c.environment, 'production'))) = 'sandbox'
            THEN 'sandbox' ELSE 'production' END,
       pg_catalog.btrim(c.realm_id),
       1
  FROM public.integration_credentials c
 WHERE c.provider = 'quickbooks'
   AND NULLIF(pg_catalog.btrim(c.realm_id), '') IS NOT NULL
ON CONFLICT (singleton) DO NOTHING;

DO $existing_connection$
DECLARE
  v_connection public.integration_credentials%ROWTYPE;
  v_binding public.qbo_company_binding%ROWTYPE;
  v_environment text;
BEGIN
  SELECT * INTO v_connection
    FROM public.integration_credentials
   WHERE provider = 'quickbooks';
  IF NOT FOUND OR NULLIF(pg_catalog.btrim(v_connection.realm_id), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO STRICT v_binding FROM public.qbo_company_binding WHERE singleton;
  v_environment := CASE
    WHEN pg_catalog.lower(pg_catalog.btrim(COALESCE(v_connection.environment, 'production'))) = 'sandbox'
      THEN 'sandbox'
    ELSE 'production'
  END;
  IF v_binding.realm_id IS DISTINCT FROM pg_catalog.btrim(v_connection.realm_id)
     OR v_binding.environment IS DISTINCT FROM v_environment THEN
    RAISE EXCEPTION 'QBO_COMPANY_BINDING_MISMATCH';
  END IF;

  UPDATE public.integration_credentials
     SET realm_id = v_binding.realm_id,
         environment = v_binding.environment,
         qbo_binding_generation = v_binding.generation
   WHERE provider = 'quickbooks';
END;
$existing_connection$;

-- Worker/service-role only. Token exchange happens before this call, then this
-- one transaction either binds and stores the connection together or stores
-- neither. Same-company reconnects advance the credential generation.
CREATE OR REPLACE FUNCTION public.replace_qbo_connection(
  p_environment text,
  p_realm_id text,
  p_access_token text,
  p_refresh_token text,
  p_token_expires_at timestamptz,
  p_granted_scopes text DEFAULT NULL,
  p_connected_by uuid DEFAULT NULL,
  p_connected_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_environment text;
  v_realm_id text := NULLIF(pg_catalog.btrim(p_realm_id), '');
  v_binding public.qbo_company_binding%ROWTYPE;
  v_has_artifacts boolean;
  v_generation bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  v_environment := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_environment, '')));
  IF v_environment NOT IN ('production', 'sandbox')
     OR v_realm_id IS NULL
     OR NULLIF(pg_catalog.btrim(p_access_token), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_refresh_token), '') IS NULL
     OR p_token_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-connection');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('upr:qbo-company-binding', 0)
  );
  SELECT * INTO v_binding
    FROM public.qbo_company_binding
   WHERE singleton
   FOR UPDATE;
  IF FOUND THEN
    IF v_binding.environment IS DISTINCT FROM v_environment
       OR v_binding.realm_id IS DISTINCT FROM v_realm_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'realm-mismatch',
        'environment', v_binding.environment,
        'realm_id', v_binding.realm_id,
        'generation', v_binding.generation
      );
    END IF;
    v_generation := v_binding.generation + 1;
    UPDATE public.qbo_company_binding
       SET generation = v_generation,
           updated_at = now()
     WHERE singleton;
  ELSE
    SELECT
      EXISTS (
        SELECT 1 FROM public.integration_credentials
         WHERE provider = 'quickbooks'
           AND (
             NULLIF(pg_catalog.btrim(realm_id), '') IS NOT NULL
             OR NULLIF(pg_catalog.btrim(access_token), '') IS NOT NULL
             OR NULLIF(pg_catalog.btrim(refresh_token), '') IS NOT NULL
           )
      )
      OR EXISTS (SELECT 1 FROM public.payments WHERE NULLIF(pg_catalog.btrim(qbo_realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.payment_receipts WHERE NULLIF(pg_catalog.btrim(qbo_realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.payment_receipt_attempts WHERE NULLIF(pg_catalog.btrim(qbo_realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.qbo_payment_allocation_fences WHERE NULLIF(pg_catalog.btrim(qbo_realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.qbo_invoice_commands WHERE NULLIF(pg_catalog.btrim(realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations WHERE NULLIF(pg_catalog.btrim(realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.qbo_estimate_commands WHERE NULLIF(pg_catalog.btrim(realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.qbo_estimate_command_reservations WHERE NULLIF(pg_catalog.btrim(realm_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.contacts WHERE NULLIF(pg_catalog.btrim(qbo_customer_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.invoices WHERE NULLIF(pg_catalog.btrim(qbo_invoice_id), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.estimates WHERE NULLIF(pg_catalog.btrim(qbo_estimate_id), '') IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.payments
         WHERE NULLIF(pg_catalog.btrim(qbo_payment_id), '') IS NOT NULL
            OR NULLIF(pg_catalog.btrim(stripe_fee_qbo_purchase_id), '') IS NOT NULL
      )
      OR EXISTS (SELECT 1 FROM public.qbo_attachments WHERE NULLIF(pg_catalog.btrim(qbo_attachable_id), '') IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.invoice_line_items
         WHERE NULLIF(pg_catalog.btrim(qbo_item_id), '') IS NOT NULL
            OR NULLIF(pg_catalog.btrim(qbo_class_id), '') IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.estimate_line_items
         WHERE NULLIF(pg_catalog.btrim(qbo_item_id), '') IS NOT NULL
            OR NULLIF(pg_catalog.btrim(qbo_class_id), '') IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.integration_config
         WHERE key IN (
           'qbo_stripe_clearing_account_id',
           'qbo_fee_expense_account_id',
           'qbo_bank_account_id'
         )
           AND NULLIF(pg_catalog.btrim(value), '') IS NOT NULL
      )
      INTO v_has_artifacts;

    IF v_has_artifacts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unscoped-links');
    END IF;
    v_generation := 1;
    INSERT INTO public.qbo_company_binding(singleton, environment, realm_id, generation)
    VALUES(true, v_environment, v_realm_id, v_generation);
  END IF;

  PERFORM pg_catalog.set_config(
    'upr.qbo_connection_writer_generation',
    v_generation::text,
    true
  );
  INSERT INTO public.integration_credentials(
    provider, access_token, refresh_token, realm_id, environment,
    token_expires_at, granted_scopes, connected_by, connected_at,
    updated_at, qbo_binding_generation
  ) VALUES(
    'quickbooks', p_access_token, p_refresh_token, v_realm_id, v_environment,
    p_token_expires_at, p_granted_scopes, p_connected_by,
    COALESCE(p_connected_at, now()), now(), v_generation
  )
  ON CONFLICT (provider) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    refresh_token = EXCLUDED.refresh_token,
    realm_id = EXCLUDED.realm_id,
    environment = EXCLUDED.environment,
    token_expires_at = EXCLUDED.token_expires_at,
    granted_scopes = COALESCE(EXCLUDED.granted_scopes, public.integration_credentials.granted_scopes),
    connected_by = EXCLUDED.connected_by,
    connected_at = EXCLUDED.connected_at,
    updated_at = EXCLUDED.updated_at,
    qbo_binding_generation = EXCLUDED.qbo_binding_generation;
  PERFORM pg_catalog.set_config('upr.qbo_connection_writer_generation', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'environment', v_environment,
    'realm_id', v_realm_id,
    'generation', v_generation
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.replace_qbo_connection(text,text,text,text,timestamptz,text,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_qbo_connection(text,text,text,text,timestamptz,text,uuid,timestamptz) TO service_role;

-- Worker/service-role only. A refresh may contact Intuit using an old token
-- version, but it may persist the answer only if that exact generation still
-- owns both the durable binding and credential row. A reconnect therefore wins.
CREATE OR REPLACE FUNCTION public.refresh_qbo_connection_cas(
  p_expected_environment text,
  p_expected_realm_id text,
  p_expected_generation bigint,
  p_access_token text,
  p_refresh_token text,
  p_token_expires_at timestamptz,
  p_granted_scopes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_environment text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_expected_environment, '')));
  v_realm_id text := NULLIF(pg_catalog.btrim(p_expected_realm_id), '');
  v_binding public.qbo_company_binding%ROWTYPE;
  v_connection public.integration_credentials%ROWTYPE;
  v_generation bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  IF v_environment NOT IN ('production', 'sandbox')
     OR v_realm_id IS NULL
     OR p_expected_generation IS NULL
     OR p_expected_generation < 1
     OR NULLIF(pg_catalog.btrim(p_access_token), '') IS NULL
     OR p_token_expires_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-refresh');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('upr:qbo-company-binding', 0)
  );
  SELECT * INTO v_binding
    FROM public.qbo_company_binding
   WHERE singleton
   FOR UPDATE;
  IF NOT FOUND
     OR v_binding.environment IS DISTINCT FROM v_environment
     OR v_binding.realm_id IS DISTINCT FROM v_realm_id
     OR v_binding.generation IS DISTINCT FROM p_expected_generation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'connection-changed');
  END IF;

  SELECT * INTO v_connection
    FROM public.integration_credentials
   WHERE provider = 'quickbooks'
   FOR UPDATE;
  IF NOT FOUND
     OR v_connection.environment IS DISTINCT FROM v_environment
     OR v_connection.realm_id IS DISTINCT FROM v_realm_id
     OR v_connection.qbo_binding_generation IS DISTINCT FROM p_expected_generation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'connection-changed');
  END IF;

  v_generation := p_expected_generation + 1;
  UPDATE public.qbo_company_binding
     SET generation = v_generation,
         updated_at = now()
   WHERE singleton;
  PERFORM pg_catalog.set_config(
    'upr.qbo_connection_writer_generation',
    v_generation::text,
    true
  );
  UPDATE public.integration_credentials
     SET access_token = p_access_token,
         refresh_token = COALESCE(NULLIF(pg_catalog.btrim(p_refresh_token), ''), v_connection.refresh_token),
         token_expires_at = p_token_expires_at,
         granted_scopes = COALESCE(p_granted_scopes, v_connection.granted_scopes),
         updated_at = now(),
         qbo_binding_generation = v_generation
   WHERE provider = 'quickbooks';
  PERFORM pg_catalog.set_config('upr.qbo_connection_writer_generation', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'environment', v_environment,
    'realm_id', v_realm_id,
    'generation', v_generation
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.refresh_qbo_connection_cas(text,text,bigint,text,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_qbo_connection_cas(text,text,bigint,text,text,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_quickbooks_company_binding()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_binding public.qbo_company_binding%ROWTYPE;
  v_environment text;
  v_realm_id text;
  v_writer_generation text;
  v_protected_write boolean;
BEGIN
  IF NEW.provider IS DISTINCT FROM 'quickbooks' THEN
    RETURN NEW;
  END IF;
  v_environment := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.environment, 'production')));
  v_realm_id := NULLIF(pg_catalog.btrim(NEW.realm_id), '');
  SELECT * INTO v_binding FROM public.qbo_company_binding WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QBO_BINDING_REQUIRED' USING ERRCODE = '55000';
  END IF;
  IF v_realm_id IS NULL
     OR v_environment IS DISTINCT FROM v_binding.environment
     OR v_realm_id IS DISTINCT FROM v_binding.realm_id THEN
    RAISE EXCEPTION 'QBO_COMPANY_BINDING_MISMATCH' USING ERRCODE = '55000';
  END IF;
  v_writer_generation := NULLIF(
    current_setting('upr.qbo_connection_writer_generation', true),
    ''
  );
  IF TG_OP = 'INSERT' THEN
    v_protected_write := true;
  ELSE
    v_protected_write := OLD.access_token IS DISTINCT FROM NEW.access_token
      OR OLD.refresh_token IS DISTINCT FROM NEW.refresh_token
      OR OLD.token_expires_at IS DISTINCT FROM NEW.token_expires_at
      OR OLD.granted_scopes IS DISTINCT FROM NEW.granted_scopes
      OR OLD.realm_id IS DISTINCT FROM NEW.realm_id
      OR OLD.environment IS DISTINCT FROM NEW.environment
      OR OLD.qbo_binding_generation IS DISTINCT FROM NEW.qbo_binding_generation;
  END IF;
  IF v_protected_write
     AND (
       auth.role() IS DISTINCT FROM 'service_role'
       OR v_writer_generation IS DISTINCT FROM v_binding.generation::text
     ) THEN
    RAISE EXCEPTION 'QBO_CONNECTION_WRITE_REQUIRES_CAS' USING ERRCODE = '55000';
  END IF;
  NEW.environment := v_binding.environment;
  NEW.realm_id := v_binding.realm_id;
  NEW.qbo_binding_generation := v_binding.generation;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.guard_quickbooks_company_binding() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_integration_credentials_qbo_company_binding
BEFORE INSERT OR UPDATE ON public.integration_credentials
FOR EACH ROW
EXECUTE FUNCTION public.guard_quickbooks_company_binding();

-- Last-line realm guard for every durable, realm-bearing QBO ledger or local
-- projection.  The command and receipt RPCs intentionally keep their frozen
-- signatures; this trigger makes their eventual service-role writes prove the
-- same company at the storage boundary.  Legacy payments with neither a QBO
-- payment id nor a realm remain writable, but a row claiming a QBO payment
-- cannot omit its realm after this migration.
CREATE OR REPLACE FUNCTION public.guard_qbo_realm_binding()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_binding public.qbo_company_binding%ROWTYPE;
  v_realm_id text := NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(NEW)->>TG_ARGV[0]), '');
  v_old_realm_id text := CASE
    WHEN TG_OP = 'INSERT' THEN NULL
    ELSE NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(OLD)->>TG_ARGV[0]), '')
  END;
  v_new_identity text := CASE
    WHEN COALESCE(TG_ARGV[2], '') = '' THEN NULL
    ELSE NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(NEW)->>TG_ARGV[2]), '')
  END;
  v_old_identity text := CASE
    WHEN TG_OP = 'INSERT' OR COALESCE(TG_ARGV[2], '') = '' THEN NULL
    ELSE NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(OLD)->>TG_ARGV[2]), '')
  END;
  v_new_secondary_identity text := CASE
    WHEN COALESCE(TG_ARGV[3], '') = '' THEN NULL
    ELSE NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(NEW)->>TG_ARGV[3]), '')
  END;
  v_old_secondary_identity text := CASE
    WHEN TG_OP = 'INSERT' OR COALESCE(TG_ARGV[3], '') = '' THEN NULL
    ELSE NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(OLD)->>TG_ARGV[3]), '')
  END;
BEGIN
  -- Do not turn ordinary browser-created manual payments or legacy projection
  -- rows into QBO writes. This compatibility exit is deliberately before the
  -- service-role/binding checks; any QBO identity, required ledger surface, or
  -- attempt to erase an existing realm continues through the fail-closed path.
  IF v_realm_id IS NULL
     AND v_old_realm_id IS NULL
     AND v_new_identity IS NULL
     AND v_old_identity IS NULL
     AND v_new_secondary_identity IS NULL
     AND v_old_secondary_identity IS NULL
     AND TG_ARGV[1] = 'nullable' THEN
    RETURN NEW;
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'QBO_REALM_WRITE_REQUIRES_SERVICE_ROLE' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_binding FROM public.qbo_company_binding WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QBO_BINDING_REQUIRED' USING ERRCODE = '55000';
  END IF;
  IF v_realm_id IS NULL THEN
    RAISE EXCEPTION 'QBO_REALM_BINDING_REQUIRED' USING ERRCODE = '55000';
  END IF;
  IF v_realm_id IS DISTINCT FROM v_binding.realm_id THEN
    RAISE EXCEPTION 'QBO_COMPANY_BINDING_MISMATCH' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.guard_qbo_realm_binding() FROM PUBLIC, anon, authenticated, service_role;

DO $realm_guard_triggers$
DECLARE
  v_target record;
BEGIN
  IF current_setting('server_version_num')::integer < 140000 THEN
    RAISE EXCEPTION 'QBO_REALM_GUARD_REQUIRES_CREATE_OR_REPLACE_TRIGGER';
  END IF;
  FOR v_target IN
    SELECT * FROM (VALUES
      ('payments', 'qbo_realm_id', 'nullable', 'qbo_payment_id', 'stripe_fee_qbo_purchase_id'),
      ('payment_receipts', 'qbo_realm_id', 'required', '', ''),
      ('payment_receipt_attempts', 'qbo_realm_id', 'required', '', ''),
      ('payment_receipt_events', 'qbo_realm_id', 'nullable', 'qbo_payment_id', ''),
      ('qbo_payment_allocation_fences', 'qbo_realm_id', 'required', '', ''),
      ('qbo_invoice_commands', 'realm_id', 'required', '', ''),
      ('qbo_invoice_command_reservations', 'realm_id', 'required', '', ''),
      ('qbo_estimate_commands', 'realm_id', 'required', '', ''),
      ('qbo_estimate_command_reservations', 'realm_id', 'required', '', '')
    ) AS t(table_name, realm_column, null_mode, identity_column, secondary_identity_column)
  LOOP
    IF pg_catalog.to_regclass('public.' || v_target.table_name) IS NULL THEN
      RAISE EXCEPTION 'QBO_REALM_GUARD_TARGET_MISSING: %', v_target.table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = pg_catalog.to_regclass('public.' || v_target.table_name)
         AND a.attname = v_target.realm_column AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'QBO_REALM_GUARD_COLUMN_MISSING: %.%', v_target.table_name, v_target.realm_column;
    END IF;
    IF v_target.identity_column <> '' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = pg_catalog.to_regclass('public.' || v_target.table_name)
         AND a.attname = v_target.identity_column AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'QBO_REALM_GUARD_COLUMN_MISSING: %.%', v_target.table_name, v_target.identity_column;
    END IF;
    IF v_target.secondary_identity_column <> '' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = pg_catalog.to_regclass('public.' || v_target.table_name)
         AND a.attname = v_target.secondary_identity_column AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'QBO_REALM_GUARD_COLUMN_MISSING: %.%', v_target.table_name, v_target.secondary_identity_column;
    END IF;
    EXECUTE pg_catalog.format(
      'CREATE OR REPLACE TRIGGER trg_qbo_realm_binding BEFORE INSERT OR UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.guard_qbo_realm_binding(%L, %L, %L, %L)',
      v_target.table_name, v_target.realm_column, v_target.null_mode,
      v_target.identity_column, v_target.secondary_identity_column
    );
  END LOOP;
END;
$realm_guard_triggers$;

COMMENT ON TABLE public.qbo_company_binding IS
  'Durable single-company QBO identity. Survives credential deletion; replacement requires reviewed reconciliation.';
COMMENT ON COLUMN public.integration_credentials.qbo_binding_generation IS
  'Generation of the durable QBO company binding that authorized this credential version.';

NOTIFY pgrst, 'reload schema';
