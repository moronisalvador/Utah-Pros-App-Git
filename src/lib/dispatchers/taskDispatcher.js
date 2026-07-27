/**
 * ════════════════════════════════════════════════
 * FILE: taskDispatcher.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Retains the dormant task-toggle prototype for historical source context.
 *
 * DEPENDS ON:
 *   Internal:  none
 *   Data:      writes → toggle_appointment_task RPC
 *
 * NOTES / GOTCHAS:
 *   - DORMANT: the production enqueue boundary rejects `task.toggle` and the
 *     sync runner does not import this prototype.
 *   - A toggle has no desired-state/operation-ID contract. Ambiguous outcomes
 *     require manual reconciliation and must never auto-replay.
 * ════════════════════════════════════════════════
 */

import { isStableQueueOperationId } from '../offlineDb';

/**
 * Send a queued task toggle to the server. The RPC is a toggle and accepts no
 * operation ID, so an ambiguous outcome must be reconciled manually; the queue
 * runner never automatically replays it.
 * @param {object} db - Authenticated supabase client (db.rpc).
 * @param {object} employee - employee row (for the p_employee_id fallback).
 * @param {{ clientId:string, taskId:string, employeeId?:string }} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchTaskToggle(
  db,
  employee,
  payload,
  queueItem,
  ownerLease,
) {
  if (
    !payload?.taskId
    || !isStableQueueOperationId(queueItem?.operationId)
    || payload.clientId !== queueItem.operationId
    || ownerLease?.owner !== queueItem?.owner
  ) {
    throw new Error(
      'dispatchTaskToggle requires an owner-bound stable operation ID',
    );
  }

  await db.rpc('toggle_appointment_task', {
    p_task_id: payload.taskId,
    p_employee_id: payload.employeeId || employee?.id || null,
  });

  // No new server row is created (a toggle updates an existing task).
  return { serverId: undefined };
}
