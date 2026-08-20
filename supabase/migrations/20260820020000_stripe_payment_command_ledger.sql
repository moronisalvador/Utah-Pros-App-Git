-- ════════════════════════════════════════════════
-- MIGRATION: 20260820020000_stripe_payment_command_ledger
-- Phase: Stripe Invoicing Portal — Phase 1
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds a private record of every accounting action a Stripe payment triggers,
--   written down BEFORE QuickBooks is called and updated after. If the network
--   drops halfway through, the retry finds the record, reuses the same request
--   number, and QuickBooks recognises it as the same request instead of making a
--   second payment. Nothing here changes an existing table, and nothing runs
--   until its switch is turned on.
--
-- WHY IT EXISTS:
--   The Stripe webhook was contained on 2026-08-11 (commit 4292afde) because it
--   wrote to UPR *and* QuickBooks with no durable record between them. Charge-level
--   idempotency protected the local `payments` row, but nothing protected the
--   provider call: if `createPayment` succeeded at Intuit and the response was
--   lost, a retry created a SECOND QuickBooks Payment for the same money. This
--   ledger closes that, mirroring `qbo_invoice_commands` (20260731210000).
--
-- ADDITIVE-ONLY:
--   One new forced-RLS service-only table, five service-only RPCs, and one
--   disabled feature-flag row. No table DROP/RENAME/ALTER COLUMN, no policy or
--   grant change on any existing object, no data change.
--
-- apply-tier: owner-gated: the hygiene checker flags three patterns here —
--   `UPDATE ... SET`, `INSERT`, and `CREATE UNIQUE INDEX`. All three are
--   confined to objects this migration itself creates: the UPDATEs live inside
--   the new function bodies and touch only `stripe_payment_commands`, and the
--   unique index is on that same table, which starts empty, so no live row can
--   collide. In substance a local run is blind to nothing here. But the checker
--   is text-based and cannot prove that confinement, and this is money-path
--   source — so it takes the owner's word rather than the author's assertion.
--   Deliberately not downgraded to `auto`.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260820020000_stripe_payment_command_ledger.rollback.sql
--   Drops the five RPCs, the table, and the feature-flag row. Safe because no
--   existing object is modified and the flag ships disabled, so nothing consumes
--   any of it until a later, separately-reviewed change turns it on.
-- ════════════════════════════════════════════════

-- ── The ledger ──────────────────────────────────────────────────────────────
-- Keyed on the Stripe object that caused the action, NOT on the invoice: one
-- Stripe charge legitimately produces several accounting actions (record the
-- payment, book the fee), and a payout produces one that belongs to no invoice
-- at all.
CREATE TABLE public.stripe_payment_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What Stripe object drove this, and which accounting action it is.
  stripe_object_id text NOT NULL,          -- ch_… | po_… | dp_…
  stripe_event_id text,                    -- evt_… for traceability; NOT the key
  action text NOT NULL CHECK (action IN (
    'record_payment', 'book_fee', 'transfer_payout', 'reverse_payment'
  )),

  -- Local targets. invoice_id is NULL for a payout transfer.
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,

  realm_id text NOT NULL,

  -- The frozen Intuit request id. This is the whole point of the table: it is
  -- generated once, before the first provider attempt, and reused verbatim on
  -- every retry so Intuit's own dedup recognises the repeat.
  provider_request_id text NOT NULL CHECK (length(provider_request_id) BETWEEN 1 AND 50),
  provider_target_id text,                 -- the QBO entity id once known

  -- Frozen intent, so a retry can prove it is the same operation.
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
  intent_payload jsonb NOT NULL CHECK (jsonb_typeof(intent_payload) = 'object'),

  status text NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared',            -- written down, no provider call yet
    'pending_settlement',  -- ACH submitted to the network; NOT money yet
    'provider_started',    -- provider call in flight; outcome unknown
    'ambiguous',           -- provider call failed indeterminately; retry SAME id
    'succeeded',
    'rejected',            -- definitively refused; will not be retried
    'needs_reconciliation' -- a human must look
  )),

  error text,
  intuit_request_id text,                  -- Intuit's own tid, for support
  response_payload jsonb,

  prepared_at timestamptz NOT NULL DEFAULT now(),
  provider_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_payment_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_payment_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_payment_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_payment_commands TO service_role;

CREATE POLICY stripe_payment_commands_service_role_only
  ON public.stripe_payment_commands
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- One command per (Stripe object, action). This is what makes a redelivered
-- Stripe event find the existing record instead of starting a second one.
CREATE UNIQUE INDEX stripe_payment_commands_object_action_uniq
  ON public.stripe_payment_commands (stripe_object_id, action);

CREATE INDEX stripe_payment_commands_open
  ON public.stripe_payment_commands (status, prepared_at)
  WHERE status IN ('prepared', 'pending_settlement', 'provider_started', 'ambiguous', 'needs_reconciliation');

