-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: 20260804210000_invoice_activity
-- WHAT: Adds a private, append-only record of what happened to an invoice --
--       saved, emailed, message or recipient changed -- so staff can see who
--       did what and when. Also adds two inert columns that let a human review
--       the recipient and the customer-visible message before an invoice is
--       emailed. This is source only; it is not an apply request.
-- ADDITIVE-ONLY: new table, new columns, new indexes, new functions. No table
--       or column removal, no rename, no type change, no data change, and no
--       change to any existing function, trigger, policy or grant.
-- SECURITY: the activity record is service-owned. Browser roles hold no table
--       privilege at all and cannot write it; the one browser-readable path is
--       a definer projection that resolves the caller from auth.uid() and fails
--       closed. Reads are role-gated and paginated.
-- ROLLBACK: supabase/rollbacks/20260804210000_invoice_activity.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Send-review presentation columns ────────────────────────────────────────
-- Both are deliberately nullable with no default, so an invoice that predates
-- this migration and a frontend that does not know about them behave exactly as
-- before. They exist as STORED columns because the QuickBooks command ledger
-- rebuilds its payload from live invoice state and byte-compares it against the
-- frozen attempt (functions/api/qbo-invoice.js currentMatchesStoredAttempt). A
-- value that is not a deterministic read of a stored column would make every
-- retry a false "invoice changed" conflict.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_message text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS send_cc_email text;

COMMENT ON COLUMN public.invoices.customer_message IS
  'Staff-authored message shown to the customer on the QuickBooks invoice. NULL keeps the derived job/claim memo.';
COMMENT ON COLUMN public.invoices.send_cc_email IS
  'Optional single CC address applied as BillEmailCc before the QuickBooks send. NULL means no CC.';

-- ── Activity record ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  -- NULL actor means the event was not caused by a person (a provider callback
  -- or a scheduled job). It is never a stand-in for "we did not check".
  actor_employee_id uuid REFERENCES public.employees(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('employee', 'system', 'provider')),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
  -- Typed, because the recipient is the whole point of a send timeline. Keeping
  -- it out of free-form metadata is what lets the read projection decide whether
  -- a given role may see it.
  recipient_email text,
  cc_email text,
  -- Free-form structured detail. The customer-visible message body is NOT stored
  -- here: it lives on invoices.customer_message, and duplicating it would create
  -- a second copy to keep in sync and to redact.
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (
      jsonb_typeof(safe_metadata) = 'object'
      AND NOT (safe_metadata ?| ARRAY['token', 'secret', 'password', 'authorization', 'body', 'message'])
    ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_activity IS
  'Append-only record of invoice edits, saves, sends and provider outcomes. Service-owned; browser roles read only through get_invoice_activity.';

CREATE INDEX IF NOT EXISTS invoice_activity_invoice_occurred_idx
  ON public.invoice_activity (invoice_id, occurred_at DESC);

ALTER TABLE public.invoice_activity ENABLE ROW LEVEL SECURITY;
-- FORCE is the difference between "policies apply to most roles" and "policies
-- apply to everyone including the owner". The weaker plain ENABLE used by the
-- older invoice_status_history is what this deliberately does not copy.
ALTER TABLE public.invoice_activity FORCE ROW LEVEL SECURITY;

-- service_role is named in the REVOKE on purpose. This project's ALTER DEFAULT
-- PRIVILEGES grants ALL on every new table to service_role, so a bare
-- "GRANT SELECT, INSERT" would be additive on top of ALL and the append-only
-- claim below would be false -- UPDATE and DELETE would both still be held.
-- Revoking everything first and re-granting exactly two privileges is what
-- makes "append-only" true rather than aspirational.
REVOKE ALL ON TABLE public.invoice_activity FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.invoice_activity TO service_role;

DROP POLICY IF EXISTS invoice_activity_service_all ON public.invoice_activity;
CREATE POLICY invoice_activity_service_all ON public.invoice_activity
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Writer: service-only, actor re-validated in the database ────────────────
CREATE OR REPLACE FUNCTION public.record_invoice_activity(
  p_invoice_id uuid,
  p_actor_employee_id uuid,
  p_event_type text,
  p_recipient_email text DEFAULT NULL,
  p_cc_email text DEFAULT NULL,
  p_safe_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_kind text := 'system';
  v_id uuid;
BEGIN
  IF p_invoice_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: unknown invoice' USING errcode = '22023';
  END IF;

  -- A caller-supplied actor is a claim, not proof. Re-check it against the
  -- employee roster so a Worker cannot attribute an action to an arbitrary id.
  IF p_actor_employee_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: actor is not an active internal employee' USING errcode = '42501';
    END IF;
    v_actor_kind := 'employee';
  END IF;

  INSERT INTO public.invoice_activity (
    invoice_id, actor_employee_id, actor_kind, event_type, recipient_email, cc_email, safe_metadata
  ) VALUES (
    p_invoice_id, p_actor_employee_id, v_actor_kind, p_event_type,
    NULLIF(btrim(COALESCE(p_recipient_email, '')), ''),
    NULLIF(btrim(COALESCE(p_cc_email, '')), ''),
    COALESCE(p_safe_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── Reader: browser-callable projection, fails closed ───────────────────────
CREATE OR REPLACE FUNCTION public.get_invoice_activity(
  p_invoice_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_role text;
  v_total bigint;
  v_rows jsonb;
BEGIN
  SELECT e.role::text INTO v_role FROM public.employees e
  WHERE e.auth_user_id = auth.uid() AND e.is_active IS TRUE AND e.is_external IS FALSE;

  -- These are the real public.employee_role enum values. Note that 'manager',
  -- which src/lib/claimUtils.js BILLING_EDIT_ROLES still names, is NOT a member
  -- of that enum -- so naming it here would add a branch that can never be true.
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND (v_role IS NULL OR v_role NOT IN ('admin', 'office', 'project_manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: invoice activity access required' USING errcode = '42501';
  END IF;

  IF p_invoice_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: invalid invoice activity page' USING errcode = '22023';
  END IF;

  SELECT count(*) INTO v_total FROM public.invoice_activity a WHERE a.invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.occurred_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT a.id, a.event_type, a.actor_kind, a.occurred_at,
           a.recipient_email, a.cc_email, a.safe_metadata,
           -- public.employees has full_name/display_name; there is no `name`.
           COALESCE(e.display_name, e.full_name) AS actor_name
    FROM public.invoice_activity a
    LEFT JOIN public.employees e ON e.id = a.actor_employee_id
    WHERE a.invoice_id = p_invoice_id
    ORDER BY a.occurred_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('total', v_total, 'limit', p_limit, 'offset', p_offset, 'rows', v_rows);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_invoice_activity(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_activity(uuid,uuid,text,text,text,jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_invoice_activity(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_activity(uuid,integer,integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
