-- ════════════════════════════════════════════════
-- ROLLBACK: notification unsafe-producer containment
-- ════════════════════════════════════════════════
--
-- Re-enables only the five notification types disabled by the paired migration.
-- Run only after appointment/timesheet producer authorization has passed its
-- negative and permitted-path tests; rollback restores notification delivery but
-- does not itself repair those producer boundaries.
-- ════════════════════════════════════════════════

UPDATE public.notification_types
SET enabled = true
WHERE type_key = ANY (ARRAY[
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
  'timesheet.change_requested',
  'timesheet.change_reviewed'
]::text[]);
