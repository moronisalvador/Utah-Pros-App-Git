-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260810020000_qbo_invoice_command_reservation
-- WHAT THIS DOES: serializes a manual invoice lock with all QBO invoice command
-- preparation, including customer self-heal, before any provider side effect.
-- ADDITIVE: adds a forced-RLS service-only reservation table, a non-mutating
-- line-patch staging RPC, a post-provider line finalizer, and a lock trigger;
-- narrows the existing line policy during an active reservation; and replaces
-- only service-only command/CAS function bodies with their existing signatures.
-- No automatic TTL is permitted: ambiguous work remains reserved until a human
-- reconciliation path reaches a terminal result.
-- ROLLBACK: supabase/rollbacks/20260810020000_qbo_invoice_command_reservation.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.qbo_invoice_command_reservations (
  invoice_id uuid PRIMARY KEY REFERENCES public.invoices(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('save', 'send', 'delete')),
  actor_auth_user_id uuid,
  actor_employee_id uuid,
  initiator text NOT NULL CHECK (initiator IN ('browser', 'webhook')),
  realm_id text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qbo_invoice_command_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_invoice_command_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qbo_invoice_command_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qbo_invoice_command_reservations TO service_role;
CREATE POLICY qbo_invoice_command_reservations_service_role_only
  ON public.qbo_invoice_command_reservations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.reserve_qbo_invoice_command(
  p_command_id uuid, p_invoice_id uuid, p_action text,
  p_actor_auth_user_id uuid, p_actor_employee_id uuid, p_initiator text, p_realm_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invoice public.invoices;
  v_reservation public.qbo_invoice_command_reservations;
  v_active public.qbo_invoice_commands;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_invoice_id IS NULL
     OR p_action NOT IN ('save', 'send', 'delete')
     OR p_initiator NOT IN ('browser', 'webhook')
     OR p_realm_id IS NULL
     OR (p_initiator = 'browser' AND p_actor_auth_user_id IS NULL)
     OR (p_initiator = 'webhook' AND (p_actor_auth_user_id IS NOT NULL OR p_actor_employee_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-command');
  END IF;
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found');
  END IF;
  IF v_invoice.locked IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice-locked');
  END IF;
  -- Rolling deploys can encounter a pre-reservation command. Never install a
  -- different reservation in front of it: only the exact same command and
  -- frozen identity may acquire the missing fence and resume.
  SELECT * INTO v_active
  FROM public.qbo_invoice_commands
  WHERE invoice_id = p_invoice_id
    AND status IN ('prepared', 'provider_started', 'ambiguous', 'provider_succeeded', 'needs_reconciliation')
  FOR UPDATE;
  IF FOUND AND (
    v_active.id IS DISTINCT FROM p_command_id
    OR v_active.action IS DISTINCT FROM p_action
    OR v_active.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR v_active.actor_employee_id IS DISTINCT FROM p_actor_employee_id
    OR v_active.initiator IS DISTINCT FROM p_initiator
    OR v_active.realm_id IS DISTINCT FROM p_realm_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active-command-conflict',
      'command_id', v_active.id, 'status', v_active.status);
  END IF;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF FOUND THEN
    IF v_reservation.command_id = p_command_id
       AND v_reservation.action = p_action
       AND v_reservation.actor_auth_user_id IS NOT DISTINCT FROM p_actor_auth_user_id
       AND v_reservation.actor_employee_id IS NOT DISTINCT FROM p_actor_employee_id
       AND v_reservation.initiator IS NOT DISTINCT FROM p_initiator
       AND v_reservation.realm_id IS NOT DISTINCT FROM p_realm_id THEN
      RETURN jsonb_build_object('ok', true, 'replay', true,
        'command_id', v_reservation.command_id, 'action', v_reservation.action);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'active-command-conflict',
      'command_id', v_reservation.command_id);
  END IF;
  INSERT INTO public.qbo_invoice_command_reservations (
    invoice_id, command_id, action, actor_auth_user_id, actor_employee_id, initiator, realm_id
  ) VALUES (
    p_invoice_id, p_command_id, p_action, p_actor_auth_user_id, p_actor_employee_id, p_initiator, p_realm_id
  );
  RETURN jsonb_build_object('ok', true, 'reserved', true,
    'command_id', p_command_id, 'action', p_action);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'active-command-conflict');
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_qbo_invoice_command_reservation(
  p_command_id uuid, p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_reservation public.qbo_invoice_command_reservations;
  v_command public.qbo_invoice_commands;
  v_command_found boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  -- Lock the parent so a concurrent false→true manual lock observes either the
  -- reservation or its definitive local release, never an in-between state.
  PERFORM 1 FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found'); END IF;
  -- Keep the same command→reservation lock order as terminal state changes so
  -- a terminal retry and its original finalizer cannot deadlock each other.
  SELECT * INTO v_command
  FROM public.qbo_invoice_commands
  WHERE id = p_command_id
  FOR UPDATE;
  v_command_found := FOUND;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'released', false); END IF;
  IF v_reservation.command_id IS DISTINCT FROM p_command_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reservation-mismatch');
  END IF;
  -- A reservation with no ledger row is the pre-command/local-validation case.
  -- Once preparation has created a command, only its terminal state may release
  -- the manual-lock fence; service-role possession alone is not sufficient.
  IF v_command_found THEN
    IF v_command.invoice_id IS DISTINCT FROM p_invoice_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'command-mismatch');
    END IF;
    IF v_command.status NOT IN ('succeeded', 'rejected') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'command-not-terminal',
        'status', v_command.status);
    END IF;
  END IF;
  DELETE FROM public.qbo_invoice_command_reservations WHERE invoice_id = p_invoice_id;
  RETURN jsonb_build_object('ok', true, 'released', true);
