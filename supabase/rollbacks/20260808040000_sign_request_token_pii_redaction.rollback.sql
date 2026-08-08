-- ════════════════════════════════════════════════
-- ROLLBACK: 20260808040000_sign_request_token_pii_redaction
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts the signing-link lookup back exactly the way it was before the
--   redaction. After running this, a signing link hands out the customer's name,
--   address, date of loss, insurance company, claim number and policy number
--   again — permanently, including after the document has been signed, cancelled
--   or expired.
--
--   THAT IS THE POINT OF THE ROLLBACK, NOT A SIDE EFFECT. Run it only if the
--   redaction broke a caller. It re-opens a real exposure.
--
-- ADDITIVE-ONLY: function BODY replacement only. Same name, argument types,
--   return type and grants. No table, column, policy, trigger or row changes.
--
-- PROVENANCE: this body is the live definition captured from pg_proc on
--   2026-08-08, immediately before the forward migration was authored — not
--   retyped from the repository. The only differences from the forward version
--   are the removal of the `actionable` lateral and the four CASE guards.
-- ════════════════════════════════════════════════

-- public: unchanged from the forward migration — the signing page at
-- /sign/:token is opened by an unauthenticated client. Allowlisted in
-- .claude/rules/database-standard.md §2.
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
    'signer_name',      sr.signer_name,
    'signer_email',     sr.signer_email,
    'signed_at',        sr.signed_at,
    'signed_file_path', sr.signed_file_path,
    'job', jsonb_build_object(
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
    )
  )
  INTO v_result
  FROM sign_requests sr
  JOIN jobs j ON j.id = sr.job_id
  WHERE sr.token = p_token::uuid;  -- explicit cast: text → uuid

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sign_request_by_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sign_request_by_token(text) TO anon, authenticated, service_role;
