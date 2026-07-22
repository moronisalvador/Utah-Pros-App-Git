-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_appointment_status_history
-- Phase: n/a (standalone production fix)
-- ════════════════════════════════════════════════
--
-- Verified before shipping via workflow wf_8d04b08f-ba2: (1) exhaustive caller
-- inventory — 5 update_appointment call sites, 3 delete_appointment call sites,
-- all in src/, none in functions/, all using named args with no actor today;
-- (2) live pg_get_functiondef confirmed both RPCs' exact current signatures so
-- the DROP FUNCTION below is not guessed; (3) full live rolled-back-transaction
-- test: a real reschedule logged a correct history row with the right actor, a
-- notes-only edit logged nothing, an un-updated caller omitting p_actor_id still
-- succeeded with actor_id=NULL, delete_appointment's INSERT-before-DELETE
-- ordering read correct by inspection. An initial draft rewrote
-- update_appointment's core UPDATE into precomputed variables instead of the
-- original inline COALESCE expressions — an independent adversarial review
-- caught this as an avoidable behavioral divergence on a live, heavily-used
-- RPC and it was corrected before applying: the ORIGINAL update statement is
-- reproduced byte-for-byte below; old values are captured via a preceding
-- plain SELECT, and history is logged from the UPDATE's own RETURNING result
-- (i.e. the write path a tech/dispatcher/CRM user actually exercises is
-- unchanged from what is live today). A second dry run (reschedule -> cancel
-- -> reschedule again, in one transaction) confirmed all three transitions log
-- correctly and status is preserved through the reschedule-only call.
--
-- WHAT THIS DOES (plain language):
--   Today, rescheduling an appointment (update_appointment) silently overwrites
--   its old date/time/status with no trace, and deleting an appointment
--   (delete_appointment) is a hard delete with zero record of what was removed
--   or who did it. This migration adds a new append-only
--   `appointment_status_history` table and widens both RPCs to write a row to
--   it before/after they change or remove data: a reschedule logs the old vs.
--   new date/time, a status change (e.g. cancel) logs the old vs. new status,
--   and a delete logs a full snapshot of the appointment right before it's
--   removed. Both RPCs also gain a `p_actor_id` (who did it) parameter —
--   `delete_appointment` additionally gains `p_reason` — so future work can
--   show "who rescheduled/cancelled/deleted this and why." All 8 call sites
--   across desktop Schedule (drag/resize + EventModal + EditAppointmentModal),
--   tech mobile (TechEditAppointment), and the shared event/appointment modals
--   were updated in the same change to start passing the current employee.
--
-- ADDITIVE-ONLY:
--   One brand-new table (`appointment_status_history`, RLS-enabled at
--   creation, SELECT-only policy — writes happen only via the two SECURITY
--   DEFINER RPCs below, which run as the function owner and bypass RLS; no
--   existing table touched). Both RPCs gain new TRAILING parameters that all
--   default to NULL, so every existing named-argument caller kept working
--   unchanged even before the caller edits landed (backward-compatible by
--   construction, verified live). Per this project's established precedent
--   (20260629_create_job_with_contact_existing_claim.sql, reaffirmed by
--   20260721_customer_activity_and_claim_creator.sql), this is a DROP + CREATE
--   of the EXACT current live signature (confirmed via pg_get_functiondef, not
--   guessed) rather than a plain CREATE OR REPLACE — avoids any risk of a
--   second PostgREST-ambiguous overload. No column/table is dropped, renamed,
--   or retyped; the original UPDATE/DELETE statements are reproduced verbatim,
--   with the new history INSERT added around them, not inside them.
--
-- Known caveat (surfaced by live verification, not a defect): the history
-- table's actor_id has a hard FK to employees(id) with no tolerance for a bad
-- id — a p_actor_id that doesn't match a real employee row will fail the
-- ENTIRE reschedule/delete with a 23503 FK violation, not just skip logging.
-- Real employee ids (the only values any caller passes, via employee?.id) are
-- always valid FK targets, so this is expected/correct, not a functional risk.
--
-- Pre-existing, NOT touched by this migration (flagging only because the
-- inventory surfaced it): the live `appointments` table's own RLS policies
-- are scoped to roles={anon,authenticated} with USING(true) — the old
-- blanket-anon template database-standard.md supersedes, and appointments is
-- not on the §2 public allowlist. Tightening that is a separate, larger
-- reviewed change; this migration only adds a new table and widens two RPCs.
-- Also flagging separately: EditAppointmentModal.jsx's delete button
-- (handleDelete) has no visible two-click confirm gate, unlike its two
-- sibling delete flows (EventModal, TechEditAppointment) which both have one
-- — a pre-existing CLAUDE.md Rule 2 gap unrelated to this migration.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Three independent, ordered steps. Steps 1-2 (restore the prior RPC
--   bodies) are safe to run any time. Step 3 (drop the history table) should
--   only be run if the table is genuinely empty or its data is deliberately
--   being discarded — once callers start passing real actors, dropping it
--   destroys exactly the audit trail this migration exists to create.
--
--   STEP 1 — restore prior update_appointment (verbatim live 8-arg body):
--   DROP FUNCTION IF EXISTS public.update_appointment(
--     uuid, date, time without time zone, time without time zone, text, text, text, text, uuid
--   );
--   CREATE OR REPLACE FUNCTION public.update_appointment(p_appointment_id uuid, p_date date DEFAULT NULL::date, p_time_start time without time zone DEFAULT NULL::time without time zone, p_time_end time without time zone DEFAULT NULL::time without time zone, p_title text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
--    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
--   AS $function$
--   DECLARE
--     v_result JSONB;
--   BEGIN
--     UPDATE appointments SET
--       date = COALESCE(p_date, date), time_start = COALESCE(p_time_start, time_start),
--       time_end = COALESCE(p_time_end, time_end), title = COALESCE(p_title, title),
--       type = COALESCE(p_type::appointment_type, type), status = COALESCE(p_status::appointment_status, status),
--       notes = COALESCE(p_notes, notes)
--     WHERE id = p_appointment_id
--     RETURNING jsonb_build_object('id', id, 'date', date, 'time_start', time_start, 'time_end', time_end, 'title', title, 'status', status) INTO v_result;
--     IF v_result IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;
--     RETURN v_result;
--   END; $function$;
--   REVOKE EXECUTE ON FUNCTION public.update_appointment(uuid, date, time without time zone, time without time zone, text, text, text, text) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.update_appointment(uuid, date, time without time zone, time without time zone, text, text, text, text) TO authenticated, service_role;
--
--   STEP 2 — restore prior delete_appointment (verbatim live 1-arg body):
--   DROP FUNCTION IF EXISTS public.delete_appointment(uuid, uuid, text);
--   CREATE OR REPLACE FUNCTION public.delete_appointment(p_appointment_id uuid)
--    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
--   AS $function$
--   BEGIN
--     UPDATE job_tasks SET appointment_id = NULL WHERE appointment_id = p_appointment_id;
--     DELETE FROM appointment_crew WHERE appointment_id = p_appointment_id;
--     DELETE FROM appointments WHERE id = p_appointment_id;
--   END; $function$;
--   REVOKE EXECUTE ON FUNCTION public.delete_appointment(uuid) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.delete_appointment(uuid) TO authenticated, service_role;
--
--   STEP 3 (last resort only) — drop the history table:
--   DROP INDEX IF EXISTS public.idx_appointment_status_history_appt;
--   DROP TABLE IF EXISTS public.appointment_status_history;
-- ════════════════════════════════════════════════

-- ─── 1. History table (append-only, RLS on, SELECT-only policy) ───────────
CREATE TABLE IF NOT EXISTS public.appointment_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  event_type     text NOT NULL CHECK (event_type IN ('rescheduled', 'status_changed', 'cancelled', 'deleted')),
  old_date       date,
  old_time_start time,
  old_time_end   time,
  old_status     text,
  new_date       date,
  new_time_start time,
  new_time_end   time,
  new_status     text,
  actor_id       uuid REFERENCES public.employees(id),
  reason         text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_status_history_appt
  ON public.appointment_status_history (appointment_id, changed_at DESC);

ALTER TABLE public.appointment_status_history ENABLE ROW LEVEL SECURITY;

-- SELECT-only floor (not FOR ALL): writes happen exclusively via the two
-- SECURITY DEFINER RPCs below, which run as the function owner and bypass
-- RLS — a client-facing write grant is never needed. Matches the
-- claim_status_history/invoice_status_history precedent
-- (20260708_dbf_lifecycle_history.sql).
DROP POLICY IF EXISTS appointment_status_history_select ON public.appointment_status_history;
CREATE POLICY appointment_status_history_select ON public.appointment_status_history
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.appointment_status_history FROM anon, PUBLIC;
GRANT SELECT ON public.appointment_status_history TO authenticated;
GRANT ALL ON public.appointment_status_history TO service_role;

-- ─── 2. update_appointment — widened with p_actor_id + reschedule/status history ──
-- The original UPDATE statement below is reproduced BYTE-FOR-BYTE from the
-- live body (same inline COALESCE expressions, same casts, same RETURNING
-- clause, same not-found check) — only a preceding old-value SELECT and a
-- trailing conditional history INSERT (derived from the UPDATE's own
-- RETURNING result) were added around it.
DROP FUNCTION IF EXISTS public.update_appointment(
  uuid, date, time without time zone, time without time zone, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.update_appointment(
  p_appointment_id uuid,
  p_date date DEFAULT NULL::date,
  p_time_start time without time zone DEFAULT NULL::time without time zone,
  p_time_end time without time zone DEFAULT NULL::time without time zone,
  p_title text DEFAULT NULL::text,
  p_type text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_old_date date;
  v_old_time_start time;
  v_old_time_end time;
  v_old_status text;
BEGIN
  SELECT date, time_start, time_end, status::text
    INTO v_old_date, v_old_time_start, v_old_time_end, v_old_status
  FROM appointments
  WHERE id = p_appointment_id;

  UPDATE appointments SET
    date = COALESCE(p_date, date),
    time_start = COALESCE(p_time_start, time_start),
    time_end = COALESCE(p_time_end, time_end),
    title = COALESCE(p_title, title),
    type = COALESCE(p_type::appointment_type, type),
    status = COALESCE(p_status::appointment_status, status),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_appointment_id
  RETURNING jsonb_build_object(
    'id', id, 'date', date, 'time_start', time_start, 'time_end', time_end,
    'title', title, 'status', status
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;

  IF (v_result->>'date')::date IS DISTINCT FROM v_old_date
     OR (v_result->>'time_start')::time IS DISTINCT FROM v_old_time_start
     OR (v_result->>'time_end')::time IS DISTINCT FROM v_old_time_end THEN
    INSERT INTO appointment_status_history (
      appointment_id, event_type,
      old_date, old_time_start, old_time_end, old_status,
      new_date, new_time_start, new_time_end, new_status,
      actor_id
    ) VALUES (
      p_appointment_id, 'rescheduled',
      v_old_date, v_old_time_start, v_old_time_end, v_old_status,
      (v_result->>'date')::date, (v_result->>'time_start')::time, (v_result->>'time_end')::time, v_result->>'status',
      p_actor_id
    );
  ELSIF (v_result->>'status') IS DISTINCT FROM v_old_status THEN
    INSERT INTO appointment_status_history (
      appointment_id, event_type,
      old_status, new_status, actor_id
    ) VALUES (
      p_appointment_id,
      CASE WHEN v_result->>'status' = 'cancelled' THEN 'cancelled' ELSE 'status_changed' END,
      v_old_status, v_result->>'status', p_actor_id
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_appointment(uuid, date, time without time zone, time without time zone, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_appointment(uuid, date, time without time zone, time without time zone, text, text, text, text, uuid) TO authenticated, service_role;

-- ─── 3. delete_appointment — widened with p_actor_id/p_reason + deletion snapshot ──
-- Original three statements (unassign tasks / delete crew / delete
-- appointment) reproduced byte-for-byte, unchanged — only a preceding
-- old-value SELECT + snapshot INSERT was added before them.
DROP FUNCTION IF EXISTS public.delete_appointment(uuid);

CREATE OR REPLACE FUNCTION public.delete_appointment(
  p_appointment_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_date date;
  v_time_start time;
  v_time_end time;
  v_status text;
BEGIN
  SELECT date, time_start, time_end, status::text
    INTO v_date, v_time_start, v_time_end, v_status
  FROM appointments
  WHERE id = p_appointment_id;

  IF FOUND THEN
    INSERT INTO appointment_status_history (
      appointment_id, event_type,
      old_date, old_time_start, old_time_end, old_status,
      actor_id, reason
    ) VALUES (
      p_appointment_id, 'deleted',
      v_date, v_time_start, v_time_end, v_status,
      p_actor_id, p_reason
    );
  END IF;

  UPDATE job_tasks SET appointment_id = NULL WHERE appointment_id = p_appointment_id;
  DELETE FROM appointment_crew WHERE appointment_id = p_appointment_id;
  DELETE FROM appointments WHERE id = p_appointment_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_appointment(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_appointment(uuid, uuid, text) TO authenticated, service_role;
