/**
 * ════════════════════════════════════════════════
 * FILE: filterStore.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Remembers each technician's schedule filter choices (just my work vs. a chosen
 *   crew, and which division) between visits, saved on the device. It reads and
 *   writes the SAME saved setting the old schedule page used, so a tech's filters
 *   carry over seamlessly when the new schedule turns on.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — used by TechScheduleV2
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      localStorage key `tech_schedule_filters_{employeeId}` (shared with
 *              the legacy page — same shape { employee, division })
 *
 * NOTES / GOTCHAS:
 *   - Migrates the pre-2026 single-string employee value to the array form, exactly
 *     like the legacy loader, so an old saved filter still loads.
 * ════════════════════════════════════════════════
 */

const keyFor = (empId) => `tech_schedule_filters_${empId}`;

/** Load { employee, division } for an employee, defaulting to Me / All. */
export function loadFilters(empId) {
  try {
    const raw = localStorage.getItem(keyFor(empId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.employee === 'string' && parsed.employee !== 'me' && parsed.employee !== 'all') {
        parsed.employee = [parsed.employee];
      }
      return { employee: parsed.employee ?? 'me', division: parsed.division ?? 'all' };
    }
  } catch { /* ignore malformed */ }
  return { employee: 'me', division: 'all' };
}

/** Persist { employee, division } for an employee. */
export function saveFilters(empId, filters) {
  try { localStorage.setItem(keyFor(empId), JSON.stringify(filters)); } catch { /* quota / private mode */ }
}
