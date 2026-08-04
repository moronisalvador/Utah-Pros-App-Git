/**
 * ════════════════════════════════════════════════
 * FILE: appointment-crew-commands.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves every appointment form sends one normalized atomic command, preserves
 *   unchanged crew, nullable field clears, and "preserve" versus "clear."
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/appointmentCrewCommands.js
 *   Data:      reads → generated RPC payloads; writes → none
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  changedAppointmentFields,
  createAppointmentWithCrew,
  crewPayloadForUpdate,
  normalizeAppointmentCrew,
  updateAppointmentWithCrew,
} from '@/lib/appointmentCrewCommands';

const appointmentCallerMatrix = [
  ['desktop create', 'src/components/CreateAppointmentModal.jsx', ['createAppointmentWithCrew']],
  ['desktop edit and clone', 'src/components/EditAppointmentModal.jsx', ['createAppointmentWithCrew', 'updateAppointmentWithCrew']],
  ['desktop event create and edit', 'src/components/EventModal.jsx', ['createAppointmentWithCrew', 'updateAppointmentWithCrew']],
  ['desktop drag, resize, and placement', 'src/pages/Schedule.jsx', ['createAppointmentWithCrew', 'updateAppointmentWithCrew']],
  ['native edit and reschedule', 'src/pages/tech/TechEditAppointment.jsx', ['updateAppointmentWithCrew']],
  ['native appointment create', 'src/pages/tech/TechNewAppointment.jsx', ['createAppointmentWithCrew']],
  ['native event create', 'src/pages/tech/TechNewEvent.jsx', ['createAppointmentWithCrew']],
];

describe('appointment crew commands', () => {
  it.each(appointmentCallerMatrix)(
    'routes %s through the shared atomic command boundary',
    (_surface, sourcePath, expectedCommands) => {
      const source = readFileSync(resolve(sourcePath), 'utf8');
      expectedCommands.forEach((command) => {
        expect(source).toContain(command);
      });
      expect(source).not.toMatch(
        /\.from\(['"](?:appointments|appointment_crew)['"]\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(/,
      );
      expect(source).not.toMatch(
        /\bdb\s*\.\s*(?:insert|update|upsert|delete)\s*\(\s*['"](?:appointments|appointment_crew)['"]/,
      );
      expect(source).not.toMatch(
        /\bdb\s*\.\s*rpc\s*\(\s*['"](?:sync_appointment_crew|update_appointment)['"]/,
      );
    },
  );

  it('normalizes missing roles to tech and removes duplicate people', () => {
    expect(normalizeAppointmentCrew([
      { employee_id: 'b', role: null },
      { employee_id: 'a', role: 'lead' },
      { employee_id: 'a', role: 'helper' },
    ])).toEqual([
      { employee_id: 'a', role: 'lead' },
      { employee_id: 'b', role: 'tech' },
    ]);
  });

  it('omits unchanged appointment fields so crew-only authority stays crew-only', async () => {
    const original = {
      date: '2026-08-03',
      timeStart: '09:00',
      timeEnd: '10:00',
      title: 'Monitoring',
      type: 'reconstruction',
      status: 'scheduled',
      notes: 'Dry check',
    };
    const db = { rpc: vi.fn().mockResolvedValue({ id: 'appointment-1' }) };

    const appointmentChanges = changedAppointmentFields(original, { ...original });
    expect(appointmentChanges).toEqual({});

    await updateAppointmentWithCrew(db, {
      appointmentId: 'appointment-1',
      ...appointmentChanges,
      crew: [{ employee_id: 'employee-2', role: 'tech' }],
    });

    expect(db.rpc).toHaveBeenCalledWith(
      'update_appointment_with_crew',
      expect.objectContaining({
        p_appointment_id: 'appointment-1',
        p_date: null,
        p_time_start: null,
        p_time_end: null,
        p_title: null,
        p_type: null,
        p_status: null,
        p_notes: null,
        p_set_time_start: false,
        p_set_time_end: false,
        p_set_notes: false,
        p_crew: [{ employee_id: 'employee-2', role: 'tech' }],
      }),
    );
  });

  it('keeps explicit nullable-field clears while omitting unchanged values', () => {
    expect(changedAppointmentFields(
      {
        date: '2026-08-03',
        timeStart: '09:00',
        timeEnd: '10:00',
        notes: 'Dry check',
      },
      {
        date: '2026-08-03',
        timeStart: null,
        timeEnd: null,
        notes: null,
      },
    )).toEqual({
      timeStart: null,
      timeEnd: null,
      notes: null,
    });
  });

  it('passes null crew for an unchanged update and one atomic RPC call', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ id: 'appointment-1' }) };
    const crew = [{ employee_id: 'a', role: 'lead' }];
    expect(crewPayloadForUpdate(crew, [...crew])).toBeNull();
    await updateAppointmentWithCrew(db, { appointmentId: 'appointment-1', crew: undefined });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('update_appointment_with_crew', expect.objectContaining({
      p_appointment_id: 'appointment-1', p_crew: null,
    }));
  });

  it('keeps omitted tasks distinct from an explicit empty replacement', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ id: 'appointment-1' }) };
    await updateAppointmentWithCrew(db, { appointmentId: 'appointment-1' });
    await updateAppointmentWithCrew(db, {
      appointmentId: 'appointment-1',
      taskIds: [],
    });
    expect(db.rpc.mock.calls[0][1].p_task_ids).toBeNull();
    expect(db.rpc.mock.calls[1][1].p_task_ids).toEqual([]);
  });

  it('distinguishes omitted nullable fields from explicit clear-to-null', async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ id: 'appointment-1' }) };
    await updateAppointmentWithCrew(db, { appointmentId: 'appointment-1' });
    await updateAppointmentWithCrew(db, {
      appointmentId: 'appointment-1',
      timeStart: null,
      timeEnd: '',
      notes: null,
    });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({
      p_time_start: null,
      p_time_end: null,
      p_notes: null,
      p_set_time_start: false,
      p_set_time_end: false,
      p_set_notes: false,
    });
    expect(db.rpc.mock.calls[1][1]).toMatchObject({
      p_time_start: null,
      p_time_end: null,
      p_notes: null,
      p_set_time_start: true,
      p_set_time_end: true,
      p_set_notes: true,
    });
  });

  it('propagates an atomic command rejection without issuing a follow-up write', async () => {
    const failure = new Error('crew role rejected');
    const db = { rpc: vi.fn().mockRejectedValue(failure) };
    await expect(createAppointmentWithCrew(db, { title: 'Visit', date: '2026-08-03', crew: [] }))
      .rejects.toThrow('crew role rejected');
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});