END;
$function$;

-- Freeze, but do not apply, one safe line patch under the exact reservation.
-- The global order for every path that touches a line and its parent is
-- line→invoice→command→reservation. This matches direct desktop UPDATE plus its
-- AFTER trigger and prevents the previous parent→line inversion.
CREATE OR REPLACE FUNCTION public.stage_qbo_invoice_line_update(
  p_command_id uuid, p_invoice_id uuid, p_line_id uuid,
  p_actor_auth_user_id uuid, p_actor_employee_id uuid, p_initiator text, p_realm_id text,
  p_description text, p_qbo_item_id text, p_qbo_item_name text,
  p_qbo_class_id text, p_qbo_class_name text, p_quantity numeric, p_unit_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invoice public.invoices;
  v_command public.qbo_invoice_commands;
  v_reservation public.qbo_invoice_command_reservations;
  v_line public.invoice_line_items;
  v_command_found boolean := false;
  v_current jsonb;
  v_patch jsonb;
  v_frozen jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_invoice_id IS NULL OR p_line_id IS NULL
     OR p_initiator <> 'browser' OR p_actor_auth_user_id IS NULL OR p_realm_id IS NULL
     OR p_description IS NULL OR btrim(p_description) = '' OR length(p_description) > 4000
     OR p_quantity IS NULL OR p_unit_price IS NULL
     OR p_quantity IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_unit_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-line-update');
  END IF;

  SELECT * INTO v_line FROM public.invoice_line_items
  WHERE id = p_line_id AND invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'line-not-found'); END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found'); END IF;
  IF v_invoice.locked IS TRUE THEN RETURN jsonb_build_object('ok', false, 'reason', 'invoice-locked'); END IF;

  SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id = p_command_id FOR UPDATE;
  v_command_found := FOUND;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND
     OR v_reservation.command_id IS DISTINCT FROM p_command_id
     OR v_reservation.action IS DISTINCT FROM 'save'
     OR v_reservation.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
     OR v_reservation.actor_employee_id IS DISTINCT FROM p_actor_employee_id
     OR v_reservation.initiator IS DISTINCT FROM p_initiator
     OR v_reservation.realm_id IS DISTINCT FROM p_realm_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reservation-mismatch');
  END IF;
  IF v_command_found AND (
    v_command.invoice_id IS DISTINCT FROM p_invoice_id
    OR v_command.action IS DISTINCT FROM 'save'
    OR v_command.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR v_command.actor_employee_id IS DISTINCT FROM p_actor_employee_id
    OR v_command.initiator IS DISTINCT FROM p_initiator
    OR v_command.realm_id IS DISTINCT FROM p_realm_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'command-mismatch');
  END IF;

  v_current := jsonb_build_object(
    'description', v_line.description, 'qbo_item_id', v_line.qbo_item_id,
    'qbo_item_name', v_line.qbo_item_name, 'qbo_class_id', v_line.qbo_class_id,
    'qbo_class_name', v_line.qbo_class_name, 'quantity', v_line.quantity,
    'unit_price', v_line.unit_price
  );
  v_patch := jsonb_build_object(
    'description', p_description, 'qbo_item_id', p_qbo_item_id,
    'qbo_item_name', p_qbo_item_name, 'qbo_class_id', p_qbo_class_id,
    'qbo_class_name', p_qbo_class_name, 'quantity', p_quantity,
    'unit_price', p_unit_price
  );
  v_frozen := jsonb_build_object('line_id', p_line_id, 'preimage', v_current, 'patch', v_patch);
  IF v_command_found THEN
    IF jsonb_typeof(v_command.intent_payload->'line_update') IS DISTINCT FROM 'object'
       OR v_command.intent_payload->'line_update'->>'line_id' IS DISTINCT FROM p_line_id::text
       OR v_command.intent_payload->'line_update'->'patch' IS DISTINCT FROM v_patch THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch-conflict');
    END IF;
    v_frozen := v_command.intent_payload->'line_update';
    IF v_command.status IN ('prepared', 'provider_started', 'ambiguous', 'rejected')
       AND v_current IS DISTINCT FROM v_frozen->'preimage' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'source-mismatch');
    ELSIF v_command.status = 'succeeded'
       AND v_current IS DISTINCT FROM v_frozen->'patch' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'source-mismatch');
    ELSIF v_command.status IN ('provider_succeeded', 'needs_reconciliation')
       AND v_current IS DISTINCT FROM v_frozen->'preimage'
       AND v_current IS DISTINCT FROM v_frozen->'patch' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'source-mismatch');
    ELSIF v_command.status NOT IN (
      'prepared', 'provider_started', 'ambiguous', 'provider_succeeded',
      'needs_reconciliation', 'succeeded', 'rejected'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid-state');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'line_update', v_frozen);
END;
$function$;

-- Apply the frozen patch only after QuickBooks has definitively accepted the
-- provider operation. A current preimage is changed once; the exact patch is an
-- idempotent crash replay; every third state is a durable reconciliation case.
CREATE OR REPLACE FUNCTION public.finalize_qbo_invoice_line_update(
  p_command_id uuid, p_invoice_id uuid, p_line_id uuid,
  p_actor_auth_user_id uuid, p_actor_employee_id uuid, p_initiator text, p_realm_id text,
  p_description text, p_qbo_item_id text, p_qbo_item_name text,
  p_qbo_class_id text, p_qbo_class_name text, p_quantity numeric, p_unit_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invoice public.invoices;
  v_command public.qbo_invoice_commands;
  v_reservation public.qbo_invoice_command_reservations;
  v_line public.invoice_line_items;
  v_current jsonb;
  v_patch jsonb;
  v_frozen jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR p_invoice_id IS NULL OR p_line_id IS NULL
     OR p_initiator <> 'browser' OR p_actor_auth_user_id IS NULL OR p_realm_id IS NULL
     OR p_description IS NULL OR btrim(p_description) = '' OR length(p_description) > 4000
     OR p_quantity IS NULL OR p_unit_price IS NULL
     OR p_quantity IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_unit_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-line-update');
  END IF;
  SELECT * INTO v_line FROM public.invoice_line_items
  WHERE id = p_line_id AND invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'line-not-found'); END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found'); END IF;
  IF v_invoice.locked IS TRUE THEN RETURN jsonb_build_object('ok', false, 'reason', 'invoice-locked'); END IF;
  SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'command-not-found'); END IF;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND
     OR v_reservation.command_id IS DISTINCT FROM p_command_id
     OR v_reservation.action IS DISTINCT FROM 'save'
     OR v_reservation.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
     OR v_reservation.actor_employee_id IS DISTINCT FROM p_actor_employee_id
     OR v_reservation.initiator IS DISTINCT FROM p_initiator
     OR v_reservation.realm_id IS DISTINCT FROM p_realm_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reservation-mismatch');
  END IF;
  IF v_command.invoice_id IS DISTINCT FROM p_invoice_id
     OR v_command.action IS DISTINCT FROM 'save'
     OR v_command.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
     OR v_command.actor_employee_id IS DISTINCT FROM p_actor_employee_id
     OR v_command.initiator IS DISTINCT FROM p_initiator
     OR v_command.realm_id IS DISTINCT FROM p_realm_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'command-mismatch');
  END IF;
  IF v_command.status IS DISTINCT FROM 'provider_succeeded' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provider-not-succeeded', 'status', v_command.status);
  END IF;
  v_current := jsonb_build_object(
    'description', v_line.description, 'qbo_item_id', v_line.qbo_item_id,
    'qbo_item_name', v_line.qbo_item_name, 'qbo_class_id', v_line.qbo_class_id,
    'qbo_class_name', v_line.qbo_class_name, 'quantity', v_line.quantity,
    'unit_price', v_line.unit_price
  );
  v_patch := jsonb_build_object(
    'description', p_description, 'qbo_item_id', p_qbo_item_id,
    'qbo_item_name', p_qbo_item_name, 'qbo_class_id', p_qbo_class_id,
    'qbo_class_name', p_qbo_class_name, 'quantity', p_quantity,
    'unit_price', p_unit_price
  );
  v_frozen := v_command.intent_payload->'line_update';
  IF jsonb_typeof(v_frozen) IS DISTINCT FROM 'object'
     OR v_frozen->>'line_id' IS DISTINCT FROM p_line_id::text
     OR v_frozen->'patch' IS DISTINCT FROM v_patch THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch-conflict');
  END IF;
  IF v_current IS NOT DISTINCT FROM v_patch THEN
    RETURN jsonb_build_object('ok', true, 'applied', false, 'line', to_jsonb(v_line));
  END IF;
  IF v_current IS DISTINCT FROM v_frozen->'preimage' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source-mismatch');
  END IF;
  UPDATE public.invoice_line_items
  SET description = p_description,
      qbo_item_id = p_qbo_item_id,
      qbo_item_name = p_qbo_item_name,
      qbo_class_id = p_qbo_class_id,
      qbo_class_name = p_qbo_class_name,
      quantity = p_quantity,
      unit_price = p_unit_price
  WHERE id = v_line.id
  RETURNING * INTO v_line;
  RETURN jsonb_build_object('ok', true, 'applied', true, 'line', to_jsonb(v_line));
