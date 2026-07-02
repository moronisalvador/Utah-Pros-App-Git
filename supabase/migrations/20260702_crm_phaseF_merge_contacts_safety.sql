-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase F — merge_contacts CRM-safety fix (P0)
--
-- docs/crm-roadmap.md, "Phase F — Foundation" + the "P0 finding fixed in
-- Phase F" note. The live merge_contacts RPC was never committed as a
-- migration (schema drift) — its body is captured here verbatim, then
-- SUPERSEDED to close a data-loss bug: it reassigned only 14 legacy FK
-- tables before DELETEing the losing contact, so a merge CASCADE-deleted the
-- loser's lead_attribution + email_campaign_recipients + email_campaign_
-- exclusions rows and SET-NULL orphaned their inbound_leads.contact_id.
--
-- The four missing reassignments (steps 15–18 below) run BEFORE the delete so
-- every piece of the loser's CRM history survives on the surviving contact.
-- Two of those tables carry UNIQUE(campaign_id, contact_id), so their move is
-- a delete-conflicts-then-update, matching the pattern the original already
-- used for contact_tags / conversation_participants.
--
-- Signature unchanged: merge_contacts(uuid, uuid) RETURNS jsonb. This is a
-- backward-compatible CREATE OR REPLACE — every existing caller (MergeModal.jsx
-- ×5, DevTools) keeps working. Proof: supabase/tests/crm_merge_contacts_safety.test.js
-- (committed failing against the pre-fix body).
--
-- ALL ADDITIVE: no table altered, one function replaced. One shared Supabase
-- for dev + main, so this is live in both the moment it applies.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.merge_contacts(p_keep_id uuid, p_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_keep contacts;
  v_merge contacts;
  v_claims_moved INT := 0;
  v_jobs_moved INT := 0;
  v_conversations_moved INT := 0;
BEGIN
  IF p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'Cannot merge a contact with itself';
  END IF;

  SELECT * INTO v_keep FROM contacts WHERE id = p_keep_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Keep contact not found'; END IF;

  SELECT * INTO v_merge FROM contacts WHERE id = p_merge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Merge contact not found'; END IF;

  UPDATE contacts SET
    name = COALESCE(name, v_merge.name),
    email = COALESCE(email, v_merge.email),
    phone_secondary = COALESCE(phone_secondary, v_merge.phone_secondary),
    billing_address = COALESCE(billing_address, v_merge.billing_address),
    billing_city = COALESCE(billing_city, v_merge.billing_city),
    billing_state = COALESCE(billing_state, v_merge.billing_state),
    billing_zip = COALESCE(billing_zip, v_merge.billing_zip),
    insurance_carrier = COALESCE(insurance_carrier, v_merge.insurance_carrier),
    policy_number = COALESCE(policy_number, v_merge.policy_number),
    claim_number = COALESCE(claim_number, v_merge.claim_number),
    referral_source = COALESCE(referral_source, v_merge.referral_source),
    preferred_language = COALESCE(preferred_language, v_merge.preferred_language),
    desk_phone = COALESCE(desk_phone, v_merge.desk_phone),
    desk_extension = COALESCE(desk_extension, v_merge.desk_extension),
    territory = COALESCE(territory, v_merge.territory),
    trade_specialty = COALESCE(trade_specialty, v_merge.trade_specialty),
    notes = CASE
      WHEN notes IS NULL THEN v_merge.notes
      WHEN v_merge.notes IS NOT NULL THEN notes || E'\n---\n' || v_merge.notes
      ELSE notes
    END,
    relationship_notes = CASE
      WHEN relationship_notes IS NULL THEN v_merge.relationship_notes
      WHEN v_merge.relationship_notes IS NOT NULL THEN relationship_notes || E'\n---\n' || v_merge.relationship_notes
      ELSE relationship_notes
    END,
    updated_at = now()
  WHERE id = p_keep_id;

  -- 1. claims.contact_id
  UPDATE claims SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  GET DIAGNOSTICS v_claims_moved = ROW_COUNT;

  -- 2. claims.adjuster_contact_id
  UPDATE claims SET adjuster_contact_id = p_keep_id WHERE adjuster_contact_id = p_merge_id;

  -- 3. jobs.primary_contact_id
  UPDATE jobs SET primary_contact_id = p_keep_id WHERE primary_contact_id = p_merge_id;
  GET DIAGNOSTICS v_jobs_moved = ROW_COUNT;

  -- 4. contact_jobs — UNIQUE(contact_id, job_id, role)
  DELETE FROM contact_jobs WHERE contact_id = p_merge_id
    AND (job_id, role) IN (SELECT job_id, role FROM contact_jobs WHERE contact_id = p_keep_id);
  UPDATE contact_jobs SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 5. contact_addresses
  UPDATE contact_addresses SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 6. contact_tags — PK is (contact_id, tag)
  DELETE FROM contact_tags WHERE contact_id = p_merge_id
    AND tag IN (SELECT tag FROM contact_tags WHERE contact_id = p_keep_id);
  UPDATE contact_tags SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 7. conversation_participants — UNIQUE(conversation_id, contact_id)
  DELETE FROM conversation_participants WHERE contact_id = p_merge_id
    AND conversation_id IN (SELECT conversation_id FROM conversation_participants WHERE contact_id = p_keep_id);
  UPDATE conversation_participants SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  GET DIAGNOSTICS v_conversations_moved = ROW_COUNT;

  -- 8. messages.sender_contact_id
  UPDATE messages SET sender_contact_id = p_keep_id WHERE sender_contact_id = p_merge_id;

  -- 9. invoices.contact_id
  UPDATE invoices SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 10. payments.contact_id
  UPDATE payments SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 11. sign_requests.contact_id
  UPDATE sign_requests SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 12. campaign_recipients.contact_id  (legacy SMS campaign recipients)
  UPDATE campaign_recipients SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 13. sms_consent_log.contact_id
  UPDATE sms_consent_log SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 14. sub_confirmations.contact_id
  UPDATE sub_confirmations SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- ── Phase F P0 fix: the four CRM tables the pre-fix body left to be
  --    CASCADE-deleted / orphaned when the loser was deleted below. ──

  -- 15. lead_attribution.contact_id — CASCADE-deleted pre-fix (PK id only, plain move)
  UPDATE lead_attribution SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 16. email_campaign_recipients — CASCADE-deleted pre-fix; UNIQUE(campaign_id, contact_id)
  DELETE FROM email_campaign_recipients WHERE contact_id = p_merge_id
    AND campaign_id IN (SELECT campaign_id FROM email_campaign_recipients WHERE contact_id = p_keep_id);
  UPDATE email_campaign_recipients SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 17. email_campaign_exclusions — CASCADE-deleted pre-fix; UNIQUE(campaign_id, contact_id)
  DELETE FROM email_campaign_exclusions WHERE contact_id = p_merge_id
    AND campaign_id IN (SELECT campaign_id FROM email_campaign_exclusions WHERE contact_id = p_keep_id);
  UPDATE email_campaign_exclusions SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  -- 18. inbound_leads.contact_id — SET-NULL orphaned pre-fix (contact_id not unique, plain move)
  UPDATE inbound_leads SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('contact.merged', 'contact', p_keep_id, jsonb_build_object(
    'kept_id', p_keep_id,
    'merged_id', p_merge_id,
    'merged_name', v_merge.name,
    'merged_phone', v_merge.phone,
    'claims_moved', v_claims_moved,
    'jobs_moved', v_jobs_moved,
    'conversations_moved', v_conversations_moved
  ));

  DELETE FROM contacts WHERE id = p_merge_id;

  RETURN jsonb_build_object(
    'ok', true,
    'kept_id', p_keep_id,
    'merged_id', p_merge_id,
    'claims_moved', v_claims_moved,
    'jobs_moved', v_jobs_moved,
    'conversations_moved', v_conversations_moved
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
