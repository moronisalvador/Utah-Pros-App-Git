/**
 * ════════════════════════════════════════════════
 * FILE: OverdueTasksWidget.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small Overview card that lists the CRM tasks that are past due, so staff
 *   see what needs catching up the moment they open the CRM. It stays hidden
 *   when nothing is overdue, so a clean day leaves the Overview untouched.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/crmIcons (IconTasks),
 *              functions/lib/date-mt.js (isStale — the Mountain-Time day boundary)
 *   Data:      reads → get_overdue_tasks RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 7 (.claude/rules/crm-wave-ownership.md).
 *   - "Overdue" is a Mountain-Time DAY-boundary judgment (isTaskOverdue below),
 *     the JS mirror of the get_overdue_tasks SQL predicate: a task due earlier
 *     *today* in Denver is not overdue; a task whose due date was a prior Denver
 *     day is. The server already filters; the client re-checks defensively
 *     against clock skew and to render the "Overdue" state honestly.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconTasks } from '@/lib/crmIcons';
import { isStale } from '../../../functions/lib/date-mt.js';

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

// True when a task's due DATE is a prior Mountain-Time day relative to `now`.
// A task with no due date is never overdue. Mirrors get_overdue_tasks in SQL.
// (Exported for unit tests + reuse in CrmTasks; the file's default export is
// still the component.)
// eslint-disable-next-line react-refresh/only-export-components
export function isTaskOverdue(dueAt, now) {
  if (!dueAt) return false;
  return isStale(dueAt, now, 1);
}

function formatDue(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function OverdueTasksWidget() {
  const { db } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date().toISOString();
      const rows = await db.rpc('get_overdue_tasks', { p_now: now });
      // Defensive client re-check on the same MT day-boundary rule.
      setTasks((rows || []).filter(t => isTaskOverdue(t.due_at, now)));
    } catch {
      err('Failed to load overdue tasks');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Render ──────────────
  // Hidden while loading and when nothing is overdue — keeps the Overview clean.
  if (loading || tasks.length === 0) return null;

  return (
    <div className="crm-card crm-overdue-card">
      <div className="crm-overdue-head">
        <IconTasks className="crm-overdue-icon" />
        <h2 className="crm-section-title">Overdue tasks</h2>
        <span className="crm-overdue-count">{tasks.length}</span>
      </div>
      <ul className="crm-overdue-list">
        {tasks.map(t => (
          <li key={t.id} className="crm-overdue-row">
            <div className="crm-overdue-main">
              <span className="crm-overdue-title">{t.title}</span>
              {t.contact_name && <span className="crm-overdue-contact">{t.contact_name}</span>}
            </div>
            <div className="crm-overdue-meta">
              {t.assignee_name && <span className="crm-overdue-assignee">{t.assignee_name}</span>}
              <span className="crm-overdue-due">Due {formatDue(t.due_at)}</span>
            </div>
          </li>
        ))}
      </ul>
      <Link to="/crm/tasks" className="crm-overdue-link">View all tasks →</Link>
    </div>
  );
}
