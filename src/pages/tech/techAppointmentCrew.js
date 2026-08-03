/**
 * ════════════════════════════════════════════════
 * FILE: techAppointmentCrew.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether the mobile appointment editor should save a crew change.
 *   It prevents unauthorized private-crew edits and skips saves that would not
 *   change any assignment.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Crew order does not count as a change.
 * ════════════════════════════════════════════════
 */

function normalizedCrew(crew = []) {
  return crew
    .map((entry) => ({
      employee_id: entry.employee_id || entry.employees?.id || '',
      role: entry.role || 'tech',
    }))
    .filter((entry) => entry.employee_id)
    .sort((left, right) => (
      `${left.employee_id}:${left.role}`.localeCompare(
        `${right.employee_id}:${right.role}`,
      )
    ));
}

export function shouldSyncAppointmentCrew({
  employeeRole,
  isPrivate,
  originalCrew,
  selectedCrew,
}) {
  const canManagePrivateCrew = ['admin', 'project_manager'].includes(employeeRole);
  if (isPrivate && !canManagePrivateCrew) return false;
  return JSON.stringify(normalizedCrew(originalCrew))
    !== JSON.stringify(normalizedCrew(selectedCrew));
}
