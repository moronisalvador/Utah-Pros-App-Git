-- CRM/Billing Phase B — stop auto-syncing contacts to QuickBooks on INSERT.
--
-- A QBO customer is now created ON-DEMAND when a contact is actually invoiced
-- or estimated (functions/lib/quickbooks.js ensureQboCustomer — Phase A, live
-- on `main`). So this AFTER-INSERT trigger no longer needs to fire. It is left
-- ATTACHED but turned into a no-op (NOT dropped), so re-enabling auto-sync is a
-- one-function restore.
--
-- Sequencing (critical — one shared Supabase for dev+main): applied ONLY after
-- Phase A's invoice/estimate self-heal reached production `main`, so production
-- invoicing self-creates the customer now that the trigger won't. Also closes
-- the pre-existing "name added after insert never syncs" gap (the trigger never
-- fires, and the self-heal syncs at transaction time regardless).
--
-- Original body preserved here for a trivial rollback:
--   IF NEW.role NOT IN ('homeowner','property_manager','tenant') THEN RETURN NEW; END IF;
--   IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN RETURN NEW; END IF;
--   IF NEW.qbo_customer_id IS NOT NULL THEN RETURN NEW; END IF;
--   SELECT (refresh_token IS NOT NULL) INTO v_connected FROM integration_credentials WHERE provider='quickbooks';
--   IF v_connected IS NOT TRUE THEN RETURN NEW; END IF;
--   SELECT value INTO v_worker_url FROM integration_config WHERE key='qbo_worker_url';
--   SELECT value INTO v_secret     FROM integration_config WHERE key='qbo_webhook_secret';
--   IF v_worker_url IS NULL OR btrim(v_worker_url)='' THEN RETURN NEW; END IF;
--   PERFORM net.http_post(url:=v_worker_url, body:=jsonb_build_object('contact_id',NEW.id),
--     headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',COALESCE(v_secret,'')));

CREATE OR REPLACE FUNCTION public.notify_qbo_customer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase B: no-op. QBO customers are created on-demand at invoice/estimate
  -- time (ensureQboCustomer), not when a contact is inserted. Restore the body
  -- above to re-enable auto-sync.
  RETURN NEW;
END;
$function$;
