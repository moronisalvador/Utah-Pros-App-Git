import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS, DIV_PILL_COLORS, DIV_BORDER_COLORS, CLAIM_STATUS_COLORS } from './techConstants';
import { DIV_EMOJI } from '@/lib/claimUtils';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';

function openMap(address) {
  if (!address) return;
  const encoded = encodeURIComponent(address);
  const url = /iPhone|iPad/.test(navigator.userAgent)
    ? `maps://?q=${encoded}`
    : `https://maps.google.com/?q=${encoded}`;
  window.open(url);
}

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T12:00:00'); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return target.toLocaleDateString('en-US', { weekday: 'long' });
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Returns { ctxType: 'now_active'|'today'|'next', appt } or null.
// Mirrors the logic spec'd in TECH-CLAIM-DETAIL-TASK.md § "Now / Next module".
function pickNowNext(appointments, employeeId) {
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

// ───────────────────────────────────────────────────────────────
// Hero — division-gradient header. Candidate for future extraction
// to components/tech/ once TechJobDetail needs the same shape.
// ───────────────────────────────────────────────────────────────
function Hero({
  division, claimNumber, insuredName, address, status, jobCount,
  lossDate, lossType, insuranceClaimNumber,
  onBack, showMenu, onMenu,
}) {
  const gradient = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const statusColors = CLAIM_STATUS_COLORS[status] || CLAIM_STATUS_COLORS.open;
  const emoji = DIV_EMOJI[division] || DIV_EMOJI.general;

  return (
    <div className="tech-hero" style={{ background: gradient, color: '#fff' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px var(--space-4)',
      }}>
        <button
          onClick={onBack}
          aria-label="Back to claims"
          style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
            minWidth: 48, minHeight: 48, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: '#fff', color: statusColors.color,
            textTransform: 'capitalize', letterSpacing: '0.02em',
          }}>
            {status || 'open'}
          </span>
          {showMenu && (
            <button
              onClick={onMenu}
              aria-label="More actions"
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 36, minHeight: 36, borderRadius: 'var(--radius-full)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '4px var(--space-5) 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
          <span style={{
            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
            color: 'rgba(255,255,255,0.72)', letterSpacing: '0.02em',
          }}>
            {claimNumber || '—'}
          </span>
        </div>

        <div style={{
          fontSize: 24, fontWeight: 700, color: '#fff',
          lineHeight: 1.2, marginBottom: 6,
        }}>
          {insuredName || 'Unknown'}
        </div>

        {address && (
          <button
            onClick={() => openMap(address)}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: 500,
              textAlign: 'left', cursor: 'pointer', textDecoration: 'underline',
              textUnderlineOffset: 3, textDecorationColor: 'rgba(255,255,255,0.4)',
              fontFamily: 'var(--font-sans)', WebkitTapHighlightColor: 'transparent',
              minHeight: 24,
            }}
          >
            {address}
          </button>
        )}

        {/* Meta row: loss date · loss type · ins# · job count */}
        <div style={{
          marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.72)',
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        }}>
          {lossDate && <span>Loss: {formatLossDate(lossDate)}</span>}
          {lossType && <><span>·</span><span style={{ textTransform: 'capitalize' }}>{lossType}</span></>}
          {insuranceClaimNumber && <><span>·</span><span style={{ fontFamily: 'var(--font-mono)' }}>Ins# {insuranceClaimNumber}</span></>}
          {jobCount > 0 && <><span>·</span><span>{jobCount} job{jobCount !== 1 ? 's' : ''}</span></>}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// ActionBar — Call · Navigate · Message
// Candidate for extraction once TechJobDetail reuses it.
// ───────────────────────────────────────────────────────────────
function ActionBar({ phone, address }) {
  const btnBase = {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 4, padding: '6px 0', minWidth: 64, minHeight: 56,
    fontFamily: 'var(--font-sans)',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
  };
  const enabledStyle = { color: 'var(--text-secondary)', cursor: 'pointer' };
  const disabledStyle = { color: 'var(--text-tertiary)', opacity: 0.45, cursor: 'not-allowed' };

  return (
    <div style={{
      display: 'flex', background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-light)', padding: '8px 0',
    }}>
      {/* Call */}
      {phone ? (
        <a href={`tel:${phone}`} style={{ ...btnBase, ...enabledStyle, textDecoration: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
        </a>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
        </button>
      )}

      {/* Navigate */}
      {address ? (
        <button onClick={() => openMap(address)} style={{ ...btnBase, ...enabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Navigate</span>
        </button>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Navigate</span>
        </button>
      )}

      {/* Message — TODO: switch to in-app SMS when available */}
      {phone ? (
        <a href={`sms:${phone}`} style={{ ...btnBase, ...enabledStyle, textDecoration: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
        </a>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// NowNextTile — context-aware "what's happening on this claim"
// Shown when the tech has live work, a today appt, or the claim
// has any upcoming appt. Hidden otherwise. Reusable on TechJobDetail.
// ───────────────────────────────────────────────────────────────
function NowNextTile({ appt, ctxType, onOpen }) {
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

function nextApptForJob(jobId, appointments) {
  if (!jobId || !appointments?.length) return null;
  const today = new Date().toISOString().split('T')[0];
  return appointments
    .filter(a => a.job_id === jobId && a.date >= today && !['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''))[0] || null;
}

// ───────────────────────────────────────────────────────────────
// JobTile — one large tile per job under the claim.
// Reusable on TechJobDetail? No — job page IS a single job.
// But the internal layout (division-bordered card + progress + next appt)
// mirrors patterns we may want on the job page's appointments section.
// ───────────────────────────────────────────────────────────────
function JobTile({ job, taskSummary, nextAppt, onOpen }) {
  const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
  const divPill = DIV_PILL_COLORS[job.division] || DIV_PILL_COLORS.water;
  const emoji = DIV_EMOJI[job.division] || DIV_EMOJI.general;
  const divLabel = (job.division || '').charAt(0).toUpperCase() + (job.division || '').slice(1);
  const total = taskSummary?.total || 0;
  const completed = taskSummary?.completed || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;
  const phase = (job.phase || '').replace(/_/g, ' ');
  const status = job.status || 'active';

  return (
    <button
      onClick={onOpen}
      style={{
        position: 'relative', display: 'block', width: 'calc(100% - 2 * var(--space-4))',
        margin: '10px var(--space-4) 0', padding: '14px 40px 14px 18px',
        borderRadius: 16, background: 'var(--bg-primary)',
        border: '1px solid var(--border-light)',
        borderLeft: `4px solid ${divColor}`,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        WebkitTapHighlightColor: 'transparent', minHeight: 104,
        boxShadow: 'var(--tech-shadow-card)',
      }}
    >
      {/* Top row: emoji + job# + division + phase + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          {job.job_number}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{divLabel}</span>
        {phase && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: divPill.bg, color: divPill.color,
            textTransform: 'capitalize',
          }}>
            {phase}
          </span>
        )}
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
          textTransform: 'capitalize',
        }}>
          {status}
        </span>
      </div>

      {/* Progress bar — only if tasks exist */}
      {total > 0 ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Tasks</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? '#059669' : 'var(--text-primary)' }}>
              {completed}/{total}
            </span>
          </div>
          <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: allDone ? '#059669' : divColor,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No tasks yet</div>
      )}

      {/* Next appt */}
      {nextAppt && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
          Next: <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {relativeDate(nextAppt.date)}{nextAppt.time_start ? ` · ${formatTime(nextAppt.time_start)}` : ''}
          </span>
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

// ───────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────
export default function TechClaimDetail() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [detail, setDetail] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [taskSummaries, setTaskSummaries] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Dark gradient hero → switch status bar to light icons
  useEffect(() => {
    statusBarLight();
    return () => statusBarDark();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [data, appts] = await Promise.all([
        db.rpc('get_claim_detail', { p_claim_id: claimId }),
        db.rpc('get_claim_appointments', { p_claim_id: claimId }).catch(() => []),
      ]);
      if (!data?.claim) {
        setLoadError('Claim not found');
        return;
      }
      setDetail(data);
      setAppointments(appts || []);

      // Task summaries per job — parallel, soft-fail per-job
      const jobIds = (data.jobs || []).map(j => j.id);
      if (jobIds.length > 0) {
        const entries = await Promise.all(jobIds.map(id =>
          db.rpc('get_job_task_summary', { p_job_id: id })
            .then(s => [id, s])
            .catch(() => [id, null])
        ));
        setTaskSummaries(Object.fromEntries(entries));
      }
    } catch (e) {
      setLoadError(e.message || 'Failed to load claim');
      toast('Failed to load claim', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, claimId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (!detail?.claim) {
    return (
      <div className="tech-page">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {loadError || 'Claim not found'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
            This claim may have been removed or is unavailable.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/tech/claims')}>Back to Claims</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const { claim, jobs = [], contact, adjuster } = detail;
  const division = jobs[0]?.division || 'water';
  const insuredName = contact?.name || jobs[0]?.insured_name || 'Unknown';
  const phone = contact?.phone || jobs[0]?.client_phone || null;
  const address = [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ');
  const isAdmin = employee?.role === 'admin' || employee?.role === 'manager';
  const nowNext = pickNowNext(appointments, employee?.id);

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <Hero
        division={division}
        claimNumber={claim.claim_number}
        insuredName={insuredName}
        address={address}
        status={claim.status}
        jobCount={jobs.length}
        lossDate={claim.date_of_loss}
        lossType={claim.loss_type}
        insuranceClaimNumber={claim.insurance_claim_number}
        onBack={() => navigate('/tech/claims')}
        showMenu={isAdmin}
        onMenu={() => { /* Phase 5: admin kebab menu */ }}
      />
      <ActionBar phone={phone} address={address} />

      {nowNext && (
        <NowNextTile
          appt={nowNext.appt}
          ctxType={nowNext.ctxType}
          onOpen={() => navigate(`/tech/appointment/${nowNext.appt.id}`)}
        />
      )}

      {jobs.length > 0 && (
        <>
          <div style={{
            padding: '20px var(--space-4) 0',
            fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {jobs.length === 1 ? 'Job' : `Jobs (${jobs.length})`}
          </div>
          {jobs.map(job => (
            <JobTile
              key={job.id}
              job={job}
              taskSummary={taskSummaries[job.id]}
              nextAppt={nextApptForJob(job.id, appointments)}
              onOpen={() => navigate(`/tech/jobs/${job.id}`)}
            />
          ))}
        </>
      )}

      {/* Phase 4: Photos & Notes grouped by job */}
      {/* Phase 5: Claim details collapsed + adjuster contact */}

      {/* Silence unused-adjuster warning — wired up in Phase 5 */}
      {adjuster ? null : null}
    </div>
  );
}
