-- ════════════════════════════════════════════════
-- ROLLBACK: 20260807200000_esign_situational_authorization_templates
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the wording for the six situational authorization documents added by
--   the matching migration. After this runs, those six documents can no longer be
--   sent for signature with correct text.
--
-- WHAT IT DOES NOT DO:
--   It does not touch anything already signed. A signed document is a stored PDF
--   in the job-files bucket plus a job_documents row plus an esign.signed audit
--   event — none of those are re-rendered from this table, so every completed
--   signature keeps its exact text. It also leaves the five original document
--   types (coc, work_auth, direction_pay, change_order, recon_agreement)
--   untouched.
--
-- ⚠️  BEFORE RUNNING IT — CANCEL PENDING REQUESTS OF THESE SIX TYPES
--   A sign_request that is still 'pending' resolves its text at SIGN time. With
--   these rows gone, both readers fall through to Certificate-of-Completion
--   boilerplate: SignPage.jsx via buildSectionText() and
--   functions/api/submit-esign.js via buildCocSections(). A client who opened an
--   emergency-removal link would be shown, and would sign, "the work is 100%
--   complete and I have no outstanding complaints."
--
--   Check first, and cancel anything this returns:
--
--     SELECT id, token, doc_type, signer_name, created_at
--       FROM public.sign_requests
--      WHERE status = 'pending'
--        AND doc_type IN ('cat3_removal','emergency_demo','coverage_unconfirmed',
--                         'service_declined','equipment_early_removal','access_release');
--
-- SAFETY:
--   Deletes are scoped by the six exact doc_type values this migration inserted.
--   No other row in document_templates can match. The frontend constant in
--   src/pages/settings/templates/templateData.jsx is NOT removed by this file —
--   reverting that is a separate code deploy, and leaving it in place is
--   harmless (it is only the Settings editor's fallback text).
-- ════════════════════════════════════════════════

BEGIN;

DELETE FROM public.document_templates
 WHERE division IS NULL
   AND doc_type IN (
     'cat3_removal',
     'emergency_demo',
     'coverage_unconfirmed',
     'service_declined',
     'equipment_early_removal',
     'access_release'
   );

COMMIT;