END;
$function$;

-- Policy evaluation cannot read the forced-RLS service-only reservation table
-- as authenticated. Keep that table private behind a caller-aware, boolean-only
-- predicate: it reveals no command identity or provider data and is false for
-- every caller outside the existing billing editor boundary.
CREATE OR REPLACE FUNCTION public.invoice_line_qbo_write_access(p_invoice_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT auth.role() = 'authenticated'
    AND public.billing_edit_access()
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = p_invoice_id AND i.locked IS FALSE
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.qbo_invoice_command_reservations r
      WHERE r.invoice_id = p_invoice_id
    );
$function$;
REVOKE EXECUTE ON FUNCTION public.invoice_line_qbo_write_access(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_line_qbo_write_access(uuid) TO authenticated;

-- Desktop billing users retain their direct draft editor. Once an invoice has
-- a durable QBO reservation, every browser/PostgREST line write is refused so
-- the service-only post-provider finalizer remains the only mutation path.
ALTER POLICY "invoice_lines_billing_write" ON public.invoice_line_items
  TO authenticated
  USING (public.invoice_line_qbo_write_access(invoice_id))
  WITH CHECK (public.invoice_line_qbo_write_access(invoice_id));

-- RLS is the first fence, but its STABLE predicate uses the outer statement's
-- snapshot. A browser UPDATE that passed RLS just before a reservation commit
-- must recheck after it owns the exact line row. This VOLATILE trigger takes
-- the parent next, so reservation acquisition and direct edits serialize in the
-- global line→invoice order. Queries executed by a volatile PL/pgSQL function
-- under READ COMMITTED use a fresh execution snapshot after a blocked parent
-- lock is acquired. Service-role finalization already proves the exact command
-- and bypasses this browser-only defense.
CREATE OR REPLACE FUNCTION public.guard_invoice_line_write_during_qbo_command()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invoice_id uuid;
  v_invoice_ids uuid[];
  v_locked boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_invoice_ids := ARRAY[NEW.invoice_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_invoice_ids := ARRAY[OLD.invoice_id];
  ELSE
    v_invoice_ids := ARRAY[OLD.invoice_id, NEW.invoice_id];
  END IF;

  FOR v_invoice_id IN
    SELECT DISTINCT candidate
    FROM unnest(v_invoice_ids) AS candidate
    WHERE candidate IS NOT NULL
    ORDER BY candidate
  LOOP
    SELECT i.locked INTO v_locked
    FROM public.invoices i
    WHERE i.id = v_invoice_id
    FOR UPDATE;
    IF NOT FOUND OR v_locked IS TRUE THEN
      RAISE EXCEPTION 'INVOICE_QBO_WRITE_FENCED: invoice is missing or locked'
        USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.qbo_invoice_command_reservations r
      WHERE r.invoice_id = v_invoice_id
    ) OR EXISTS (
      SELECT 1 FROM public.qbo_invoice_commands c
      WHERE c.invoice_id = v_invoice_id
        AND c.status IN (
          'prepared', 'provider_started', 'ambiguous',
          'provider_succeeded', 'needs_reconciliation'
        )
    ) THEN
      RAISE EXCEPTION 'INVOICE_QBO_COMMAND_ACTIVE: resolve the QuickBooks command before editing invoice lines'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.guard_invoice_line_write_during_qbo_command()
  FROM PUBLIC, anon, authenticated, service_role;

DO $preflight_line_trigger$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.invoice_line_items'::regclass
      AND tgname = 'trg_invoice_lines_guard_qbo_command_write'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_invoice_lines_guard_qbo_command_write already exists';
  END IF;
END;
$preflight_line_trigger$;
CREATE TRIGGER trg_invoice_lines_guard_qbo_command_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_line_write_during_qbo_command();

-- The invoice row lock makes reservation and manual locking mutually serial.
-- Legacy active command rows are included so no pre-migration command can be
-- bypassed during a rolling deploy. There is intentionally no lease/TTL.
CREATE OR REPLACE FUNCTION public.guard_invoice_lock_during_qbo_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.locked IS TRUE AND OLD.locked IS FALSE THEN
    IF EXISTS (SELECT 1 FROM public.qbo_invoice_command_reservations r WHERE r.invoice_id = NEW.id) THEN
      RAISE EXCEPTION 'INVOICE_QBO_COMMAND_ACTIVE: resolve the QuickBooks command before locking this invoice'
        USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.qbo_invoice_commands c
      WHERE c.invoice_id = NEW.id
        AND c.status IN ('prepared', 'provider_started', 'ambiguous', 'provider_succeeded', 'needs_reconciliation')
    ) THEN
      RAISE EXCEPTION 'INVOICE_QBO_COMMAND_ACTIVE: resolve the QuickBooks command before locking this invoice'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DO $preflight_trigger$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.invoices'::regclass
      AND tgname = 'trg_invoices_guard_qbo_command_lock'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_invoices_guard_qbo_command_lock already exists';
  END IF;
