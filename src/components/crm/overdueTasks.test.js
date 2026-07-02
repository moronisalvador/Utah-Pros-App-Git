/**
 * ════════════════════════════════════════════════
 * FILE: overdueTasks.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "is this task overdue?" rule uses Utah's calendar day (Mountain
 *   Time), not the server's UTC day. A task due earlier *today* in Denver is NOT
 *   overdue even though its stored UTC timestamp is already in the past; a task
 *   whose due date was a prior Denver day IS overdue. This is the JS mirror of
 *   the get_overdue_tasks SQL predicate — both keyed on functions/lib/date-mt.js.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/components/crm/OverdueTasksWidget.jsx (isTaskOverdue helper)
 *
 * NOTES / GOTCHAS:
 *   - Mocks @/contexts/AuthContext so importing the widget module does not pull
 *     in the realtime Supabase client (which needs env vars at import time).
 *     We only exercise the pure helper, never render the component.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: {}, employee: null }) }));

const { isTaskOverdue } = await import('./OverdueTasksWidget.jsx');

describe('isTaskOverdue — Mountain-Time day boundary', () => {
  // Reference "now": 2026-07-02T18:00:00Z == 12:00 MDT on July 2 in Denver.
  const now = '2026-07-02T18:00:00Z';

  it('a task whose due date was a prior MT day is overdue', () => {
    // 2026-07-01T18:00:00Z == July 1 noon MDT — yesterday in Denver.
    expect(isTaskOverdue('2026-07-01T18:00:00Z', now)).toBe(true);
  });

  it('a task due earlier the SAME MT day is NOT overdue (day boundary, not instant)', () => {
    // 2026-07-02T13:30:00Z == 07:30 MDT July 2 — earlier today in Denver, and
    // its UTC instant is already before `now`, yet it is still today's work.
    expect(isTaskOverdue('2026-07-02T13:30:00Z', now)).toBe(false);
  });

  it('a task due a future MT day is not overdue', () => {
    // 2026-07-03T06:30:00Z == 00:30 MDT July 3 — tomorrow in Denver.
    expect(isTaskOverdue('2026-07-03T06:30:00Z', now)).toBe(false);
  });

  it('a UTC-day boundary that is not an MT-day boundary does not flip the verdict', () => {
    // last 2026-07-02T02:00:00Z is 2026-07-01 20:00 MDT (July 1 in Denver);
    // now 2026-07-02T05:00:00Z is 2026-07-01 23:00 MDT (still July 1 in Denver).
    // Same MT day → not overdue, even though they straddle a UTC midnight.
    expect(isTaskOverdue('2026-07-02T02:00:00Z', '2026-07-02T05:00:00Z')).toBe(false);
  });

  it('a task with no due date is never overdue', () => {
    expect(isTaskOverdue(null, now)).toBe(false);
    expect(isTaskOverdue(undefined, now)).toBe(false);
  });
});
