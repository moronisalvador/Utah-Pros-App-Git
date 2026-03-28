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

  // Live timer — counts from travel_start (On My Way) through to Finish
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const startRef = entry?.travel_start || entry?.clock_in;
    if (!startRef || entry?.clock_out) return;
    if (entry.paused_at) {
      const pausedMs = new Date(entry.paused_at) - new Date(startRef)
        - (entry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, pausedMs)));
      return;
    }
    const tick = () => {
      const ms = Date.now() - new Date(startRef).getTime()
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

  if (loading) {
    return (
      <div className="tech-tracker" style={{ background: 'var(--bg-secondary)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  const hasTravel = entry?.travel_start;
  const hasClockIn = entry?.clock_in;
  const hasClockOut = entry?.clock_out;
  const isPaused = entry?.paused_at;

  // Completed — compact summary
  if (hasClockOut) {
    const hours = entry.hours ?? '—';
    return (
      <div className="tech-tracker" style={{ background: 'var(--bg-secondary)', padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'var(--status-completed-color)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            Completed
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>In: {fmtTime(entry.clock_in)}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Out: {fmtTime(entry.clock_out)}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{hours}h</span>
        </div>
      </div>
    );
  }

  // Working or Paused
  if (hasClockIn) {
    const bg = isPaused ? 'var(--status-paused-bg)' : 'var(--status-working-bg)';
    const timerColor = isPaused ? 'var(--status-paused-color)' : 'var(--status-working-color)';
    const statusLabel = isPaused ? 'PAUSED' : 'WORKING';

    return (
      <div className="tech-tracker" style={{ background: bg }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: timerColor,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {statusLabel}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>elapsed</span>
        </div>

        <div className="tech-tracker-timer" style={{ color: timerColor }}>
          {elapsed}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {isPaused ? (
            <button
              className="tech-tracker-btn"
              onClick={() => doAction('resume')}
              disabled={acting}
              style={{ background: '#059669', color: '#fff' }}
            >
              Resume
            </button>
          ) : (
            <>
              <button
                className="tech-tracker-btn-secondary"
                onClick={() => doAction('pause')}
                disabled={acting}
                style={{
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  border: '1.5px solid var(--border-color)',
                }}
              >
                Pause
              </button>
              <button
                className="tech-tracker-btn-secondary"
                onClick={() => doAction('finish')}
                onBlur={() => setConfirmFinish(false)}
                disabled={acting}
                style={{
                  background: confirmFinish ? '#fef2f2' : 'transparent',
                  color: confirmFinish ? '#dc2626' : 'var(--text-primary)',
                  border: `1.5px solid ${confirmFinish ? '#fecaca' : 'var(--border-color)'}`,
                  fontWeight: confirmFinish ? 700 : 600,
                }}
              >
                {confirmFinish ? 'Confirm Finish' : 'Finish'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // En Route
  if (hasTravel) {
    return (
      <div className="tech-tracker" style={{ background: 'var(--status-enroute-bg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'var(--status-enroute-color)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            EN ROUTE
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Left at {fmtTime(entry.travel_start)}
          </span>
        </div>

        <div className="tech-tracker-timer" style={{ color: 'var(--status-enroute-color)' }}>
          {elapsed}
        </div>

        <button
          className="tech-tracker-btn"
          onClick={() => doAction('start')}
          disabled={acting}
          style={{ background: '#059669', color: '#fff' }}
        >
          Start Work
        </button>
      </div>
    );
  }

  // Scheduled — no entry yet
  return (
    <div className="tech-tracker" style={{ background: 'var(--bg-secondary)' }}>
      <button
        className="tech-tracker-btn"
        onClick={() => doAction('omw')}
        disabled={acting}
        style={{ background: '#b45309', color: '#fff' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        On My Way
      </button>
    </div>
  );
}
