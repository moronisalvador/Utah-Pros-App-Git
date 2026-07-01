-- ════════════════════════════════════════════════
-- MIGRATION: get_inbound_leads reader RPC
-- ════════════════════════════════════════════════
--
-- WHY:
--   The Call Log page loaded leads with a PostgREST GET (db.select). A GET is
--   cacheable, so after navigating away and back the browser served a STALE
--   cached response — a live call that had already landed did not appear until
--   a hard refresh. Reading through an RPC makes the request a POST, which
--   browsers never cache, so every visit reflects the current data.
--
-- WHAT:
--   A SECURITY DEFINER reader that returns the newest inbound leads with the
--   linked contact embedded (mirrors the old `select=*,contact:contacts(...)`
--   shape exactly, so the frontend needs no field changes). Read-only.
--
-- Additive-only, no changes to any existing table (CRM phase rule).

CREATE OR REPLACE FUNCTION public.get_inbound_leads(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at DESC NULLS LAST, t.created_at DESC),
    '[]'::jsonb
  )
  FROM (
    SELECT il.*,
      CASE WHEN c.id IS NOT NULL
        THEN jsonb_build_object('name', c.name, 'phone', c.phone)
        ELSE NULL
      END AS contact
    FROM inbound_leads il
    LEFT JOIN contacts c ON c.id = il.contact_id
    ORDER BY il.occurred_at DESC NULLS LAST, il.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbound_leads(integer) TO anon, authenticated;
