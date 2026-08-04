/**
 * ════════════════════════════════════════════════
 * FILE: appointment-crew-caller-lifecycle.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps appointment saves from blanking the schedule, losing a placement the
 *   user may need to retry, or rolling an unrelated appointment backward.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/pages/Schedule.jsx,
 *              src/components/EditAppointmentModal.jsx
 *   Data:      reads → source contracts; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Database atomicity is tested separately; this file locks the caller-side
 *     loading, retry, and optimistic rollback behavior.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schedule = readFileSync(resolve('src/pages/Schedule.jsx'), 'utf8');
const editModal = readFileSync(
  resolve('src/components/EditAppointmentModal.jsx'),
  'utf8',
);
const placementHandler = schedule.slice(
  schedule.indexOf('const handlePlacementClick'),
  schedule.indexOf('const [jobPickerModal'),
);

describe('appointment crew caller lifecycle', () => {
  it('silently reconciles successful schedule mutations without spinner gating', () => {
    expect(placementHandler).toContain('await silentReloadBoard();');
    expect(placementHandler).not.toContain(
      'loadBoard(); setPanelRefreshKey(k => k + 1);',
    );
  });

  it('serializes each appointment and rolls back only its owned fields', () => {
    expect(schedule).toContain(
      'const appointmentSaveInFlightRef = useRef(new Set());',
    );
    expect(schedule).toContain(
      'appointmentSaveInFlightRef.current.has(apptId)',
    );
    expect(schedule).toContain('previousBoardAppointment.date');
    expect(schedule).toContain('previousBoardAppointment.time_end');
    expect(schedule).not.toContain('setBoardData(prevBoard)');
    expect(schedule).not.toContain('setEvents(prevEvents)');
  });

  it('retains placement state on failure and prevents duplicate creates', () => {
    expect(placementHandler).toContain('placementSaveInFlightRef.current');
    expect(placementHandler).toMatch(
      /await createAppointmentWithCrew\([\s\S]*?setPlacementMode\(/,
    );
    expect(placementHandler).not.toMatch(
      /setPlacementMode\([\s\S]*?await createAppointmentWithCrew\(/,
    );
    expect(placementHandler).toContain('await silentReloadBoard();');
  });

  it('surfaces task lookup and assignment failures without clearing selections', () => {
    expect(schedule).toContain(
      "err('Failed to load remaining tasks: ' + e.message);",
    );
    expect(editModal).toContain(
      "err('Failed to assign tasks: ' + e.message);",
    );
  });
});
