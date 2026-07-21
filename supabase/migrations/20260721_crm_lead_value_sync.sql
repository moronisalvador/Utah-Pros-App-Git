-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_lead_value_sync
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   When a real invoice is created (whether it's a brand-new invoice or one
--   converted from an estimate — both are just "an invoices row with a real
--   dollar total"), this fills in the dollar value on the CRM lead that
--   closed, so the Leads pipeline's weighted-value math and future
--   ROI/total-sales reports reflect the actual deal size instead of staying
--   blank. Piggybacks on the existing "invoice created -> move to Won"
--   trigger, since by the time that runs the lead is already sitting in Won.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One new SECURITY DEFINER helper function
--   (crm_sync_lead_value) and a function-body-only CREATE OR REPLACE of the
--   existing crm_trg_invoice_created trigger function (signature unchanged —
--   it's a trigger function, RETURNS trigger, no arguments — the trigger
--   itself is not re-created, just the body it runs). No table
--   created/dropped/altered, no column added/renamed/removed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION public.crm_sync_lead_value(uuid, numeric);
--   Re-apply crm_trg_invoice_created's prior body (from
--   20260721_crm_pipeline_auto_advance.sql):
--     CREATE OR REPLACE FUNCTION public.crm_trg_invoice_created()
--      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--     AS $function$
--     BEGIN
--       IF COALESCE(NEW.total, 0) > 0 AND NEW.contact_id IS NOT NULL THEN
--         BEGIN
--           PERFORM crm_auto_advance_leads(NEW.contact_id, 'Won');
--         EXCEPTION WHEN OTHERS THEN
--           INSERT INTO system_events (event_type, entity_type, entity_id, payload)
--           VALUES ('crm_auto_advance_failed', 'invoice', NEW.id,
--                   jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Won'));
--         END;
--       END IF;
--       RETURN NEW;
--     END; $function$;
--   No data was altered by creating crm_sync_lead_value — only future invoice
--   creates start (or, on rollback, stop) filling a Won lead's value. Any
--   lead value already set by it stays exactly as it is (correct data, not
--   something to revert).
-- ════════════════════════════════════════════════

-- ─── Fill a blank value on the contact's Won lead ────────────────────────────
-- Deliberately "fill only if blank" (never overwrites) and scoped to exactly
-- ONE lead (the most-recently-Won, non-spam one still missing a value) rather
-- than every open/Won lead for the contact — a contact can have multiple
-- inbound_leads rows (repeat caller, separate inquiries), and blasting the
-- same invoice amount onto more than one would double-count it in any future
-- SUM(value) sales report. If no such lead exists (nothing Won yet, or
-- already has a value), this silently no-ops.
CREATE OR REPLACE FUNCTION public.crm_sync_lead_value(
  p_contact_id uuid,
  p_amount numeric
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF p_contact_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;

  SELECT il.id INTO v_lead_id
    FROM inbound_leads il
    JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
    JOIN pipeline_stages ps ON ps.id = lps.stage_id
   WHERE il.contact_id = p_contact_id
     AND ps.is_won = true
     AND il.value IS NULL
     AND COALESCE(il.spam_flag, false) = false
   ORDER BY lps.updated_at DESC
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    RETURN; -- nothing Won yet for this contact, or it already has a value
  END IF;

  UPDATE inbound_leads
     SET value      = p_amount,
         updated_at = now()
   WHERE id = v_lead_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_value_synced', 'inbound_lead', v_lead_id,
          jsonb_build_object('value', p_amount, 'contact_id', p_contact_id));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_sync_lead_value(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sync_lead_value(uuid, numeric) TO authenticated, service_role;

-- ─── Extend the existing invoice-created trigger to also sync the value ─────
-- Runs the value sync AFTER the auto-advance call, in the same order, so the
-- lead is already sitting in Won by the time crm_sync_lead_value looks for it.
-- Uses adjusted_total when present (a manual correction to the real deal
-- amount) else total — same fallback the invoicing UI treats as the real
-- final number.
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

REVOKE EXECUTE ON FUNCTION public.crm_trg_invoice_created() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_trg_invoice_created() TO authenticated, service_role;
