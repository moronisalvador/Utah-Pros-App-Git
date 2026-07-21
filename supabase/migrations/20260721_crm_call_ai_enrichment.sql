-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_call_ai_enrichment
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds two small helper functions the call-transcription worker uses to act
--   on two more signals the AI clean-up/summarize pass now detects: (1) a call
--   where the company representative spoke but the caller never actually said
--   anything back gets automatically flagged as spam so it's removed from the
--   Leads pipeline without a human having to notice and do it by hand, and (2)
--   a customer's email or mailing address, when they clearly stated it during
--   the call, gets filled onto their contact record — but ONLY a blank field
--   on an ALREADY-linked contact; this never creates a contact and never
--   overwrites a value that's already there.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. Two new SECURITY DEFINER functions. No table
--   created/dropped/altered, no column added/renamed/removed, no existing
--   function's signature or body changed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION public.set_lead_spam_flag(uuid, boolean, text);
--   DROP FUNCTION public.set_lead_contact_details(uuid, text, text);
--   No data was altered by creating these — only future worker calls to them
--   stop (or, on rollback, never start) auto-flagging spam / backfilling
--   contact fields. Any lead already flagged spam or any contact field already
--   backfilled by these functions stays exactly as it is (that's correct data,
--   not something to revert).
-- ════════════════════════════════════════════════

-- ─── Auto-flag a lead as spam (or un-flag it) with an audit trail ────────────
-- A no-op write (p_spam already matches the current value) still returns the
-- row but skips the system_events insert, so re-running the AI backfill pass
-- over the same lead twice never produces duplicate audit rows.
CREATE OR REPLACE FUNCTION public.set_lead_spam_flag(
  p_lead_id uuid,
  p_spam boolean,
  p_reason text DEFAULT NULL
)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row  inbound_leads;
  v_prev boolean;
BEGIN
  SELECT spam_flag INTO v_prev FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  UPDATE inbound_leads
     SET spam_flag  = p_spam,
         updated_at = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_row;

  IF COALESCE(v_prev, false) IS DISTINCT FROM p_spam THEN
    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    VALUES ('crm_lead_spam_flag_set', 'inbound_lead', v_row.id, NULL,
            jsonb_build_object('spam_flag', p_spam, 'reason', p_reason));
  END IF;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_lead_spam_flag(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_spam_flag(uuid, boolean, text) TO authenticated, service_role;

-- ─── Backfill a blank email/address on an ALREADY-linked contact only ────────
-- Mirrors set_lead_caller_name's "fill only if blank, never create a contact"
-- contract exactly. inbound_leads has no email/address column of its own, so
-- an unlinked lead (contact_id IS NULL) has nowhere to write this — it
-- silently no-ops rather than creating a contact from unverified AI-extracted
-- data (the same reason set_lead_caller_name never creates one either). Once
-- that lead is later linked to a contact (phone match), a subsequent call for
-- the same person can still fill it in. customer_address maps to
-- contacts.billing_address — the only free-text street-address field on the
-- table (billing_city/state/zip are separate and untouched here).
CREATE OR REPLACE FUNCTION public.set_lead_contact_details(
  p_lead_id uuid,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL
)
 RETURNS contacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
  v_row        contacts;
  v_email      text := NULLIF(btrim(p_email), '');
  v_address    text := NULLIF(btrim(p_address), '');
BEGIN
  IF v_email IS NULL AND v_address IS NULL THEN
    SELECT contact_id INTO v_contact_id FROM inbound_leads WHERE id = p_lead_id;
    IF v_contact_id IS NOT NULL THEN
      SELECT * INTO v_row FROM contacts WHERE id = v_contact_id;
    END IF;
    RETURN v_row;
  END IF;

  SELECT contact_id INTO v_contact_id FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  IF v_contact_id IS NULL THEN
    RETURN NULL; -- no linked contact yet — nowhere to write this, never create one
  END IF;

  UPDATE contacts
     SET email          = COALESCE(NULLIF(btrim(email), ''), v_email),
         billing_address = COALESCE(NULLIF(btrim(billing_address), ''), v_address),
         updated_at      = now()
   WHERE id = v_contact_id
   RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_contact_details_backfilled', 'contact', v_contact_id, NULL,
          jsonb_build_object('lead_id', p_lead_id, 'email_provided', v_email IS NOT NULL, 'address_provided', v_address IS NOT NULL));

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_lead_contact_details(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_contact_details(uuid, text, text) TO authenticated, service_role;
