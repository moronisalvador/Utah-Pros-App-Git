-- ════════════════════════════════════════════════
-- MIGRATION: 20260725060000_fixed_automation_claims
-- Phase: Fixed-automation duplicate-send closure (run-automations.js)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Gives the four fixed automations (speed-to-lead, missed-call text-back,
--   no-response follow-up, review request) a "ticket" they must take BEFORE
--   they send anything. Only one ticket can exist per automation per lead or
--   job, so if the worker crashes right after sending a text but before it
--   finishes writing its records, the next run cannot take the ticket again
--   and therefore cannot send the same person a second text.
--
--   Until now the worker checked "did I already send this?" first and only
--   wrote the record AFTER sending. Anything that went wrong in between
--   (a crash, a failed insert) meant the text went out unrecorded and the
--   next scheduled run sent it again. A duplicate automated text is a
--   per-message TCPA exposure, and the missed-call text-back is aimed at
--   people who have never dealt with us before.
--
-- ADDITIVE-ONLY:
--   One new table and three new functions. No existing table, column, policy,
--   grant, or function body is altered or dropped. No data is changed. The
--   existing system_events terminal history remains the durable
--   "already fired" record and is deliberately still consulted first, so
--   entities that already fired before this migration can never re-fire.
--
-- DESIGN NOTE (deliberate, fail-closed):
--   Unlike claim_scheduled_message, this claim has NO stale-recovery window.
--   A claim left behind by a crash means "we may already have texted this
--   person" — reclaiming it would reintroduce exactly the duplicate send this
--   migration exists to prevent. A stuck claim therefore stops that one
--   automation for that one entity until a human looks, which is the safe
--   direction. Outcomes that sent nothing (quiet hours, kill-switch, absent
--   consent, transient send failure) release the claim so they retry
--   normally.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Revert run-automations.js to its pre-claim ordering, then run
--   supabase/rollbacks/20260725060000_fixed_automation_claims.rollback.sql
--   (drops the three functions and the table). Dropping the table only
--   discards in-flight claim tickets; the terminal history in system_events
--   is untouched, so no automation can re-fire for an entity that already
--   completed.
-- ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fixed_automation_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  outcome text,
  reason text,
  CONSTRAINT fixed_automation_claims_unique_entity
    UNIQUE (automation_key, entity_id)
);

ALTER TABLE public.fixed_automation_claims ENABLE ROW LEVEL SECURITY;

-- RPC-only table: no browser policy is defined, so RLS denies every
-- non-service caller by default. The service-role client bypasses RLS.
REVOKE ALL ON TABLE public.fixed_automation_claims FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.fixed_automation_claims IS
  'Service-only claim fence for the four fixed automations in run-automations.js. One row per (automation_key, entity_id); presence blocks a second send.';

-- ─── Claim ────────────────────────────────────────
-- Atomic: the UNIQUE constraint decides the winner. Exactly one caller can
-- insert a given (automation_key, entity_id); every other caller gets false
-- and must not send.
CREATE OR REPLACE FUNCTION public.claim_fixed_automation(
  p_automation_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_claimed boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'claim_fixed_automation is service-role only'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.fixed_automation_claims AS c (
    automation_key, entity_type, entity_id, claimed_at
  )
  VALUES (p_automation_key, p_entity_type, p_entity_id, p_now)
  ON CONFLICT ON CONSTRAINT fixed_automation_claims_unique_entity DO NOTHING;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_fixed_automation(text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_fixed_automation(text, text, uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.claim_fixed_automation(text, text, uuid, timestamptz) IS
  'Service-only atomic claim taken BEFORE a fixed automation sends. True means this caller may send.';

-- ─── Release ──────────────────────────────────────
-- Only for outcomes that sent NOTHING. Refuses to release a finalized claim,
-- so a completed send can never be re-opened.
CREATE OR REPLACE FUNCTION public.release_fixed_automation_claim(
  p_automation_key text,
  p_entity_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_released boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'release_fixed_automation_claim is service-role only'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.fixed_automation_claims AS c
  WHERE c.automation_key = p_automation_key
    AND c.entity_id = p_entity_id
    AND c.finalized_at IS NULL;

  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_fixed_automation_claim(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_fixed_automation_claim(text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.release_fixed_automation_claim(text, uuid, text) IS
  'Service-only release of a fixed-automation claim that sent nothing (quiet hours, kill-switch, no consent, transient failure). Never releases a finalized claim.';

-- ─── Finalize ─────────────────────────────────────
-- Marks a claim terminal for observability. The row is KEPT: its continued
-- existence is what blocks a re-send even if the system_events write failed.
CREATE OR REPLACE FUNCTION public.finalize_fixed_automation_claim(
  p_automation_key text,
  p_entity_id uuid,
  p_outcome text,
  p_reason text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_updated boolean := false;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'finalize_fixed_automation_claim is service-role only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.fixed_automation_claims AS c
  SET finalized_at = p_now,
      outcome = p_outcome,
      reason = p_reason
  WHERE c.automation_key = p_automation_key
    AND c.entity_id = p_entity_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_fixed_automation_claim(text, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_fixed_automation_claim(text, uuid, text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.finalize_fixed_automation_claim(text, uuid, text, text, timestamptz) IS
  'Service-only terminal marker for a fixed-automation claim. The claim row is retained so it keeps blocking re-sends.';