CREATE INDEX stripe_payment_commands_invoice
  ON public.stripe_payment_commands (invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON TABLE public.stripe_payment_commands IS
  'Durable record of each accounting action a Stripe payment triggers. Written before the QuickBooks call so a lost response cannot become a duplicate QuickBooks Payment. Service-role only; see 20260820020000.';

-- ── Guard ───────────────────────────────────────────────────────────────────
-- Every routine below refuses any caller that is not the service role. The
-- predicate is auth.role(), NOT current_setting('request.jwt.claim.role') — the
-- legacy GUC is not populated by modern PostgREST and cannot ever match, which
-- is what broke all eight QBO receipt routines until 20260806034004. And it is
-- IS DISTINCT FROM, not <>, because auth.role() is NULL outside a PostgREST
-- request and `NULL <> 'x'` is NULL, which PL/pgSQL's IF treats as false —
-- silently skipping the guard.
CREATE OR REPLACE FUNCTION public.stripe_command_guard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stripe_command_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_command_guard() TO service_role;

-- ── Reserve ─────────────────────────────────────────────────────────────────
-- Claims (object, action) and freezes the provider request id. Returns the
-- EXISTING row when one is present, so a redelivered event or a retry always
-- gets back the same frozen identity rather than minting a new one.
CREATE OR REPLACE FUNCTION public.reserve_stripe_payment_command(
  p_stripe_object_id text,
  p_action text,
  p_realm_id text,
  p_provider_request_id text,
  p_intent_hash text,
  p_intent_payload jsonb,
  p_invoice_id uuid DEFAULT NULL,
  p_payment_id uuid DEFAULT NULL,
  p_stripe_event_id text DEFAULT NULL
)
RETURNS public.stripe_payment_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.stripe_payment_commands;
BEGIN
  PERFORM public.stripe_command_guard();

  INSERT INTO public.stripe_payment_commands (
    stripe_object_id, stripe_event_id, action, invoice_id, payment_id,
    realm_id, provider_request_id, intent_hash, intent_payload
  )
  VALUES (
    p_stripe_object_id, p_stripe_event_id, p_action, p_invoice_id, p_payment_id,
    p_realm_id, p_provider_request_id, p_intent_hash, p_intent_payload
  )
  ON CONFLICT (stripe_object_id, action) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.stripe_payment_commands
    WHERE stripe_object_id = p_stripe_object_id AND action = p_action
    FOR UPDATE;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_stripe_payment_command(
  text, text, text, text, text, jsonb, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_payment_command(
  text, text, text, text, text, jsonb, uuid, uuid, text
) TO service_role;

-- ── Mark in flight ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_stripe_payment_command(p_command_id uuid)
RETURNS public.stripe_payment_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.stripe_payment_commands;
BEGIN
  PERFORM public.stripe_command_guard();

  UPDATE public.stripe_payment_commands
  SET status = 'provider_started',
      provider_started_at = COALESCE(provider_started_at, now()),
      updated_at = now()
  WHERE id = p_command_id
    AND status IN ('prepared', 'pending_settlement', 'ambiguous')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_stripe_payment_command(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_stripe_payment_command(uuid) TO service_role;

-- ── Finalize ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_stripe_payment_command(
  p_command_id uuid,
  p_status text,
  p_provider_target_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_intuit_request_id text DEFAULT NULL,
  p_response_payload jsonb DEFAULT NULL,
  p_payment_id uuid DEFAULT NULL
)
RETURNS public.stripe_payment_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.stripe_payment_commands;
BEGIN
  PERFORM public.stripe_command_guard();

  IF p_status NOT IN ('pending_settlement', 'ambiguous', 'succeeded', 'rejected', 'needs_reconciliation') THEN
    RAISE EXCEPTION 'INVALID_STATUS %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.stripe_payment_commands
  SET status = p_status,
      provider_target_id = COALESCE(p_provider_target_id, provider_target_id),
      payment_id = COALESCE(p_payment_id, payment_id),
      error = p_error,
      intuit_request_id = COALESCE(p_intuit_request_id, intuit_request_id),
      response_payload = COALESCE(p_response_payload, response_payload),
      completed_at = CASE WHEN p_status IN ('succeeded', 'rejected') THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_command_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_stripe_payment_command(
  uuid, text, text, text, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stripe_payment_command(
  uuid, text, text, text, text, jsonb, uuid
) TO service_role;

-- ── Read ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stripe_payment_command(
  p_stripe_object_id text,
  p_action text
)
RETURNS public.stripe_payment_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.stripe_payment_commands;
BEGIN
  PERFORM public.stripe_command_guard();

  SELECT * INTO v_row
  FROM public.stripe_payment_commands
  WHERE stripe_object_id = p_stripe_object_id AND action = p_action;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_stripe_payment_command(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stripe_payment_command(text, text) TO service_role;

-- ── The switch ──────────────────────────────────────────────────────────────
-- Ships DISABLED. The restored webhook consumes this exactly like
-- feature:qbo_document_command_v2 — enabled = true AND force_disabled <> true —
-- so applying this migration changes no behaviour at all.
-- `category` is set explicitly: the column defaults to 'page', and this is not a
-- page. Siblings feature:billing / feature:twilio_live / feature:web_push all
-- carry 'feature'. `label` is NOT NULL, so it is supplied rather than defaulted.
INSERT INTO public.feature_flags (key, category, label, description, enabled, force_disabled)
VALUES (
  'feature:stripe_payment_command_v1',
  'feature',
  'Stripe payment projection (durable command boundary)',
  'Opens the Stripe webhook''s accounting projection. While false the webhook verifies the signature and refuses, exactly as the 2026-08-11 containment does.',
  false,
  false
)
ON CONFLICT (key) DO NOTHING;
