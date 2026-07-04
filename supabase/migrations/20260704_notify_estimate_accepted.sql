-- ════════════════════════════════════════════════
-- FILE: 20260704_notify_estimate_accepted.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Sends the "estimate accepted" notification to admins the moment an estimate
--   is marked accepted (status → 'approved'). It is a database trigger, not a
--   code hook, so it catches EVERY way an estimate can flip to approved — the
--   staff "Convert to invoice" click and any out-of-band write alike.
--
-- DEPENDS ON:
--   notify_emit(text, jsonb) — the shared dispatcher gate (inert unless the
--   'estimate.accepted' catalog type is enabled). The human-readable title/body
--   is built in functions/api/notify.js (enrichEstimateBody) from { estimate_id }.
--
-- NOTES / GOTCHAS:
--   - Additive only: new trigger function + trigger. No table/column change.
--   - Fires on INSERT-as-approved and on a real status transition to 'approved'
--     (OLD.status IS DISTINCT FROM NEW.status) — never on an unrelated update.
--   - notify_emit is fire-and-forget (net.http_post); a notify hiccup can never
--     roll back the estimate write.
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_estimate_accepted_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.notify_emit('estimate.accepted',
      jsonb_build_object('estimate_id', NEW.id, 'job_id', NEW.job_id));
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_estimate_accepted_notify ON public.estimates;
CREATE TRIGGER trg_estimate_accepted_notify
AFTER INSERT OR UPDATE OF status ON public.estimates
FOR EACH ROW EXECUTE FUNCTION public.trg_estimate_accepted_notify();
