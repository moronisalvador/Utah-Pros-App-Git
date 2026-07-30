-- ════════════════════════════════════════════════
-- ROLLBACK: 20260730120000_crm_lead_value_from_claim
-- ════════════════════════════════════════════════
--
-- Undoes the CRM lead-value feature: the three triggers, the six new
-- functions, the two added columns, and the body change to
-- crm_trg_invoice_created.
--
-- ORDER MATTERS: triggers first (they reference the functions), then the
-- functions, then the columns (the index/constraints go with them).
--
-- ON DATA: values already written to inbound_leads.value are correct billing
-- figures, not corruption, so this script does NOT erase them by default —
-- dropping value_source alone makes them indistinguishable from hand-entered
-- values, which is the safe resting state. If the owner wants a genuinely
-- clean slate, run the OPTIONAL block at the bottom BEFORE dropping the
-- columns.
-- ════════════════════════════════════════════════

-- ─── 1. Triggers ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS crm_invoice_lead_value_sync   ON public.invoices;
DROP TRIGGER IF EXISTS crm_job_claim_lead_value_sync ON public.jobs;
DROP TRIGGER IF EXISTS crm_claim_created_lead_link   ON public.claims;

-- ─── 2. Restore crm_trg_invoice_created's prior body ─────────────────────────
-- Verbatim from 20260721_crm_lead_value_sync.sql (the state immediately before
-- this migration): auto-advance to Won, then the single-invoice value sync.
CREATE OR REPLACE FUNCTION public.crm_trg_invoice_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.total, 0) > 0 AND NEW.contact_id IS NOT NULL THEN
    BEGIN
      PERFORM crm_auto_advance_leads(NEW.contact_id, 'Won');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_auto_advance_failed', 'invoice', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Won'));
    END;

    BEGIN
      PERFORM crm_sync_lead_value(NEW.contact_id, COALESCE(NEW.adjusted_total, NEW.total));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_lead_value_sync_failed', 'invoice', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── 3. Functions ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.crm_trg_invoice_lead_value()             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_trg_job_claim_lead_value()           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_trg_claim_created_lead_link()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_backfill_lead_values(integer)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_lead_value(uuid, numeric, uuid)      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_attach_claim_to_lead(uuid)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_recompute_lead_values_for_claim(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_recompute_lead_value(uuid)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_lead_claim_value(uuid)               FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.crm_trg_invoice_lead_value();
DROP FUNCTION IF EXISTS public.crm_trg_job_claim_lead_value();
DROP FUNCTION IF EXISTS public.crm_trg_claim_created_lead_link();
DROP FUNCTION IF EXISTS public.crm_backfill_lead_values(integer);
DROP FUNCTION IF EXISTS public.set_lead_value(uuid, numeric, uuid);
DROP FUNCTION IF EXISTS public.crm_attach_claim_to_lead(uuid);
DROP FUNCTION IF EXISTS public.crm_recompute_lead_values_for_claim(uuid);
DROP FUNCTION IF EXISTS public.crm_recompute_lead_value(uuid);
DROP FUNCTION IF EXISTS public.crm_lead_claim_value(uuid);

-- ─── 4. OPTIONAL: clear auto-written values before dropping the columns ──────
-- Only run this if the owner wants the board back to blank. It cannot be run
-- after step 5, because value_source is what identifies machine-written rows.
--   UPDATE public.inbound_leads
--      SET value = NULL
--    WHERE value_source = 'auto';

-- ─── 5. Columns (index and constraints drop with them) ───────────────────────
ALTER TABLE public.inbound_leads DROP COLUMN IF EXISTS claim_id;
ALTER TABLE public.inbound_leads DROP COLUMN IF EXISTS value_source;

NOTIFY pgrst, 'reload schema';
