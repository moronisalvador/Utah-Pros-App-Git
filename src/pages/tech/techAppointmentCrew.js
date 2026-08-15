/**
 * ════════════════════════════════════════════════
 * FILE: techAppointmentCrew.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether the mobile appointment editor should include a crew diff.
 *   Authorization belongs to the atomic server command; the client only avoids
 *   sending a no-op crew payload.
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
  originalCrew,
  selectedCrew,
}) {
  return JSON.stringify(normalizedCrew(originalCrew))
    !== JSON.stringify(normalizedCrew(selectedCrew));
}
