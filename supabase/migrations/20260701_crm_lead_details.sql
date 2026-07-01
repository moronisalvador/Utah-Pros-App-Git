-- ════════════════════════════════════════════════
-- Migration: CRM lead details (notes + value)
-- ════════════════════════════════════════════════
-- WHY: Staff need to qualify a lead from the Call Log — leave notes and set a
--   dollar value. The `notes` (text) and `value` (numeric) columns already exist
--   on inbound_leads; this adds the writer RPC (no column change).
--
-- The form is the source of truth: notes/value are set DIRECTLY (a null clears
-- the field), so staff can blank a value they entered by mistake.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_lead_details(
  p_lead_id    uuid,
  p_notes      text,
  p_value      numeric,
  p_updated_by uuid DEFAULT NULL
)
RETURNS inbound_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row inbound_leads;
BEGIN
  UPDATE inbound_leads
     SET notes      = NULLIF(btrim(p_notes), ''),
         value      = p_value,
         updated_at = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_details_updated', 'inbound_lead', v_row.id, p_updated_by,
          jsonb_build_object('value', v_row.value, 'has_notes', (v_row.notes IS NOT NULL)));

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_lead_details(uuid, text, numeric, uuid) TO anon, authenticated;
