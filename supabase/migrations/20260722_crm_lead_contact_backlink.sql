-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_lead_contact_backlink
-- Phase: n/a (standalone CRM attribution fix — owner-directed)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   When a call comes in, the system only connects the call's lead record to
--   a person in the contacts list if that person ALREADY exists at that
--   moment. But the office usually creates the contact LATER — while booking
--   the job — so the lead stays disconnected forever, and every downstream
--   attribution number (which relies on knowing "this contact came from that
--   call") silently loses the connection. Verified live 2026-07-22: 85 leads
--   sit unlinked today. This adds the missing reverse direction: whenever a
--   contact is created (or their phone number is set/changed), any still-
--   unlinked leads from that same phone number are connected to them — using
--   the exact same "only if this is the ONLY contact with that number" safety
--   rule the call-ingest side already uses, and the exact same phone-digit
--   comparison (last 10 digits of the digits-only form, both sides required
--   to have at least 10 digits). If two contacts share the number, nothing
--   happens (ambiguity guard). An already-linked lead is never re-linked.
--   Spam-flagged leads DO get linked (identity is identity — the
--   crm_contact_is_traced predicate already ignores spam leads on its own).
--   Every link this makes is written to system_events (event_type
--   'crm_lead_backlinked') so it is auditable and reversible row-by-row.
--   A one-time backfill at the end applies the identical rule to history
--   (expected at authoring time: exactly 3 links — 3 unlinked leads have
--   exactly-one matching contact; 0 ambiguous; 82 with no match).
--
--   Performance / recursion notes (why a per-row trigger is safe here):
--   - inbound_leads is small (hundreds of rows), so the per-row scan during
--     a bulk contact import is acceptable.
--   - No recursion: the trigger UPDATEs inbound_leads, which has NO triggers
--     (verified live 2026-07-22); contacts carries only the unrelated
--     trg_qbo_customer_sync (pg_net notify) besides this new one, and this
--     function never writes contacts.
--
--   Self-healing + known limits (from the adversarial review, 2026-07-22):
--   - PHONE CHANGES SELF-HEAL: if a contact's phone is edited (typo fixed,
--     number recycled), the trigger first RELEASES its own past links for
--     that contact's OLD number (system_events-trail-scoped — human links
--     are never touched; each reversal audited as
--     'crm_lead_backlink_reverted'), so a mistyped number can no longer
--     permanently poach a stranger's lead history.
--   - HOUSEHOLD ORDERING (disclosed limit): two people sharing one number —
--     the FIRST contact created claims the number's unlinked leads; the
--     ambiguity guard only protects once BOTH contacts exist. Same limit as
--     the ingest-time forward link; corrections are enumerable via the
--     system_events trail.
--   - MERGE GAP (known follow-up, separate change): merge_contacts neither
--     inserts a contact nor updates phone, so resolving a shared-number
--     ambiguity by merging does NOT re-fire this trigger — the freed leads
--     stay unlinked until the survivor's phone is touched.
--
-- ADDITIVE-ONLY:
--   Yes — one new trigger function + one new trigger on contacts + a
--   one-time data backfill that only fills NULL inbound_leads.contact_id
--   values (never overwrites a non-NULL link) and appends system_events
--   audit rows. No table DROP/RENAME/ALTER COLUMN, no policy change.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_backlink_leads_to_contact ON public.contacts;
--   DROP FUNCTION IF EXISTS public.crm_backlink_leads_to_contact();
--   Data undo: every link this migration (or the trigger afterward) applied
--   is enumerated in system_events (event_type = 'crm_lead_backlinked',
--   entity_type = 'inbound_lead', entity_id = the lead id, payload holds the
--   contact_id and via 'trigger'|'backfill'), so links are individually
--   reversible with:
--     UPDATE inbound_leads il SET contact_id = NULL, updated_at = now()
--     FROM system_events se
--     WHERE se.event_type = 'crm_lead_backlinked'
--       AND se.entity_id = il.id
--       AND il.contact_id = (se.payload->>'contact_id')::uuid;
-- ════════════════════════════════════════════════

-- 1. The backlink trigger function. Mirrors upsert_lead_from_callrail's
--    forward-link convention EXACTLY: digits-only via regexp_replace(x,
--    '\D','','g'), compare right(digits, 10), require length(digits) >= 10
--    on both sides, and link only when NEW is the ONLY contact carrying that
--    10-digit suffix.
CREATE OR REPLACE FUNCTION public.crm_backlink_leads_to_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digits     text;
  v_suffix     text;
  v_old_digits text;
