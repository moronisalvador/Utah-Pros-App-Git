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
 *   Rendered by:  src/pages/tech/TechAppointment.jsx,
 *                 src/pages/tech/v2/hub/HubStage.jsx,
 *                 src/pages/tech/v2/dash/NowNextHero.jsx
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
 *   - A synchronous ref lock drops a double/triple OMW tap client-side; a
 *     residual 23505 unique_violation on 'omw' (a duplicate tap that raced the
 *     DB's one-open-clock guard) is treated as a harmless no-op and refreshed
 *     silently instead of shown as an error.
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

// How long we will wait for a GPS fix before writing the clock without one.
// Deliberately short: coords are optional metadata, the clock write is payroll.
const COORD_BUDGET_MS = 2500;

// How long the Finish button stays armed after the first tap. It USED to be
// disarmed by the button's own onBlur, which fired on any incidental focus
// change (the hub's 1s clock tick re-render, a toast, a stray tap) — so a tech's
// second tap silently RE-ARMED instead of finishing. An explicit timer is
// visible, predictable, and cannot be tripped by a re-render.
const FINISH_CONFIRM_MS = 6000;

// ─── SECTION: Helpers ──────────────
// (fmtTime / formatTimeStr removed 2026-08-07 — they were exported but called by
// nothing: all three consumers import only the default export, and the named
// exports also broke React Fast Refresh for this file.)
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
function Station({ icon, label, timestamp, belowLabel, active, confirm, disabled, onClick }) {
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
        // The armed state must reach a screen reader through the accessible NAME,
        // not only the red circle and the swapped label.
        aria-label={confirm ? `${t('confirm')} — ${label}` : label}
        style={{
          // Explicit resets instead of `all: unset`: `all` also resets outline to
          // none, and being an inline style it beats the global :focus-visible
          // rule — so a keyboard user got NO focus indicator on any of the three
          // primary clock buttons. Listing the resets keeps the visual identical
          // while letting focus, tap-highlight and press feedback fall through.
          background: 'none',
          border: 'none',
          margin: 0,
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'inherit',
          // `all: unset` also zeroed this; without it WKWebView can reapply
          // native button chrome. With it, the computed style is identical to
          // the old reset on every property EXCEPT the outline we want back.
          WebkitAppearance: 'none',
          appearance: 'none',
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
export default function TimeTracker({
  appt, employee, db, onUpdate,
  // ── Job Hub extras (all OPTIONAL — omitted, this renders exactly as before,
  //    which is what keeps the legacy appointment page byte-identical) ──
  // windowLabel: the visit's scheduled window, shown after the status word so the
  //   card answers "what am I on, and when was it booked" on one line.
  // onEdit: renders the pencil on that same line. Absent → no pencil.
  // onJobLiveLabel: a LIVE "on job" duration under STARTED. The owner asked for a
  //   duration here rather than a big ticking clock ("no need for a big clock
  //   scaring the technicians about time ticking"), so the value is supplied by
  //   the caller that already ticks — this component never starts an interval.
  windowLabel = null, onEdit = null, onJobLiveLabel = null,
}) {
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
  // A clock write that FAILED. Unlike a toast (which disappears in seconds — long
  // before a tech who pocketed the phone looks again) this persists on screen
  // until they retry or dismiss it. It is the honest answer to "did my tap save?".
  // NOT an offline queue: nothing is stored or replayed automatically, the tech
  // re-taps by hand (tech-mobile-ux.md online-only amendment).
  const [saveError, setSaveError] = useState(null); // { action, message } | null
  const [loadError, setLoadError] = useState(false); // refresh failed → showing stale state
  const confirmReturnTimer = useRef(null);
  const confirmFinishTimer = useRef(null);
  // Synchronous re-entrancy guard for doAction — `acting` state only flips true
  // inside performClock, which for 'omw' is after an awaited precheck. A second
  // tap during that window would race the same clock RPC before React re-renders
  // the disabled button, so this ref blocks re-entry the instant a tap is handled.
  const actionLockRef = useRef(false);

  // ─── SECTION: Data fetching ──────────────
  // A failed refresh keeps the rows already on screen and RAISES loadError —
  // it must never fall through silently (loading-error-states.md §1). Silently
  // ignoring it made the tracker show a stale station row after a successful
  // clock, so the tech re-tapped and overwrote clock_in / recomputed travel.
  const loadEntries = useCallback(async () => {
    try {
      const rows = await db.select(
        'job_time_entries',
        `appointment_id=eq.${appt.id}&employee_id=eq.${employee.id}&select=*&order=created_at.asc`
      );
      setEntries(rows || []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [db, appt.id, employee.id]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    return () => {
      if (confirmReturnTimer.current) clearTimeout(confirmReturnTimer.current);
      if (confirmFinishTimer.current) clearTimeout(confirmFinishTimer.current);
    };
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
    setSaveError(null);
    let ok = false;
    try {
      // Capture coords on arrival-transitions (omw, start). Pause/resume/finish skip it
      // so we don't stall the UI asking for GPS when location doesn't add value.
      //
      // THE COORD WAIT IS HARD-CAPPED AND NEVER GATES THE WRITE. Location is a
      // nice-to-have (it feeds the "away from jobsite" nudge); the clock write is
      // payroll. This used to await the 8s default, during which all three
      // stations were dead — and if iOS suspended the web view in that window
      // (a tech tapping "On my way" and pocketing the phone is the literal use
      // case) the promise never settled and the RPC NEVER FIRED: no row, no
      // error, no trace. Send whatever we have by COORD_BUDGET_MS and move on.
      let coords = null;
      if (action === 'omw' || action === 'start') {
        coords = await getCurrentCoords({ timeoutMs: COORD_BUDGET_MS }).catch(() => null);
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
      const msg = String(e.message || '');
      // Backstop: enforce flag flipped on between precheck and call → show hard-block sheet.
      if (action === 'omw' && msg.includes('OPEN_ENTRY_EXISTS')) {
        const pc = await runOmwPrecheck(db, appt.id, employee.id);
        if (pc.open_entry) setSupersede({ ...pc, enforce_explicit: true });
        else toast(t('toastClockElsewhere'), 'error');
      } else if (action === 'omw' && msg.includes('uq_jte_one_open_clock_per_employee')) {
        // A duplicate OMW tap raced the DB's one-open-clock guard — an earlier tap
        // already clocked this in. Harmless; just refresh quietly. Matched on the
        // specific constraint name (not the bare 23505 code) so an unrelated future
        // unique-violation still falls through to the error toast below.
        console.warn('TimeTracker: duplicate OMW tap absorbed', msg);
        await loadEntries();
        if (onUpdate) onUpdate();
        ok = true;
      } else {
        // Toast for immediacy AND a persistent banner: a tech who taps and
        // pockets the phone never sees a toast, which is exactly how a failed
        // clock-in became "I tapped it and nothing recorded".
        toast(t('tech:toast.actionFailed', { message: e.message }), 'error');
        setSaveError({ action, message: e.message });
      }
    }
    setActing(false);
    return ok;
  };

  const doAction = async (action) => {
    if (action === 'finish') {
      if (!confirmFinish) {
        setConfirmFinish(true);
        impact('light');
        if (confirmFinishTimer.current) clearTimeout(confirmFinishTimer.current);
        confirmFinishTimer.current = setTimeout(() => setConfirmFinish(false), FINISH_CONFIRM_MS);
        return;
      }
      setConfirmFinish(false);
      if (confirmFinishTimer.current) clearTimeout(confirmFinishTimer.current);
    }
    if (actionLockRef.current) return; // drop a double/triple tap while one is in flight
    actionLockRef.current = true;
    try {
      // Before On-My-Way, check whether it would supersede another open clock.
      if (action === 'omw') {
        const pc = await runOmwPrecheck(db, appt.id, employee.id);
        if (pc.open_entry && (pc.enforce_explicit || pc.requires_confirmation)) {
          setSupersede(pc);
          return;
        }
      }
      await performClock(action);
    } catch (e) {
      // Defence in depth. Both callees swallow their own errors today, so this
      // is unreachable — but a payroll write must never be one refactor away
      // from a silent unhandled rejection (page-lifecycle.md §6).
      toast(t('tech:toast.actionFailed', { message: e.message }), 'error');
      setSaveError({ action, message: e.message });
    } finally {
      actionLockRef.current = false;
    }
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
      // Same hard cap as performClock — this is a clock write too, and the
      // 8s default here gated it exactly the same way.
      const coords = await getCurrentCoords({ timeoutMs: COORD_BUDGET_MS }).catch(() => null);
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
  // Finished: the recorded figure. Still on the job: the caller's live duration,
  // if it gave us one. The finished value always wins — it is the payroll truth.
  const onJobLabel = currentEntry?.clock_out && currentEntry?.hours != null
    ? t('onJobLabel', { value: fmtHoursDecimal(currentEntry.hours) })
    : onJobLiveLabel;

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
          {/* The scheduled window rides the status line rather than taking a row
              of its own — textTransform is reset so the time reads as a time and
              not as another shouted label. */}
          {windowLabel && (
            <span style={{ textTransform: 'none', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {' · '}{windowLabel}
            </span>
          )}
        </span>
        {/* A tap must LOOK like it registered. Without this the stations just dim
            while the write is in flight, which reads as "nothing happened".
            The live region is mounted ALWAYS and only its text changes — a
            freshly-inserted aria-live node is announced inconsistently. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span aria-live="polite" style={{
            fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {acting ? t('saving') : ''}
          </span>
          {/* 44px, not 48: a dense secondary control beside a primary row, which
              tech-mobile-ux.md allows when it says so out loud. Negative margin
              keeps the hit area from pushing the card taller than it was. */}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t('editVisit')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                minWidth: 44, minHeight: 44, margin: '-11px -8px -11px 0',
                background: 'none', border: 'none', padding: '0 8px',
                color: 'var(--text-secondary)', font: 'inherit',
                fontSize: 12, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              {t('edit')}
            </button>
          )}
        </span>
      </div>

      {/* Refresh failed — the stations below may be showing a stale state. Say so
          rather than letting the tech re-tap and overwrite a good entry. */}
      {loadError && !acting && (
        <div role="status" style={{
          fontSize: 12, color: 'var(--status-paused-color)',
          marginBottom: 8, lineHeight: 1.4,
        }}>
          {t('staleWarning')}
        </div>
      )}

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
        />
      </div>

      {/* The clock write FAILED and stays on screen until dealt with. A toast is
          gone in seconds; a tech who taps and walks into the house never sees it,
          which is precisely how a lost tap became "I clocked in and it didn't
          record". Retry is a manual re-tap — nothing is queued or auto-replayed
          (tech-mobile-ux.md online-only amendment). */}
      {saveError && (
        <div
          role="alert"
          style={{
            marginTop: 10, padding: '10px 12px',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger-border)',
            borderRadius: 'var(--tech-radius-button)',
          }}
        >
          {/* --text-primary, not --danger: #dc2626 on the dark-theme --danger-bg
              (#2c1618) measures ~2.8:1, well under the 4.5:1 floor. The red
              border and the red Retry button (white on #dc2626 = 4.8:1) carry
              the alarm; the title carries the words. */}
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            {t('saveFailedTitle')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
            {t('saveFailedBody')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              // performClock, NOT doAction: doAction('finish') is a two-tap state
              // machine and confirmFinish is already back to false by the time a
              // failure lands, so routing retry through it would merely RE-ARM the
              // Finish station and fire nothing — the very defect this banner
              // exists to report. Retry is already-confirmed intent. Safe for
              // 'omw' too: performClock's own catch re-runs the precheck and
              // raises the supersede sheet if a real conflict appeared meanwhile.
              onClick={() => performClock(saveError.action)}
              disabled={acting}
              style={{
                flex: 1, minHeight: 48,
                borderRadius: 'var(--tech-radius-button)',
                fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)',
                cursor: 'pointer', touchAction: 'manipulation',
                background: 'var(--danger)', color: '#fff', border: 'none',
              }}
            >
              {t('saveFailedRetry')}
            </button>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              style={{
                minHeight: 48, padding: '0 16px',
                borderRadius: 'var(--tech-radius-button)',
                fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                cursor: 'pointer', touchAction: 'manipulation',
                background: 'transparent', color: 'var(--text-secondary)',
                border: '1.5px solid var(--border-color)',
              }}
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
      )}

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
            background: status === 'paused' ? 'var(--success-bg)' : 'transparent',
            // Label stays --text-primary in BOTH states. --success on
            // --success-bg is only 3.15:1 in light (the old #059669 was 3.60:1
            // — already under the floor), so promoting it to the token would
            // have kept a failing pairing. The green tint + green border carry
            // "resume"; the word stays readable in sun and in dark.
            color: 'var(--text-primary)',
            border: `1.5px solid ${status === 'paused' ? 'var(--success-border)' : 'var(--border-color)'}`,
          }}
        >
          {status === 'on_site' ? t('pause') : t('resume')}
        </button>
      )}

      {/* Return to Job (completed state) */}
      {allCompleted && !returnOpen && (
        <button
          onClick={handleReturnTap}
          /* No onBlur disarm — same defect class as the Finish station: an
             incidental focus change silently cancelled the arm, so the second
             tap re-armed instead of acting. The 3s timer is the only disarm. */
          style={{
            width: '100%', marginTop: 10, padding: '10px 0',
            borderRadius: 'var(--tech-radius-button)',
            fontSize: 13, fontWeight: 600,
            fontFamily: 'var(--font-sans)', cursor: 'pointer',
            touchAction: 'manipulation',
            background: confirmReturn ? 'var(--warning-bg)' : 'transparent',
            // Armed label is --text-primary, not --warning: --warning on
            // --warning-bg is 3.07:1 in light, so mapping #b45309 (4.84:1) to
            // the token would have turned a passing pairing into a failing one.
            // Amber tint + amber border still read as "armed".
            color: confirmReturn ? 'var(--text-primary)' : 'var(--text-secondary)',
            border: `1.5px solid ${confirmReturn ? 'var(--warning-border)' : 'var(--border-color)'}`,
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
              // DELIBERATE raw hex — do NOT "finish the migration" here.
              // This is a filled button with white text: #fff on #b45309 is
              // 5.02:1, but #fff on var(--warning) (#d97706) is only 3.19:1.
              // Swapping the token in would push the label under AA.
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
