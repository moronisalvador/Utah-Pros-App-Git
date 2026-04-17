import { formatTime, relativeDate } from '@/lib/techDateUtils';

// Context-aware "what's happening on this entity" tile.
// ctxType: 'now_active' | 'today' | 'next' — computed by the caller.
// Used by TechClaimDetail (scope: claim) and TechJobDetail (scope: single job).
export default function NowNextTile({ appt, ctxType, onOpen }) {
  let label, bg, border, color;
  if (ctxType === 'now_active') {
    if (appt.status === 'en_route')         { label = 'ON MY WAY'; color = '#d97706'; bg = '#fffbeb'; border = '#fde68a'; }
    else if (appt.status === 'in_progress') { label = 'WORKING';   color = '#059669'; bg = '#ecfdf5'; border = '#a7f3d0'; }
    else                                     { label = 'PAUSED';    color = '#dc2626'; bg = '#fef2f2'; border = '#fecaca'; }
  } else if (ctxType === 'today') {
    label = 'TODAY'; color = '#2563eb'; bg = '#eff6ff'; border = '#bfdbfe';
  } else {
    label = 'NEXT'; color = 'var(--text-secondary)'; bg = 'var(--bg-secondary)'; border = 'var(--border-color)';
  }

  const time = formatTime(appt.time_start);
  const dateRel = ctxType === 'next' ? relativeDate(appt.date) : '';
  const title = appt.title || (appt.type || '').replace(/_/g, ' ') || 'Appointment';
  const crewNames = (appt.crew || []).map(c => (c.full_name || '').split(' ')[0]).filter(Boolean).join(', ');

  const headerPieces = [label];
  if (ctxType === 'next' && dateRel) headerPieces.push(dateRel);
  if (time) headerPieces.push(time);

  return (
    <button
      onClick={onOpen}
      style={{
        position: 'relative', display: 'block', width: 'calc(100% - 2 * var(--space-4))',
        margin: '14px var(--space-4) 0', padding: '14px 44px 14px 16px',
        borderRadius: 16, border: `1px solid ${border}`, background: bg,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        WebkitTapHighlightColor: 'transparent', minHeight: 72,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.08em' }}>
        {headerPieces.join(' · ')}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, textTransform: 'capitalize' }}>
        {title}
      </div>
      {(appt.job_number || crewNames) && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {[appt.job_number, crewNames && `Crew: ${crewNames}`].filter(Boolean).join(' · ')}
        </div>
      )}
      <span style={{
        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-tertiary)', display: 'flex',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );
}

// Helper: choose which appointment (if any) to show.
// Returns { ctxType, appt } or null.
export function pickNowNext(appointments, employeeId) {
  if (!appointments?.length) return null;
  const today = new Date().toISOString().split('T')[0];
  const crewHas = (a) => (a.crew || []).some(c => c.employee_id === employeeId);
  const live = ['en_route', 'in_progress', 'paused'];

  const active = appointments.find(a => live.includes(a.status) && crewHas(a));
  if (active) return { ctxType: 'now_active', appt: active };

  const todayMine = appointments.find(a =>
    a.date === today && crewHas(a) &&
    a.status !== 'completed' && a.status !== 'cancelled'
  );
  if (todayMine) return { ctxType: 'today', appt: todayMine };

  const upcoming = appointments
    .filter(a => a.date >= today && a.status !== 'completed' && a.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''));
  if (upcoming.length > 0) return { ctxType: 'next', appt: upcoming[0] };

  return null;
}
