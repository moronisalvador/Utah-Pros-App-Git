-- ════════════════════════════════════════════════
-- ROLLBACK: 20260807201000_esign_custom_authorization_snapshot
-- ════════════════════════════════════════════════
--
-- ⚠️  READ THIS BEFORE RUNNING IT — THIS DESTROYS LEGAL TEXT
--     Dropping custom_body and custom_heading permanently deletes the wording of
--     every Custom Authorization ever sent, INCLUDING ONES ALREADY SIGNED. There
--     is no other copy in the database.
--
--     The executed documents themselves survive: each signed PDF is a stored file
--     in the job-files bucket with a job_documents row and an esign.signed audit
--     event, and none of those are re-rendered from these columns. So you keep
--     the signed artifact, but you lose the queryable record of what it said.
--
--     Prefer rolling FORWARD. If the feature misbehaves, the cheaper fix is to
--     stop offering it in the UI — the columns are inert when nothing writes
--     them, and the RPC answers nothing when no request has doc_type='other'.
--
-- BEFORE RUNNING, CAPTURE WHAT YOU ARE ABOUT TO DELETE:
--
--   SELECT id, token, job_id, doc_type, status, signed_at,
--          custom_snippet_key, custom_heading, custom_body
--     FROM public.sign_requests
--    WHERE custom_body IS NOT NULL
--    ORDER BY created_at;
--
--   Save that output somewhere durable first. If it returns rows and you have
--   not saved them, stop.
--
-- ALSO CANCEL ANYTHING STILL PENDING:
--   A pending doc_type='other' request whose columns are gone would render an
--   empty document. functions/api/submit-esign.js refuses to complete a blank
--   Custom Authorization and src/pages/SignPage.jsx shows an error screen rather
--   than a signable form, so the client cannot sign an empty document — but they
--   would hit a dead link. Cancel them first:
--
--     SELECT id, token, signer_name FROM public.sign_requests
--      WHERE status = 'pending' AND doc_type = 'other';
--
-- WHAT IT DOES NOT DO:
--   It does not touch create_sign_request, get_sign_request_by_token,
--   complete_sign_request, any policy, any grant on sign_requests, or any of the
--   eleven document types. The forward migration created no overload and this
--   removes none.
--
-- ORDER MATTERS:
--   Drop the function before the columns — it selects them, and dropping a
--   column a function body references leaves the function in place but broken at
--   call time rather than failing loudly here.
-- ════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.get_sign_request_custom_text(text);

-- destructive-approved: removes the three additive columns this migration added.
-- Deliberate and irreversible for stored custom-document text; see the banner.
ALTER TABLE public.sign_requests
  DROP COLUMN IF EXISTS custom_snippet_key,
  DROP COLUMN IF EXISTS custom_body,
  DROP COLUMN IF EXISTS custom_heading;

COMMIT;
