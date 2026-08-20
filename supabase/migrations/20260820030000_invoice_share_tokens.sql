-- ════════════════════════════════════════════════
-- MIGRATION: 20260820030000_invoice_share_tokens
-- Phase: Stripe Invoicing Portal — Phase 3
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Creates the secret links UPR sends customers so they can look at their
--   invoice and pay it, and the one read the public page uses. A link that has
--   been paid, cancelled or has expired still answers — so the page can say
--   which of those happened — but it stops handing out the customer's private
--   details.
--
-- WHY A SEPARATE TABLE:
--   It doubles as UPR's own send history. `cas_qbo_invoice_link` NULLs
--   `invoices.qbo_emailed_at`, `qbo_email_status` and `sent_to_email` whenever
--   the QuickBooks link changes, so those columns cannot be trusted to record
--   what UPR itself sent.
--
-- ADDITIVE-ONLY:
--   One new table, three functions, no change to any existing table, column,
--   policy, grant or row.
--
-- apply-tier: owner-gated: this GRANTS EXECUTE TO anon. That is the one thing
--   `database-standard.md` §2 requires a named allowlist entry for, and only the
--   owner may add that line. The grant is not legitimate under project law until
--   it exists — same posture as 20260807201000, which deliberately shipped the
--   same way. A local run also cannot prove what a real internet caller sees.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260820030000_invoice_share_tokens.rollback.sql
--   Drops the three functions and the table. Destroys any issued links, which
--   means every link already emailed to a customer stops working — recoverable
--   only by re-sending. It changes no invoice and no payment.
-- ════════════════════════════════════════════════

CREATE TABLE public.invoice_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,

  -- The whole capability. 122 bits of entropy; never truncate it for a prettier
  -- URL, because shortening an unauthenticated link that exposes claim data cuts
  -- real entropy rather than cosmetic length.
  token uuid NOT NULL DEFAULT gen_random_uuid(),

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'superseded')),
  expires_at timestamptz NOT NULL,

  -- UPR's own send record, independent of the QuickBooks columns.
  sent_to_email text,
  sent_at timestamptz,

  -- "Opened four times and still not paid" is a real collections signal.
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX invoice_shares_token_uniq ON public.invoice_shares (token);
CREATE INDEX invoice_shares_invoice ON public.invoice_shares (invoice_id, created_at DESC);
CREATE INDEX invoice_shares_active
  ON public.invoice_shares (expires_at)
  WHERE status = 'active';

ALTER TABLE public.invoice_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_shares FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invoice_shares TO service_role;

CREATE POLICY invoice_shares_service_role_only
  ON public.invoice_shares
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.invoice_shares IS
  'Secret customer links for an invoice, and UPR''s own send history. The browser never reads this table directly — only get_invoice_by_share_token(). See 20260820030000.';

