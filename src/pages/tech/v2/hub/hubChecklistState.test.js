/**
 * ════════════════════════════════════════════════
 * FILE: hubChecklistState.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the checklist's instant-tap behavior: tapping flips just that task,
 *   flipping the same task again puts it back (the revert used when the server
 *   call fails), and the progress counter matches. Pure unit test.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { toggleTaskLocal, taskProgress } from './hubChecklistState.js';

const tasks = [
  { id: 't1', title: 'A', is_completed: false },
  { id: 't2', title: 'B', is_completed: true },
  { id: 't3', title: 'C', is_completed: false },
];

describe('toggleTaskLocal', () => {
  it('flips only the tapped task', () => {
    const next = toggleTaskLocal(tasks, 't1');
    expect(next.find((t) => t.id === 't1').is_completed).toBe(true);
    expect(next.find((t) => t.id === 't2').is_completed).toBe(true); // untouched
    expect(next.find((t) => t.id === 't3').is_completed).toBe(false);
  });

  it('does not mutate the input array', () => {
    const snapshot = JSON.parse(JSON.stringify(tasks));
    toggleTaskLocal(tasks, 't1');
    expect(tasks).toEqual(snapshot);
  });

  it('flipping twice restores the original (the optimistic-revert path)', () => {
    const flipped = toggleTaskLocal(tasks, 't1');
    const reverted = toggleTaskLocal(flipped, 't1');
    expect(reverted).toEqual(tasks);
  });
});

describe('taskProgress', () => {
  it('counts done/total and percent', () => {
    expect(taskProgress(tasks)).toEqual({ done: 1, total: 3, pct: (1 / 3) * 100 });
  });
  it('empty list is 0% with no divide-by-zero', () => {
    expect(taskProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});
