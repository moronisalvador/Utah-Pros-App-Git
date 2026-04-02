import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from '@/lib/toast';

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

function fmtMinutes(min) {
  if (min == null) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const rm = Math.round(min % 60);
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

const HAPTIC = { omw: 50, start: 50, pause: 30, resume: 50, finish: [50, 30, 50] };
const haptic = (ms = 50) => { if ('vibrate' in navigator) navigator.vibrate(ms); };

export default function TimeTracker({ appt, employee, db, onUpdate }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState('0:00:00');
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returningJob, setReturningJob] = useState(false);
  const timerRef = useRef(null);
  const confirmReturnTimer = useRef(null);

  const loadEntries = useCallback(async () => {
    try {
      const rows = await db.select(
        'job_time_entries',
        `appointment_id=eq.${appt.id}&employee_id=eq.${employee.id}&select=*&order=created_at.asc`
      );
      setEntries(rows || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [db, appt.id, employee.id]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    return () => { if (confirmReturnTimer.current) clearTimeout(confirmReturnTimer.current); };
  }, []);

  // Active entry = latest one without clock_out, or null
  const activeEntry = entries.find(e => !e.clock_out) || null;
  // All completed entries
  const completedEntries = entries.filter(e => e.clock_out);
  // Are ALL entries completed?
  const allCompleted = entries.length > 0 && !activeEntry;
  // The entry to use for timer/actions
  const entry = activeEntry || (entries.length > 0 ? entries[entries.length - 1] : null);

  // Live timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!activeEntry) return;
    const startRef = activeEntry.travel_start || activeEntry.clock_in;
    if (!startRef || activeEntry.clock_out) return;
    if (activeEntry.paused_at) {
      const pausedMs = new Date(activeEntry.paused_at) - new Date(startRef)
        - (activeEntry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, pausedMs)));
      return;
    }
    const tick = () => {
      const ms = Date.now() - new Date(startRef).getTime()
        - (activeEntry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, ms)));
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [activeEntry]);

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
      await loadEntries();
      if (onUpdate) onUpdate();
    } catch (e) {
      toast('Action failed: ' + e.message, 'error');
    }
    setActing(false);
  };

  const handleReturnTap = () => {
    if (!confirmReturn) {
      setConfirmReturn(true);
      confirmReturnTimer.current = setTimeout(() => setConfirmReturn(false), 3000);
      return;
    }
    // Second tap — open reason input
    setConfirmReturn(false);
    if (confirmReturnTimer.current) clearTimeout(confirmReturnTimer.current);
    setReturnOpen(true);
    setReturnReason('');
  };

  const handleReturnClockIn = async () => {
    setReturningJob(true);
    haptic(50);
    try {
      // Log return reason as a note linked to the job/appointment
      const job = appt.jobs;
      if (returnReason.trim() && job) {
        await db.rpc('insert_job_document', {
          p_job_id: job.id,
          p_name: 'Return reason',
          p_file_path: '',
          p_mime_type: 'text/plain',
          p_category: 'note',
          p_uploaded_by: employee.id,
          p_description: `Return reason: ${returnReason.trim()}`,
          p_appointment_id: appt.id,
        });
      }
      // Clock in — RPC will create a new entry since existing one is completed
      await db.rpc('clock_appointment_action', {
        p_appointment_id: appt.id,
        p_employee_id: employee.id,
        p_action: 'omw',
      });
      setReturnOpen(false);
      setReturnReason('');
      await loadEntries();
      if (onUpdate) onUpdate();
    } catch (e) {
      toast('Return failed: ' + e.message, 'error');
    }
    setReturningJob(false);
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

  // ── Completed state (all entries done) ──
  if (allCompleted) {
    const multiVisit = completedEntries.length > 1;

    // Calculate grand totals
    let grandTravelMin = 0;
    let grandOnsiteMin = 0;
    completedEntries.forEach(e => {
      grandTravelMin += Number(e.travel_minutes || 0);
      grandOnsiteMin += Number(e.hours || 0) * 60;
    });

    return (
      <div className="tech-tracker" style={{ background: 'var(--bg-secondary)', padding: '14px 20px' }}>
        {multiVisit ? (
          <>
            {completedEntries.map((e, i) => {
              const travelMin = Number(e.travel_minutes || 0);
              const onsiteMin = Number(e.hours || 0) * 60;
              // Check if this visit has a return reason in description
              const desc = e.description || '';
              const returnMatch = desc.includes('Return') || i > 0;
              return (
                <div key={e.id} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--status-completed-color)' }}>
                      Visit {i + 1}:
                    </span>
                    {e.travel_minutes != null && (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Travel {fmtMinutes(travelMin)}</span>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>· On-site {fmtMinutes(onsiteMin)}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 6, marginTop: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Total: {fmtMinutes(grandTravelMin + grandOnsiteMin)}
              </span>
            </div>
          </>
        ) : (
          /* Single visit — compact format */
          (() => {
            const e = completedEntries[0];
            const travelMin = e.travel_minutes ?? null;
            const hours = e.hours ?? null;

            if (travelMin != null && hours != null) {
              const onsiteMin = Number(hours) * 60;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--status-completed-color)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Completed</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Travel: {fmtMinutes(travelMin)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>On-site: {fmtMinutes(onsiteMin)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Total: {fmtMinutes(Number(travelMin) + onsiteMin)}</span>
                </div>
              );
            }
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--status-completed-color)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Completed</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>In: {fmtTime(e.clock_in)}</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Out: {fmtTime(e.clock_out)}</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>·</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{hours ?? '—'}h</span>
              </div>
            );
          })()
        )}

        {/* Return to Job button */}
        {!returnOpen && (
          <button
            onClick={handleReturnTap}
            onBlur={() => { setConfirmReturn(false); if (confirmReturnTimer.current) clearTimeout(confirmReturnTimer.current); }}
            style={{
              width: '100%', marginTop: 10, padding: '10px 0',
              borderRadius: 'var(--tech-radius-button)',
              fontSize: 13, fontWeight: 600,
              fontFamily: 'var(--font-sans)', cursor: 'pointer',
              touchAction: 'manipulation',
              background: confirmReturn ? '#fffbeb' : 'transparent',
              color: confirmReturn ? '#b45309' : 'var(--text-secondary)',
              border: `1.5px solid ${confirmReturn ? '#fde68a' : 'var(--border-color)'}`,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
          >
            {confirmReturn ? 'Confirm Return?' : 'Return to Job'}
          </button>
        )}

        {/* Return reason input */}
        {returnOpen && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Reason for return
            </div>
            <input
              className="input"
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              placeholder="e.g. Additional work requested, Follow-up monitoring..."
              autoFocus
              style={{ fontSize: 16, marginBottom: 10, width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="tech-tracker-btn"
                onClick={handleReturnClockIn}
                disabled={returningJob}
                style={{ background: '#b45309', color: '#fff', flex: 1 }}
              >
                {returningJob ? 'Clocking In...' : 'Clock In'}
              </button>
              <button
                className="tech-tracker-btn-secondary"
                onClick={() => { setReturnOpen(false); setReturnReason(''); }}
                style={{
                  background: 'transparent', color: 'var(--text-primary)',
                  border: '1.5px solid var(--border-color)', flex: 1,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Working or Paused ──
  if (hasClockIn && !hasClockOut) {
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
            {statusLabel}{completedEntries.length > 0 ? ` (Visit ${completedEntries.length + 1})` : ''}
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

  // ── En Route ──
  if (hasTravel && !hasClockIn) {
    return (
      <div className="tech-tracker" style={{ background: 'var(--status-enroute-bg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'var(--status-enroute-color)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            EN ROUTE{completedEntries.length > 0 ? ` (Visit ${completedEntries.length + 1})` : ''}
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

  // ── Scheduled — no entry yet ──
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
