import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import '@/claim-ops-page.css';
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import AddRelatedJobModal from '@/components/AddRelatedJobModal';
import MergeModal from '@/components/MergeModal';
import { toast, errToast, DIV_LABEL, DIV_EMOJI, LOSS_TYPES, CLAIM_STATUSES, fmt$, fmtK, fmtPh, fmtDate, fmtDateShort, getBalances } from '@/lib/claimUtils';
import { IR, EF, ES, StatusBadge } from '@/components/claim/SharedClaimUI';

// ═══════════════════════════════════════════════════════════════════════
// CLAIM PAGE — Operational view (Jobs, Schedule, Docs, Info, Activity)
// ═══════════════════════════════════════════════════════════════════════
export default function ClaimPage() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { db, employee: currentUser } = useAuth();

  // Detect if we're in the tech mobile layout
  const isTech = location.pathname.startsWith('/tech/');

  const [claim, setClaim] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [contact, setContact] = useState(null);
  const [adjuster, setAdjuster] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lazy-loaded data
  const [appointments, setAppointments] = useState([]);
  const [apptsLoaded, setApptsLoaded] = useState(false);
  const [taskSummaries, setTaskSummaries] = useState({});
  const [documents, setDocuments] = useState([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [activity, setActivity] = useState([]);
  const [activityLoaded, setActivityLoaded] = useState(false);

  // UI state
  const [expandedJob, setExpandedJob] = useState(null);
  const [showAddJob, setShowAddJob] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(null);

  // Mobile collapsible sections
  const [openSections, setOpenSections] = useState({ jobs: true, schedule: false, documents: false, info: false, activity: false });
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Load claim detail ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_claim_detail', { p_claim_id: claimId });
      if (!data?.claim) { navigate(isTech ? '/tech/claims' : '/claims', { replace: true }); return; }
      setClaim(data.claim);
      setJobs(data.jobs || []);
      setContact(data.contact || null);
      setAdjuster(data.adjuster || null);
    } catch (e) {
      errToast('Failed to load claim: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [db, claimId, navigate, isTech]);

  useEffect(() => { load(); }, [load]);

  // ── Lazy load appointments ──
  const loadAppointments = useCallback(async () => {
    if (apptsLoaded) return;
    try {
      const data = await db.rpc('get_claim_appointments', { p_claim_id: claimId });
      setAppointments(data || []);
    } catch { setAppointments([]); }
    setApptsLoaded(true);
  }, [db, claimId, apptsLoaded]);

  // ── Lazy load task summaries per job ──
  const loadTaskSummary = useCallback(async (jobId) => {
    if (taskSummaries[jobId]) return;
    try {
      const data = await db.rpc('get_job_task_summary', { p_job_id: jobId });
      setTaskSummaries(prev => ({ ...prev, [jobId]: data }));
    } catch {
      setTaskSummaries(prev => ({ ...prev, [jobId]: { total: 0, completed: 0 } }));
    }
  }, [db, taskSummaries]);

  // ── Lazy load documents ──
  const loadDocuments = useCallback(async () => {
    if (docsLoaded || jobs.length === 0) return;
    try {
      const ids = jobs.map(j => `"${j.id}"`).join(',');
      const d = await db.select('job_documents', `job_id=in.(${ids})&order=created_at.desc`);
      setDocuments(d || []);
    } catch { setDocuments([]); }
    setDocsLoaded(true);
  }, [db, jobs, docsLoaded]);

  // ── Lazy load activity ──
  const loadActivity = useCallback(async () => {
    if (activityLoaded) return;
    try {
      const data = await db.rpc('get_claim_activity', { p_claim_id: claimId });
      setActivity(data || []);
    } catch { setActivity([]); }
    setActivityLoaded(true);
  }, [db, claimId, activityLoaded]);

  // Desktop: load all sections on mount (no tabs)
  useEffect(() => {
    if (isTech || jobs.length === 0) return;
    loadAppointments();
    loadDocuments();
    loadActivity();
  }, [isTech, jobs, loadAppointments, loadDocuments, loadActivity]);

  // Mobile: lazy load when sections open
  useEffect(() => {
    if (!isTech) return;
    if (openSections.schedule) loadAppointments();
    if (openSections.documents) loadDocuments();
    if (openSections.activity) loadActivity();
  }, [isTech, openSections, loadAppointments, loadDocuments, loadActivity]);

  // Load task summary when a job is expanded
  useEffect(() => {
    if (expandedJob) loadTaskSummary(expandedJob);
  }, [expandedJob, loadTaskSummary]);

  // ── Mutations ──
  const patchClaim = async (fields) => {
    setSaving('claim');
    try {
      await db.update('claims', `id=eq.${claimId}`, { ...fields, updated_at: new Date().toISOString() });
      setClaim(prev => ({ ...prev, ...fields }));
    } catch (e) {
      errToast('Update failed: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  // ── Soft delete ──
  const handleSoftDelete = async () => {
    if (!claim) return;
    setDeleting(true);
    try {
      await db.update('claims', `id=eq.${claimId}`, { status: 'deleted' });
      toast(`Claim ${claim.claim_number} archived`);
      setDeleteTarget(null);
      setDeleteInput('');
      navigate(isTech ? '/tech/claims' : '/claims', { replace: true });
    } catch (e) {
      errToast('Failed to delete claim: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  // ── Computed ──
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';
  const canEdit = isAdmin || currentUser?.role === 'project_manager' || currentUser?.role === 'supervisor';
  const totals = useMemo(() => {
    let invoiced = 0, collected = 0, balance = 0;
    for (const j of jobs) {
      const b = getBalances(j);
      invoiced += b.invoiced;
      collected += b.collected;
      balance += b.balance;
    }
    return { invoiced, collected, balance };
  }, [jobs]);

  // ── Render ──
  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!claim) return null;

  const insuredName = contact?.name || jobs[0]?.insured_name || 'Unknown';
  const carrier = claim.insurance_carrier || jobs[0]?.insurance_company || 'Out of pocket';

  // (tabs removed — desktop uses two-column scrollable layout)

  // Shared content renderers
  const jobsContent = (
    <JobsSection
      jobs={jobs}
      expandedJob={expandedJob}
      setExpandedJob={setExpandedJob}
      taskSummaries={taskSummaries}
      navigate={navigate}
      onAddJob={() => setShowAddJob(true)}
      isTech={isTech}
    />
  );

  const scheduleContent = (
    <ScheduleSection
      appointments={appointments}
      loaded={apptsLoaded}
      navigate={navigate}
      isTech={isTech}
    />
  );

  const documentsContent = (
    <DocumentsSection
      jobs={jobs}
      documents={documents}
      loaded={docsLoaded}
      db={db}
      navigate={navigate}
    />
  );

  const infoContent = (
    <InfoSection
      claim={claim}
      contact={contact}
      adjuster={adjuster}
      patchClaim={patchClaim}
      saving={saving}
      canEdit={canEdit}
    />
  );

  const activityContent = (
    <ActivitySection
      activity={activity}
      loaded={activityLoaded}
    />
  );

  return (
    <div className="claim-ops-page">

      {/* ── TOP BAR ── */}
      <div className="claim-ops-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(isTech ? '/tech/claims' : '/claims')} style={{ gap: 4 }}>
          ← {isTech ? 'Claims' : 'Back'}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {contact?.phone && (
            <a href={`tel:${contact.phone}`} className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', gap: 5, height: 32 }}>
              📱 {fmtPh(contact.phone)}
            </a>
          )}
          {isAdmin && (
            <div style={{ position: 'relative' }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setShowMore(false); }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowMore(v => !v)} style={{ gap: 0, height: 32, minWidth: 32, padding: '0 8px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
              </button>
              {showMore && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', zIndex: 100, minWidth: 160, overflow: 'hidden' }}>
                  <button onClick={() => { setShowMore(false); setShowMerge(true); }} onMouseDown={e => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', textAlign: 'left' }}>
                    Merge Claim
                  </button>
                  <button onClick={() => { setShowMore(false); setDeleteTarget(claim); setDeleteInput(''); }} onMouseDown={e => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#dc2626', textAlign: 'left' }}>
                    Delete Claim
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── HEADER ── */}
      <div className="claim-ops-header">
        <div className="claim-ops-header-top">
          <div style={{ flex: 1 }}>
            <div className="claim-ops-claim-number">{claim.claim_number}</div>
            <div className="claim-ops-client">{insuredName}</div>
            <div className="claim-ops-meta">
              <span>{carrier}</span>
              {claim.date_of_loss && <><span className="claim-ops-meta-sep">·</span><span>Loss: {fmtDate(claim.date_of_loss)}</span></>}
              {claim.loss_type && <><span className="claim-ops-meta-sep">·</span><span style={{ textTransform: 'capitalize' }}>{claim.loss_type}</span></>}
              {claim.insurance_claim_number && <><span className="claim-ops-meta-sep">·</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Ins# {claim.insurance_claim_number}</span></>}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <StatusBadge status={claim.status} />
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {jobs.length} job{jobs.length !== 1 ? 's' : ''}
              {jobs.length > 0 && <span style={{ marginLeft: 4 }}>· {jobs.map(j => DIV_EMOJI[j.division] || '📁').join(' ')}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── ADMIN KPI STRIP (admin/manager only) ── */}
      {isAdmin && totals.invoiced > 0 && (
        <div className="claim-ops-kpi-strip">
          <div className="claim-ops-kpi">
            <div className="claim-ops-kpi-label">Invoiced</div>
            <div className="claim-ops-kpi-value" style={{ color: 'var(--accent)' }}>{fmtK(totals.invoiced)}</div>
          </div>
          <div className="claim-ops-kpi">
            <div className="claim-ops-kpi-label">Collected</div>
            <div className="claim-ops-kpi-value" style={{ color: '#059669' }}>
              {fmtK(totals.collected)}
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                {totals.invoiced > 0 ? Math.round((totals.collected / totals.invoiced) * 100) + '%' : ''}
              </span>
            </div>
          </div>
          <div className="claim-ops-kpi">
            <div className="claim-ops-kpi-label">Balance</div>
            <div className="claim-ops-kpi-value" style={{ color: totals.balance > 0 ? '#dc2626' : '#059669' }}>
              {totals.balance > 0 ? fmtK(totals.balance) : '✓ Paid'}
            </div>
          </div>
        </div>
      )}

      {/* ── DESKTOP: TWO-COLUMN SCROLLABLE LAYOUT ── */}
      {!isTech && (
        <div className="claim-ops-body">
          {/* Top row: two columns */}
          <div className="claim-ops-grid">
            {/* Left column: Jobs + Schedule */}
            <div className="claim-ops-col-left">
              <SectionCard title="Jobs" count={jobs.length}>
                {jobsContent}
              </SectionCard>
              <SectionCard title="Schedule">
                {scheduleContent}
              </SectionCard>
            </div>

            {/* Right column: Info + Activity */}
            <div className="claim-ops-col-right">
              <SectionCard title="Info">
                {infoContent}
              </SectionCard>
              <SectionCard title="Activity">
                {activityContent}
              </SectionCard>
            </div>
          </div>

          {/* Full-width: Documents (photo grid needs room) */}
          {(docsLoaded && documents.length > 0) && (
            <SectionCard title="Documents" count={documents.length}>
              {documentsContent}
            </SectionCard>
          )}

          {/* Financials link */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/collections/${claimId}`)}
            style={{ marginTop: 8, fontSize: 12 }}
          >
            View Financials →
          </button>
        </div>
      )}

      {/* ── MOBILE: COLLAPSIBLE SECTIONS ── */}
      {isTech && (
        <div style={{ padding: '12px 16px' }}>
          <CollapsibleSection title="Jobs" count={jobs.length} open={openSections.jobs} onToggle={() => toggleSection('jobs')}>
            {jobsContent}
          </CollapsibleSection>
          <CollapsibleSection title="Schedule" open={openSections.schedule} onToggle={() => toggleSection('schedule')}>
            {scheduleContent}
          </CollapsibleSection>
          <CollapsibleSection title="Documents" open={openSections.documents} onToggle={() => toggleSection('documents')}>
            {documentsContent}
          </CollapsibleSection>
          <CollapsibleSection title="Info" open={openSections.info} onToggle={() => toggleSection('info')}>
            {infoContent}
          </CollapsibleSection>
          <CollapsibleSection title="Activity" open={openSections.activity} onToggle={() => toggleSection('activity')}>
            {activityContent}
          </CollapsibleSection>
        </div>
      )}

      {/* ── ADD JOB MODAL ── */}
      {showAddJob && jobs.length > 0 && (
        <AddRelatedJobModal
          sourceJob={jobs[0]}
          claimData={{
            claim_number: claim.claim_number,
            insurance_carrier: claim.insurance_carrier,
            date_of_loss: claim.date_of_loss,
            loss_address: claim.loss_address,
          }}
          siblingJobs={jobs}
          employees={[]}
          db={db}
          onClose={() => setShowAddJob(false)}
          onCreated={() => { setShowAddJob(false); load(); }}
        />
      )}

      {/* ── MERGE MODAL ── */}
      {showMerge && <MergeModal type="claim" keepRecord={claim} onClose={() => setShowMerge(false)} onMerged={() => { setShowMerge(false); load(); }} />}

      {/* ── DELETE CONFIRMATION ── */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => { setDeleteTarget(null); setDeleteInput(''); }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)', width: '90%', maxWidth: 420, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626', marginBottom: 12 }}>Delete Claim</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              This will archive <strong>{claim.claim_number}</strong>. It can be restored later but will be hidden from all views.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Type <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>DELETE</strong> to confirm:
            </div>
            <input type="text" value={deleteInput} onChange={e => setDeleteInput(e.target.value)} autoFocus placeholder="DELETE"
              style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setDeleteTarget(null); setDeleteInput(''); }}>Cancel</button>
              <button onClick={handleSoftDelete} disabled={deleteInput !== 'DELETE' || deleting}
                style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)', border: 'none',
                  cursor: deleteInput === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                  background: deleteInput === 'DELETE' ? '#dc2626' : 'var(--bg-tertiary)',
                  color: deleteInput === 'DELETE' ? '#fff' : 'var(--text-tertiary)',
                  opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting...' : 'Delete Claim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION CARD (desktop)
// ═══════════════════════════════════════════════════════════════════════
function SectionCard({ title, count, children }) {
  return (
    <div className="claim-ops-section-card">
      <div className="claim-ops-section-card-title">
        {title}
        {count > 0 && <span className="claim-ops-section-card-count">{count}</span>}
      </div>
      <div className="claim-ops-section-card-body">{children}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COLLAPSIBLE SECTION (mobile)
// ═══════════════════════════════════════════════════════════════════════
function CollapsibleSection({ title, count, open, onToggle, children }) {
  return (
    <div className="claim-ops-section">
      <button className="claim-ops-section-header" onClick={onToggle}>
        <span>
          {title}
          {count > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginLeft: 6 }}>({count})</span>}
        </span>
        <svg className={`claim-ops-section-chevron${open ? ' open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="claim-ops-section-body">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// JOBS SECTION
// ═══════════════════════════════════════════════════════════════════════
function JobsSection({ jobs, expandedJob, setExpandedJob, taskSummaries, navigate, onAddJob, isTech }) {
  if (jobs.length === 0) {
    return (
      <div className="claim-ops-empty">
        <div className="claim-ops-empty-icon">📋</div>
        <div className="claim-ops-empty-text">No jobs under this claim yet.</div>
      </div>
    );
  }

  return (
    <div>
      {jobs.map(job => {
        const color = DIVISION_COLORS[job.division] || '#6b7280';
        const isExpanded = expandedJob === job.id;
        const summary = taskSummaries[job.id];

        return (
          <div key={job.id} className="claim-ops-job-card" style={{ borderLeft: `4px solid ${color}` }}>
            <div className="claim-ops-job-card-header" onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
              <DivisionIcon type={job.division} size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{job.job_number}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{DIV_LABEL[job.division]}</span>
                  <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 99, background: `${color}18`, color, fontWeight: 600, textTransform: 'capitalize' }}>
                    {job.phase?.replace(/_/g, ' ') || 'New'}
                  </span>
                  <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'capitalize' }}>
                    {job.status || 'active'}
                  </span>
                </div>
                {job.project_manager_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
                    PM: {job.project_manager_name}
                  </div>
                )}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {isExpanded && (
              <div className="claim-ops-job-expand">
                {/* Task progress */}
                {summary ? (
                  <div style={{ padding: '10px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Tasks</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: summary.completed === summary.total && summary.total > 0 ? '#059669' : 'var(--text-primary)' }}>
                        {summary.completed}/{summary.total} completed
                      </span>
                    </div>
                    <div className="claim-ops-progress-track">
                      <div className="claim-ops-progress-fill" style={{
                        width: summary.total > 0 ? `${Math.round((summary.completed / summary.total) * 100)}%` : '0%',
                        background: summary.completed === summary.total && summary.total > 0 ? '#059669' : 'var(--accent)',
                      }} />
                    </div>
                    {/* Phase breakdown */}
                    {summary.by_phase?.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        {summary.by_phase.map(p => (
                          <span key={p.phase_name} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${p.phase_color || '#6b7280'}18`, color: p.phase_color || '#6b7280' }}>
                            {p.phase_name}: {p.completed}/{p.total}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--text-tertiary)' }}>Loading tasks…</div>
                )}

                {/* Quick actions */}
                <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => navigate(isTech ? `/tech/jobs/${job.id}` : `/jobs/${job.id}`)} style={{ fontSize: 12 }}>
                    View Job →
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add Job button */}
      {!isTech && (
        <button className="btn btn-secondary btn-sm" onClick={onAddJob} style={{ marginTop: 8, fontSize: 12 }}>
          + Add Related Job
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SCHEDULE SECTION
// ═══════════════════════════════════════════════════════════════════════
function ScheduleSection({ appointments, loaded, navigate, isTech }) {
  if (!loaded) return <div className="loading-page" style={{ padding: 32 }}><div className="spinner" /></div>;

  if (appointments.length === 0) {
    return (
      <div className="claim-ops-empty">
        <div className="claim-ops-empty-icon">📅</div>
        <div className="claim-ops-empty-text">No appointments scheduled for this claim.</div>
      </div>
    );
  }

  // Group by date
  const today = new Date().toISOString().split('T')[0];
  const upcoming = appointments.filter(a => a.date >= today && a.status !== 'completed' && a.status !== 'cancelled');
  const past = appointments.filter(a => a.date < today || a.status === 'completed' || a.status === 'cancelled');

  const STATUS_COLORS = {
    scheduled: { bg: '#eff6ff', color: '#2563eb' },
    en_route: { bg: '#fffbeb', color: '#d97706' },
    in_progress: { bg: '#f0fdf4', color: '#16a34a' },
    paused: { bg: '#fef2f2', color: '#dc2626' },
    completed: { bg: '#f9fafb', color: '#6b7280' },
    cancelled: { bg: '#f9fafb', color: '#9ca3af' },
  };

  const renderAppt = (appt) => {
    const sc = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;
    const divColor = DIVISION_COLORS[appt.division] || '#6b7280';
    return (
      <div key={appt.id} className="claim-ops-appt-card" style={{ borderLeft: `3px solid ${divColor}` }}
        onClick={() => navigate(isTech ? `/tech/appointment/${appt.id}` : `/schedule/appointment/${appt.id}`)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{appt.title || appt.type?.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{appt.job_number}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
            {appt.time_start && <span>{appt.time_start.slice(0, 5)}{appt.time_end ? ' – ' + appt.time_end.slice(0, 5) : ''}</span>}
            {appt.crew?.length > 0 && <span>· {appt.crew.map(c => c.full_name?.split(' ')[0]).join(', ')}</span>}
            {appt.task_total > 0 && <span>· {appt.task_completed}/{appt.task_total} tasks</span>}
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sc.bg, color: sc.color, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
          {appt.status?.replace(/_/g, ' ')}
        </span>
      </div>
    );
  };

  return (
    <div>
      {upcoming.length > 0 && (
        <>
          <div className="claim-ops-date-group">Upcoming</div>
          {upcoming.map(a => (
            <div key={a.id}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 0' }}>{fmtDate(a.date)}</div>
              {renderAppt(a)}
            </div>
          ))}
        </>
      )}
      {past.length > 0 && (
        <>
          <div className="claim-ops-date-group" style={{ marginTop: upcoming.length > 0 ? 8 : 0 }}>Recent / Completed</div>
          {past.map(a => (
            <div key={a.id}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 0' }}>{fmtDate(a.date)}</div>
              {renderAppt(a)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DOCUMENTS SECTION
// ═══════════════════════════════════════════════════════════════════════
function DocumentsSection({ jobs, documents, loaded, db, navigate }) {
  const grouped = useMemo(() => {
    const g = {};
    for (const doc of documents) {
      if (!g[doc.job_id]) g[doc.job_id] = [];
      g[doc.job_id].push(doc);
    }
    return g;
  }, [documents]);

  const getFileUrl = (doc) => `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}`;
  const fmtSize = (b) => { if (!b) return ''; if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`; return `${(b / 1048576).toFixed(1)} MB`; };
  const isImage = (doc) => doc.mime_type?.startsWith('image/');

  if (!loaded) return <div className="loading-page" style={{ padding: 32 }}><div className="spinner" /></div>;

  if (documents.length === 0) {
    return (
      <div className="claim-ops-empty">
        <div className="claim-ops-empty-icon">📁</div>
        <div className="claim-ops-empty-text">No documents yet. Files uploaded to jobs will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      {jobs.map(job => {
        const docs = grouped[job.id] || [];
        if (docs.length === 0) return null;
        const color = DIVISION_COLORS[job.division] || '#6b7280';
        return (
          <div key={job.id} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: `2px solid ${color}` }}>
              <DivisionIcon type={job.division} size={16} />
              <span style={{ fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{job.job_number}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{docs.length} file{docs.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="job-page-files-grid">
              {docs.map(doc => (
                <div key={doc.id} className="job-page-file-card">
                  {isImage(doc)
                    ? <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview"><img src={getFileUrl(doc)} alt={doc.name} loading="lazy" /></a>
                    : <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">{doc.mime_type?.includes('pdf') ? '📄' : '📎'}</a>}
                  <div className="job-page-file-info">
                    <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{doc.name}</a>
                    <div className="job-page-file-meta">
                      <span className="job-page-file-cat-badge">{doc.category}</span>
                      {doc.file_size && <span>{fmtSize(doc.file_size)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// INFO SECTION
// ═══════════════════════════════════════════════════════════════════════
function InfoSection({ claim, contact, adjuster, patchClaim, saving, canEdit }) {
  const [ed, setEd] = useState(false);
  const [f, setF] = useState({});
  const start = () => setF({
    insurance_carrier: claim.insurance_carrier || '',
    insurance_claim_number: claim.insurance_claim_number || '',
    policy_number: claim.policy_number || '',
    date_of_loss: claim.date_of_loss || '',
    loss_type: claim.loss_type || '',
    status: claim.status || 'open',
    loss_address: claim.loss_address || '',
    loss_city: claim.loss_city || '',
    loss_state: claim.loss_state || '',
    loss_zip: claim.loss_zip || '',
    notes: claim.notes || '',
  }) || setEd(true);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const save = async () => {
    await patchClaim({
      insurance_carrier: f.insurance_carrier?.trim() || null,
      insurance_claim_number: f.insurance_claim_number?.trim() || null,
      policy_number: f.policy_number?.trim() || null,
      date_of_loss: f.date_of_loss || null,
      loss_type: f.loss_type || null,
      status: f.status || 'open',
      loss_address: f.loss_address?.trim() || null,
      loss_city: f.loss_city?.trim() || null,
      loss_state: f.loss_state?.trim() || null,
      loss_zip: f.loss_zip?.trim() || null,
      notes: f.notes?.trim() || null,
    });
    setEd(false);
  };

  return (
    <div className="job-page-grid">
      {/* Claim Details */}
      <div className="job-page-section">
        <div className="job-page-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Claim Details</span>
          {canEdit && (
            <div style={{ display: 'flex', gap: 6 }}>
              {!ed
                ? <button className="btn btn-ghost btn-sm" onClick={() => start()} style={{ height: 26, width: 26, padding: 0 }}>✏️</button>
                : <><button className="btn btn-ghost btn-sm" onClick={() => setEd(false)} style={{ height: 26, fontSize: 11 }}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={saving === 'claim'} style={{ height: 26, fontSize: 11 }}>{saving === 'claim' ? '…' : 'Save'}</button></>}
            </div>
          )}
        </div>
        {ed ? (<>
          <EF label="Insurance Carrier" value={f.insurance_carrier} onChange={v => s('insurance_carrier', v)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <EF label="Claim # (Ins.)" value={f.insurance_claim_number} onChange={v => s('insurance_claim_number', v)} />
            <EF label="Policy #" value={f.policy_number} onChange={v => s('policy_number', v)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <EF label="Date of Loss" value={f.date_of_loss} onChange={v => s('date_of_loss', v)} type="date" />
            <ES label="Loss Type" value={f.loss_type} onChange={v => s('loss_type', v)} options={LOSS_TYPES} />
          </div>
          <ES label="Claim Status" value={f.status} onChange={v => s('status', v)} options={CLAIM_STATUSES} />
          <EF label="Loss Address" value={f.loss_address} onChange={v => s('loss_address', v)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <EF label="City" value={f.loss_city} onChange={v => s('loss_city', v)} />
            <EF label="State" value={f.loss_state} onChange={v => s('loss_state', v)} />
            <EF label="ZIP" value={f.loss_zip} onChange={v => s('loss_zip', v)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}>
            <span className="job-page-info-label">Notes</span>
            <textarea className="input textarea" value={f.notes} onChange={e => s('notes', e.target.value)} rows={3} />
          </div>
        </>) : (<>
          <IR label="Carrier" value={claim.insurance_carrier || 'Out of pocket'} />
          <IR label="Insurance #" value={claim.insurance_claim_number} />
          <IR label="Policy #" value={claim.policy_number} />
          <IR label="Date of Loss" value={fmtDate(claim.date_of_loss)} />
          <IR label="Loss Type" value={claim.loss_type} />
          {(claim.loss_address || claim.loss_city) && (
            <IR label="Loss Address" value={[claim.loss_address, claim.loss_city, claim.loss_state, claim.loss_zip].filter(Boolean).join(', ')} />
          )}
          {claim.notes && <IR label="Notes" value={claim.notes} />}
        </>)}
      </div>

      {/* Contact */}
      {contact && (
        <div className="job-page-section">
          <div className="job-page-section-title">Homeowner / Insured</div>
          <IR label="Name" value={contact.name} />
          <IR label="Phone" value={fmtPh(contact.phone)} href={contact.phone ? `tel:${contact.phone}` : null} />
          <IR label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} />
          {contact.billing_address && (
            <IR label="Address" value={[contact.billing_address, contact.billing_city, contact.billing_state].filter(Boolean).join(', ')} />
          )}
        </div>
      )}

      {/* Adjuster */}
      {adjuster && (
        <div className="job-page-section">
          <div className="job-page-section-title">Adjuster</div>
          <IR label="Name" value={adjuster.name} />
          <IR label="Company" value={adjuster.company} />
          <IR label="Cell" value={fmtPh(adjuster.phone)} href={adjuster.phone ? `tel:${adjuster.phone}` : null} />
          <IR label="Desk" value={fmtPh(adjuster.desk_phone)} href={adjuster.desk_phone ? `tel:${adjuster.desk_phone}` : null} />
          <IR label="Territory" value={adjuster.territory} />
          <IR label="Email" value={adjuster.email} href={adjuster.email ? `mailto:${adjuster.email}` : null} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ACTIVITY SECTION
// ═══════════════════════════════════════════════════════════════════════
const EVENT_ICONS = {
  'claim.created': '🆕',
  'claim.updated': '✏️',
  'claim.merged': '🔗',
  'job.created': '📋',
  'job.updated': '✏️',
  'job.phase_changed': '🔄',
  'appointment.created': '📅',
  'appointment.completed': '✅',
  'document.uploaded': '📎',
  'photo.uploaded': '📸',
  'note.added': '📝',
  'payment.logged': '💰',
  'task.completed': '☑️',
  'message.sent': '💬',
  'message.received': '📩',
};

function getEventDescription(evt) {
  const type = evt.event_type || '';
  const payload = evt.payload || {};

  if (type === 'claim.merged') return `Claims merged${payload.merged_claim_number ? ': ' + payload.merged_claim_number : ''}`;
  if (type === 'job.phase_changed') return `Phase → ${payload.new_phase || payload.phase || 'unknown'}${payload.job_number ? ' (' + payload.job_number + ')' : ''}`;
  if (type === 'document.uploaded' || type === 'photo.uploaded') return `${payload.name || 'File'} uploaded${payload.job_number ? ' to ' + payload.job_number : ''}`;
  if (type === 'payment.logged') return `Payment: ${payload.amount ? '$' + Number(payload.amount).toFixed(2) : ''}${payload.source ? ' from ' + payload.source : ''}`;
  if (type === 'task.completed') return `Task completed: ${payload.title || ''}`;
  if (type === 'appointment.completed') return `Appointment completed${payload.title ? ': ' + payload.title : ''}`;

  // Generic fallback
  const [entity, action] = type.split('.');
  return `${entity || 'Item'} ${action || 'updated'}${payload.description ? ' — ' + payload.description : ''}`;
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const mins = Math.round((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDateShort(dateStr);
}

function ActivitySection({ activity, loaded }) {
  if (!loaded) return <div className="loading-page" style={{ padding: 32 }}><div className="spinner" /></div>;

  if (activity.length === 0) {
    return (
      <div className="claim-ops-empty">
        <div className="claim-ops-empty-icon">📊</div>
        <div className="claim-ops-empty-text">No activity recorded for this claim yet.</div>
      </div>
    );
  }

  return (
    <div className="claim-ops-timeline">
      {activity.map(evt => {
        const icon = EVENT_ICONS[evt.event_type] || '•';
        return (
          <div key={evt.id} className="claim-ops-timeline-item">
            <div className="claim-ops-timeline-dot" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, width: 14, height: 14, left: -24, top: 2 }}>
              <span style={{ fontSize: 10 }}>{icon}</span>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                {getEventDescription(evt)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {evt.actor_name && <span style={{ fontWeight: 600 }}>{evt.actor_name}</span>}
                {evt.actor_name && ' · '}
                {timeAgo(evt.created_at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
