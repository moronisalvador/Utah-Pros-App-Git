-- get_qbo_connection_status() — expose the QuickBooks connection state to the frontend so the
-- UI can gate card charging on the Payments scope.
--
-- get_billing_settings reads integration_config; the OAuth grant lives in integration_credentials
-- (service-role only), so granted_scopes is otherwise invisible to the app. This SECURITY DEFINER
-- RPC reads that table but returns ONLY non-sensitive status fields (never the tokens), so it is
-- safe to grant to anon/authenticated.
--
-- Returns: { connected, has_payment_scope, company_name, environment }
--   connected         — a refresh token is on file (QBO is linked)
--   has_payment_scope — the granted scopes include com.intuit.quickbooks.payment (card charging)
--   company_name      — the connected QuickBooks company (for display)
--   environment       — 'production' | 'sandbox'

create or replace function public.get_qbo_connection_status()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select refresh_token, granted_scopes, company_name, environment
    into c
  from integration_credentials
  where provider = 'quickbooks'
  limit 1;

  return json_build_object(
    'connected',         (c.refresh_token is not null),
    'has_payment_scope', coalesce(c.granted_scopes ilike '%com.intuit.quickbooks.payment%', false),
    'company_name',      c.company_name,
    'environment',       coalesce(c.environment, 'production')
  );
end;
$$;

grant execute on function public.get_qbo_connection_status() to anon, authenticated;
