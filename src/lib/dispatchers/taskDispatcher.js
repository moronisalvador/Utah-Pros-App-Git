// Dispatcher: sends a queued appointment-task toggle to Supabase via the
// toggle_appointment_task RPC. Mirrors the in-page flow in TechTasks.jsx exactly
// so an offline checkbox tap produces the same server state as an online one.

/**
 * Send a queued task toggle to the server.
 * The offline queue fires each enqueued toggle exactly once (deduped by clientId),
 * so a single tap flips the task once — matching the online single-tap behavior.
 * @param {object} db - Authenticated supabase client (db.rpc).
 * @param {object} employee - employee row (for the p_employee_id fallback).
 * @param {{ clientId:string, taskId:string, employeeId?:string }} payload
 * @returns {Promise<{serverId:string|undefined}>}
 */
export async function dispatchTaskToggle(db, employee, payload /*, queueItem */) {
  if (!payload?.clientId || !payload?.taskId) {
    throw new Error('dispatchTaskToggle requires clientId, taskId');
  }

  await db.rpc('toggle_appointment_task', {
    p_task_id: payload.taskId,
    p_employee_id: payload.employeeId || employee?.id || null,
  });

  // No new server row is created (a toggle updates an existing task).
  return { serverId: undefined };
}
