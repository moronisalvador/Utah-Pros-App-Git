-- 20260626_integration_credentials_scopes.sql
-- Persist the OAuth scopes QuickBooks granted, so the app can tell whether card charging
-- (the com.intuit.quickbooks.payment scope) is authorized and prompt a reconnect when not.
-- Populated by saveTokens() from the Intuit token response (`scope`).

ALTER TABLE integration_credentials ADD COLUMN IF NOT EXISTS granted_scopes text;
