-- Roll back only after the recovery worker no longer calls this RPC.
REVOKE ALL ON FUNCTION public.claim_callrail_provider_event(
  uuid,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.claim_callrail_provider_event(
  uuid,
  timestamptz,
  timestamptz
);
