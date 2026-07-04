/**
 * ════════════════════════════════════════════════
 * FILE: TimeTracker.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The clock-in panel a field tech sees on an appointment. It shows three big
 *   round buttons — "On my way", "Start", and "Finish" — that the tech taps in
 *   order as the visit progresses, plus a Pause/Resume button while on site.
 *   It records the timestamps for each step, shows how long travel and on-site
 *   time took, and lets a tech re-open a finished job with a "Return to Job"
 *   button (asking for a short reason).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (panel embedded in an appointment screen)
 *   Rendered by:  src/pages/tech/TechDash.jsx and
 *                 src/pages/tech/TechAppointment.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/toast, @/lib/nativeGeolocation (getCurrentCoords),
 *              @/lib/nativeHaptics (impact, notify)
 *   Data:      reads  → job_time_entries (lists this tech's entries for the
 *                        appointment); clock_appointment_action also reads
 *                        appointments, job_time_entries
 *              writes → clock_appointment_action → appointments,
 *                        job_time_entries, system_events;
 *                        insert_job_document → job_documents (the return reason
 *                        note)
 *
 * NOTES / GOTCHAS:
 *   - The timer starts from "On my way" (travel_start), not "Start" (clock_in).
 *     Travel minutes and on-site hours are stored separately on the backend.
 *   - GPS coordinates are captured only on the "omw" and "start" actions so the
 *     UI never stalls asking for location when it would not add value.
 *   - "Finish" and "Return to Job" use a two-tap confirm (no native dialogs);
 *     the return-confirm auto-cancels after 3 seconds.
 *   - An appointment can have multiple visits; prior completed entries render as
 *     a "Visit N" history summary above the active station row.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { getCurrentCoords } from '@/lib/nativeGeolocation';
import { impact, notify } from '@/lib/nativeHaptics';
import { runOmwPrecheck, jobLabel, fmtElapsed } from '@/lib/clockPrecheck';
import { currentLocaleTag } from '@/lib/techDateUtils';
import ClockSupersedeSheet from '@/components/tech/ClockSupersedeSheet';

// ─── SECTION: Helpers ──────────────
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(currentLocaleTag(), { hour: 'numeric', minute: '2-digit' });
}

export function formatTimeStr(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString(currentLocaleTag(), { hour: 'numeric', minute: '2-digit' });
}

function fmtStamp(iso) {
  // "8:44 AM" for today, "Apr 15 · 8:44 AM" for other days
  if (!iso) return '';
  const d = new Date(iso);
  const tag = currentLocaleTag();
  const t = d.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) return t;
  return `${d.toLocaleDateString(tag, { month: 'short', day: 'numeric' })} · ${t}`;
}

function fmtMinutes(min) {
  if (min == null) return '—';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const rm = Math.round(min % 60);
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function fmtHoursDecimal(hours) {
  if (hours == null) return '—';
  const min = Number(hours) * 60;
  return fmtMinutes(min);
}

// Haptic profile per clock action: Taptic Engine on iOS, navigator.vibrate fallback elsewhere
function actionHaptic(action) {
  if (action === 'start' || action === 'finish') return notify('success');
  if (action === 'pause' || action === 'resume') return impact('light');
  return impact('medium'); // omw
}

// ── Icons ───────────────────────────────────────────────
const IconTruck = ({ color }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/>
    <circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
  </svg>
);
const IconPlay = ({ color }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round">
    <polygon points="6 4 20 12 6 20 6 4"/>
  </svg>
);
const IconStop = ({ color }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1">
    <rect x="6" y="6" width="12" height="12" rx="1"/>
  </svg>
);

// ── Station: one column of the three-station row ────────
function Station({ icon, label, timestamp, belowLabel, active, confirm, disabled, onClick, onBlur }) {
  const { t } = useTranslation('tracker');
  const isCompleted = !!timestamp && !active;
  const iconColor = active ? '#fff' : isCompleted ? 'var(--text-tertiary)' : 'var(--text-tertiary)';
  const circleBg = active
    ? (confirm ? '#dc2626' : 'var(--accent)')
    : 'var(--bg-tertiary)';
  const labelColor = active
    ? (confirm ? '#dc2626' : 'var(--accent)')
    : isCompleted ? 'var(--text-secondary)' : 'var(--text-tertiary)';

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '6px 4px' }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: circleBg,
        border: active ? 'none' : '1px solid var(--border-color)',
        transition: 'background 0.15s',
      }}>
        {icon(iconColor)}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: labelColor,
        textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center',
      }}>
        {confirm ? t('confirm') : label}
      </div>
      {timestamp && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
          {fmtStamp(timestamp)}
        </div>
      )}
      {belowLabel && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
          {belowLabel}
        </div>
      )}
    </div>
  );

  if (onClick && !disabled) {
    return (
      <button
        onClick={onClick}
        onBlur={onBlur}
        style={{
          all: 'unset',
          cursor: 'pointer',
          touchAction: 'manipulation',
          display: 'block',
          width: '100%',
        }}
      >
        {content}
      </button>
    );
  }
  return <div style={{ opacity: disabled ? 0.5 : 1 }}>{content}</div>;
}

// ── Visit summary line (for multi-visit history) ────────
function VisitSummary({ n, travelMin, onsiteMin }) {
  const { t } = useTranslation('tracker');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      fontSize: 12, color: 'var(--text-secondary)',
      padding: '4px 0',
    }}>
      <span style={{ fontWeight: 700, color: 'var(--status-completed-color)' }}>{t('visitSummary', { n })}</span>
      {travelMin != null && <span>{t('travel')} {fmtMinutes(travelMin)}</span>}
      <span>· {t('onSite')} {fmtMinutes(onsiteMin)}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function TimeTracker({ appt, employee, db, onUpdate }) {
  // ─── SECTION: State & hooks ──────────────
  const { t } = useTranslation(['tracker', 'tech']);
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returningJob, setReturningJob] = useState(false);
  const [supersede, setSupersede] = useState(null); // precheck result when OMW would supersede another open clock
  const confirmReturnTimer = useRef(null);

  // ─── SECTION: Data fetching ──────────────
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

  // Decide which entry the stations row represents
  const activeEntry = entries.find(e => !e.clock_out) || null;
  const allCompleted = entries.length > 0 && !activeEntry;
  const currentEntry = activeEntry || (allCompleted ? entries[entries.length - 1] : null);
  const priorVisits = allCompleted ? entries.slice(0, -1) : entries.filter(e => e.clock_out);

  const status = !currentEntry ? 'scheduled'
    : allCompleted ? 'completed'
    : currentEntry.paused_at ? 'paused'
    : currentEntry.clock_in ? 'on_site'
    : currentEntry.travel_start ? 'omw'
    : 'scheduled';

  const visitNumber = entries.length > 1 ? entries.indexOf(currentEntry) + 1 : null;

  // ─── SECTION: Event handlers ──────────────
  // Fire the actual clock RPC. Returns true on success.
  const performClock = async (action) => {
    actionHaptic(action);
    setActing(true);
    let ok = false;
    try {
      // Capture coords on arrival-transitions (omw, start). Pause/resume/finish skip it
      // so we don't stall the UI asking for GPS when location doesn't add value.
      let coords = null;
      if (action === 'omw' || action === 'start') {
        coords = await getCurrentCoords().catch(() => null);
      }
      await db.rpc('clock_appointment_action', {
        p_appointment_id: appt.id,
        p_employee_id: employee.id,
        p_action: action,
        p_lat: coords?.lat ?? null,
        p_lng: coords?.lng ?? null,
        p_accuracy: coords?.accuracy ?? null,
      });
      await loadEntries();
      if (onUpdate) onUpdate();
      ok = true;
    } catch (e) {
      // Backstop: enforce flag flipped on between precheck and call → show hard-block sheet.
      if (action === 'omw' && String(e.message || '').includes('OPEN_ENTRY_EXISTS')) {
        const pc = await runOmwPrecheck(db, appt.id, employee.id);
        if (pc.open_entry) setSupersede({ ...pc, enforce_explicit: true });
        else toast(t('toastClockElsewhere'), 'error');
      } else {
        toast(t('tech:toast.actionFailed', { message: e.message }), 'error');
      }
    }
    setActing(false);
    return ok;
  };

  const doAction = async (action) => {
    if (action === 'finish') {
      if (!confirmFinish) { setConfirmFinish(true); impact('light'); return; }
      setConfirmFinish(false);
    }
    // Before On-My-Way, check whether it would supersede another open clock.
    if (action === 'omw') {
      const pc = await runOmwPrecheck(db, appt.id, employee.id);
      if (pc.open_entry && (pc.enforce_explicit || pc.requires_confirmation)) {
        setSupersede(pc);
        return;
      }
    }
    await performClock(action);
  };

  const handleSupersedeConfirm = async () => {
    const open = supersede?.open_entry;
    setSupersede(null);
    const ok = await performClock('omw');
    if (ok && open) {
      toast(t('toastClockedOutOf', { job: jobLabel(open), elapsed: fmtElapsed(open.elapsed_minutes) }), 'success');
    }
  };

  const handleSupersedeGoToJob = (apptId) => {
    setSupersede(null);
    if (apptId) navigate(`/tech/appointment/${apptId}`);
  };

  const handleReturnTap = () => {
    if (!confirmReturn) {
      setConfirmReturn(true);
      impact('light');
      confirmReturnTimer.current = setTimeout(() => setConfirmReturn(false), 3000);
      return;
    }
    setConfirmReturn(false);
    if (confirmReturnTimer.current) clearTimeout(confirmReturnTimer.current);
    setReturnOpen(true);
    setReturnReason('');
  };

  const handleReturnClockIn = async () => {
    setReturningJob(true);
    impact('medium');
    try {
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
      const coords = await getCurrentCoords().catch(() => null);
      await db.rpc('clock_appointment_action', {
        p_appointment_id: appt.id,
        p_employee_id: employee.id,
        p_action: 'omw',
        p_lat: coords?.lat ?? null,
        p_lng: coords?.lng ?? null,
        p_accuracy: coords?.accuracy ?? null,
      });
      setReturnOpen(false);
      setReturnReason('');
      await loadEntries();
      if (onUpdate) onUpdate();
    } catch (e) {
      toast(t('toastReturnFailed', { message: e.message }), 'error');
    }
    setReturningJob(false);
  };

  if (loading) {
    return (
      <div className="tech-tracker" style={{ background: 'var(--bg-secondary)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        {t('loading')}
      </div>
    );
  }

  // Status label + color
  const STATUS_LABEL = {
    scheduled: { text: t('status.scheduled'), color: 'var(--text-secondary)' },
    omw:       { text: t('status.omw'),       color: 'var(--status-enroute-color)' },
    on_site:   { text: t('status.started'),   color: 'var(--status-working-color)' },
    paused:    { text: t('status.paused', { stamp: fmtStamp(currentEntry?.paused_at) }), color: 'var(--status-paused-color)' },
    completed: { text: t('status.completed'), color: 'var(--status-completed-color)' },
  }[status];

  // Background tint by status
  const BG = {
    scheduled: 'var(--bg-secondary)',
    omw:       'var(--status-enroute-bg)',
    on_site:   'var(--status-working-bg)',
    paused:    'var(--status-paused-bg)',
    completed: 'var(--bg-secondary)',
  }[status];

  // Between-step labels (only shown after the right side of the interval is reached)
  const travelLabel = currentEntry?.travel_minutes != null && (currentEntry?.clock_in || currentEntry?.clock_out)
    ? t('travelLabel', { value: fmtMinutes(Number(currentEntry.travel_minutes)) })
    : null;
  const onJobLabel = currentEntry?.clock_out && currentEntry?.hours != null
    ? t('onJobLabel', { value: fmtHoursDecimal(currentEntry.hours) })
    : null;

  // Tappability
  const omwActive    = status === 'scheduled';
  const startActive  = status === 'omw';
  const finishActive = status === 'on_site';

  // ─── SECTION: Render ──────────────
  return (
    <div className="tech-tracker" style={{ background: BG, padding: '14px 16px' }}>
      {/* Status label + visit number */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: STATUS_LABEL.color,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {STATUS_LABEL.text}
          {visitNumber && ` · ${t('visitBadge', { n: visitNumber })}`}
        </span>
      </div>

      {/* Prior visit summaries (multi-visit history) */}
      {priorVisits.length > 0 && priorVisits.map((e, i) => (
        <VisitSummary
          key={e.id}
          n={i + 1}
          travelMin={e.travel_minutes != null ? Number(e.travel_minutes) : null}
          onsiteMin={Number(e.hours || 0) * 60}
        />
      ))}

      {/* Three-station row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: priorVisits.length ? 8 : 0 }}>
        <Station
          icon={(c) => <IconTruck color={c} />}
          label={t('station.omw')}
          timestamp={currentEntry?.travel_start}
          belowLabel={travelLabel}
          active={omwActive}
          disabled={acting}
          onClick={omwActive ? () => doAction('omw') : null}
        />
        <Station
          icon={(c) => <IconPlay color={c} />}
          label={t('station.start')}
          timestamp={currentEntry?.clock_in}
          belowLabel={onJobLabel}
          active={startActive}
          disabled={acting}
          onClick={startActive ? () => doAction('start') : null}
        />
        <Station
          icon={(c) => <IconStop color={c} />}
          label={t('station.finish')}
          timestamp={currentEntry?.clock_out}
          active={finishActive}
          confirm={confirmFinish}
          disabled={acting}
          onClick={finishActive ? () => doAction('finish') : null}
          onBlur={() => setConfirmFinish(false)}
        />
      </div>

      {/* Pause / Resume secondary control (only when on_site or paused) */}
      {(status === 'on_site' || status === 'paused') && (
        <button
          onClick={() => doAction(status === 'on_site' ? 'pause' : 'resume')}
          disabled={acting}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '10px 0',
            borderRadius: 'var(--tech-radius-button)',
            fontSize: 13, fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            touchAction: 'manipulation',
            background: status === 'paused' ? '#f0fdf4' : 'transparent',
            color: status === 'paused' ? '#059669' : 'var(--text-primary)',
            border: `1.5px solid ${status === 'paused' ? '#bbf7d0' : 'var(--border-color)'}`,
          }}
        >
          {status === 'on_site' ? t('pause') : t('resume')}
        </button>
      )}

      {/* Return to Job (completed state) */}
      {allCompleted && !returnOpen && (
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
          {confirmReturn ? t('confirmReturn') : t('returnToJob')}
        </button>
      )}

      {/* Return reason input */}
      {returnOpen && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {t('reasonForReturn')}
          </div>
          <input
            className="input"
            value={returnReason}
            onChange={e => setReturnReason(e.target.value)}
            placeholder={t('reasonPlaceholder')}
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
              {returningJob ? t('clockingIn') : t('clockIn')}
            </button>
            <button
              className="tech-tracker-btn-secondary"
              onClick={() => { setReturnOpen(false); setReturnReason(''); }}
              style={{
                background: 'transparent', color: 'var(--text-primary)',
                border: '1.5px solid var(--border-color)', flex: 1,
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Supersede confirm / hard-block sheet (shown before OMW when clocked in elsewhere) */}
      <ClockSupersedeSheet
        precheck={supersede}
        busy={acting}
        onConfirm={handleSupersedeConfirm}
        onCancel={() => setSupersede(null)}
        onGoToJob={handleSupersedeGoToJob}
      />
    </div>
  );
}