BEGIN
  -- UPDATE OF phone also fires when an UPDATE statement merely lists phone
  -- in its SET clause without changing it — only act on a real change.
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  -- ── Self-healing on a REAL phone change (adversarial-review fix) ──
  -- The evidence behind this trigger's own past links for this contact was
  -- the OLD number; when the number changes (a typo being corrected, a
  -- mistype that poached a stranger's leads, a genuinely new number), that
  -- evidence is gone — so release ONLY the links this trigger/backfill
  -- itself made (system_events trail), only where the lead still points at
  -- this contact, and only where the lead's caller matches the OLD suffix.
  -- Human-made links are never touched. Each reversal is audited, and the
  -- freed leads become linkable again by whichever contact truly owns that
  -- number. This runs BEFORE the new-number validity checks on purpose: a
  -- phone corrected to something short/garbage must still release old links.
  IF TG_OP = 'UPDATE' THEN
    v_old_digits := regexp_replace(COALESCE(OLD.phone, ''), '\D', '', 'g');
    IF length(v_old_digits) >= 10 THEN
      WITH reverted AS (
        UPDATE inbound_leads il
        SET contact_id = NULL, updated_at = now()
        WHERE il.contact_id = NEW.id
          AND il.caller_number IS NOT NULL
          AND length(regexp_replace(il.caller_number, '\D', '', 'g')) >= 10
          AND right(regexp_replace(il.caller_number, '\D', '', 'g'), 10) = right(v_old_digits, 10)
          AND EXISTS (
            SELECT 1 FROM system_events se
            WHERE se.event_type = 'crm_lead_backlinked'
              AND se.entity_type = 'inbound_lead'
              AND se.entity_id = il.id
              AND (se.payload->>'contact_id')::uuid = NEW.id
          )
        RETURNING il.id
      )
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      SELECT 'crm_lead_backlink_reverted', 'inbound_lead', reverted.id,
             jsonb_build_object('contact_id', NEW.id, 'reason', 'contact_phone_changed')
      FROM reverted;
    END IF;
  END IF;

  v_digits := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');
  IF length(v_digits) < 10 THEN
    RETURN NEW;  -- short/garbage phone: nothing to match on
  END IF;
  v_suffix := right(v_digits, 10);

  -- Exactly-one rule: if ANY other contact shares this suffix, the identity
  -- is ambiguous — do nothing (same guard as the ingest-time forward link).
  IF EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id <> NEW.id
      AND c.phone IS NOT NULL
      AND length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
      AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = v_suffix
  ) THEN
    RETURN NEW;
  END IF;

  -- Link every still-unlinked lead from this number (never overwrite a
  -- non-NULL contact_id), and audit each link via system_events. Linking
  -- ignores spam_flag on purpose: identity is identity, and the traced
  -- predicate (crm_contact_is_traced) already excludes spam leads itself.
  -- Merged redial duplicates are skipped (their canonical sibling — same
  -- caller number — links in this same pass), so a contact's activity feed
  -- never gains a second entry for one conversation.
  WITH linked AS (
    UPDATE inbound_leads il
    SET contact_id = NEW.id, updated_at = now()
    WHERE il.contact_id IS NULL
      AND il.merged_into_lead_id IS NULL
      AND il.caller_number IS NOT NULL
      AND length(regexp_replace(il.caller_number, '\D', '', 'g')) >= 10
      AND right(regexp_replace(il.caller_number, '\D', '', 'g'), 10) = v_suffix
    RETURNING il.id
  )
  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  SELECT 'crm_lead_backlinked', 'inbound_lead', linked.id,
         jsonb_build_object('contact_id', NEW.id, 'via', 'trigger')
  FROM linked;

  RETURN NEW;
END;
$function$;

-- Managed-Supabase trap: this project re-applies EXECUTE TO PUBLIC on every
-- function DDL, so the explicit REVOKE is mandatory (database-standard.md §1).
-- (Trigger functions aren't client-callable anyway; this is the standing
-- belt-and-suspenders posture for every new function.)
REVOKE EXECUTE ON FUNCTION public.crm_backlink_leads_to_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_backlink_leads_to_contact() TO authenticated, service_role;

-- 2. The trigger. AFTER (not BEFORE) so the contact row is fully in place;
--    UPDATE OF phone keeps it silent for unrelated contact edits.
DROP TRIGGER IF EXISTS trg_backlink_leads_to_contact ON public.contacts;
CREATE TRIGGER trg_backlink_leads_to_contact
AFTER INSERT OR UPDATE OF phone ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.crm_backlink_leads_to_contact();

-- 3. One-time backfill — the identical exactly-one rule applied to history.
--    Contacts are grouped by 10-digit suffix; only suffixes held by exactly
--    ONE contact link anything; only NULL contact_id leads are touched; each
--    applied link is audited with via:'backfill'. Expected at authoring time:
--    exactly 3 links (see header) — but this is intentionally not asserted,
--    since data may drift between authoring and apply.
WITH contact_digits AS (
  SELECT c.id, right(regexp_replace(c.phone, '\D', '', 'g'), 10) AS suffix
  FROM contacts c
  WHERE c.phone IS NOT NULL
    AND length(regexp_replace(c.phone, '\D', '', 'g')) >= 10
),
unique_contacts AS (
  SELECT suffix, (array_agg(id))[1] AS contact_id
  FROM contact_digits
  GROUP BY suffix
  HAVING count(*) = 1
),
linked AS (
  UPDATE inbound_leads il
  SET contact_id = uc.contact_id, updated_at = now()
  FROM unique_contacts uc
  WHERE il.contact_id IS NULL
    AND il.merged_into_lead_id IS NULL
    AND il.caller_number IS NOT NULL
    AND length(regexp_replace(il.caller_number, '\D', '', 'g')) >= 10
    AND right(regexp_replace(il.caller_number, '\D', '', 'g'), 10) = uc.suffix
  RETURNING il.id, uc.contact_id
)
INSERT INTO system_events (event_type, entity_type, entity_id, payload)
SELECT 'crm_lead_backlinked', 'inbound_lead', linked.id,
       jsonb_build_object('contact_id', linked.contact_id, 'via', 'backfill')
FROM linked;
