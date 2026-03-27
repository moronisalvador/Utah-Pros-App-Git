import { useState, useEffect, useCallback, useRef } from 'react';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

export function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatTimeStr(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const HAPTIC = { omw: 50, start: 50, pause: 30, resume: 50, finish: [50, 30, 50] };
const haptic = (ms = 50) => { if ('vibrate' in navigator) navigator.vibrate(ms); };

export default function TimeTracker({ appt, employee, db, onUpdate }) {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState('0:00:00');
  const [confirmFinish, setConfirmFinish] = useState(false);
  const timerRef = useRef(null);

  const loadEntry = useCallback(async () => {
    try {
      const rows = await db.select(
        'job_time_entries',
        `appointment_id=eq.${appt.id}&employee_id=eq.${employee.id}&select=*&limit=1`
      );
      setEntry(rows?.[0] || null);
    } catch { /* ignore */ }
    setLoading(false);
  }, [db, appt.id, employee.id]);

  useEffect(() => { loadEntry(); }, [loadEntry]);

  // Live timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!entry?.clock_in || entry?.clock_out) return;
    if (entry.paused_at) {
      const pausedMs = new Date(entry.paused_at) - new Date(entry.clock_in)
        - (entry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, pausedMs)));
      return;
    }
    const tick = () => {
      const ms = Date.now() - new Date(entry.clock_in).getTime()
        - (entry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, ms)));
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [entry]);

  const doAction = async (action) => {
    if (action === 'finish') {
      if (!confirmFinish) { setConfirmFinish(true); return; }
      setConfirmFinish(false);
    }
    haptic(HAPTIC[action] || 50);
    setActing(true);
    try {
      await db.rpc('clock_appointment_action', {
        p_appointment_id: appt.id,
        p_employee_id: employee.id,
        p_action: action,
      });
      await loadEntry();
      if (onUpdate) onUpdate();
    } catch (e) {
      toast('Action failed: ' + e.message, 'error');
    }
    setActing(false);
  };

  if (loading) return <div className="tech-tracker" style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading...</div>;

  const hasTravel = entry?.travel_start;
  const hasClockIn = entry?.clock_in;
  const hasClockOut = entry?.clock_out;
  const isPaused = entry?.paused_at;

  // Completed
  if (hasClockOut) {
    return (
      <div className="tech-tracker">
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>COMPLETED</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span><strong>In:</strong> {fmtTime(entry.clock_in)}</span>
          <span><strong>Out:</strong> {fmtTime(entry.clock_out)}</span>
          <span><strong>Hours:</strong> {entry.hours ?? '—'}</span>
        </div>
      </div>
    );
  }

  // In Progress or Paused
  if (hasClockIn) {
    return (
      <div className="tech-tracker">
        <div className="tech-tracker-timer">{elapsed}</div>
        {isPaused && <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', marginBottom: 6 }}>PAUSED</div>}
        <div className="tech-tracker-actions">
          {isPaused ? (
            <button className="btn btn-primary" onClick={() => doAction('resume')} disabled={acting} style={{ flex: 1 }}>
              Resume
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => doAction('pause')} disabled={acting} style={{ flex: 1 }}>
              Pause
            </button>
          )}
          <button
            className="btn"
            onClick={() => doAction('finish')}
            onBlur={() => setConfirmFinish(false)}
            disabled={acting}
            style={{
              flex: 1,
              background: confirmFinish ? '#fef2f2' : 'var(--bg-tertiary)',
              color: confirmFinish ? '#dc2626' : 'var(--text-primary)',
              border: `1px solid ${confirmFinish ? '#fecaca' : 'var(--border-color)'}`,
              fontWeight: confirmFinish ? 700 : 500,
            }}
          >
            {confirmFinish ? 'Confirm Finish' : 'Finish'}
          </button>
        </div>
      </div>
    );
  }

  // En Route
  if (hasTravel) {
    return (
      <div className="tech-tracker">
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Left at {fmtTime(entry.travel_start)}
        </div>
        <button
          className="btn"
          onClick={() => doAction('start')}
          disabled={acting}
          style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600 }}
        >
          Start Work
        </button>
      </div>
    );
  }

  // Scheduled — no entry yet
  return (
    <div className="tech-tracker">
      <button
        className="btn"
        onClick={() => doAction('omw')}
        disabled={acting}
        style={{ width: '100%', background: '#d97706', color: '#fff', border: 'none', fontWeight: 600 }}
      >
        On My Way
      </button>
    </div>
  );
}
