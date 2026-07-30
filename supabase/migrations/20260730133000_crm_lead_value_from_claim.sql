-- ════════════════════════════════════════════════
-- MIGRATION: 20260730133000_crm_lead_value_from_claim
-- Phase: n/a — standalone production feature, owner-directed (2026-07-30)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Two things, both about the dollar "value" shown on a card in the CRM leads
--   board.
--
--   1. Staff can now type a value in by hand (a new set_lead_value function
--      the Leads page calls), and once a human sets it the computer never
--      overwrites it.
--
--   2. When a customer's work actually gets billed, the value fills itself in.
--      A lead is tied to the insurance claim that came out of that phone call,
--      a claim can have several jobs under it, and each job can have its own
--      invoice — so the lead's value is the SUM of every committed invoice
--      under that claim, not just the first one. Add a second job later and
--      the number goes up on its own.
--
--   WHY THIS MIGRATION EXISTS AT ALL: the previous attempt
--   (20260721_crm_lead_value_sync.sql) has never once run in production —
--   verified live on 2026-07-30, 0 `crm_lead_value_synced` events and 0 of 156
--   leads carrying a value. Its trigger was AFTER INSERT ON invoices gated on
--   `total > 0`, but every invoice is INSERTed with no total at all
--   (create_invoice_for_job writes only job/contact/number/status/type), and
--   the total only appears later via recompute_invoice_from_lines()'s UPDATE.
--   The condition was unsatisfiable at insert time. That is failure pattern #3
--   in docs/crm-lead-lifecycle.md §6 — a trigger whose fire condition depends
--   on a column a *later* statement writes. This migration fixes it by
--   watching every column the decision actually depends on.
--
--   WHAT COUNTS AS A BILLED INVOICE (owner decision, 2026-07-30): a draft never
--   counts. An invoice counts once it is sent, emailed by QuickBooks, born from
--   an estimate conversion, or has money against it. Measured live, that rule
--   captures 85 of 91 money-carrying invoices ($621,027 of $662,979). The
--   "has a payment" arm is load-bearing — only 9 invoices carry qbo_emailed_at
--   and only 4 came from an estimate, so without it 60+ paid jobs would read
--   as $0.
--
-- ADDITIVE-ONLY / attribute-only / etc.:
--   Additive. Two new NULLABLE columns on inbound_leads (claim_id,
--   value_source) with constraints that apply only to those new columns, one
--   partial index, six new functions, three new triggers, and a function-BODY-
--   only CREATE OR REPLACE of crm_trg_invoice_created (a RETURNS trigger
--   function — signature unchanged, the trigger itself is not re-created).
--   No table created or dropped; no existing column added to, renamed,
--   retyped, or dropped; no RLS policy or grant on any existing object
--   changed. No data is rewritten by this migration itself — values only
--   change on future billing events, or when the owner deliberately runs the
--   bounded backfill helper (which this migration defines but does NOT call).
--
-- MULTI-TENANT NOTE (owner asked, 2026-07-30):
--   Verified live: inbound_leads / lead_pipeline_stage / pipeline_stages carry
--   org_id; claims, jobs, invoices and contacts DO NOT. So the lead is the org
--   anchor and the billing side is still single-tenant. Every claim→jobs→
--   invoices join in this feature is therefore confined to ONE function,
--   crm_lead_claim_value(). When the billing tables gain org_id, add the
--   predicate THERE and the whole feature becomes tenant-safe in one edit.
--   Nothing else in this migration joins across that boundary.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   supabase/rollbacks/20260730133000_crm_lead_value_from_claim.rollback.sql
--   Drops the three triggers and six functions, restores
--   crm_trg_invoice_created's prior body verbatim, and drops the two added
--   columns (with their constraints and index). Values already written stay —
--   they are correct billing data, not something to revert; the rollback notes
--   how to null them if the owner wants a clean slate.
-- ════════════════════════════════════════════════

-- ─── 1. Additive columns on inbound_leads ────────────────────────────────────
-- claim_id    — which claim this call turned into. NULL is the normal resting
--               state for a lead that never became work (and for the 45 of 98
--               non-spam leads that have no contact at all — see §4 below).
-- value_source— 'manual' once a human types a number (auto-sync then leaves it
--               alone forever), 'auto' when the sync owns it, NULL when unset.
ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS claim_id     uuid,
  ADD COLUMN IF NOT EXISTS value_source text;

