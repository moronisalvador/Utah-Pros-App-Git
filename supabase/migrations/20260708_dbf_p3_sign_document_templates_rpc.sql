-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p3_sign_document_templates_rpc.sql
-- DB-Foundation Phase P3 (anon closure) — token-gated SignPage template read  [item ②]
--   docs/db-foundation-roadmap.md → Phase P3 block; database-standard.md §2 allowlist.
--
-- WHAT THIS DOES (plain language):
--   The public e-sign page (SignPage.jsx) used to read the whole `document_templates`
--   table directly with the anonymous browser key. Phase P3 closes anonymous table
--   access, so this adds a small, purpose-built function the signing page can call
--   instead: given a signing-link token, it returns ONLY the boilerplate template
--   sections for THAT request's document type. No token → no rows. Nothing else in
--   `document_templates` is reachable without logging in.
--
-- WHY THIS SHIPS FIRST (sequencing — database-standard §5):
--   This is ADDITIVE (a new function) and must be deployed BEFORE the RED anon-closure
--   migrations remove the direct-read policy on `document_templates`. The SignPage code
--   change that calls this RPC ships in the SAME PR; the revokes wait for the owner's
--   apply window (after this + the code are live).
--
-- SECURITY:
--   SECURITY DEFINER so it can read `document_templates` on the caller's behalf without
--   granting anon direct table access. Token-gated: it resolves the doc_type from a real
--   `sign_requests.token`; a bogus/absent token yields the empty set. Templates are
--   non-sensitive boilerplate legal text, so exposure is limited to "the doc_type tied
--   to a valid signing link" — strictly tighter than the previous blanket anon table read.
--   `-- public:` per database-standard §2 (public e-sign pages → SignPage template read).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_sign_document_templates(text);
--   (SignPage's pre-P3 code read `document_templates` directly; reverting the SignPage
--    commit + re-granting anon on the table restores the old path — see the P3 policy
--    migration's rollback.)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_sign_document_templates(p_token text)
RETURNS SETOF public.document_templates
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT dt.*
  FROM public.document_templates dt
  WHERE dt.doc_type = (
    SELECT sr.doc_type
    FROM public.sign_requests sr
    WHERE sr.token = p_token::uuid
    LIMIT 1
  )
  ORDER BY dt.sort_order ASC NULLS LAST;
$function$;

-- Least-privilege grant (database-standard §1): strip the platform's implicit PUBLIC/anon
-- EXECUTE, then grant exactly the roles that need it. anon is intentional + allowlisted (§2).
REVOKE EXECUTE ON FUNCTION public.get_sign_document_templates(text) FROM PUBLIC;
-- public: public e-sign pages (SignPage.jsx) must resolve template sections before login.
GRANT EXECUTE ON FUNCTION public.get_sign_document_templates(text) TO anon, authenticated, service_role;
