/**
 * ════════════════════════════════════════════════
 * FILE: hubChecklistState.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure, testable bits behind the Job Hub checklist: flipping a task's
 *   done/undone state on screen the instant it's tapped (before the server
 *   answers), and counting how many are done for the progress bar. Because the
 *   flip is its own opposite, the screen can undo it by flipping again if the
 *   server call fails (the "optimistic then revert" pattern).
 *
 * WHERE IT LIVES:
 *   Exports: toggleTaskLocal, taskProgress
 *   Used by: src/pages/tech/v2/hub/HubChecklist.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (pure functions)
 * ════════════════════════════════════════════════
 */

/**
 * Return a new task list with one task's completion flipped. Pure — the same
 * call applied twice restores the original, which is exactly the revert path.
 * @param {Array<{id:string,is_completed?:boolean}>} tasks
 * @param {string} taskId
 * @returns {Array<object>}
 */
export function toggleTaskLocal(tasks, taskId) {
  return (tasks || []).map((t) =>
    t.id === taskId ? { ...t, is_completed: !t.is_completed } : t);
}

/**
 * Done / total / percent for the progress bar.
 * @param {Array<{is_completed?:boolean}>} tasks
 * @returns {{ done:number, total:number, pct:number }}
 */
export function taskProgress(tasks) {
  const list = tasks || [];
  const total = list.length;
  const done = list.filter((t) => t.is_completed).length;
  return { done, total, pct: total > 0 ? (done / total) * 100 : 0 };
}
