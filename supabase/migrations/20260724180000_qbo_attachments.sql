-- ════════════════════════════════════════════════
-- MIGRATION: 20260724180000_qbo_attachments
-- Phase: QBO Payments — invoice/estimate attachments (n/a standalone)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one small tracking table so UPR can remember which files it has attached
--   to a QuickBooks invoice or estimate. The file itself lives in QuickBooks (we
--   push it there via the Attachable API so it rides along on the email the
--   customer gets); this table just records the QuickBooks attachment id, the file
--   name/size, and whether it is included when QuickBooks emails the document — so
--   the invoice/estimate editor can list the attachments and remove one.
--
-- ADDITIVE-ONLY:
--   New table + its RLS policy + indexes. No change to any existing table, column,
--   policy, function, or data. No secret is stored (file bytes never touch this
--   table — only metadata + the opaque QuickBooks attachable id).
--
-- AUTHORIZATION (database-standard.md §1 / docs/auth-and-authorization.md):
--   This is a NEW table, so it does NOT inherit the documented-broad
--   "any authenticated" read pattern of invoices/estimates (that pattern is a known
--   finding to fix, not a template). SELECT is scoped to ACTIVE admin/manager
--   employees — the same billing role (BILLING_EDIT_ROLES / canEditBilling) that the
--   qbo-attach worker enforces and that manages billing. Writes are performed ONLY
--   by that service-role worker (bypasses RLS), so there is deliberately no
--   INSERT/UPDATE/DELETE policy for browser roles.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.qbo_attachments;   -- (drops its policy + indexes)
-- ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.qbo_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       text NOT NULL CHECK (entity_type IN ('invoice', 'estimate')),
  invoice_id        uuid REFERENCES public.invoices(id)  ON DELETE CASCADE,
  estimate_id       uuid REFERENCES public.estimates(id) ON DELETE CASCADE,
  qbo_attachable_id text NOT NULL,
  file_name         text NOT NULL,
  content_type      text,
  file_size         bigint,
  include_on_send   boolean NOT NULL DEFAULT true,
  -- Client-supplied stable key so a retried attach can't create a duplicate row
  -- (and, with the pre-check in the worker, a duplicate QuickBooks Attachable).
  idempotency_key   text UNIQUE,
  created_by        uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Never record the same QuickBooks attachment twice.
  CONSTRAINT qbo_attachments_qbo_id_unique UNIQUE (qbo_attachable_id),
  -- Exactly one parent, and it must match entity_type.
  CONSTRAINT qbo_attachments_one_parent CHECK (
    (entity_type = 'invoice'  AND invoice_id  IS NOT NULL AND estimate_id IS NULL) OR
    (entity_type = 'estimate' AND estimate_id IS NOT NULL AND invoice_id  IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_qbo_attachments_invoice  ON public.qbo_attachments(invoice_id)  WHERE invoice_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qbo_attachments_estimate ON public.qbo_attachments(estimate_id) WHERE estimate_id IS NOT NULL;

ALTER TABLE public.qbo_attachments ENABLE ROW LEVEL SECURITY;

-- Read: active admin/manager employees only (the billing role). Not a copy of the
-- broad invoices/estimates "any authenticated" policy — see AUTHORIZATION note above.
DROP POLICY IF EXISTS qbo_attachments_select ON public.qbo_attachments;
CREATE POLICY qbo_attachments_select ON public.qbo_attachments
  FOR SELECT TO authenticated
  USING (
    NOT is_crm_partner(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.auth_user_id = auth.uid()
        AND e.is_active
        AND e.role IN ('admin', 'manager')
    )
  );
