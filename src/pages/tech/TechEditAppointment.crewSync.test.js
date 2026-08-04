/**
 * ════════════════════════════════════════════════
 * FILE: TechEditAppointment.crewSync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the appointment editor sends a crew payload only for a real diff.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./techAppointmentCrew.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a pure decision test. It never opens the app or calls Supabase.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { shouldSyncAppointmentCrew } from './techAppointmentCrew';

const ORIGINAL_CREW = [
  { employee_id: 'employee-b', role: 'tech' },
  { employee_id: 'employee-a', role: 'lead' },
];

describe('TechEditAppointment crew synchronization', () => {
  it('allows an active field tech to change a private appointment crew', () => {
    expect(shouldSyncAppointmentCrew({
      employeeRole: 'field_tech',
      isPrivate: true,
      originalCrew: ORIGINAL_CREW,
      selectedCrew: [{ employee_id: 'employee-a', role: 'lead' }],
    })).toBe(true);
  });

  it('skips an unchanged crew regardless of response ordering', () => {
    expect(shouldSyncAppointmentCrew({
      employeeRole: 'admin',
      isPrivate: true,
      originalCrew: ORIGINAL_CREW,
      selectedCrew: [...ORIGINAL_CREW].reverse(),
    })).toBe(false);
  });

  it('syncs an authorized public crew diff', () => {
    expect(shouldSyncAppointmentCrew({
      employeeRole: 'field_tech',
      isPrivate: false,
      originalCrew: ORIGINAL_CREW,
      selectedCrew: [{ employee_id: 'employee-a', role: 'lead' }],
    })).toBe(true);
  });

  it('syncs an authorized private crew diff for a project manager', () => {
    expect(shouldSyncAppointmentCrew({
      employeeRole: 'project_manager',
      isPrivate: true,
      originalCrew: ORIGINAL_CREW,
      selectedCrew: [{ employee_id: 'employee-a', role: 'lead' }],
    })).toBe(true);
  });
});
