-- ════════════════════════════════════════════════
-- MIGRATION: 20260807201000_esign_custom_authorization_snapshot
-- Phase: n/a (standalone e-sign document expansion, Phase B)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Lets office staff write a one-off document for a client to sign, for a
--   situation none of the ready-made documents covers. It adds three empty
--   optional fields to the signing-request record — a title, the body text, and
--   which starter wording it began from — plus one small read-only lookup the
--   public signing page uses to fetch that text.
--
--   The text is COPIED ONTO THE REQUEST when it is sent, not looked up later.
--   That is the whole point: every other document type resolves its wording at
--   the moment the client signs, so editing a template would silently change
--   what an already-sent, not-yet-signed link says. A per-request copy cannot
--   drift out from under the client.
--
-- ADDITIVE-ONLY:
--   Yes. Three nullable ADD COLUMN IF NOT EXISTS on public.sign_requests, and
--   one brand-new function. No DROP, no RENAME, no ALTER COLUMN, no SET NOT
--   NULL, no data change, no policy change, and no existing function is created
--   or replaced.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH — public.create_sign_request:
--   The obvious design was to add two parameters to create_sign_request. That
--   would have taken production down. Postgres identifies a function by
--   (name, argument types), so CREATE OR REPLACE with extra parameters does not
--   replace anything — it creates a SECOND function alongside the live 7-argument
--   one. functions/api/send-esign.js posts exactly seven named keys, both
--   overloads would then match, and PostgREST answers PGRST203 "could not choose
--   the best candidate function". Every Certificate of Completion, Work
--   Authorization, Direction of Pay, Change Order and Reconstruction Agreement
--   send would 500 on dev AND production the instant this applied, because one
--   Supabase sits behind both.
--
--   Verified live before authoring: pg_proc holds exactly one create_sign_request,
--   the 7-argument signature. So the worker calls it unchanged and then writes
--   the snapshot with a follow-up service-role PATCH. That also means this
--   migration and the code that uses it can deploy in either order.
--
--   The same trap is why 20260727005212_upr_work_authorization_sms_consent.sql
--   added a NEW-NAMED wrapper rather than extending complete_sign_request.
--
-- WHY A NEW RPC INSTEAD OF WIDENING get_sign_request_by_token:
--   That function is granted to anon and looks a request up by token with NO
--   status and NO expiry predicate — by design, because the signed-confirmation
--   screen still needs to read it. Putting free-form staff text in its return
--   would make that text anonymously readable forever by anyone who ever held
--   the link, including after signing, expiry or cancellation. Free text invites
--   staff to write things they would never put in a shared template, so it gets
--   the narrower door: token AND doc_type='other' AND still pending AND not
--   expired. This is the shape database-standard.md §2 already prescribes for
--   public e-sign pages — "purpose-built retrieval constrained by token, status
--   and expiration".
--
--   Note the worker does NOT use this RPC. functions/api/submit-esign.js reads
--   the columns directly with the service-role client, because it must still see
--   the text while completing a request the moment before it stops being pending.
--
-- ⚠️  OWNER ACTION REQUIRED, NOT DONE HERE:
--   .claude/rules/database-standard.md §2 is the allowlist of every place `anon`
--   is granted, and it must gain a line for get_sign_request_custom_text. Only
--   the owner may amend files under .claude/rules/, so that edit is deliberately
--   left out of this change. The grant below is not legitimate under project law
--   until that line exists.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260807201000_esign_custom_authorization_snapshot.rollback.sql.
--   It drops the function and the three columns. Dropping the columns DESTROYS
--   the stored text of any custom document — including documents already signed.
--   The signed PDFs themselves survive (they are files in the job-files bucket,
--   plus job_documents rows), so the executed documents are not lost, but the
--   database record of what each one said is. Read that file's banner before
--   running it.
-- ════════════════════════════════════════════════

-- ── 1. The per-request snapshot ───────────────────────────────────────────────
ALTER TABLE public.sign_requests
  ADD COLUMN IF NOT EXISTS custom_heading     text,
  ADD COLUMN IF NOT EXISTS custom_body        text,
  ADD COLUMN IF NOT EXISTS custom_snippet_key text;

COMMENT ON COLUMN public.sign_requests.custom_heading IS
  'Custom Authorization (doc_type=''other'') only: the document title, captured at send time. NULL for every other doc type.';
COMMENT ON COLUMN public.sign_requests.custom_body IS
  'Custom Authorization (doc_type=''other'') only: the document body with {{tokens}} UNRESOLVED, captured at send time. Tokens resolve at sign time exactly as they do for a template. NULL for every other doc type.';
COMMENT ON COLUMN public.sign_requests.custom_snippet_key IS
  'Which starter snippet from src/lib/customDocSnippets.js the author began from, or NULL if they composed from a blank box. Audit aid: answers "was this the approved wording or did someone rewrite it?" without diffing against a constant that git keeps changing.';

-- ── 2. Public read for the signing page ───────────────────────────────────────
-- public: the signing page at /sign/:token is opened by an unauthenticated
-- client who holds the token. Constrained to doc_type='other' + status='pending'
-- + unexpired, so it exposes strictly less than the already-public
-- get_sign_request_by_token and stops answering the moment the request is signed,
-- cancelled or expires. Returns no signer identity, no job data and no contact.
CREATE OR REPLACE FUNCTION public.get_sign_request_custom_text(p_token text)
RETURNS TABLE (custom_heading text, custom_body text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT sr.custom_heading, sr.custom_body
  FROM public.sign_requests sr
  WHERE sr.token = p_token::uuid
    AND sr.doc_type = 'other'
    AND sr.status = 'pending'
    AND sr.expires_at > now();
$function$;

-- This managed project re-applies EXECUTE TO PUBLIC to every new function at
-- ddl_command_end, so the REVOKE must come immediately before the GRANT.
REVOKE EXECUTE ON FUNCTION public.get_sign_request_custom_text(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sign_request_custom_text(text) TO anon, authenticated, service_role;
