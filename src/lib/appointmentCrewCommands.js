/**
 * ════════════════════════════════════════════════
 * FILE: appointmentCrewCommands.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the single-RPC appointment commands used by desktop, PWA, and
 *   Capacitor screens. Keeping crew normalization here prevents a form from
 *   creating/updating an appointment before a separate crew write fails.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Data:      writes → create_appointment_with_crew / update_appointment_with_crew
 * ════════════════════════════════════════════════
 */

const DEFAULT_CREW_ROLE = 'tech';
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const APPOINTMENT_UPDATE_FIELDS = [
  'date',
  'timeStart',
  'timeEnd',
  'title',
  'type',
  'status',
  'notes',
];

export function normalizeAppointmentCrew(crew = []) {
  const seen = new Set();
  return (Array.isArray(crew) ? crew : [])
    .map((entry) => ({
      employee_id: entry?.employee_id || entry?.employees?.id || null,
      role: entry?.role || DEFAULT_CREW_ROLE,
    }))
    .filter((entry) => entry.employee_id && !seen.has(entry.employee_id) && seen.add(entry.employee_id))
    .sort((left, right) => left.employee_id.localeCompare(right.employee_id));
}

export function crewPayloadForUpdate(originalCrew, selectedCrew) {
  const original = normalizeAppointmentCrew(originalCrew);
  const selected = normalizeAppointmentCrew(selectedCrew);
  return JSON.stringify(original) === JSON.stringify(selected) ? null : selected;
}

export function changedAppointmentFields(originalValues = {}, nextValues = {}) {
  return APPOINTMENT_UPDATE_FIELDS.reduce((changes, field) => {
    if (
      hasOwn(nextValues, field)
      && !Object.is(nextValues[field], originalValues[field])
    ) {
      changes[field] = nextValues[field];
    }
    return changes;
  }, {});
}

export function createAppointmentWithCrew(db, values) {
  return db.rpc('create_appointment_with_crew', {
    p_title: values.title,
    p_date: values.date,
    p_job_id: values.jobId || null,
    p_kind: values.kind || 'job',
    p_time_start: values.timeStart || null,
    p_time_end: values.timeEnd || null,
    p_type: values.type || null,
    p_status: values.status || 'scheduled',
    p_notes: values.notes || null,
    p_is_private: Boolean(values.isPrivate),
    p_notify_client: values.notifyClient !== false,
    p_crew: normalizeAppointmentCrew(values.crew),
    p_task_ids: values.taskIds == null ? null : values.taskIds,
    p_task_templates: values.taskTemplates || [],
  });
}

export function updateAppointmentWithCrew(db, values) {
  const params = {
    p_appointment_id: values.appointmentId,
    // SQL NULL means either "clear" or "not supplied" for these nullable
    // fields. Presence flags keep mobile, PWA, and desktop clear operations
    // distinct from a partial update that should preserve the stored value.
    p_set_time_start: hasOwn(values, 'timeStart'),
    p_set_time_end: hasOwn(values, 'timeEnd'),
    p_set_notes: hasOwn(values, 'notes'),
  };

  if (values.date != null) params.p_date = values.date;
  if (hasOwn(values, 'timeStart')) params.p_time_start = values.timeStart || null;
  if (hasOwn(values, 'timeEnd')) params.p_time_end = values.timeEnd || null;
  if (values.title != null) params.p_title = values.title;
  if (values.type != null) params.p_type = values.type;
  if (values.status != null) params.p_status = values.status;
  if (hasOwn(values, 'notes')) params.p_notes = values.notes || null;
  // Omission means "preserve existing" for defaulted RPC parameters. Only an
  // explicit collection or boolean asks the server to mutate that concern.
  if (values.crew != null) params.p_crew = normalizeAppointmentCrew(values.crew);
  if (values.isPrivate != null) params.p_is_private = values.isPrivate;
  if (values.notifyClient != null) params.p_notify_client = values.notifyClient;
  if (values.taskIds != null) params.p_task_ids = values.taskIds;

  return db.rpc('update_appointment_with_crew', params);
}
