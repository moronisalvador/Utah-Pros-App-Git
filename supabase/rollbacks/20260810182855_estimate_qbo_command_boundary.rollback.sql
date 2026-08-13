-- HIGH-RISK: refuse while a provider outcome or reservation is unresolved.
DO $rollback_preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM public.qbo_estimate_command_reservations) THEN RAISE EXCEPTION 'QBO_ESTIMATE_RESERVATIONS_ACTIVE'; END IF;
 IF EXISTS(SELECT 1 FROM public.qbo_estimate_commands WHERE status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation')) THEN RAISE EXCEPTION 'QBO_ESTIMATE_COMMANDS_ACTIVE'; END IF;
END;$rollback_preflight$;

-- SECURITY-STICKY: the auth.uid() → active internal employee attribution fix is
-- deliberately retained. Reintroducing caller-controlled created_by is not a
-- safe rollback operation. Terminal QBO commands are financial audit evidence,
-- so their forced-RLS tables and the service-only read RPC also remain. This
-- rollback removes all provider/mutation capability, line/transition guards,
-- and service-role table DML while keeping read-only terminal history.

REVOKE EXECUTE ON FUNCTION public.reserve_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,jsonb),public.release_qbo_estimate_command_reservation(uuid,uuid),public.prepare_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,text,jsonb),public.start_qbo_estimate_command_attempt(uuid,text,text,text,text,jsonb,text),public.set_qbo_estimate_command_state(uuid,text,jsonb,integer,jsonb,text,text),public.finalize_qbo_estimate_command(uuid,integer,jsonb) FROM service_role;
DROP TRIGGER IF EXISTS trg_estimate_lines_guard_qbo_command ON public.estimate_line_items;
DROP TRIGGER IF EXISTS trg_estimates_guard_qbo_command ON public.estimates;
DROP FUNCTION IF EXISTS public.guard_estimate_line_during_qbo_command();
DROP FUNCTION IF EXISTS public.guard_estimate_transition_during_qbo_command();
DROP FUNCTION IF EXISTS public.finalize_qbo_estimate_command(uuid,integer,jsonb);
DROP FUNCTION IF EXISTS public.set_qbo_estimate_command_state(uuid,text,jsonb,integer,jsonb,text,text);
DROP FUNCTION IF EXISTS public.start_qbo_estimate_command_attempt(uuid,text,text,text,text,jsonb,text);
DROP FUNCTION IF EXISTS public.prepare_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.release_qbo_estimate_command_reservation(uuid,uuid);
DROP FUNCTION IF EXISTS public.reserve_qbo_estimate_command(uuid,uuid,text,uuid,uuid,text,text,text,jsonb);
REVOKE ALL ON TABLE public.qbo_estimate_commands,public.qbo_estimate_command_reservations FROM service_role;
REVOKE ALL ON TABLE public.qbo_estimate_commands,public.qbo_estimate_command_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.qbo_estimate_commands,public.qbo_estimate_command_reservations TO service_role;
ALTER TABLE public.qbo_estimate_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_estimate_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_estimate_command_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_estimate_command_reservations FORCE ROW LEVEL SECURITY;
NOTIFY pgrst,'reload schema';