-- Constraints are attached NOT VALID then VALIDATEd separately, so the
-- exclusive lock on this hot table is measured in milliseconds rather than a
-- full table scan (database-standard.md §5). Both constrain ONLY the new
-- columns, so no existing row can fail them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inbound_leads_claim_id_fkey'
  ) THEN
    ALTER TABLE public.inbound_leads
      ADD CONSTRAINT inbound_leads_claim_id_fkey
      FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE public.inbound_leads VALIDATE CONSTRAINT inbound_leads_claim_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inbound_leads_value_source_check'
  ) THEN
    ALTER TABLE public.inbound_leads
      ADD CONSTRAINT inbound_leads_value_source_check
      CHECK (value_source IS NULL OR value_source IN ('manual', 'auto'))
      NOT VALID;
    ALTER TABLE public.inbound_leads VALIDATE CONSTRAINT inbound_leads_value_source_check;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inbound_leads_claim_id_idx
  ON public.inbound_leads (claim_id) WHERE claim_id IS NOT NULL;

COMMENT ON COLUMN public.inbound_leads.claim_id IS
  'The claim that originated from this lead. Set by crm_attach_claim_to_lead on claim insert; correctable by staff. NULL = never became work.';
COMMENT ON COLUMN public.inbound_leads.value_source IS
  'manual = a human typed the value and automation must never overwrite it. auto = owned by crm_recompute_lead_value. NULL = unset.';

