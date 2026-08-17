-- Synthetic Production-only catalog predecessor for the disposable
-- notification/crew composition qualification.
--
-- Read-only live evidence showed Production has one disabled
-- appointment.reminder row and no reminder cron. QA has neither.

INSERT INTO public.notification_types (
  type_key,
  label,
  description,
  category,
  audience,
  bell_default,
  push_default,
  email_default,
  enabled,
  sort_order
)
VALUES (
  'appointment.reminder',
  '[local] Appointment reminder',
  'Synthetic local Production fixture',
  'appointments',
  'assigned_crew',
  true,
  true,
  false,
  false,
  9106
)
ON CONFLICT (type_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    audience = EXCLUDED.audience,
    bell_default = EXCLUDED.bell_default,
    push_default = EXCLUDED.push_default,
    email_default = EXCLUDED.email_default,
    enabled = EXCLUDED.enabled,
    sort_order = EXCLUDED.sort_order;
