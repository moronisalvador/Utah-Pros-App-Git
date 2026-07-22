-- ════════════════════════════════════════════════
-- MIGRATION: 20260722_crm_caller_name_follows_merge
-- Phase: n/a (standalone CRM fix — owner-caught 2026-07-22: after the
--        repeat-caller dedup, a Won card lost its caller's name)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Makes a caller's NAME land on the card you actually see, even when our AI
--   learns the name from a later call that got merged into an earlier one.
--
--   The name is not supplied by CallRail — it is extracted by our own pass
--   (Deepgram transcript → Claude analysis in functions/api/transcribe-call.js),
--   which then calls set_lead_caller_name on the lead whose recording it just
--   read. That is usually a LATER call: the first call often goes unanswered
--   or nobody says a name, and the callback is where "this is Kelsey" appears.
--
--   Since 20260722_crm_dedup_repeat_caller_leads, a repeat call from the same
--   number MERGES into the earlier lead, and only the earlier (canonical) lead
--   owns a pipeline card. So the AI wrote the name onto a row that renders
--   nowhere, and the visible card stayed nameless. Verified live: lead
--   62329182 (14:03 call) held "Kelsey Bledgy"; the surviving 14:58 card
--   7d04d2af had caller_name NULL, so the Won column showed a bare phone
--   number and the caller appeared to have vanished from the board.
--
--   Fix, at the existing chokepoint: set_lead_caller_name now resolves the
--   lead to its CANONICAL root (the same bounded merge-pointer walk
--   crm_advance_lead_if_forward already uses) and applies the name to BOTH
--   the row named and that root. Each row is judged by its OWN current name
--   under the UNCHANGED guard — fill a blank always; replace only when the
--   new name genuinely extends the existing one AND p_allow_upgrade is set.
--   So a merge can only ever ADD a name to a card that lacked one, or extend
--   it; it can never overwrite a canonical's established name with an
--   unrelated one. The call row keeps its own truth (each recording names
--   whoever spoke on it); the canonical additionally gets the person-level
--   fact so the board is right.
--
--   Signature, return value (the row for p_lead_id), and the guard semantics
--   are all unchanged — existing callers cannot tell the difference except
--   that the visible card is now named.
--
--   Also backfills: every canonical with a blank name inherits the name from
--   its most recent named merged child (this is what restores Kelsey's card),
--   including a blank linked contact's name, all logged to system_events.
--
-- ADDITIVE-ONLY / data backfill:
--   One function-BODY-only CREATE OR REPLACE (signature byte-for-byte
--   unchanged) + a name-only backfill that writes ONLY where the target is
--   currently blank (it can overwrite nothing). No table/column/policy change,
--   no DROP/RENAME.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   1. Function: re-apply the prior body from
--      20260721_crm_caller_name_upgrade.sql (the immediate predecessor). The
--      only diff is the canonical-root resolution + the FOREACH over
--      [target, canonical]; reverting to a single-target UPDATE restores the
--      old behavior exactly. Then re-issue the REVOKE/GRANT pair below.
--   2. Backfill: every promoted name is logged as a system_events row with
--      event_type='crm_lead_caller_named' AND payload->>'via_merge'='true'.
--      To undo:
--        UPDATE inbound_leads SET caller_name = NULL
--         WHERE id IN (SELECT entity_id FROM system_events
--                       WHERE event_type='crm_lead_caller_named'
--                         AND payload->>'via_merge'='true'
--                         AND payload->>'backfill'='true');
--      And the companion contact-name undo:
--        UPDATE contacts SET name = NULL
--         WHERE id IN (SELECT (payload->>'contact_id')::uuid
--                        FROM system_events
--                       WHERE event_type='crm_lead_caller_named'
--                         AND payload->>'via_merge'='true'
--                         AND payload->>'backfill'='true'
--                         AND payload->>'contact_id' IS NOT NULL);
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_lead_caller_name(p_lead_id uuid, p_name text, p_allow_upgrade boolean DEFAULT false)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row       inbound_leads;
  v_touched   inbound_leads;
  v_name      text := NULLIF(btrim(p_name), '');
  v_current   text;
  v_upgrade   boolean;
  v_canonical uuid;
  v_merged    uuid;
  v_hops      integer := 0;
  v_targets   uuid[];
  v_target    uuid;
BEGIN
  IF v_name IS NULL THEN
    SELECT * INTO v_row FROM inbound_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
    END IF;
    RETURN v_row;
  END IF;

  PERFORM 1 FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  -- Resolve the canonical root: the AI names the row whose recording it read,
  -- but only the canonical owns a pipeline card. Bounded walk, identical to
  -- crm_advance_lead_if_forward's (merge pointers always target an unmerged
  -- root, so one hop suffices — the loop is belt-and-suspenders).
  v_canonical := p_lead_id;
  LOOP
    SELECT merged_into_lead_id INTO v_merged FROM inbound_leads WHERE id = v_canonical;
    EXIT WHEN v_merged IS NULL OR v_hops >= 5;
    v_canonical := v_merged;
    v_hops := v_hops + 1;
  END LOOP;

  v_targets := ARRAY[p_lead_id];
  IF v_canonical <> p_lead_id THEN
    v_targets := v_targets || v_canonical;
  END IF;

  FOREACH v_target IN ARRAY v_targets LOOP
    -- Each row is judged against its OWN current name, so the canonical's
    -- established name is protected by the same guard as always.
    SELECT caller_name INTO v_current FROM inbound_leads WHERE id = v_target;

    v_upgrade := p_allow_upgrade
      AND v_current IS NOT NULL AND btrim(v_current) <> ''
      AND left(lower(v_name), length(btrim(v_current)) + 1) = lower(btrim(v_current)) || ' '
      AND lower(v_name) <> lower(btrim(v_current));

    IF v_upgrade THEN
      UPDATE inbound_leads
         SET caller_name = v_name,
             updated_at  = now()
       WHERE id = v_target
       RETURNING * INTO v_touched;
    ELSE
      UPDATE inbound_leads
         SET caller_name = COALESCE(NULLIF(btrim(caller_name), ''), v_name),
             updated_at  = now()
       WHERE id = v_target
       RETURNING * INTO v_touched;
    END IF;

    IF v_touched.contact_id IS NOT NULL THEN
      IF v_upgrade THEN
        UPDATE contacts
           SET name = v_name
         WHERE id = v_touched.contact_id
           AND COALESCE(NULLIF(btrim(name), ''), '') <> ''
           AND left(lower(v_name), length(btrim(name)) + 1) = lower(btrim(name)) || ' ';
      ELSE
        UPDATE contacts
           SET name = v_name
         WHERE id = v_touched.contact_id
           AND COALESCE(NULLIF(btrim(name), ''), '') = '';
      END IF;
    END IF;

    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    VALUES ('crm_lead_caller_named', 'inbound_lead', v_touched.id, NULL,
            jsonb_build_object('name', v_name, 'contact_id', v_touched.contact_id,
                               'upgraded', v_upgrade,
                               'via_merge', v_target <> p_lead_id));

    IF v_target = p_lead_id THEN
      v_row := v_touched;   -- the contract: always return the row asked for
    END IF;
  END LOOP;

  RETURN v_row;
END;
$function$;

-- Managed-Supabase trap (database-standard.md §1): re-assert explicitly.
REVOKE EXECUTE ON FUNCTION public.set_lead_caller_name(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_caller_name(uuid, text, boolean) TO authenticated, service_role;

-- BACKFILL — canonicals left nameless by an already-merged child (Kelsey's card).
-- Writes ONLY into a blank name, so it can overwrite nothing.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (m.merged_into_lead_id)
           m.merged_into_lead_id AS canonical_id,
           NULLIF(btrim(m.caller_name), '') AS name
    FROM inbound_leads m
    JOIN inbound_leads c ON c.id = m.merged_into_lead_id
    WHERE m.merged_into_lead_id IS NOT NULL
      AND NULLIF(btrim(m.caller_name), '') IS NOT NULL
      AND NULLIF(btrim(c.caller_name), '') IS NULL
    -- m.id breaks a tie: without it, two children sharing an identical
    -- occurred_at would make DISTINCT ON's pick nondeterministic.
    ORDER BY m.merged_into_lead_id, m.occurred_at DESC, m.id DESC
  LOOP
    UPDATE inbound_leads
       SET caller_name = r.name, updated_at = now()
     WHERE id = r.canonical_id
       AND NULLIF(btrim(caller_name), '') IS NULL;

    UPDATE contacts SET name = r.name
     WHERE id = (SELECT contact_id FROM inbound_leads WHERE id = r.canonical_id)
       AND COALESCE(NULLIF(btrim(name), ''), '') = '';

    INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
    SELECT 'crm_lead_caller_named', 'inbound_lead', r.canonical_id, NULL,
           jsonb_build_object('name', r.name, 'contact_id', il.contact_id,
                              'upgraded', false, 'via_merge', true, 'backfill', true)
    FROM inbound_leads il WHERE il.id = r.canonical_id;
  END LOOP;
END $$;
