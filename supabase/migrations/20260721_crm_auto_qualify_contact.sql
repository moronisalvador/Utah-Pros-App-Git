-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_auto_qualify_contact
-- Phase: n/a — standalone production fix, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The AI call-review passes never auto-create a customer record from a lead —
--   on purpose, to avoid polluting the CRM with garbage contacts from a
--   low-confidence AI read. But that means even a lead where everything checks
--   out (a real first-and-last name was captured, a real phone number, a
--   genuine in-scope service inquiry, not spam) has no way to link its next
--   call to the same person — the follow-up shows up as a brand-new,
--   disconnected lead instead of a second call from someone we already talked
--   to. This adds one new function, crm_auto_qualify_contact, that only
--   creates a contact when ALL of those signals line up at once, and always
--   tries to match an existing contact by phone number FIRST so it can never
--   create a duplicate.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. One new SECURITY DEFINER function. No table
--   created/dropped/altered, no column added/renamed/removed, no existing
--   function's signature or body changed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION public.crm_auto_qualify_contact(uuid);
--   No data was altered by creating this function — only future worker calls
--   to it stop (or, on rollback, never start) auto-creating/linking contacts.
--   Any contact already auto-created, or any lead already linked, by this
--   function stays exactly as it is (that's correct data, not something to
--   revert).
-- ════════════════════════════════════════════════

-- ─── Auto-qualify: create/link a contact only on a narrow, deliberate signal ─
-- Reuses signals that already exist on inbound_leads — invents none. Mirrors
-- upsert_lead_from_callrail's normalized, ambiguous-skip phone-match logic
-- exactly (20260721_crm_contact_link_and_activity.sql) so the live-ingest path
-- and this auto-qualify path never disagree on what counts as "the same person".
CREATE OR REPLACE FUNCTION public.crm_auto_qualify_contact(p_lead_id uuid)
 RETURNS contacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead        inbound_leads;
  v_name        text;
  v_phone       text;
  v_digits      text;
  v_contact_id  uuid;
  v_match_count int;
  v_row         contacts;
BEGIN
  SELECT * INTO v_lead FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  -- Already linked — nothing to qualify. Return the existing contact so a
  -- caller gets a stable, idempotent result on a re-run (e.g. reclassify).
  IF v_lead.contact_id IS NOT NULL THEN
    SELECT * INTO v_row FROM contacts WHERE id = v_lead.contact_id;
    RETURN v_row;
  END IF;

  -- Name: a captured FIRST + LAST name (must contain a space). Prefer the
  -- ALREADY-vetted caller_name — protected by set_lead_caller_name's
  -- extend-only upgrade guard (20260721_crm_caller_name_upgrade.sql) and, as
  -- of this same fix round, cross-validated in the transcribe-call worker —
  -- over the freshly-extracted transcript_analysis.customer_full_name, which
  -- can still be role-confused on a short/ambiguous call.
  v_name := NULLIF(btrim(v_lead.caller_name), '');
  IF v_name IS NULL OR position(' ' IN v_name) = 0 THEN
    v_name := NULLIF(btrim(v_lead.transcript_analysis ->> 'customer_full_name'), '');
  END IF;
  IF v_name IS NULL OR position(' ' IN v_name) = 0 THEN
    RETURN NULL; -- no captured first+last name — not confident enough to create a contact
  END IF;

  -- Real phone number.
  v_phone := NULLIF(btrim(v_lead.caller_number), '');
  IF v_phone IS NULL THEN
    RETURN NULL;
  END IF;
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  IF length(v_digits) < 10 THEN
    RETURN NULL;
  END IF;

  -- Not spam, a genuine customer inquiry, and in-scope for the services we offer.
  IF COALESCE(v_lead.spam_flag, false) THEN
    RETURN NULL;
  END IF;
  IF COALESCE((v_lead.transcript_analysis ->> 'is_customer_inquiry')::boolean, false) IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF COALESCE(v_lead.transcript_analysis ->> 'service_match', '') <> 'in_scope' THEN
    RETURN NULL;
  END IF;

  -- Phone-match FIRST, mirroring upsert_lead_from_callrail's normalized
  -- (digits-only, last-10) comparison exactly — never create a duplicate
  -- contact. An ambiguous match (two+ contacts share the same last-10 digits)
  -- is skipped rather than guessed, same conservative rule as that function.
  SELECT count(*) INTO v_match_count
  FROM contacts
  WHERE phone IS NOT NULL
    AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
    AND right(regexp_replace(phone, '\D', '', 'g'), 10) = right(v_digits, 10);

  IF v_match_count > 1 THEN
    RETURN NULL; -- ambiguous — skip, never guess which one is the right contact
  ELSIF v_match_count = 1 THEN
    SELECT id INTO v_contact_id
    FROM contacts
    WHERE phone IS NOT NULL
      AND length(regexp_replace(phone, '\D', '', 'g')) >= 10
      AND right(regexp_replace(phone, '\D', '', 'g'), 10) = right(v_digits, 10);
  ELSE
    INSERT INTO contacts (phone, name)
    VALUES (v_phone, v_name)
    RETURNING id INTO v_contact_id;
  END IF;

  UPDATE inbound_leads
     SET contact_id = v_contact_id,
         updated_at = now()
   WHERE id = p_lead_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_auto_qualified_contact', 'inbound_lead', p_lead_id,
          jsonb_build_object('contact_id', v_contact_id, 'name', v_name));

  SELECT * INTO v_row FROM contacts WHERE id = v_contact_id;
  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_auto_qualify_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_auto_qualify_contact(uuid) TO authenticated, service_role;
