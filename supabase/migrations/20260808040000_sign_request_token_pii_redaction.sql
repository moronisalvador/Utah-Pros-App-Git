-- ════════════════════════════════════════════════
-- MIGRATION: 20260808040000_sign_request_token_pii_redaction
-- Phase: n/a — standalone security narrowing
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   When we email or text someone a link to sign a document, that link carries a
--   secret code. Today, anyone holding that code can read the customer's name,
--   home address, date of loss, insurance company, claim number and policy
--   number — and can keep reading them forever, long after the document has been
--   signed, cancelled, or expired. This change keeps the link working exactly as
--   before while it can still be signed, and stops it handing out any of that
--   personal information once it can't.
--
-- ADDITIVE-ONLY: function BODY replacement only. Same name, same argument types,
--   same return type, same jsonb keys. No table, column, index, policy, trigger,
--   grant or row is changed. No data change.
--
-- ════════════════════════════════════════════════
-- WHY NOT THE OBVIOUS FIX
--
--   The tempting change is to add `AND status = 'pending' AND expires_at > now()`
--   to the WHERE clause, the way get_sign_request_custom_text does. That would be
--   wrong here, and it is worth writing down so nobody "simplifies" it later.
--
--   Both callers decide WHICH screen to show from the row this function returns:
--
--     SignPage.jsx:364-367      submit-esign.js:226-230
--       !d              → "This link was not found."      → 404
--       status=signed   → "Already Signed" (+ signed_at)  → 409
--       status≠pending  → "Link Expired"                  → 410
--       expires_at past → "Link Expired"                  → 410
--
--   Returning NULL for anything non-pending collapses all three into "This link
--   was not found." A customer who already signed, or whose link lapsed, would be
--   told the link is invalid — and would call the office about it.
--
--   So the row still comes back. What changes is what is INSIDE it.
--
-- WHAT IS WITHHELD, AND WHEN
--
--   `actionable` = status is 'pending' AND expires_at is still in the future.
--   That is exactly the condition under which the signing page renders a document
--   and the worker accepts a signature.
--
--   When actionable  → byte-identical payload to before this migration.
--   When not         → `job`, `signer_name`, `signer_email` and
--                      `signed_file_path` come back NULL. Everything the status
--                      screens actually read — id, token, doc_type, divisions,
--                      status, expires_at, signed_at — is untouched.
--
--   VERIFIED SAFE FOR BOTH CALLERS, by reading them rather than assuming: each
--   checks status and expiry BEFORE it touches `.job`
--   (SignPage.jsx:365-367 then :368; submit-esign.js:227-229 then :239). Neither
--   reads signer_email or signed_file_path from this RPC at all, and SignPage's
--   two `job` reads are already null-safe (`data?.job || {}` at :574, optional
--   chaining at :523) and sit behind an early return on the signed screen.
--
-- THIS DOES NOT CLOSE THE WHOLE HOLE, AND SHOULD NOT BE READ AS DOING SO.
--   A PENDING link still yields full PII to whoever holds the token — that is
--   inherent to an emailed signing link and is the accepted design. What this
--   ends is the PERMANENT exposure: today a token from a job signed in April
--   still returns that customer's claim and policy numbers on demand. Separately,
--   the `job-files` bucket is public-read, so signed PDFs remain fetchable by
--   path; that is tracked as its own work and is NOT addressed here.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260808040000_sign_request_token_pii_redaction.rollback.sql
--   restores the exact prior body — the same jsonb_build_object with no CASE
--   guards and no `actionable` lateral. Rolling back re-opens the permanent PII
--   read; it is a deliberate revert, not a cleanup.
-- ════════════════════════════════════════════════

-- public: the signing page at /sign/:token is opened by an unauthenticated
-- client, so this must stay reachable before login. Allowlisted in
-- .claude/rules/database-standard.md §2 under "public e-sign — signing-page
-- bootstrap". The grant below is unchanged from the live state; it is restated
-- because this managed project re-applies EXECUTE TO PUBLIC on every replaced
-- function (database-standard.md §1).
CREATE OR REPLACE FUNCTION public.get_sign_request_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',               sr.id,
    'token',            sr.token,
    'doc_type',         sr.doc_type,
    'divisions',        sr.divisions,
    'status',           sr.status,
    'expires_at',       sr.expires_at,
    'signed_at',        sr.signed_at,
    -- Withheld once the link can no longer be signed. See the header: the ROW
    -- must still come back so the caller can tell "expired" from "already
    -- signed" from "not found"; only its contents are gated.
    'signer_name',      CASE WHEN a.actionable THEN sr.signer_name      ELSE NULL END,
    'signer_email',     CASE WHEN a.actionable THEN sr.signer_email     ELSE NULL END,
    'signed_file_path', CASE WHEN a.actionable THEN sr.signed_file_path ELSE NULL END,
    'job', CASE WHEN a.actionable THEN jsonb_build_object(
      'id',                j.id,
      'job_number',        j.job_number,
      'insured_name',      j.insured_name,
      'address',           j.address,
      'city',              j.city,
      'state',             j.state,
      'zip',               j.zip,
      'date_of_loss',      j.date_of_loss,
      'division',          j.division,
      'insurance_company', j.insurance_company,
      'claim_number',      j.claim_number,
      'policy_number',     j.policy_number,
      'adjuster_name',     j.adjuster_name
    ) ELSE NULL END
  )
  INTO v_result
  FROM sign_requests sr
  JOIN jobs j ON j.id = sr.job_id
  -- now() is the transaction timestamp, so every CASE in one call agrees.
  CROSS JOIN LATERAL (
    SELECT (sr.status = 'pending' AND sr.expires_at > now()) AS actionable
  ) a
  WHERE sr.token = p_token::uuid;  -- explicit cast: text → uuid

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sign_request_by_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sign_request_by_token(text) TO anon, authenticated, service_role;