END;
$preflight_trigger$;
CREATE TRIGGER trg_invoices_guard_qbo_command_lock
  BEFORE UPDATE OF locked ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_lock_during_qbo_command();

-- Existing command preparation keeps its deployed signature, but cannot create
-- or resume provider work unless this exact durable reservation owns the parent.
CREATE OR REPLACE FUNCTION public.prepare_qbo_invoice_command(
  p_command_id uuid, p_invoice_id uuid, p_action text, p_actor_auth_user_id uuid,
  p_actor_employee_id uuid, p_initiator text, p_realm_id text,
  p_expected_qbo_invoice_id text, p_target_qbo_invoice_id text,
  p_intent_hash text, p_intent_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_command public.qbo_invoice_commands; v_invoice public.invoices;
  v_reservation public.qbo_invoice_command_reservations; v_active public.qbo_invoice_commands;
  v_command_found boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('save', 'send', 'delete') OR p_initiator NOT IN ('browser', 'webhook')
    OR (p_initiator = 'browser' AND p_actor_auth_user_id IS NULL)
    OR (p_initiator = 'webhook' AND (p_actor_auth_user_id IS NOT NULL OR p_actor_employee_id IS NOT NULL))
    OR p_intent_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_intent_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid-command');
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invoice-not-found'); END IF;
  IF v_invoice.locked IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice-locked');
  END IF;
  -- Existing state transitions lock command→reservation. Follow the same
  -- order on replay so prepare cannot deadlock a concurrent terminal cleanup.
  SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id = p_command_id FOR UPDATE;
  v_command_found := FOUND;
  IF NOT v_command_found THEN
    -- Rolling-deploy compatibility: the currently deployed Worker reaches
    -- prepare without the new pre-intent reserve call. It may establish the
    -- fence here only when no other active command exists. The new Worker calls
    -- reserve_qbo_invoice_command before intent/customer work, so this branch
    -- disappears from normal traffic as soon as both origins are updated.
    SELECT * INTO v_active
    FROM public.qbo_invoice_commands
    WHERE invoice_id = p_invoice_id
      AND status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation')
    FOR UPDATE;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'active-command-conflict',
        'command_id', v_active.id, 'status', v_active.status);
    END IF;
  END IF;
  SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations
   WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.qbo_invoice_command_reservations (
      invoice_id, command_id, action, actor_auth_user_id, actor_employee_id, initiator, realm_id
    ) VALUES (
      p_invoice_id, p_command_id, p_action, p_actor_auth_user_id,
      p_actor_employee_id, p_initiator, p_realm_id
    );
  ELSIF v_reservation.command_id IS DISTINCT FROM p_command_id
     OR v_reservation.action IS DISTINCT FROM p_action
     OR v_reservation.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
     OR v_reservation.actor_employee_id IS DISTINCT FROM p_actor_employee_id
     OR v_reservation.initiator IS DISTINCT FROM p_initiator
     OR v_reservation.realm_id IS DISTINCT FROM p_realm_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reservation-mismatch');
  END IF;
  IF v_command_found THEN
    IF v_command.invoice_id IS DISTINCT FROM p_invoice_id OR v_command.action IS DISTINCT FROM p_action
      OR v_command.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id OR v_command.actor_employee_id IS DISTINCT FROM p_actor_employee_id
      OR v_command.initiator IS DISTINCT FROM p_initiator OR v_command.realm_id IS DISTINCT FROM p_realm_id
      OR v_command.expected_qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id OR v_command.target_qbo_invoice_id IS DISTINCT FROM p_target_qbo_invoice_id
      OR v_command.intent_hash IS DISTINCT FROM p_intent_hash OR v_command.intent_payload IS DISTINCT FROM p_intent_payload THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'idempotency-key-mismatch');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'command_id', v_command.id, 'status', v_command.status,
      'provider_stage', v_command.provider_stage, 'response_status', v_command.response_status, 'response_payload', v_command.response_payload);
  END IF;
  INSERT INTO public.qbo_invoice_commands (id,invoice_id,action,actor_auth_user_id,actor_employee_id,initiator,realm_id,expected_qbo_invoice_id,target_qbo_invoice_id,intent_hash,intent_payload)
  VALUES (p_command_id,p_invoice_id,p_action,p_actor_auth_user_id,p_actor_employee_id,p_initiator,p_realm_id,p_expected_qbo_invoice_id,p_target_qbo_invoice_id,p_intent_hash,p_intent_payload);
  RETURN jsonb_build_object('ok', true, 'prepared', true, 'command_id', p_command_id, 'status', 'prepared');
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok', false, 'reason', 'active-command-conflict');
END;
$function$;