-- ── Mint a link (service-role only; the send worker calls this) ─────────────
CREATE OR REPLACE FUNCTION public.create_invoice_share(
  p_invoice_id uuid,
  p_sent_to_email text DEFAULT NULL,
  p_expires_days integer DEFAULT 60,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.invoice_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.invoice_shares;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_expires_days IS NULL OR p_expires_days < 1 OR p_expires_days > 365 THEN
    RAISE EXCEPTION 'INVALID_EXPIRY' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = p_invoice_id) THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  -- Re-sending supersedes the previous link rather than leaving several live
  -- URLs for one invoice.
  UPDATE public.invoice_shares
  SET status = 'superseded', updated_at = now()
  WHERE invoice_id = p_invoice_id AND status = 'active';

  INSERT INTO public.invoice_shares (invoice_id, expires_at, sent_to_email, created_by)
  VALUES (p_invoice_id, now() + make_interval(days => p_expires_days), p_sent_to_email, p_created_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_invoice_share(uuid, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_share(uuid, text, integer, uuid) TO service_role;

-- ── Revoke a link (service-role only) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_invoice_share(p_share_id uuid)
RETURNS public.invoice_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.invoice_shares;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invoice_shares
  SET status = 'revoked', updated_at = now()
  WHERE id = p_share_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_invoice_share(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invoice_share(uuid) TO service_role;

-- ── The public read ─────────────────────────────────────────────────────────
--
-- The WHERE matches on the TOKEN ALONE, deliberately. The page picks which
-- screen to show — Pay / Already paid / Link expired / Not found — from the
-- returned row, so adding `AND status = 'active'` would collapse all four into
-- "this link was not found" and tell a customer who already paid that their
-- link is invalid. This is exactly the reasoning recorded for
-- get_sign_request_by_token in 20260808040000; do not "simplify" it.
--
-- What changes when the link is no longer actionable is the CONTENTS. One
-- `actionable` flag is computed once in a LATERAL so every branch below agrees
-- within a single call, and the private fields come back NULL: line items,
-- amounts, the customer's email, the loss address, the claim number and the
-- carrier. A spent or expired token then proves only that it once existed.
CREATE OR REPLACE FUNCTION public.get_invoice_by_share_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
  v_uuid uuid;
BEGIN
  -- A malformed token is "not found", never an error the caller can probe.
  BEGIN
    v_uuid := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  SELECT jsonb_build_object(
    'share_id',        s.id,
    'status',          s.status,
    'expires_at',      s.expires_at,
    'actionable',      a.actionable,
    'invoice_number',  COALESCE(i.qbo_doc_number, i.invoice_number),
    'invoice_status',  i.status,
    -- Money is shown only while the link is actionable. Once it is spent the
    -- page needs to say "this was paid", not restate the amounts.
    'total',           CASE WHEN a.actionable THEN COALESCE(i.adjusted_total, i.total) END,
    'amount_paid',     CASE WHEN a.actionable THEN i.amount_paid END,
    'balance_due',     CASE WHEN a.actionable THEN COALESCE(i.adjusted_total, i.total) - i.amount_paid END,
    'invoice_date',    CASE WHEN a.actionable THEN i.invoice_date END,
    'due_date',        CASE WHEN a.actionable THEN i.due_date END,
    'customer_name',   CASE WHEN a.actionable THEN c.name END,
    'customer_email',  CASE WHEN a.actionable THEN c.email END,
    'job_number',      CASE WHEN a.actionable THEN j.job_number END,
    'job_address',     CASE WHEN a.actionable THEN j.address END,
    'job_city',        CASE WHEN a.actionable THEN j.city END,
    'job_state',       CASE WHEN a.actionable THEN j.state END,
    'claim_number',    CASE WHEN a.actionable THEN cl.claim_number END,
    'insurance_carrier', CASE WHEN a.actionable THEN cl.insurance_carrier END,
    'lines',           CASE WHEN a.actionable THEN (
                          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'description', TRIM(BOTH ' ' FROM COALESCE(li.qbo_item_name || ' — ', '') || COALESCE(li.description, '')),
                            'quantity',    li.quantity,
                            'unit_price',  li.unit_price,
                            'line_total',  li.line_total
                          ) ORDER BY li.sort_order, li.created_at), '[]'::jsonb)
                          FROM public.invoice_line_items li WHERE li.invoice_id = i.id)
                        END,
    'payments',        CASE WHEN a.actionable THEN (
                          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'payment_date', p.payment_date,
                            'method',       p.payment_method,
                            'amount',       p.amount - COALESCE(p.refunded_amount, 0)
                          ) ORDER BY p.payment_date), '[]'::jsonb)
                          FROM public.payments p
                          WHERE p.invoice_id = i.id AND p.amount - COALESCE(p.refunded_amount, 0) > 0)
                        END
  )
  INTO v_result
  FROM public.invoice_shares s
  JOIN public.invoices i ON i.id = s.invoice_id
  LEFT JOIN public.jobs j ON j.id = i.job_id
  LEFT JOIN public.contacts c ON c.id = COALESCE(i.contact_id, j.primary_contact_id)
  LEFT JOIN public.claims cl ON cl.id = j.claim_id
  CROSS JOIN LATERAL (
    -- now() is the transaction timestamp, so every CASE above agrees.
    SELECT (
      s.status = 'active'
      AND s.expires_at > now()
      AND COALESCE(i.adjusted_total, i.total) - i.amount_paid > 0
    ) AS actionable
  ) a
  WHERE s.token = v_uuid;

  IF v_result IS NULL THEN RETURN NULL; END IF;

  -- Record the view. Cheap, bounded by holding the token, and "opened four times
  -- and still not paid" is a genuine collections signal.
  UPDATE public.invoice_shares
  SET first_opened_at = COALESCE(first_opened_at, now()),
      last_opened_at = now(),
      open_count = open_count + 1,
      updated_at = now()
  WHERE token = v_uuid;

  RETURN v_result;
END;
$$;

-- public: the customer-facing invoice page at /pay/:token is opened by an
-- unauthenticated client, so the invoice it must display has to be readable
-- before login. The token is the entire capability; a spent, revoked or expired
-- token returns status and expiry only, with every private field NULL.
-- REQUIRES a matching entry in .claude/rules/database-standard.md §2, which only
-- the owner may add. Until that line exists this grant is not legitimate under
-- project law and this migration must not be applied.
REVOKE EXECUTE ON FUNCTION public.get_invoice_by_share_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invoice_by_share_token(text) TO anon, authenticated, service_role;
