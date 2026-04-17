import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_PILL_COLORS, DIV_BORDER_COLORS, APPT_STATUS_COLORS } from './techConstants';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import Hero from '@/components/tech/Hero';
import ActionBar from '@/components/tech/ActionBar';
import NowNextTile, { pickNowNext } from '@/components/tech/NowNextTile';
import PhotosGroup from '@/components/tech/PhotosGroup';
import Lightbox from '@/components/tech/Lightbox';
import DetailRow from '@/components/tech/DetailRow';
import MergeModal from '@/components/MergeModal';
import PullToRefresh from '@/components/PullToRefresh';
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
  const [docs, setDocs] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [entering, setEntering] = useState(false);
  const fileRef = useRef(null);

  // Collapsed details + admin kebab state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

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

      const [contacts, claimRows, allAppts, docList] = await Promise.all([
        db.rpc('get_job_contacts', { p_job_id: jobId }).catch(() => []),
        j.claim_id
          ? db.select('claims', `id=eq.${j.claim_id}&select=id,claim_number`).catch(() => [])
          : Promise.resolve([]),
        j.claim_id
          ? db.rpc('get_claim_appointments', { p_claim_id: j.claim_id }).catch(() => [])
          : Promise.resolve([]),
        db.select('job_documents', `job_id=eq.${jobId}&order=created_at.desc`).catch(() => []),
      ]);
      const list = Array.isArray(contacts) ? contacts : [];
      const primary = list.find(c => c.is_primary) || list[0] || null;
      setContact(primary);
      setClaim(claimRows?.[0] || null);
      const jobAppts = (allAppts || []).filter(a => a.job_id === jobId);
      setAppointments(jobAppts);
      setDocs(docList || []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load job');
      toast('Failed to load job', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobId]);

  useEffect(() => { load(); }, [load]);

  const uploadPhoto = useCallback(async (file) => {
    if (!file || !jobId) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is too large (max 10 MB)', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed', 'error'); return; }
    setUploading(true);
    try {
      const ts = Date.now();
      const path = `${jobId}/${ts}-${file.name}`;
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${db.apiKey}`, 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Upload failed');
      await db.rpc('insert_job_document', {
        p_job_id: jobId,
        p_name: file.name,
        p_file_path: `job-files/${path}`,
        p_mime_type: file.type,
        p_category: 'photo',
        p_uploaded_by: employee?.id || null,
        p_appointment_id: null,
      });
      impact('light');
      toast('Photo uploaded');
      load();
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  }, [db, employee?.id, jobId, load]);

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) uploadPhoto(file);
  };

  const triggerAddPhoto = async () => {
    if (uploading) return;
    if (isNativeCamera()) {
      try {
        const file = await takeNativePhoto();
        if (file) await uploadPhoto(file);
      } catch (err) {
        if (!isUserCancelled(err)) toast('Camera error: ' + err.message, 'error');
      }
    } else {
      fileRef.current?.click();
    }
  };

  const handleSoftDelete = async () => {
    setDeleting(true);
    try {
      await db.update('jobs', `id=eq.${jobId}`, {
        status: 'deleted',
        updated_by: employee?.id || null,
      });
      toast(`Job ${job?.job_number || ''} archived`);
      // Return to the parent claim
      navigate(claim ? `/tech/claims/${claim.id}` : '/tech/claims', { replace: true });
    } catch (err) {
      toast('Failed to delete job: ' + err.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await db.rpc('insert_job_document', {
        p_job_id: jobId,
        p_name: 'Field note',
        p_file_path: '',
        p_mime_type: 'text/plain',
        p_category: 'note',
        p_uploaded_by: employee?.id || null,
        p_description: noteText.trim(),
        p_appointment_id: null,
      });
      toast('Note saved');
      setNoteText('');
      setNoteOpen(false);
      load();
    } catch (err) {
      toast('Failed to save note: ' + err.message, 'error');
    } finally {
      setSavingNote(false);
    }
  };

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

  const isAdmin = employee?.role === 'admin' || employee?.role === 'manager';

  return (
    <div className={`tech-page${entering ? ' tech-page-enter' : ''}`} style={{ padding: 0 }}>
      <Hero
        division={division}
        eyebrow="Job"
        topLabel={job.job_number}
        title={title}
        address={address}
        statusText={phaseLabel}
        statusColors={{ color: divPill.color }}
        meta={metaPieces}
        onBack={() => (claim ? navigate(`/tech/claims/${claim.id}`) : navigate(-1))}
        backLabel={claim ? 'Back to claim' : 'Back'}
        showMenu={isAdmin}
        onMenu={() => setMenuOpen(true)}
      />
      <ActionBar phone={phone} address={address} />

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
      {/* Claim breadcrumb — division-tinted, division-bordered card.
          Visually signals "this job lives inside a claim". */}
      {claim && (() => {
        const pill = DIV_PILL_COLORS[division] || DIV_PILL_COLORS.water;
        const border = DIV_BORDER_COLORS?.[division] || '#3b82f6';
        return (
          <button
            onClick={() => navigate(`/tech/claims/${claim.id}`)}
            style={{
              width: 'calc(100% - 2 * var(--space-4))',
              margin: '12px var(--space-4) 0',
              padding: '12px 14px', minHeight: 56,
              background: pill.bg, borderRadius: 12,
              border: '1px solid var(--border-light)',
              borderLeft: `4px solid ${border}`,
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
              WebkitTapHighlightColor: 'transparent', textAlign: 'left',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={pill.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: pill.color,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                lineHeight: 1.2,
              }}>
                Part of claim
              </div>
              <div style={{
                fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)', marginTop: 2,
              }}>
                {claim.claim_number}
              </div>
            </div>
            <span style={{ fontSize: 12, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
              View →
            </span>
          </button>
        );
      })()}

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

      {/* Photos & Notes — single group (this IS one job) */}
      {(() => {
        const photos = docs.filter(d => d.category === 'photo');
        const notes = docs.filter(d => d.category === 'note');
        const hasAny = photos.length + notes.length > 0;

        return (
          <div style={{ padding: '22px var(--space-4) 0' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 4,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                Photos & Notes{hasAny ? ` (${photos.length + notes.length})` : ''}
              </div>
              {photos.length > 0 && (
                <button
                  onClick={() => navigate(`/tech/jobs/${jobId}/photos`)}
                  style={{
                    background: 'none', border: 'none', padding: '4px 0',
                    color: 'var(--accent)', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  See all →
                </button>
              )}
            </div>

            {hasAny ? (
              <PhotosGroup
                job={job}
                photos={photos}
                notes={notes}
                isSingleJob
                db={db}
                onOpenAlbum={(_jobId, index) => setLightboxIndex(index)}
              />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '6px 0 4px' }}>
                No photos or notes yet.
              </div>
            )}

            {noteOpen && (
              <div style={{
                marginTop: 12, padding: 12,
                border: '1px solid var(--border-color)', borderRadius: 12,
                background: 'var(--bg-primary)',
              }}>
                <textarea
                  className="input textarea"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="What do you want to note?"
                  rows={3}
                  autoFocus
                  style={{ width: '100%', fontSize: 15, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setNoteOpen(false); setNoteText(''); }}
                    style={{
                      padding: '10px 18px', minHeight: 44, borderRadius: 10,
                      background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)', cursor: 'pointer',
                      fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveNote}
                    disabled={!noteText.trim() || savingNote}
                    style={{
                      padding: '10px 18px', minHeight: 44, borderRadius: 10,
                      background: noteText.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: noteText.trim() ? '#fff' : 'var(--text-tertiary)',
                      border: 'none',
                      cursor: noteText.trim() && !savingNote ? 'pointer' : 'not-allowed',
                      fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                      opacity: savingNote ? 0.7 : 1,
                    }}
                  >
                    {savingNote ? 'Saving…' : 'Save note'}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={triggerAddPhoto}
                disabled={uploading}
                style={{
                  flex: 1, minHeight: 48, borderRadius: 12,
                  background: 'var(--accent)', color: '#fff', border: 'none',
                  cursor: uploading ? 'wait' : 'pointer',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  WebkitTapHighlightColor: 'transparent', opacity: uploading ? 0.7 : 1,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                </svg>
                {uploading ? 'Uploading…' : 'Add Photo'}
              </button>
              <button
                onClick={() => { setNoteOpen(true); setNoteText(''); }}
                disabled={noteOpen}
                style={{
                  flex: 1, minHeight: 48, borderRadius: 12,
                  background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  WebkitTapHighlightColor: 'transparent',
                  opacity: noteOpen ? 0.5 : 1,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Add Note
              </button>
            </div>
          </div>
        );
      })()}

      {/* Collapsed Job details — reference info at bottom */}
      <div style={{ padding: '18px var(--space-4) calc(24px + env(safe-area-inset-bottom, 0px))' }}>
        <button
          onClick={() => setDetailsOpen(v => !v)}
          style={{
            width: '100%', minHeight: 48, padding: '12px 16px',
            borderRadius: 12, background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
            fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span>Job details</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: detailsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {detailsOpen && (
          <div style={{
            marginTop: 8, padding: '14px 16px',
            borderRadius: 12, background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
          }}>
            <DetailRow label="Phase" value={phaseLabel} />
            <DetailRow label="Status" value={titleCase(job.status || 'active')} />
            <DetailRow label="Division" value={titleCase(job.division)} />
            <DetailRow label="Date of loss" value={formatLossDate(job.date_of_loss)} />
            <DetailRow label="Type of loss" value={job.type_of_loss ? titleCase(job.type_of_loss) : null} />
            <DetailRow label="Carrier" value={job.insurance_company || 'Out of pocket'} />
            <DetailRow label="Policy #" value={job.policy_number} mono />
            <DetailRow label="Claim #" value={job.claim_number} mono />
            {isAdmin && typeof job.deductible === 'number' && (
              <DetailRow label="Deductible" value={`$${Number(job.deductible).toFixed(2)}`} />
            )}
            {job.ar_notes && <DetailRow label="Notes" value={job.ar_notes} multiline />}

            {(contact || job.insured_name) && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  marginTop: 14, marginBottom: 6,
                }}>
                  Insured / Homeowner
                </div>
                <DetailRow label="Name" value={contact?.name || job.insured_name} />
                <DetailRow label="Phone" value={contact?.phone || job.client_phone} href={(contact?.phone || job.client_phone) ? `tel:${contact?.phone || job.client_phone}` : null} />
                <DetailRow label="Email" value={contact?.email || job.client_email} href={(contact?.email || job.client_email) ? `mailto:${contact?.email || job.client_email}` : null} />
              </>
            )}

            {(job.adjuster_name || job.adjuster_phone || job.adjuster_email) && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  marginTop: 14, marginBottom: 6,
                }}>
                  Adjuster
                </div>
                <DetailRow label="Name" value={job.adjuster_name} />
                <DetailRow label="Phone" value={job.adjuster_phone} href={job.adjuster_phone ? `tel:${job.adjuster_phone}` : null} />
                <DetailRow label="Email" value={job.adjuster_email} href={job.adjuster_email ? `mailto:${job.adjuster_email}` : null} />
              </>
            )}
          </div>
        )}
      </div>

      </PullToRefresh>

      {/* Hidden file input for web photo picker */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Lightbox for in-page preview */}
      {lightboxIndex !== null && (
        <Lightbox
          photos={docs.filter(d => d.category === 'photo')}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={(i) => setLightboxIndex(i)}
          db={db}
        />
      )}

      {/* Admin kebab bottom sheet */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', width: '100%',
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{
              width: 36, height: 4, background: 'var(--border-color)',
              borderRadius: 2, margin: '0 auto 12px',
            }} />
            <button
              onClick={() => { setMenuOpen(false); setShowMerge(true); }}
              style={{
                width: '100%', minHeight: 56, padding: '14px 16px',
                borderRadius: 12, background: 'var(--bg-primary)',
                border: '1px solid var(--border-light)', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 15, fontWeight: 600, color: 'var(--text-primary)',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent', textAlign: 'left',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7 17 17 7" /><polyline points="7 7 17 17" /><circle cx="12" cy="12" r="10" />
              </svg>
              Merge job
            </button>
            <button
              onClick={() => { setMenuOpen(false); setDeleteOpen(true); setDeleteInput(''); }}
              style={{
                width: '100%', minHeight: 56, padding: '14px 16px',
                borderRadius: 12, background: '#fef2f2',
                border: '1px solid #fecaca',
                display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 15, fontWeight: 600, color: '#dc2626',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent', textAlign: 'left',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              </svg>
              Delete job
            </button>
            <button
              onClick={() => setMenuOpen(false)}
              style={{
                marginTop: 14, width: '100%', minHeight: 44, borderRadius: 10,
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showMerge && (
        <MergeModal
          type="job"
          keepRecord={job}
          onClose={() => setShowMerge(false)}
          onMerged={() => { setShowMerge(false); load(); }}
        />
      )}

      {deleteOpen && (
        <div
          onClick={() => { if (!deleting) { setDeleteOpen(false); setDeleteInput(''); } }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', width: '100%', maxWidth: 420,
              borderRadius: 16, padding: 20,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>Delete Job</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              This will archive <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{job.job_number}</strong>. It can be restored later but will be hidden from all views.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Type <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>DELETE</strong> to confirm:
            </div>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              autoFocus
              placeholder="DELETE"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '12px 14px', fontSize: 16,
                border: '1px solid var(--border-color)', borderRadius: 10,
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
                outline: 'none', fontFamily: 'var(--font-mono)',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => { setDeleteOpen(false); setDeleteInput(''); }}
                disabled={deleting}
                style={{
                  padding: '10px 18px', minHeight: 44, borderRadius: 10,
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)', cursor: deleting ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSoftDelete}
                disabled={deleteInput !== 'DELETE' || deleting}
                style={{
                  padding: '10px 18px', minHeight: 44, borderRadius: 10,
                  background: deleteInput === 'DELETE' ? '#dc2626' : 'var(--bg-tertiary)',
                  color: deleteInput === 'DELETE' ? '#fff' : 'var(--text-tertiary)',
                  border: 'none',
                  cursor: deleteInput === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
