-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_crm_caller_name_upgrade
-- Phase: n/a — standalone production feature, owner-directed
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The AI naming step used to only ever capture a caller's FIRST name; it now
--   asks for the full name (first + last) when the caller states both. But the
--   name-setting function only ever fills a BLANK name — it was designed to
--   never overwrite anything, so leads that already got a first-name-only
--   result from before this fix would stay stuck with just the first name
--   forever. This adds a narrow, safe "upgrade" path: when explicitly asked
--   to (p_allow_upgrade), it will replace an existing name with a fuller one
--   ONLY when the new name genuinely extends the old one (e.g. "Silvina" →
--   "Silvina Wright") — never when it's a different, unrelated name. Every
--   other caller of this function (the normal one-call-at-a-time path) is
--   completely unaffected — p_allow_upgrade defaults to false, so it behaves
--   exactly as it did before.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive / backward-compatible replace. `set_lead_caller_name` keeps its
--   exact existing behavior for every existing caller — only a new
--   `p_allow_upgrade boolean DEFAULT false` parameter is added, and the
--   upgrade path only activates when a caller explicitly passes `true`. No
--   table created/dropped/altered, no column added/renamed/removed.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Re-apply the prior body (fill-only-if-blank, no upgrade path, no third
--   parameter):
--     CREATE OR REPLACE FUNCTION public.set_lead_caller_name(p_lead_id uuid, p_name text)
--      RETURNS inbound_leads LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--     AS $function$
--     DECLARE
--       v_row  inbound_leads;
--       v_name text := NULLIF(btrim(p_name), '');
--     BEGIN
--       IF v_name IS NULL THEN
--         SELECT * INTO v_row FROM inbound_leads WHERE id = p_lead_id;
--         IF NOT FOUND THEN RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id; END IF;
--         RETURN v_row;
--       END IF;
--       UPDATE inbound_leads SET caller_name = COALESCE(NULLIF(btrim(caller_name), ''), v_name), updated_at = now()
--       WHERE id = p_lead_id RETURNING * INTO v_row;
--       IF NOT FOUND THEN RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id; END IF;
--       IF v_row.contact_id IS NOT NULL THEN
--         UPDATE contacts SET name = v_name WHERE id = v_row.contact_id AND COALESCE(NULLIF(btrim(name), ''), '') = '';
--       END IF;
--       INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
--       VALUES ('crm_lead_caller_named', 'inbound_lead', v_row.id, NULL, jsonb_build_object('name', v_name, 'contact_id', v_row.contact_id));
--       RETURN v_row;
--     END; $function$;
--   (dropping the third parameter this way requires DROP FUNCTION first since
--   Postgres treats a different arg list as a different overload — see note
--   below; simplest true rollback is DROP FUNCTION public.set_lead_caller_name(uuid,text,boolean);
--   then re-CREATE the 2-arg version above.)
-- ════════════════════════════════════════════════

-- Postgres treats a new trailing parameter as a DIFFERENT overload, not a
-- replace — leaving the old 2-arg version in place would make every 2-arg
-- call ambiguous (it could match either). Drop it first so the 3-arg version
-- (with its DEFAULT) is the sole overload and existing 2-arg callers resolve
-- to it unchanged.
DROP FUNCTION IF EXISTS public.set_lead_caller_name(uuid, text);

CREATE OR REPLACE FUNCTION public.set_lead_caller_name(
  p_lead_id uuid,
  p_name text,
  p_allow_upgrade boolean DEFAULT false
)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row     inbound_leads;
  v_name    text := NULLIF(btrim(p_name), '');
  v_current text;
  v_upgrade boolean;
BEGIN
  IF v_name IS NULL THEN
    SELECT * INTO v_row FROM inbound_leads WHERE id = p_lead_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
    END IF;
    RETURN v_row;
  END IF;

  SELECT caller_name INTO v_current FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  -- "Upgrade" only ever means "the new name extends the old one" (e.g.
  -- "Silvina" -> "Silvina Wright") — a strict, safe prefix-with-word-boundary
  -- check via plain string comparison (never LIKE — a caller_name containing
  -- a literal % or _ from a garbled transcription must never turn into an
  -- unintended wildcard match). It NEVER replaces an existing name with
  -- something unrelated, so an AI mistake on a later run can't clobber a
  -- correct earlier name.
  v_upgrade := p_allow_upgrade
    AND v_current IS NOT NULL AND btrim(v_current) <> ''
    AND left(lower(v_name), length(btrim(v_current)) + 1) = lower(btrim(v_current)) || ' '
    AND lower(v_name) <> lower(btrim(v_current));

  IF v_upgrade THEN
    UPDATE inbound_leads
       SET caller_name = v_name,
           updated_at  = now()
     WHERE id = p_lead_id
     RETURNING * INTO v_row;
  ELSE
    UPDATE inbound_leads
       SET caller_name = COALESCE(NULLIF(btrim(caller_name), ''), v_name),
           updated_at  = now()
     WHERE id = p_lead_id
     RETURNING * INTO v_row;
  END IF;

  IF v_row.contact_id IS NOT NULL THEN
    IF v_upgrade THEN
      UPDATE contacts
         SET name = v_name
       WHERE id = v_row.contact_id
         AND COALESCE(NULLIF(btrim(name), ''), '') <> ''
         AND left(lower(v_name), length(btrim(name)) + 1) = lower(btrim(name)) || ' ';
    ELSE
      UPDATE contacts
         SET name = v_name
       WHERE id = v_row.contact_id
         AND COALESCE(NULLIF(btrim(name), ''), '') = '';
    END IF;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_lead_caller_named', 'inbound_lead', v_row.id, NULL,
          jsonb_build_object('name', v_name, 'contact_id', v_row.contact_id, 'upgraded', v_upgrade));

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_lead_caller_name(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_caller_name(uuid, text, boolean) TO authenticated, service_role;
