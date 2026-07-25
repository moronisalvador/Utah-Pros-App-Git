-- ════════════════════════════════════════════════
-- MIGRATION: 20260725010000_owner_attested_prior_service_consent
-- Phase: Messaging activation — consent backfill (standalone, owner-authorized)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Records that Utah Pros Restoration already has permission to text the customers it has
--   already worked for. Every person in this list either filed an insurance claim with UPR or
--   contacted UPR asking for service — so they handed over their own phone number, and in most
--   cases signed a paper work authorization or filled in a website form before UPR existed as a
--   system. The owner attested to this on 2026-07-25. Nothing here invents permission: it writes
--   down permission that was obtained outside this database, and it writes down WHO said so and
--   WHY, so the record can be audited later.
--
--   Anyone who has ever said stop, or been placed on Do Not Disturb, is deliberately excluded.
--
-- ADDITIVE-ONLY:
--   Data change only. No table, column, constraint, policy, function or grant is touched.
--   Sets contacts.opt_in_status/opt_in_at/opt_in_source and inserts one sms_consent_log row per
--   contact. Idempotent — re-running affects zero rows because it only targets contacts whose
--   opt_in_status is not already true.
--
-- SCOPE (verified live immediately before authoring, 2026-07-25):
--   198 contacts have a phone number. 141 match the predicate below. 134 of those need the write
--   (7 already opted in via web_form). Excluded on purpose: 1 opted-out, 3 DND, and the 57
--   contacts with neither a claim nor an inbound lead — the owner reviewed those 57 and chose to
--   leave them out, because they cannot be shown to have requested service and may be adjusters,
--   vendors or referral partners rather than clients.
--
-- WHY THIS IS NOT AN INFERENCE:
--   The predicate requires a claim or an inbound lead — i.e. a recorded event in which the person
--   engaged UPR for service. It is not "exists in the contacts table". A blanket
--   `UPDATE contacts SET opt_in_status = true` was explicitly rejected in favour of this, because
--   a bare flag records no basis, no actor and no time, and would be indefensible under review.
--
-- SAFETY:
--   - Preflight: the attesting actor must be an existing employee with role 'admin', else RAISE.
--   - Hard ceiling: refuses to run if the predicate matches more than 160 contacts, so a wrong
--     predicate cannot silently sweep the whole table.
--   - STOP / DND are excluded and stay excluded. Honouring those is what makes the attested
--     position defensible; it is the one rule with no exception.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Reverses exactly the rows this wrote, keyed on the sentinel opt_in_source:
--
--   DELETE FROM public.sms_consent_log
--    WHERE source = 'owner_attestation_prior_service_relationship';
--
--   UPDATE public.contacts
--      SET opt_in_status = false, opt_in_at = NULL, opt_in_source = NULL
--    WHERE opt_in_source = 'owner_attestation_prior_service_relationship';
--
--   (Contacts that already had consent from 'web_form' are untouched by both statements.)
-- ════════════════════════════════════════════════

DO $$
DECLARE
  v_actor   uuid := 'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da';  -- owner, admin employee
  v_source  text := 'owner_attestation_prior_service_relationship';
  v_details text := 'Owner-attested prior consent for one-to-one service SMS. Basis: pre-existing '
                 || 'service relationship — the contact filed a claim with UPR or contacted UPR '
                 || 'requesting service, providing their own phone number. Written consent was '
                 || 'obtained on a paper work authorization or a website form, including before '
                 || 'UPR was adopted as the system of record. Attested by the owner 2026-07-25. '
                 || 'Scope is service/transactional messaging only — not marketing or promotional '
                 || 'messaging, which continues to require express written consent. STOP and DND '
                 || 'remain absolute.';
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.id = v_actor AND e.role::text = 'admin'
  ) THEN
    RAISE EXCEPTION 'consent backfill preflight failed: attester % is not an admin employee', v_actor;
  END IF;

  CREATE TEMP TABLE _consent_targets ON COMMIT DROP AS
  SELECT c.id, c.phone
  FROM public.contacts c
  WHERE c.phone IS NOT NULL
    AND c.phone <> ''
    AND c.opt_out_at IS NULL
    AND c.dnd IS DISTINCT FROM true
    AND c.opt_in_status IS DISTINCT FROM true
    AND (
      EXISTS (SELECT 1 FROM public.claims cl WHERE cl.contact_id = c.id)
      OR EXISTS (SELECT 1 FROM public.inbound_leads il WHERE il.contact_id = c.id)
    );

  SELECT count(*) INTO v_count FROM _consent_targets;
  RAISE NOTICE 'owner-attested consent backfill: % contacts targeted', v_count;

  IF v_count > 160 THEN
    RAISE EXCEPTION
      'consent backfill refused: % contacts matched, above the reviewed ceiling of 160', v_count;
  END IF;

  UPDATE public.contacts c
     SET opt_in_status = true,
         opt_in_at     = now(),
         opt_in_source = v_source
   WHERE c.id IN (SELECT id FROM _consent_targets);

  INSERT INTO public.sms_consent_log
    (contact_id, phone, event_type, source, details, performed_by)
  SELECT t.id, t.phone, 'opt_in', v_source, v_details, v_actor
  FROM _consent_targets t;
END;
$$;
