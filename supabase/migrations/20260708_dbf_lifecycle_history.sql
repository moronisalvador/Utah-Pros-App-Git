-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_lifecycle_history.sql
-- DB-Foundation Phase F — status-history capture for claims + invoices  [item ⑤]
--   docs/db-foundation-roadmap.md → Phase F block.
--
-- WHAT THIS DOES (plain language):
--   Records every change to a claim's or an invoice's status into an append-only
--   history table, so the business can answer "when did this claim move to
--   approved / this invoice to paid, and from what?" — an audit trail the app
--   never had. Two new read-only history tables, plus a trigger on each parent
--   that files a row whenever (and ONLY when) status actually changes.
--
-- SAFETY (these are triggers on HOT FINANCIAL tables — treated with care):
--   • WHEN (OLD.status IS DISTINCT FROM NEW.status): the trigger fires ONLY on a
--     real status change — never a bare AFTER UPDATE (which would fire on every
--     edit and log no-op noise). Belt-and-suspenders: also scoped `OF status`.
--   • The trigger function is DEFENSIVE: the history INSERT is wrapped in its own
--     BEGIN/EXCEPTION block, so if history capture ever errors it degrades to a
--     WARNING and the parent claim/invoice UPDATE still commits. History can
--     never break a financial write.
--   • History tables are RLS-enabled, readable by authenticated staff, writable
--     only by the SECURITY DEFINER trigger (clients get no write policy); anon
--     gets nothing.
--
-- ADDITIVE: new tables/functions/triggers only; no change to claims/invoices
--   columns. One shared Supabase (dev + prod) — live in both on apply. Seeds a
--   current-state baseline row per existing claim/invoice (idempotent).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_claim_status_history ON public.claims;
--   DROP TRIGGER IF EXISTS trg_invoice_status_history ON public.invoices;
--   DROP FUNCTION IF EXISTS public.capture_claim_status_history();
--   DROP FUNCTION IF EXISTS public.capture_invoice_status_history();
--   DROP TABLE IF EXISTS public.claim_status_history;
--   DROP TABLE IF EXISTS public.invoice_status_history;
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. History tables (append-only, RLS on, authenticated-read) ─────────────
CREATE TABLE IF NOT EXISTS public.claim_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    uuid NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  from_status text,
  to_status   text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claim_status_history_claim
  ON public.claim_status_history (claim_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  from_status text,
  to_status   text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_status_history_invoice
  ON public.invoice_status_history (invoice_id, changed_at DESC);

ALTER TABLE public.claim_status_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_status_history ENABLE ROW LEVEL SECURITY;

-- Read-only for signed-in staff; NO write policy (only the definer trigger writes).
DROP POLICY IF EXISTS claim_status_history_read   ON public.claim_status_history;
DROP POLICY IF EXISTS invoice_status_history_read ON public.invoice_status_history;
CREATE POLICY claim_status_history_read   ON public.claim_status_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY invoice_status_history_read ON public.invoice_status_history
  FOR SELECT TO authenticated USING (true);

-- Explicit least-privilege grants (independent of default-privilege state).
REVOKE ALL ON public.claim_status_history   FROM anon;
REVOKE ALL ON public.invoice_status_history FROM anon;
GRANT SELECT ON public.claim_status_history   TO authenticated;
GRANT SELECT ON public.invoice_status_history TO authenticated;
GRANT ALL    ON public.claim_status_history   TO service_role;
GRANT ALL    ON public.invoice_status_history TO service_role;

-- ─── 2. Defensive capture functions ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.capture_claim_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.claim_status_history (claim_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  EXCEPTION WHEN OTHERS THEN
    -- History capture must NEVER roll back the parent claim write.
    RAISE WARNING 'capture_claim_status_history failed for claim %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_invoice_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.invoice_status_history (invoice_id, from_status, to_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'capture_invoice_status_history failed for invoice %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Trigger-only functions (a direct call errors — "can only be called as a
-- trigger"), but follow the database-standard §2 explicit-grant block anyway:
-- deny anon/PUBLIC, grant the trusted roles.
REVOKE ALL ON FUNCTION public.capture_claim_status_history()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capture_invoice_status_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capture_claim_status_history()   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_invoice_status_history() TO authenticated, service_role;

-- ─── 3. Triggers — fire ONLY on a real status change (never bare AFTER UPDATE) ─
DROP TRIGGER IF EXISTS trg_claim_status_history   ON public.claims;
DROP TRIGGER IF EXISTS trg_invoice_status_history ON public.invoices;

CREATE TRIGGER trg_claim_status_history
  AFTER UPDATE OF status ON public.claims
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.capture_claim_status_history();

CREATE TRIGGER trg_invoice_status_history
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.capture_invoice_status_history();

-- ─── 4. Seed a current-state baseline row per existing parent (idempotent) ────
INSERT INTO public.claim_status_history (claim_id, from_status, to_status, changed_at)
SELECT c.id, NULL, c.status, COALESCE(c.created_at, now())
FROM public.claims c
WHERE NOT EXISTS (SELECT 1 FROM public.claim_status_history h WHERE h.claim_id = c.id);

INSERT INTO public.invoice_status_history (invoice_id, from_status, to_status, changed_at)
SELECT i.id, NULL, i.status, COALESCE(i.created_at, now())
FROM public.invoices i
WHERE NOT EXISTS (SELECT 1 FROM public.invoice_status_history h WHERE h.invoice_id = i.id);