-- ─── 2. THE single join point (multi-tenant seam) ────────────────────────────
-- Sum every committed invoice under a claim, across ALL of that claim's jobs.
-- Measured live 2026-07-30: 88 of 157 claims already have more than one job
-- (max 4), so the multi-job sum is the majority case, not an edge case.
--
-- ⚠ This is the ONLY place in the feature that walks claim → jobs → invoices.
--   Keep it that way. When jobs/invoices gain org_id, the tenant predicate
--   goes HERE and nowhere else.
CREATE OR REPLACE FUNCTION public.crm_lead_claim_value(p_claim_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(COALESCE(iv.adjusted_total, iv.total, 0)), 0)
    FROM jobs j
    JOIN invoices iv ON iv.job_id = j.id
   WHERE j.claim_id = p_claim_id
     -- BILLING-CONTEXT.md §7: adjusted_total ?? total is the billable amount.
     AND COALESCE(iv.adjusted_total, iv.total, 0) > 0
     -- Owner rule: a draft never counts; sent / emailed / converted-from-
     -- estimate / paid all do.
     AND (
          iv.sent_at            IS NOT NULL
       OR iv.qbo_emailed_at     IS NOT NULL
       OR iv.estimate_id        IS NOT NULL
       OR COALESCE(iv.amount_paid, 0) > 0
     );
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_lead_claim_value(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_lead_claim_value(uuid) TO authenticated, service_role;

-- ─── 3. Recompute ONE lead's value ───────────────────────────────────────────
-- Idempotent BY CONSTRUCTION: it recomputes a SUM from source rather than
-- adding an amount, so a re-send, a QBO webhook replay, an hourly payment
-- re-sync and a manual re-run all converge on the same number. That is the
-- whole reason this is a recompute and not an increment.
CREATE OR REPLACE FUNCTION public.crm_recompute_lead_value(p_lead_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead inbound_leads;
  v_new  numeric;
BEGIN
  SELECT * INTO v_lead FROM inbound_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A human's number always wins (mirrors lifecycle invariant #5, "a human's
  -- placement always beats the machine's").
  IF v_lead.value_source = 'manual' THEN
    RETURN v_lead.value;
  END IF;

  IF v_lead.claim_id IS NULL THEN
    RETURN v_lead.value;
  END IF;

  v_new := crm_lead_claim_value(v_lead.claim_id);

  -- Nothing committed yet — leave the card blank rather than stamping a
  -- misleading $0 on it.
  IF COALESCE(v_new, 0) <= 0 THEN
    RETURN v_lead.value;
  END IF;

  -- Unchanged → write nothing. Keeps re-runs free of update storms and keeps
  -- system_events readable.
  IF v_lead.value IS NOT DISTINCT FROM v_new THEN
    RETURN v_lead.value;
  END IF;

  UPDATE inbound_leads
     SET value        = v_new,
         value_source = 'auto',
         updated_at   = now()
   WHERE id = p_lead_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_value_synced', 'inbound_lead', p_lead_id,
          jsonb_build_object('value', v_new,
                             'previous_value', v_lead.value,
                             'claim_id', v_lead.claim_id));

  RETURN v_new;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_recompute_lead_value(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_recompute_lead_value(uuid) TO authenticated, service_role;

-- ─── 4. Recompute every lead attached to a claim ─────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_recompute_lead_values_for_claim(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  IF p_claim_id IS NULL THEN
    RETURN;
  END IF;
  FOR v_lead_id IN
    SELECT id FROM inbound_leads WHERE claim_id = p_claim_id
  LOOP
    PERFORM crm_recompute_lead_value(v_lead_id);
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_recompute_lead_values_for_claim(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_recompute_lead_values_for_claim(uuid) TO authenticated, service_role;

-- ─── 5. Tie a new claim back to the call it came from ────────────────────────
-- The lead→claim link is what makes the per-claim sum possible; nothing in the
-- schema had it before. Rule: the contact's most recent unattached, non-spam,
-- non-merged lead that happened at or before the claim was created.
--
-- Deliberately conservative:
--   • only ever fills a NULL claim_id, never re-points an existing link;
--   • never guesses across contacts (no phone matching here — lifecycle
--     invariant #9 keeps the one-phone-rule in ONE place, the backlink
--     trigger, and this must not become a second copy of it);
--   • a lead with no contact simply never attaches. Measured live, 45 of 98
--     non-spam leads have no contact — those stay manual-entry only, which is
--     the honest outcome. promote_lead_to_contact + the existing backlink
--     trigger are the sanctioned path that makes them eligible later.
CREATE OR REPLACE FUNCTION public.crm_attach_claim_to_lead(p_claim_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim   claims;
  v_lead_id uuid;
BEGIN
  SELECT * INTO v_claim FROM claims WHERE id = p_claim_id;
  IF NOT FOUND OR v_claim.contact_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT il.id INTO v_lead_id
    FROM inbound_leads il
   WHERE il.contact_id = v_claim.contact_id
     AND il.claim_id IS NULL
     AND COALESCE(il.spam_flag, false) = false
     AND il.merged_into_lead_id IS NULL
     AND COALESCE(il.occurred_at, il.created_at) <= COALESCE(v_claim.created_at, now())
   ORDER BY COALESCE(il.occurred_at, il.created_at) DESC
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE inbound_leads
     SET claim_id = p_claim_id, updated_at = now()
   WHERE id = v_lead_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_claim_attached', 'inbound_lead', v_lead_id,
          jsonb_build_object('claim_id', p_claim_id, 'contact_id', v_claim.contact_id));

  RETURN v_lead_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_attach_claim_to_lead(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_attach_claim_to_lead(uuid) TO authenticated, service_role;

-- ─── 6. Staff-editable value ─────────────────────────────────────────────────
-- Deliberately NOT reusing set_lead_details(p_lead_id, p_notes, p_value, ...):
-- that function also writes inbound_leads.notes, and crm-wave-ownership.md §11
-- retired that column in favour of the crm_lead_notes log. Calling it with a
-- NULL note to change a value would silently blank the legacy note.
--
-- Passing p_value = NULL means "hand it back to the automation": the row flips
-- to 'auto' and is immediately recomputed, so clearing the box restores the
-- billed number rather than wiping it to blank.
CREATE OR REPLACE FUNCTION public.set_lead_value(
  p_lead_id    uuid,
  p_value      numeric DEFAULT NULL,
  p_updated_by uuid    DEFAULT NULL
)
 RETURNS inbound_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row inbound_leads;
BEGIN
  -- Caller validation inside SQL (database-standard.md §1): a valid session is
  -- authentication, not authorization. Any active internal employee may value
  -- a lead — this is sales bookkeeping, not an admin action — but an external
  -- or deactivated account may not.
  IF NOT EXISTS (
    SELECT 1 FROM employees e
     WHERE e.auth_user_id = auth.uid()
       AND e.is_active
       AND NOT e.is_external
  ) THEN
    RAISE EXCEPTION 'not authorized to set a lead value';
  END IF;

  IF p_value IS NOT NULL AND p_value < 0 THEN
    RAISE EXCEPTION 'lead value cannot be negative';
  END IF;

  UPDATE inbound_leads
     SET value        = p_value,
         value_source = CASE WHEN p_value IS NULL THEN 'auto' ELSE 'manual' END,
         updated_at   = now()
   WHERE id = p_lead_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead % not found', p_lead_id;
  END IF;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_value_set', 'inbound_lead', p_lead_id,
          jsonb_build_object('value', p_value, 'updated_by', p_updated_by));

  -- Cleared back to auto → refill from the claim straight away.
  IF p_value IS NULL THEN
    PERFORM crm_recompute_lead_value(p_lead_id);
    SELECT * INTO v_row FROM inbound_leads WHERE id = p_lead_id;
  END IF;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_lead_value(uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_lead_value(uuid, numeric, uuid) TO authenticated, service_role;

-- ─── 7. Triggers ─────────────────────────────────────────────────────────────
-- Every trigger body wraps its work in EXCEPTION WHEN OTHERS. CRM bookkeeping
-- must NEVER block an invoice, job or claim write — that is real money and a
-- real contract. Same posture as the existing crm_trg_* family.

-- 7a. Invoice money changed → resum the claim.
--
-- ⚠ The UPDATE OF list below is the whole point of this migration. It must
--   name EVERY column crm_lead_claim_value() reads, or we recreate the exact
--   bug this replaces (lifecycle §6 lens 3: "a trigger's UPDATE OF list must
--   include every column in its WHEN condition's join path"). Adding an arm to
--   that function's WHERE clause means adding the column here.
CREATE OR REPLACE FUNCTION public.crm_trg_invoice_lead_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_job   uuid;
  v_old_job   uuid;
  v_new_claim uuid;
  v_old_claim uuid;
BEGIN
  BEGIN
    v_new_job := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.job_id END;
    v_old_job := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.job_id END;

    IF v_new_job IS NOT NULL THEN
      SELECT claim_id INTO v_new_claim FROM jobs WHERE id = v_new_job;
      PERFORM crm_recompute_lead_values_for_claim(v_new_claim);
    END IF;

    -- An invoice moving between jobs (and so possibly between claims) has to
    -- shrink the claim it left, not just grow the one it joined.
    IF v_old_job IS NOT NULL AND v_old_job IS DISTINCT FROM v_new_job THEN
      SELECT claim_id INTO v_old_claim FROM jobs WHERE id = v_old_job;
      IF v_old_claim IS DISTINCT FROM v_new_claim THEN
        PERFORM crm_recompute_lead_values_for_claim(v_old_claim);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO system_events (event_type, entity_type, entity_id, payload)
    VALUES ('crm_lead_value_sync_failed', 'invoice',
            COALESCE(NEW.id, OLD.id),
            jsonb_build_object('error', SQLERRM, 'op', TG_OP));
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_invoice_lead_value() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_trg_invoice_lead_value() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_invoice_lead_value_sync ON public.invoices;
CREATE TRIGGER crm_invoice_lead_value_sync
  AFTER INSERT OR DELETE OR UPDATE OF
    total, adjusted_total, job_id, sent_at, qbo_emailed_at, amount_paid, estimate_id
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_invoice_lead_value();

-- 7b. A job moving between claims carries its invoices with it.
CREATE OR REPLACE FUNCTION public.crm_trg_job_claim_lead_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM crm_recompute_lead_values_for_claim(NEW.claim_id);
    IF OLD.claim_id IS DISTINCT FROM NEW.claim_id THEN
      PERFORM crm_recompute_lead_values_for_claim(OLD.claim_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO system_events (event_type, entity_type, entity_id, payload)
    VALUES ('crm_lead_value_sync_failed', 'job', NEW.id,
            jsonb_build_object('error', SQLERRM, 'op', TG_OP));
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_job_claim_lead_value() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_trg_job_claim_lead_value() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_job_claim_lead_value_sync ON public.jobs;
CREATE TRIGGER crm_job_claim_lead_value_sync
  AFTER UPDATE OF claim_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_job_claim_lead_value();

-- 7c. A new claim adopts the call it came from, then values it.
CREATE OR REPLACE FUNCTION public.crm_trg_claim_created_lead_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  BEGIN
    v_lead_id := crm_attach_claim_to_lead(NEW.id);
    IF v_lead_id IS NOT NULL THEN
      PERFORM crm_recompute_lead_value(v_lead_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO system_events (event_type, entity_type, entity_id, payload)
    VALUES ('crm_lead_claim_attach_failed', 'claim', NEW.id,
            jsonb_build_object('error', SQLERRM));
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_trg_claim_created_lead_link() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_trg_claim_created_lead_link() TO authenticated, service_role;

DROP TRIGGER IF EXISTS crm_claim_created_lead_link ON public.claims;
CREATE TRIGGER crm_claim_created_lead_link
  AFTER INSERT ON public.claims
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_trg_claim_created_lead_link();

-- ─── 8. Retire the superseded value sync ─────────────────────────────────────
-- Function-BODY-only CREATE OR REPLACE (RETURNS trigger, no arguments —
-- signature unchanged, the crm_invoice_created_advance trigger is NOT
-- re-created). The Won auto-advance behaviour is preserved verbatim; only the
-- crm_sync_lead_value call is removed, because 7a now owns lead value and
-- keeping both would race — the old one writes a single invoice's total,
-- the new one writes the claim-wide sum.
--
-- crm_sync_lead_value() itself is intentionally LEFT IN PLACE and unreferenced
-- rather than dropped: it is granted to authenticated, and dropping a live
-- function is exactly the kind of contract removal database-standard.md §3
-- forbids. It becomes dead code that the rollback can re-wire.
CREATE OR REPLACE FUNCTION public.crm_trg_invoice_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.total, 0) > 0 AND NEW.contact_id IS NOT NULL THEN
    BEGIN
      PERFORM crm_auto_advance_leads(NEW.contact_id, 'Won');
    EXCEPTION WHEN OTHERS THEN
      -- Pipeline bookkeeping must NEVER block the underlying invoice write
      -- (real money). Log and move on.
      INSERT INTO system_events (event_type, entity_type, entity_id, payload)
      VALUES ('crm_auto_advance_failed', 'invoice', NEW.id,
              jsonb_build_object('error', SQLERRM, 'contact_id', NEW.contact_id, 'target_stage', 'Won'));
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── 9. Bounded backfill helper — DEFINED, NOT RUN ───────────────────────────
-- The owner scoped this feature to "leads on the pipeline right now, especially
-- the last thirty days". This helper does exactly that and nothing wider: it
-- only touches leads that currently sit on the board (they have a
-- lead_pipeline_stage row), are within p_days, and are not manually valued.
--
-- It is deliberately NOT invoked by this migration. Since the sync has never
-- run, the first execution will put dollar figures on real cards for the first
-- time, and that deserves a deliberate look rather than arriving as a silent
-- side effect of an apply. Run it by hand once the migration is applied:
--     SELECT * FROM crm_backfill_lead_values(30);
CREATE OR REPLACE FUNCTION public.crm_backfill_lead_values(p_days integer DEFAULT 30)
 RETURNS TABLE (lead_id uuid, claim_id uuid, new_value numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead   record;
  v_result numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees e
     WHERE e.auth_user_id = auth.uid() AND e.is_active AND NOT e.is_external
       AND e.role::text = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized to backfill lead values';
  END IF;

  FOR v_lead IN
    SELECT il.id
      FROM inbound_leads il
      JOIN lead_pipeline_stage lps ON lps.lead_id = il.id
     WHERE COALESCE(il.spam_flag, false) = false
       AND il.merged_into_lead_id IS NULL
       AND COALESCE(il.value_source, 'auto') <> 'manual'
       AND COALESCE(il.occurred_at, il.created_at) >= now() - make_interval(days => GREATEST(p_days, 0))
  LOOP
    -- Attach first if the link is missing but the contact has exactly one
    -- claim; ambiguity is left for a human rather than guessed at.
    UPDATE inbound_leads il
       SET claim_id = (
             SELECT c.id FROM claims c
              WHERE c.contact_id = il.contact_id
              LIMIT 1
           )
     WHERE il.id = v_lead.id
       AND il.claim_id IS NULL
       AND il.contact_id IS NOT NULL
       AND (SELECT count(*) FROM claims c WHERE c.contact_id = il.contact_id) = 1;

    v_result := crm_recompute_lead_value(v_lead.id);
    IF v_result IS NOT NULL THEN
      RETURN QUERY
        SELECT il.id, il.claim_id, il.value
          FROM inbound_leads il WHERE il.id = v_lead.id AND il.value IS NOT NULL;
    END IF;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_backfill_lead_values(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_backfill_lead_values(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