-- Attempt mutation is still frozen exactly as before, now additionally tied to
-- the reservation that prevented a manual lock during intent construction.
CREATE OR REPLACE FUNCTION public.start_qbo_invoice_command_attempt(
 p_command_id uuid,p_provider_stage text,p_provider_action text,p_provider_target_id text,p_provider_request_id text,p_provider_payload jsonb,p_provider_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands; v_reservation public.qbo_invoice_command_reservations;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 IF p_provider_stage IS NULL OR p_provider_action IS NULL OR p_provider_request_id IS NULL OR (p_provider_target_id IS NULL AND p_provider_action <> 'create') OR jsonb_typeof(p_provider_payload) <> 'object' OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-attempt'); END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations WHERE invoice_id=v_command.invoice_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.command_id IS DISTINCT FROM p_command_id OR v_reservation.action IS DISTINCT FROM v_command.action OR v_reservation.actor_auth_user_id IS DISTINCT FROM v_command.actor_auth_user_id OR v_reservation.actor_employee_id IS DISTINCT FROM v_command.actor_employee_id OR v_reservation.initiator IS DISTINCT FROM v_command.initiator OR v_reservation.realm_id IS DISTINCT FROM v_command.realm_id THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
 IF v_command.status IN ('provider_started','ambiguous') THEN
  IF v_command.provider_stage IS DISTINCT FROM p_provider_stage OR v_command.provider_action IS DISTINCT FROM p_provider_action OR v_command.provider_target_id IS DISTINCT FROM p_provider_target_id OR v_command.provider_request_id IS DISTINCT FROM p_provider_request_id OR v_command.provider_payload IS DISTINCT FROM p_provider_payload OR v_command.provider_payload_hash IS DISTINCT FROM p_provider_payload_hash THEN RETURN jsonb_build_object('ok',false,'reason','attempt-mismatch'); END IF;
  RETURN jsonb_build_object('ok',true,'replay',true,'status',v_command.status,'provider_stage',v_command.provider_stage,'provider_action',v_command.provider_action,'provider_target_id',v_command.provider_target_id,'provider_request_id',v_command.provider_request_id,'provider_payload',v_command.provider_payload,'provider_payload_hash',v_command.provider_payload_hash);
 END IF;
 IF v_command.status <> 'prepared' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-state','status',v_command.status); END IF;
 UPDATE public.qbo_invoice_commands SET status='provider_started',provider_stage=p_provider_stage,provider_action=p_provider_action,provider_target_id=p_provider_target_id,provider_request_id=p_provider_request_id,provider_payload=p_provider_payload,provider_payload_hash=p_provider_payload_hash,provider_started_at=now(),error=NULL,updated_at=now() WHERE id=p_command_id;
 RETURN jsonb_build_object('ok',true,'started',true,'status','provider_started','provider_stage',p_provider_stage,'provider_action',p_provider_action,'provider_target_id',p_provider_target_id,'provider_request_id',p_provider_request_id,'provider_payload',p_provider_payload,'provider_payload_hash',p_provider_payload_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_qbo_invoice_command_attempt(
 p_command_id uuid,p_expected_provider_stage text,p_provider_stage text,p_provider_action text,p_provider_target_id text,p_provider_request_id text,p_provider_payload jsonb,p_provider_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands; v_reservation public.qbo_invoice_command_reservations;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 IF p_expected_provider_stage IS NULL OR p_provider_stage IS NULL OR p_provider_action IS NULL OR p_provider_request_id IS NULL OR (p_provider_target_id IS NULL AND p_provider_action <> 'create') OR jsonb_typeof(p_provider_payload) <> 'object' OR p_provider_payload_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-attempt'); END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 SELECT * INTO v_reservation FROM public.qbo_invoice_command_reservations WHERE invoice_id=v_command.invoice_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.command_id IS DISTINCT FROM p_command_id OR v_reservation.action IS DISTINCT FROM v_command.action OR v_reservation.actor_auth_user_id IS DISTINCT FROM v_command.actor_auth_user_id OR v_reservation.actor_employee_id IS DISTINCT FROM v_command.actor_employee_id OR v_reservation.initiator IS DISTINCT FROM v_command.initiator OR v_reservation.realm_id IS DISTINCT FROM v_command.realm_id THEN RETURN jsonb_build_object('ok',false,'reason','reservation-mismatch'); END IF;
 IF v_command.status <> 'provider_started' THEN RETURN jsonb_build_object('ok',false,'reason','invalid-state','status',v_command.status); END IF;
 IF v_command.provider_stage = p_provider_stage AND v_command.provider_action IS NOT DISTINCT FROM p_provider_action AND v_command.provider_target_id IS NOT DISTINCT FROM p_provider_target_id AND v_command.provider_request_id IS NOT DISTINCT FROM p_provider_request_id AND v_command.provider_payload IS NOT DISTINCT FROM p_provider_payload AND v_command.provider_payload_hash IS NOT DISTINCT FROM p_provider_payload_hash THEN RETURN jsonb_build_object('ok',true,'replay',true,'status',v_command.status,'provider_stage',v_command.provider_stage,'provider_action',v_command.provider_action,'provider_target_id',v_command.provider_target_id,'provider_request_id',v_command.provider_request_id,'provider_payload',v_command.provider_payload,'provider_payload_hash',v_command.provider_payload_hash); END IF;
 IF v_command.provider_stage IS DISTINCT FROM p_expected_provider_stage THEN RETURN jsonb_build_object('ok',false,'reason','attempt-mismatch','provider_stage',v_command.provider_stage); END IF;
 UPDATE public.qbo_invoice_commands SET provider_stage=p_provider_stage,provider_action=p_provider_action,provider_target_id=p_provider_target_id,provider_request_id=p_provider_request_id,provider_payload=p_provider_payload,provider_payload_hash=p_provider_payload_hash,updated_at=now() WHERE id=p_command_id RETURNING * INTO v_command;
 RETURN jsonb_build_object('ok',true,'advanced',true,'status',v_command.status,'provider_stage',v_command.provider_stage,'provider_action',v_command.provider_action,'provider_target_id',v_command.provider_target_id,'provider_request_id',v_command.provider_request_id,'provider_payload',v_command.provider_payload,'provider_payload_hash',v_command.provider_payload_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_qbo_invoice_command_state(
 p_command_id uuid,p_status text,p_provider_result jsonb DEFAULT NULL,p_response_status integer DEFAULT NULL,p_response_payload jsonb DEFAULT NULL,p_error text DEFAULT NULL,p_intuit_request_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_command public.qbo_invoice_commands; v_allowed boolean:=false;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_command FROM public.qbo_invoice_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','command-not-found'); END IF;
 v_allowed := (v_command.status='prepared' AND p_status IN ('succeeded','rejected')) OR (v_command.status='provider_started' AND p_status IN ('ambiguous','provider_succeeded','rejected')) OR (v_command.status='ambiguous' AND p_status IN ('provider_succeeded','needs_reconciliation','rejected')) OR (v_command.status='provider_succeeded' AND p_status IN ('succeeded','needs_reconciliation')) OR (v_command.status='needs_reconciliation' AND p_status IN ('provider_started','provider_succeeded','succeeded','rejected'));
 IF NOT v_allowed THEN RETURN jsonb_build_object('ok',false,'reason','invalid-transition','status',v_command.status); END IF;
 IF v_command.status='prepared' AND p_status='succeeded' AND (p_response_status IS NULL OR p_response_payload IS NULL) THEN RETURN jsonb_build_object('ok',false,'reason','terminal-response-required','status',v_command.status); END IF;
 UPDATE public.qbo_invoice_commands SET status=p_status,provider_result=COALESCE(p_provider_result,provider_result),response_status=COALESCE(p_response_status,response_status),response_payload=COALESCE(p_response_payload,response_payload),error=p_error,intuit_request_id=COALESCE(p_intuit_request_id,intuit_request_id),provider_succeeded_at=CASE WHEN p_status='provider_succeeded' THEN now() ELSE provider_succeeded_at END,completed_at=CASE WHEN p_status IN ('succeeded','rejected') THEN now() ELSE completed_at END,updated_at=now() WHERE id=p_command_id RETURNING * INTO v_command;
 IF p_status IN ('succeeded','rejected') THEN
   DELETE FROM public.qbo_invoice_command_reservations WHERE invoice_id=v_command.invoice_id AND command_id=p_command_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'command_id',v_command.id,'status',v_command.status,'provider_stage',v_command.provider_stage,'response_status',v_command.response_status,'response_payload',v_command.response_payload);
END;
$function$;

-- Preserve the deployed signature while making a post-provider manual lock a
-- durable reconciliation result rather than silently changing a locked invoice.
CREATE OR REPLACE FUNCTION public.cas_qbo_invoice_link(
 p_invoice_id uuid,p_expected_qbo_invoice_id text,p_new_qbo_invoice_id text,p_qbo_doc_number text DEFAULT NULL,p_qbo_emailed_at timestamptz DEFAULT NULL,p_qbo_email_status text DEFAULT NULL,p_sent_to_email text DEFAULT NULL,p_write_email_metadata boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_invoice public.invoices;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized: service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_invoice FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','invoice-not-found'); END IF;
 IF v_invoice.locked IS TRUE THEN RETURN jsonb_build_object('ok',false,'reason','invoice-locked','current_qbo_invoice_id',v_invoice.qbo_invoice_id); END IF;
 IF v_invoice.qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id THEN
   IF v_invoice.qbo_invoice_id IS NOT DISTINCT FROM p_new_qbo_invoice_id THEN RETURN jsonb_build_object('ok',true,'id',v_invoice.id,'job_id',v_invoice.job_id,'contact_id',v_invoice.contact_id,'invoice_number',v_invoice.invoice_number,'qbo_doc_number',v_invoice.qbo_doc_number,'qbo_invoice_id',v_invoice.qbo_invoice_id,'idempotent',true); END IF;
   RETURN jsonb_build_object('ok',false,'reason','qbo-invoice-mismatch','current_qbo_invoice_id',v_invoice.qbo_invoice_id);
 END IF;
 UPDATE public.invoices SET qbo_invoice_id=p_new_qbo_invoice_id,qbo_synced_at=CASE WHEN p_new_qbo_invoice_id IS NULL THEN NULL ELSE now() END,qbo_doc_number=CASE WHEN p_new_qbo_invoice_id IS NULL THEN NULL ELSE COALESCE(p_qbo_doc_number,qbo_doc_number) END,qbo_emailed_at=CASE WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL WHEN p_write_email_metadata THEN p_qbo_emailed_at ELSE qbo_emailed_at END,qbo_email_status=CASE WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL WHEN p_write_email_metadata THEN p_qbo_email_status ELSE qbo_email_status END,sent_to_email=CASE WHEN p_new_qbo_invoice_id IS DISTINCT FROM v_invoice.qbo_invoice_id THEN NULL WHEN p_write_email_metadata THEN p_sent_to_email ELSE sent_to_email END,qbo_sync_error=NULL,updated_at=now() WHERE id=v_invoice.id RETURNING * INTO v_invoice;
 RETURN jsonb_build_object('ok',true,'id',v_invoice.id,'job_id',v_invoice.job_id,'contact_id',v_invoice.contact_id,'invoice_number',v_invoice.invoice_number,'qbo_doc_number',v_invoice.qbo_doc_number,'qbo_invoice_id',v_invoice.qbo_invoice_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserve_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.release_qbo_invoice_command_reservation(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_qbo_invoice_command_reservation(uuid,uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) TO service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) TO service_role;
REVOKE EXECUTE ON FUNCTION public.guard_invoice_lock_during_qbo_command() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guard_invoice_line_write_during_qbo_command() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prepare_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_qbo_invoice_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.start_qbo_invoice_command_attempt(uuid,text,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_qbo_invoice_command_attempt(uuid,text,text,text,text,jsonb,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.advance_qbo_invoice_command_attempt(uuid,text,text,text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_qbo_invoice_command_attempt(uuid,text,text,text,text,text,jsonb,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_qbo_invoice_command_state(uuid,text,jsonb,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_qbo_invoice_command_state(uuid,text,jsonb,integer,jsonb,text,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cas_qbo_invoice_link(uuid,text,text,text,timestamptz,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cas_qbo_invoice_link(uuid,text,text,text,timestamptz,text,text,boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
