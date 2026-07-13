/**
 * ════════════════════════════════════════════════
 * FILE: offlineDispatchers.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two new offline-queue handlers send the right thing to the server:
 *   a queued field note becomes an insert_job_document call (category 'note'),
 *   and a queued task checkbox becomes a toggle_appointment_task call. Both are
 *   what the online screens do — so work captured with no signal syncs identically.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./noteDispatcher, ./taskDispatcher (a fake db.rpc is injected)
 *
 * NOTES / GOTCHAS:
 *   - No IndexedDB is touched: a note with no roomId short-circuits resolveIdSwap.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { dispatchNote } from './noteDispatcher';
import { dispatchTaskToggle } from './taskDispatcher';

const employee = { id: 'emp-1' };

describe('offline note.insert dispatcher', () => {
  it('calls insert_job_document with category note + description', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'doc-9' });
    const db = { rpc };
    const res = await dispatchNote(db, employee, {
      clientId: 'c1', jobId: 'job-1', appointmentId: 'appt-1', description: '  hi  ',
    });
    expect(rpc).toHaveBeenCalledWith('insert_job_document', expect.objectContaining({
      p_job_id: 'job-1', p_category: 'note', p_description: 'hi',
      p_appointment_id: 'appt-1', p_uploaded_by: 'emp-1',
    }));
    expect(res.serverId).toBe('doc-9');
  });

  it('rejects a blank note', async () => {
    const db = { rpc: vi.fn() };
    await expect(dispatchNote(db, employee, { clientId: 'c1', jobId: 'j', description: '   ' }))
      .rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('offline task.toggle dispatcher', () => {
  it('calls toggle_appointment_task with the task + employee', async () => {
    const rpc = vi.fn().mockResolvedValue(null);
    const db = { rpc };
    const res = await dispatchTaskToggle(db, employee, { clientId: 'c2', taskId: 'task-3' });
    expect(rpc).toHaveBeenCalledWith('toggle_appointment_task', {
      p_task_id: 'task-3', p_employee_id: 'emp-1',
    });
    expect(res.serverId).toBeUndefined();
  });

  it('rejects a toggle with no taskId', async () => {
    const db = { rpc: vi.fn() };
    await expect(dispatchTaskToggle(db, employee, { clientId: 'c2' })).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
