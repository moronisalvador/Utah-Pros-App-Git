-- Synthetic catalog predecessor for the disposable notification qualification.
-- The five producers are deliberately enabled so reviewed containment proves it
-- disables each one. The reminder foundation stays absent, matching qa-staging.

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
VALUES
  ('appointment.assigned', '[local] Appointment assigned', 'Synthetic local fixture', 'appointments', 'assigned_crew', true, true, false, true, 9101),
  ('appointment.updated', '[local] Appointment updated', 'Synthetic local fixture', 'appointments', 'assigned_crew', true, true, false, true, 9102),
  ('appointment.canceled', '[local] Appointment canceled', 'Synthetic local fixture', 'appointments', 'assigned_crew', true, true, false, true, 9103),
  ('timesheet.change_requested', '[local] Timesheet change requested', 'Synthetic local fixture', 'timesheets', 'employee_and_manager', true, true, false, true, 9104),
  ('timesheet.change_reviewed', '[local] Timesheet change reviewed', 'Synthetic local fixture', 'timesheets', 'employee', true, true, false, true, 9105)
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
