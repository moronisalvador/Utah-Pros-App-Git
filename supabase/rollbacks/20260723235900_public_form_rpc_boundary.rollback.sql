-- EMERGENCY ROLLBACK ONLY — 20260723235900_public_form_rpc_boundary.sql
--
-- This restores the exact legacy ACL observed on 2026-07-23. It re-opens the direct browser bypass
-- around Worker schema, abuse, consent, and webhook controls. Do not apply for ordinary rollback.
-- First prove a deployed direct caller exists, record the exception, and schedule re-containment.
--
-- Function body, signature, return type, and data are unchanged by both forward and rollback SQL.

BEGIN;

GRANT EXECUTE ON FUNCTION public.upsert_lead_from_form(
  uuid, text, jsonb, jsonb, boolean, text, text, uuid
) TO PUBLIC, anon, authenticated, service_role;

COMMIT;
