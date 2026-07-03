/**
 * ════════════════════════════════════════════════
 * FILE: CrmTasks.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's to-do list. Staff create tasks ("Call the Johnsons back",
 *   "Send the estimate"), give them a due date, an optional reminder time, an
 *   owner, and link them to a customer or a lead. Each task can be checked off
 *   (done) or reopened, edited, or deleted. Overdue tasks are flagged so nothing
 *   slips. It's the daily driver that keeps follow-up from falling through.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/tasks
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, employee),
 *              @/lib/crmIcons (IconTasks),
 *              @/components/crm/OverdueTasksWidget (isTaskOverdue)
 *   Data:      reads  → crm_tasks (get_crm_tasks RPC), employees, contacts +
 *                       inbound_leads (link pickers)
 *              writes → crm_tasks (upsert_crm_task / set_task_status /
 *                       delete_crm_task RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Status is 'open' | 'done' (the crm_tasks CHECK constraint). "Overdue" is a
 *     Mountain-Time day-boundary judgment (isTaskOverdue), matching the
 *     get_overdue_tasks SQL predicate — a task due earlier *today* isn't overdue.
 *   - Editing a task submits the FULL form state: upsert_crm_task replaces every
 *     editable field, so a blank field clears it. The editor always sends the
 *     current values, so this is intended (clear a link by removing it).
 *   - Destructive delete uses the two-click inline confirm pattern (no modal,
 *     no confirm()) per CLAUDE.md rule 2.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconTasks } from '@/lib/crmIcons';
import { isTaskOverdue } from '@/components/crm/OverdueTasksWidget';

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));
const ok = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } }));

const STATUS_TABS = [{ key: 'open', label: 'Open' }, { key: 'done', label: 'Done' }];

// <input type="datetime-local"> speaks local wall-clock; the DB speaks UTC ISO.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}
function formatDue(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CrmTasks() {
  const { db, employee } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState('open');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [editing, setEditing] = useState(null); // task object | 'new' | null
  const [confirmDelete, setConfirmDelete] = useState(null); // task id awaiting 2nd click

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_crm_tasks', {
        p_status: statusTab,
        p_assignee: assigneeFilter || null,
      });
      setTasks(rows || []);
    } catch {
      err('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [db, statusTab, assigneeFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.select('employees', 'is_active=eq.true&select=id,full_name&order=full_name.asc');
        setEmployees(rows || []);
      } catch { /* assignee picker just stays empty */ }
    })();
  }, [db]);

  // Recomputed each render (cheap) so the overdue judgment stays current.
  const now = new Date().toISOString();

  // ─── SECTION: Event handlers ──────────────
  const toggleStatus = useCallback(async (task) => {
    const next = task.status === 'done' ? 'open' : 'done';
    // Optimistic: drop it from the current tab immediately (tabs are status-filtered).
    setTasks(prev => prev.filter(t => t.id !== task.id));
    try {
      await db.rpc('set_task_status', { p_task_id: task.id, p_status: next, p_actor_id: employee?.id || null });
      ok(next === 'done' ? 'Task completed' : 'Task reopened');
    } catch {
      err('Failed to update task — reloading');
      load();
    }
  }, [db, employee, load]);

  const removeTask = useCallback(async (task) => {
    setConfirmDelete(null);
    setTasks(prev => prev.filter(t => t.id !== task.id));
    try {
      await db.rpc('delete_crm_task', { p_task_id: task.id });
      ok('Task deleted');
    } catch {
      err('Failed to delete task — reloading');
      load();
    }
  }, [db, load]);

  // ─── SECTION: Render ──────────────
  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <div className="crm-page-header-row">
          <div>
            <h1 className="crm-page-title">Tasks</h1>
            <p className="crm-page-subtitle">
              {loading ? 'Loading…' : `${tasks.length} ${statusTab === 'done' ? 'completed' : 'open'} task${tasks.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button className="crm-btn crm-btn-primary" onClick={() => setEditing('new')}>+ New task</button>
        </div>

        <div className="crm-task-toolbar">
          <div className="crm-task-tabs">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                className={`crm-task-tab${statusTab === tab.key ? ' active' : ''}`}
                onClick={() => setStatusTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <select
            className="crm-call-row-status crm-task-assignee-filter"
            value={assigneeFilter}
            onChange={e => setAssigneeFilter(e.target.value)}
            aria-label="Filter by assignee"
          >
            <option value="">Everyone</option>
            {employee && <option value={employee.id}>Mine</option>}
            {employees.filter(e => e.id !== employee?.id).map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="crm-loading">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="crm-empty-state">
          <IconTasks className="crm-empty-icon" />
          <p>{statusTab === 'done' ? 'No completed tasks yet.' : 'No open tasks. Add one to stay on top of follow-up.'}</p>
          {statusTab !== 'done' && <button className="crm-btn crm-btn-primary" onClick={() => setEditing('new')}>+ New task</button>}
        </div>
      ) : (
        <ul className="crm-task-list">
          {tasks.map(task => {
            const overdue = task.status === 'open' && isTaskOverdue(task.due_at, now);
            return (
              <li key={task.id} className={`crm-task-row${task.status === 'done' ? ' done' : ''}`}>
                <button
                  className={`crm-task-check${task.status === 'done' ? ' checked' : ''}`}
                  onClick={() => toggleStatus(task)}
                  role="checkbox"
                  aria-checked={task.status === 'done'}
                  aria-label={task.status === 'done' ? 'Reopen task' : 'Mark done'}
                >
                  {task.status === 'done' && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </button>

                <button className="crm-task-body" onClick={() => setEditing(task)}>
                  <span className="crm-task-title">{task.title}</span>
                  {task.notes && <span className="crm-task-notes">{task.notes}</span>}
                  <span className="crm-task-tags">
                    {task.due_at && (
                      <span className={`crm-task-due${overdue ? ' overdue' : ''}`}>
                        {overdue ? 'Overdue · ' : 'Due '}{formatDue(task.due_at)}
                      </span>
                    )}
                    {task.assignee_name && <span className="crm-task-chip">{task.assignee_name}</span>}
                    {task.contact_name && <span className="crm-task-chip">{task.contact_name}</span>}
                    {task.lead_id && !task.contact_name && <span className="crm-task-chip">Lead</span>}
                  </span>
                </button>

                {confirmDelete === task.id ? (
                  <span
                    className="crm-task-confirm"
                    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setConfirmDelete(null); }}
                  >
                    <button className="crm-btn crm-btn-danger crm-btn-sm" onClick={() => removeTask(task)} autoFocus>Delete</button>
                    <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="crm-task-delete" onClick={() => setConfirmDelete(task.id)} aria-label="Delete task">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <TaskEditor
          db={db}
          employees={employees}
          createdBy={employee?.id || null}
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TaskEditor — create or edit a task (title, notes, due, reminder, assignee, links)
   ═══════════════════════════════════════════════════ */
function TaskEditor({ db, employees, createdBy, task, onClose, onSaved }) {
  const [title, setTitle] = useState(task?.title || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [dueAt, setDueAt] = useState(toLocalInput(task?.due_at));
  const [remindAt, setRemindAt] = useState(toLocalInput(task?.remind_at));
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id || '');
  const [contact, setContact] = useState(task?.contact_id ? { id: task.contact_id, label: task.contact_name || 'Linked contact' } : null);
  const [lead, setLead] = useState(task?.lead_id ? { id: task.lead_id, label: 'Linked lead' } : null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!title.trim()) { err('A task title is required'); return; }
    setSaving(true);
    try {
      await db.rpc('upsert_crm_task', {
        p_id: task?.id || null,
        p_title: title.trim(),
        p_notes: notes.trim() || null,
        p_due_at: fromLocalInput(dueAt),
        p_remind_at: fromLocalInput(remindAt),
        p_assignee_id: assigneeId || null,
        p_contact_id: contact?.id || null,
        p_lead_id: lead?.id || null,
        p_created_by: createdBy,
      });
      ok(task ? 'Task updated' : 'Task added');
      onSaved();
    } catch {
      err('Failed to save the task');
      setSaving(false);
    }
  }, [db, task, title, notes, dueAt, remindAt, assigneeId, contact, lead, createdBy, onSaved]);

  const searchContacts = useCallback(async (q) => {
    const enc = encodeURIComponent(`*${q}*`);
    const rows = await db.select('contacts', `or=(name.ilike.${enc},phone.ilike.${enc})&select=id,name,phone&order=name.asc&limit=8`);
    return (rows || []).map(c => ({ id: c.id, label: c.name || c.phone || 'Contact', sublabel: c.phone }));
  }, [db]);

  const searchLeads = useCallback(async (q) => {
    const rows = await db.select('inbound_leads', 'spam_flag=eq.false&select=id,caller_number,contact:contacts(name)&order=occurred_at.desc,created_at.desc&limit=40');
    const ql = q.toLowerCase();
    return (rows || [])
      .map(l => ({ id: l.id, label: l.contact?.name || l.caller_number || 'Lead', sublabel: l.caller_number }))
      .filter(l => l.label.toLowerCase().includes(ql) || (l.sublabel || '').includes(q))
      .slice(0, 8);
  }, [db]);

  return (
    <div className="crm-panel-overlay" onClick={onClose}>
      <div className="crm-panel" onClick={e => e.stopPropagation()}>
        <div className="crm-panel-header">
          <div className="crm-panel-title">{task ? 'Edit task' : 'New task'}</div>
          <button className="crm-btn crm-btn-ghost crm-panel-close" onClick={onClose}>Close</button>
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="task-title">Title <span className="crm-required">*</span></label>
          <input id="task-title" className="crm-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Call the Johnsons back" autoFocus />
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="task-notes">Notes</label>
          <textarea id="task-notes" className="crm-input crm-task-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth remembering…" rows={3} />
        </div>

        <div className="crm-task-field-row">
          <div className="crm-panel-section crm-task-field">
            <label className="crm-panel-label" htmlFor="task-due">Due</label>
            <input id="task-due" type="datetime-local" className="crm-input" value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </div>
          <div className="crm-panel-section crm-task-field">
            <label className="crm-panel-label" htmlFor="task-remind">Reminder</label>
            <input id="task-remind" type="datetime-local" className="crm-input" value={remindAt} onChange={e => setRemindAt(e.target.value)} />
          </div>
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="task-assignee">Assignee</label>
          <select id="task-assignee" className="crm-call-row-status" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label">Linked contact</label>
          <EntitySearch placeholder="Search contacts…" selected={contact} onSelect={setContact} onClear={() => setContact(null)} search={searchContacts} />
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label">Linked lead</label>
          <EntitySearch placeholder="Search leads…" selected={lead} onSelect={setLead} onClear={() => setLead(null)} search={searchLeads} />
        </div>

        <div className="crm-panel-actions">
          <button className="crm-btn crm-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : task ? 'Save' : 'Add task'}</button>
          <button className="crm-btn crm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   EntitySearch — a tiny typeahead for linking a contact or a lead (optional)
   ═══════════════════════════════════════════════════ */
function EntitySearch({ placeholder, selected, onSelect, onClear, search }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    // All setState happens inside the debounce callback (not synchronously in
    // the effect body) so a fast typist doesn't fire a request per keystroke.
    const id = setTimeout(async () => {
      if (term.length < 2) { setResults([]); return; }
      try { setResults(await search(term)); } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(id);
  }, [q, open, search]);

  if (selected) {
    return (
      <div className="crm-entity-selected">
        <span className="crm-entity-selected-label">{selected.label}</span>
        <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={onClear}>Remove</button>
      </div>
    );
  }

  return (
    <div className="crm-entity-search">
      <input
        className="crm-input"
        value={q}
        placeholder={placeholder}
        onChange={e => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <ul className="crm-entity-results">
          {results.map(r => (
            <li key={r.id}>
              <button className="crm-entity-result" onClick={() => { onSelect(r); setQ(''); setResults([]); setOpen(false); }}>
                <span className="crm-entity-result-label">{r.label}</span>
                {r.sublabel && <span className="crm-entity-result-sub">{r.sublabel}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
