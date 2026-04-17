import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_PILL_COLORS } from './techConstants';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import Hero from '@/components/tech/Hero';
import ActionBar from '@/components/tech/ActionBar';

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

export default function TechJobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { db } = useAuth();

  const [job, setJob] = useState(null);
  const [contact, setContact] = useState(null);
  const [claim, setClaim] = useState(null);
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

      const [contacts, claimRows] = await Promise.all([
        db.rpc('get_job_contacts', { p_job_id: jobId }).catch(() => []),
        j.claim_id
          ? db.select('claims', `id=eq.${j.claim_id}&select=id,claim_number`).catch(() => [])
          : Promise.resolve([]),
      ]);
      const list = Array.isArray(contacts) ? contacts : [];
      const primary = list.find(c => c.is_primary) || list[0] || null;
      setContact(primary);
      setClaim(claimRows?.[0] || null);
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

      {/* Phase 2: NowNext + Appointments list */}
      {/* Phase 3: Photos & Notes + Add Photo/Note */}
      {/* Phase 4: Collapsed Job details + admin kebab */}
    </div>
  );
}
