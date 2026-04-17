import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_PILL_COLORS, APPT_STATUS_COLORS } from './techConstants';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import Hero from '@/components/tech/Hero';
import ActionBar from '@/components/tech/ActionBar';
import NowNextTile, { pickNowNext } from '@/components/tech/NowNextTile';
import { formatTime, relativeDate } from '@/lib/techDateUtils';

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function AppointmentCard({ appt, onOpen }) {
  const sc = APPT_STATUS_COLORS[appt.status] || APPT_STATUS_COLORS.scheduled;
  const title = appt.title || titleCase(appt.type || 'Appointment');
  const crewNames = (appt.crew || [])
    .map(c => (c.full_name || '').split(' ')[0])
    .filter(Boolean).join(', ');
  const time = formatTime(appt.time_start);

  return (
    <button
      onClick={onOpen}
      style={{
        position: 'relative', display: 'block', width: 'calc(100% - 2 * var(--space-4))',
        margin: '8px var(--space-4) 0', padding: '12px 40px 12px 14px',
        borderRadius: 14, background: 'var(--bg-primary)',
        border: '1px solid var(--border-light)',
        borderLeft: `4px solid ${sc.color}`,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        WebkitTapHighlightColor: 'transparent', minHeight: 72,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
          {title}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
          textTransform: 'capitalize', whiteSpace: 'nowrap',
        }}>
          {(appt.status || 'scheduled').replace(/_/g, ' ')}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {relativeDate(appt.date)}{time ? ` · ${time}` : ''}
        </span>
        {crewNames && <><span>·</span><span>Crew: {crewNames}</span></>}
        {appt.task_total > 0 && <><span>·</span><span>{appt.task_completed}/{appt.task_total} tasks</span></>}
      </div>
      <span style={{
        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-tertiary)', display: 'flex',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );
}

export default function TechJobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [job, setJob] = useState(null);
  const [contact, setContact] = useState(null);
  const [claim, setClaim] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setEntering(true));
    statusBarLight();
    return () => statusBarDark();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await db.select('jobs', `id=eq.${jobId}&select=*`);
      const j = rows?.[0];
      if (!j) {
        setLoadError('Job not found');
        return;
      }
      setJob(j);

      const [contacts, claimRows, allAppts] = await Promise.all([
        db.rpc('get_job_contacts', { p_job_id: jobId }).catch(() => []),
        j.claim_id
          ? db.select('claims', `id=eq.${j.claim_id}&select=id,claim_number`).catch(() => [])
          : Promise.resolve([]),
        j.claim_id
          ? db.rpc('get_claim_appointments', { p_claim_id: j.claim_id }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const list = Array.isArray(contacts) ? contacts : [];
      const primary = list.find(c => c.is_primary) || list[0] || null;
      setContact(primary);
      setClaim(claimRows?.[0] || null);
      // Filter appts to this job only
      const jobAppts = (allAppts || []).filter(a => a.job_id === jobId);
      setAppointments(jobAppts);
    } catch (e) {
      setLoadError(e.message || 'Failed to load job');
      toast('Failed to load job', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (!job) {
    return (
      <div className="tech-page">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {loadError || 'Job not found'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
            This job may have been removed or is unavailable.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const division = job.division || 'water';
  const title = contact?.name || job.insured_name || 'Unknown';
  const phone = contact?.phone || job.client_phone || null;
  const address = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const phaseLabel = titleCase(job.phase || 'New');
  const divPill = DIV_PILL_COLORS[division] || DIV_PILL_COLORS.water;

  const metaPieces = [];
  if (job.date_of_loss) metaPieces.push(`Loss: ${formatLossDate(job.date_of_loss)}`);
  if (job.division) metaPieces.push(titleCase(job.division));
  if (job.status && job.status !== 'active') metaPieces.push(`Status: ${titleCase(job.status)}`);

  return (
    <div className={`tech-page${entering ? ' tech-page-enter' : ''}`} style={{ padding: 0 }}>
      <Hero
        division={division}
        topLabel={job.job_number}
        title={title}
        address={address}
        statusText={phaseLabel}
        statusColors={{ color: divPill.color }}
        meta={metaPieces}
        onBack={() => (claim ? navigate(`/tech/claims/${claim.id}`) : navigate(-1))}
        backLabel={claim ? 'Back to claim' : 'Back'}
      />
      <ActionBar phone={phone} address={address} />

      {/* Claim breadcrumb */}
      {claim && (
        <button
          onClick={() => navigate(`/tech/claims/${claim.id}`)}
          style={{
            width: '100%', padding: '10px var(--space-4)',
            background: 'var(--bg-secondary)',
            border: 'none', borderBottom: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
            WebkitTapHighlightColor: 'transparent', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Part of <strong style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{claim.claim_number}</strong>
          </span>
          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>View claim →</span>
        </button>
      )}

      {(() => {
        const nowNext = pickNowNext(appointments, employee?.id);
        return nowNext ? (
          <NowNextTile
            appt={nowNext.appt}
            ctxType={nowNext.ctxType}
            onOpen={() => navigate(`/tech/appointment/${nowNext.appt.id}`)}
          />
        ) : null;
      })()}

      {/* Appointments list — grouped Upcoming / Past */}
      {(() => {
        const today = new Date().toISOString().split('T')[0];
        const upcoming = appointments
          .filter(a => a.date >= today && !['completed', 'cancelled'].includes(a.status))
          .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''));
        const past = appointments
          .filter(a => a.date < today || ['completed', 'cancelled'].includes(a.status))
          .sort((a, b) => b.date.localeCompare(a.date) || (b.time_start || '').localeCompare(a.time_start || ''));
        const sectionLabel = {
          padding: '20px var(--space-4) 0', fontSize: 11, fontWeight: 700,
          color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em',
        };
        const subLabel = {
          padding: '12px var(--space-4) 2px', fontSize: 10, fontWeight: 700,
          color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em',
        };

        if (appointments.length === 0) {
          return (
            <>
              <div style={sectionLabel}>Appointments</div>
              <div style={{
                margin: '8px var(--space-4) 0', padding: '16px',
                borderRadius: 12, background: 'var(--bg-secondary)',
                border: '1px dashed var(--border-color)',
                fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center',
              }}>
                No appointments scheduled for this job yet.
              </div>
            </>
          );
        }

        return (
          <>
            <div style={sectionLabel}>Appointments ({appointments.length})</div>
            {upcoming.length > 0 && <div style={subLabel}>Upcoming</div>}
            {upcoming.map(a => (
              <AppointmentCard key={a.id} appt={a} onOpen={() => navigate(`/tech/appointment/${a.id}`)} />
            ))}
            {past.length > 0 && <div style={subLabel}>Past</div>}
            {past.map(a => (
              <AppointmentCard key={a.id} appt={a} onOpen={() => navigate(`/tech/appointment/${a.id}`)} />
            ))}
          </>
        );
      })()}

      {/* Phase 3: Photos & Notes + Add Photo/Note */}
      {/* Phase 4: Collapsed Job details + admin kebab */}
    </div>
  );
}
