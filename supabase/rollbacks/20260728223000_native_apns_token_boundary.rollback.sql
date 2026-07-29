-- ════════════════════════════════════════════════
-- ROLLBACK: 20260728223000_native_apns_token_boundary
-- ════════════════════════════════════════════════
--
-- Safe operational rollback: stop new native enrollment while retaining the
-- owner-only delete path so an authenticated employee can still disconnect a
-- device. The additive column/functions and tightened table/legacy-RPC grants
-- remain because restoring raw browser token access would recreate the defect
-- this migration contains.

REVOKE EXECUTE ON FUNCTION public.upsert_my_native_device_token(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_my_native_device_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_native_device_token(text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_device_token(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_device_token(uuid, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_device_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_device_token(text)
  TO service_role;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.device_tokens
  FROM PUBLIC, anon, authenticated;
