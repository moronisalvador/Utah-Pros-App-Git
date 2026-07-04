-- ─────────────────────────────────────────────────────────────────────────────
-- Omni-inbox Phase F — security hardening follow-up (same day)
--
-- consent-path-auditor + upr-pattern-checker both flagged that
-- record_email_suppression() shipped with GRANT EXECUTE TO anon, authenticated
-- (the repo's default RPC convention). That RPC PERMANENTLY hard-suppresses an email
-- address and never downgrades — so an anon caller holding the public anon key could
-- mass-suppress real customer addresses and DoS our ability to email them. It is only
-- ever invoked by resend-webhook.js via the SERVICE ROLE client (which bypasses
-- grants), so anon/authenticated EXECUTE is unnecessary. Lock it to service_role only.
--
-- (claim_inbound_email + omni_verify_foundation keep anon EXECUTE: the former is
-- idempotency-only keyed on unguessable provider Message-IDs / svix-ids; the latter is
-- a transactional, self-cleaning self-test backing the committed widen test.)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.record_email_suppression(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_suppression(text, text, text) TO service_role;
