-- ════════════════════════════════════════════════
-- MIGRATION: 20260731223000_notification_unsafe_producer_containment
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Temporarily turns off five notification types whose business-event producers
--   inherit broader write authority than their intended audience. This prevents an
--   anonymous or insufficiently-authorized database write from being amplified into
--   a company notification while the underlying appointment/timesheet authorization
--   work is designed and reviewed.
--
-- SCOPE:
--   Data-only update to notification_types.enabled for:
--     appointment.assigned / appointment.updated / appointment.canceled
--     timesheet.change_requested / timesheet.change_reviewed
--
-- SAFETY:
--   - Does not modify CallRail, Twilio, messages, consent, provider configuration,
--     appointments, appointment_crew, timesheets or any notification payload.
--   - notification_types is migration-only by 20260726210000.
--   - Refuses if any expected catalog key is absent or already disabled instead
--     of silently applying a partial containment. This makes the paired rollback
--     an exact restoration of the verified pre-apply state.
--
-- ROLLBACK:
--   supabase/rollbacks/20260731223000_notification_unsafe_producer_containment.rollback.sql
--   Re-enable only after the producer authorization exit criteria and negative tests
--   documented in UPR-Web-Context.md have passed.
-- ════════════════════════════════════════════════

DO $$
DECLARE
  v_required text[] := ARRAY[
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
    'timesheet.change_requested',
    'timesheet.change_reviewed'
  ]::text[];
  v_locked text[];
  v_missing text[];
  v_already_disabled text[];
BEGIN
  SELECT
    array_agg(locked.type_key ORDER BY locked.type_key),
    array_agg(locked.type_key ORDER BY locked.type_key)
      FILTER (WHERE locked.enabled IS NOT TRUE)
    INTO v_locked, v_already_disabled
  FROM (
    SELECT catalog.type_key, catalog.enabled
    FROM public.notification_types catalog
    WHERE catalog.type_key = ANY (v_required)
    ORDER BY catalog.type_key
    FOR UPDATE
  ) AS locked;

  SELECT array_agg(required.type_key ORDER BY required.type_key)
    INTO v_missing
  FROM unnest(v_required) AS required(type_key)
  WHERE required.type_key <> ALL (COALESCE(v_locked, ARRAY[]::text[]));

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'notification containment refused; missing catalog keys: %', v_missing;
  END IF;

  IF v_already_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'notification containment refused; catalog keys already disabled: %',
      v_already_disabled;
  END IF;

  UPDATE public.notification_types
  SET enabled = false
  WHERE type_key = ANY (v_required);
END;
$$;
