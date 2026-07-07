/**
 * ════════════════════════════════════════════════
 * FILE: HubChecklist.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The visit's task list on the Job Hub stage — the work surface once a tech is
 *   on site. Big 56px rows tick done/undone in one tap (it flips instantly, then
 *   quietly undoes itself if the save fails), a progress bar shows how far along
 *   the visit is, and a tech can add a task right here without leaving the page.
 *   There's also an "Edit list" shortcut into the full task editor.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of the Stage, Z2)
 *   Rendered by:  src/pages/tech/v2/hub/HubStage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/lib/toast, ./hubChecklistState
 *   Data:      reads  → job_tasks (get_appointment_tasks)
 *              writes → job_tasks (toggle_appointment_task; add_adhoc_job_task
 *                        with p_appointment_id → creates + tags in one call)
 *
 * NOTES / GOTCHAS:
 *   - Optimistic toggle uses toggleTaskLocal (pure, tested); the same call
 *     reverts on error. A per-task guard prevents double-fire on rapid taps.
 *   - add_adhoc_job_task's p_appointment_id inserts the task already tagged to
 *     this visit (verified against the live definition — no separate assign call).
 *   - Toggling is gated on `canToggle` (the viewer is on this visit's crew).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { toggleTaskLocal, taskProgress } from './hubChecklistState.js';

/**
 * @param {{ apptId: string, jobId: string, canToggle?: boolean,
 *           onMutation?: (kind:string) => void }} props
 */
export default function HubChecklist({ apptId, jobId, canToggle = true, onMutation }) {
  const { t } = useTranslation('hub');
  const { employee, db } = useAuth();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const togglingRef = useRef(new Set());

  const loadTasks = useCallback(async () => {
    if (!apptId) { setTasks([]); return; }
    try {
      const list = await db.rpc('get_appointment_tasks', { p_appointment_id: apptId });
      setTasks(list || []);
    } catch { setTasks([]); }
  }, [db, apptId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const toggle = async (task) => {
    if (!canToggle || togglingRef.current.has(task.id)) return;
    togglingRef.current.add(task.id);
    setTasks((prev) => toggleTaskLocal(prev, task.id)); // optimistic
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.id, p_employee_id: employee.id });
      onMutation?.('task');
    } catch {
      setTasks((prev) => toggleTaskLocal(prev, task.id)); // revert (flip is its own inverse)
      toast(t('toast.taskFailed'), 'error');
    } finally {
      togglingRef.current.delete(task.id);
    }
  };

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await db.rpc('add_adhoc_job_task', {
        p_job_id: jobId, p_title: title, p_phase_name: 'general', p_appointment_id: apptId,
      });
      setNewTitle('');
      setAdding(false);
      await loadTasks();
      onMutation?.('task');
      toast(t('toast.taskAdded'));
    } catch {
      toast(t('toast.taskAddFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const { done, total, pct } = taskProgress(tasks);

  return (
    <section className="tv2-hub-section">
      <div className="tv2-hub-section__head">
        <span className="tv2-hub-section__title">
          {t('stage.tasks')}
          {total > 0 && <span className="tv2-hub-section__count">{done}/{total}</span>}
        </span>
        <button type="button" className="tv2-hub-linkbtn" onClick={() => navigate(`/tech/appointment/${apptId}/edit?section=tasks`)}>
          {t('stage.editTasks')}
        </button>
      </div>

      {total > 0 && (
        <div className="tv2-hub-progress"><div className="tv2-hub-progress__fill" style={{ width: `${pct}%` }} /></div>
      )}

      {total === 0 ? (
        <div className="tv2-hub-empty">{t('stage.noTasks')}</div>
      ) : (
        <div className="tv2-hub-tasklist">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="tv2-hub-task"
              onClick={() => toggle(task)}
              disabled={!canToggle}
              aria-pressed={!!task.is_completed}
            >
              <span className={`tv2-hub-task__check${task.is_completed ? ' is-done' : ''}`}>
                {task.is_completed && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </span>
              <span className={`tv2-hub-task__name${task.is_completed ? ' is-done' : ''}`}>{task.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Inline add-task */}
      {adding ? (
        <div className="tv2-hub-addrow">
          <input
            className="tv2-hub-addrow__input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
            placeholder={t('stage.addTaskPlaceholder')}
            autoFocus
          />
          <button type="button" className="tv2-hub-addrow__save" onClick={addTask} disabled={saving || !newTitle.trim()}>
            {t('common.add')}
          </button>
          <button type="button" className="tv2-hub-addrow__cancel" onClick={() => { setAdding(false); setNewTitle(''); }}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="tv2-hub-addbtn" onClick={() => setAdding(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {t('stage.addTask')}
        </button>
      )}
    </section>
  );
}
