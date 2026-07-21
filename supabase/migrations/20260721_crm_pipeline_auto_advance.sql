-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_pipeline_auto_advance
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes the CRM leads pipeline move certain cards forward on its own,
--   instead of always waiting for a staff member to drag them. Four business
--   events now automatically push a customer's open leads to the right stage:
--   signing a work authorization, creating a real invoice (not just an
--   estimate) with a dollar amount, receiving a payment, and submitting an
--   estimate. The first three mean the job is won, so those leads jump to
--   "Won". Submitting an estimate means we made an offer, so those leads move
--   to "Estimate Sent". A lead that's already marked "Won" is never pulled
--   backward by a later event (e.g. a change-order estimate after the sale).
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One new SECURITY DEFINER helper function, four new trigger
--   functions, and four new AFTER triggers on existing tables (sign_requests,
--   invoices ×2, estimates). No table is created, dropped, or altered; no
--   column is added, renamed, or removed; no existing function's signature or
--   body changes.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP TRIGGER crm_sign_request_signed_advance ON sign_requests;
--   DROP TRIGGER crm_invoice_created_advance ON invoices;
--   DROP TRIGGER crm_invoice_paid_advance ON invoices;
--   DROP TRIGGER crm_estimate_submitted_advance ON estimates;
--   DROP FUNCTION public.crm_trg_sign_request_signed();
--   DROP FUNCTION public.crm_trg_invoice_created();
--   DROP FUNCTION public.crm_trg_invoice_paid();
--   DROP FUNCTION public.crm_trg_estimate_submitted();
--   DROP FUNCTION public.crm_auto_advance_leads(uuid, text);
--   Nothing else needs undoing — no data was altered, only future writes to
--   sign_requests/invoices/estimates start (or, on rollback, stop) nudging
--   the pipeline. Any lead already moved by a trigger stays wherever it is
--   (that's a correct pipeline state, not something to revert).
-- ════════════════════════════════════════════════

-- ─── Shared helper: move every open (non-Won) lead for a contact to a stage ──
-- "Open" = not already sitting in a Won stage. A Won lead is never moved
-- again by an automated trigger (a later change-order estimate, for example,
-- must not pull an already-sold job backward). Silently no-ops when the
-- contact has no leads, the org has no stage by that name, or the lead is
-- already exactly on that stage (avoids noisy duplicate history rows).
CREATE OR REPLACE FUNCTION public.crm_auto_advance_leads(
  p_contact_id uuid,
  p_stage_name text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead   record;
  v_is_won boolean;
  v_stage_id uuid;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_lead IN
    SELECT il.id, il.org_id, lps.stage_id AS current_stage_id
    FROM inbound_leads il
    LEFT JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
    WHERE il.contact_id = p_contact_id
      AND il.spam_flag = false
  LOOP
    v_is_won := false;
    IF v_lead.current_stage_id IS NOT NULL THEN
      SELECT is_won INTO v_is_won FROM pipeline_stages WHERE id = v_lead.current_stage_id;
    END IF;
    IF COALESCE(v_is_won, false) THEN
      CONTINUE; -- already Won — never move it again
    END IF;

    SELECT id INTO v_stage_id
    FROM pipeline_stages
    WHERE org_id = v_lead.org_id AND name = p_stage_name
    LIMIT 1;
    IF v_stage_id IS NULL OR v_stage_id = v_lead.current_stage_id THEN
      CONTINUE; -- no such stage for this org, or already there
    END IF;

    -- move_lead_to_stage's p_lost_reason is deliberately left NULL — these
    -- triggers only ever move a lead FORWARD (Won/Estimate Sent), never to
    -- Lost, and that param writes inbound_leads.lost_reason. The move itself
    -- is fully audited via lead_stage_history + system_events regardless.
    PERFORM move_lead_to_stage(v_lead.id, v_stage_id, NULL, NULL);
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_auto_advance_leads(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_auto_advance_leads(uuid, text) TO authenticated, service_role;

-- ─── Trigger 1: work authorization signed → Won ──────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_trg_sign_request_signed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.doc_type = 'work_auth' AND NEW.status = 'signed' AND NEW.contact_id IS NOT NULL THEN
    BEGIN
      PERFORM crm_auto_advance_leads(NEW.contact_id, 'Won');
    EXCEPTION WHEN OTHERS THEN
      -- Pipeline bookkeeping must NEVER block the underlying sign_requests
      -- write (a real signed contract). Log and move on.
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_auto_advance_failed', 'sign_request', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Won'));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_sign_request_signed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_trg_sign_request_signed() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_sign_request_signed_advance ON sign_requests;
CREATE TRIGGER crm_sign_request_signed_advance
  AFTER INSERT OR UPDATE OF status ON sign_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_sign_request_signed();

-- ─── Trigger 2: a real invoice (not an estimate) is created with an amount ───
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
      -- Pipeline bookkeeping must NEVER block the underlying invoice write
      -- (real money). Log and move on.
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_auto_advance_failed', 'invoice', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Won'));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_invoice_created() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_trg_invoice_created() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_invoice_created_advance ON invoices;
CREATE TRIGGER crm_invoice_created_advance
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_invoice_created();

-- ─── Trigger 3: payment received on an invoice ───────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_trg_invoice_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.amount_paid, 0) > 0
     AND COALESCE(OLD.amount_paid, 0) = 0
     AND NEW.contact_id IS NOT NULL THEN
    BEGIN
      PERFORM crm_auto_advance_leads(NEW.contact_id, 'Won');
    EXCEPTION WHEN OTHERS THEN
      -- Pipeline bookkeeping must NEVER block the underlying payment write
      -- (real money). Log and move on.
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_auto_advance_failed', 'invoice', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Won'));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_invoice_paid() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_trg_invoice_paid() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_invoice_paid_advance ON invoices;
CREATE TRIGGER crm_invoice_paid_advance
  AFTER UPDATE OF amount_paid ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_invoice_paid();

-- ─── Trigger 4: estimate submitted (this schema's "sent") → Estimate Sent ────
-- NOTE: estimates.status has no literal 'sent' value — its CHECK constraint is
-- draft/submitted/under_review/approved/denied/revised/paid. 'submitted' is
-- the closest real-world equivalent of "we sent the customer/carrier an
-- estimate" and is what this trigger fires on.
CREATE OR REPLACE FUNCTION public.crm_trg_estimate_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'submitted' AND NEW.contact_id IS NOT NULL THEN
    BEGIN
      PERFORM crm_auto_advance_leads(NEW.contact_id, 'Estimate Sent');
    EXCEPTION WHEN OTHERS THEN
      -- Pipeline bookkeeping must NEVER block the underlying estimate write.
      -- Log and move on.
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_auto_advance_failed', 'estimate', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Estimate Sent'));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_estimate_submitted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_trg_estimate_submitted() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_estimate_submitted_advance ON estimates;
CREATE TRIGGER crm_estimate_submitted_advance
  AFTER INSERT OR UPDATE OF status ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_estimate_submitted();
