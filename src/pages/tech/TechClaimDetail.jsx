/**
 * ════════════════════════════════════════════════
 * FILE: TechClaimDetail.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The screen a field technician sees when they tap into a single insurance
 *   claim. It shows who the claim is for, the loss address, and one big tile
 *   per job tied to that claim (with task progress and the next appointment).
 *   From here a tech can snap photos, jot notes, open rooms, view demo sheets,
 *   and read the full claim details (carrier, policy, adjuster, homeowner).
 *   Admins also get a menu to merge the claim into another or archive it.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/claims/:claimId
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, ./techConstants, @/components/DivisionIcons,
 *              @/lib/toast, @/lib/nativeAppearance, @/lib/nativeCamera,
 *              @/lib/nativeHaptics, @/components/MergeModal,
 *              @/components/PullToRefresh, @/components/tech/Hero,
 *              @/components/tech/ActionBar, @/components/tech/NowNextTile,
 *              @/components/tech/PhotosGroup, @/components/tech/Lightbox,
 *              @/components/tech/DetailRow, @/components/tech/RoomCard,
 *              @/components/tech/AddRoomSheet, @/lib/techDateUtils,
 *              @/hooks/useOfflineQueue, @/lib/offlineDb, @/lib/syncRunnerSingleton
 *   Data:      All access goes through the db client from useAuth (RPC + REST),
 *              never raw .from(). Tables below come from the RPC Data-Flow
 *              Reference in UPR-Web-Context.md (not guessed):
 *              reads  → claims, contacts, jobs (get_claim_detail);
 *                        appointment_crew, appointments, employees, job_tasks, jobs
 *                        (get_claim_appointments); job_documents, rooms
 *                        (get_claim_rooms); forms, jobs (get_claim_demo_sheets);
 *                        job_tasks (get_job_task_summary); job_documents
 *                        (direct db.select)
 *              writes → rooms (create_room_for_claim); job_documents
 *                        (insert_job_document — used for both photos and notes);
 *                        claims (direct db.update — soft-delete sets status
 *                        'deleted'); job-files storage bucket (direct REST upload)
 *
 * NOTES / GOTCHAS:
 *   - Photos have two upload paths: an offline-queue path (gated by the
 *     'offline:queue' feature flag — stores the blob in IndexedDB and enqueues
 *     a sync job) and the default inline path (uploads to Storage, then records
 *     it via insert_job_document). Snap-first: never blocks the camera flow.
 *   - The Rooms grid is feature-gated behind the 'page:tech_rooms' flag; when
 *     off, get_claim_rooms is skipped entirely.
 *   - When the offline queue is on, a sync listener reloads the page once a
 *     queued photo for one of THIS claim's jobs finishes uploading.
 *   - "Delete claim" is a soft delete (status → 'deleted'), gated to admins /
 *     managers, and requires typing the word DELETE to confirm.
 *   - JobTile is a sub-component defined in this same file (claim-specific —
 *     the job detail page never renders multiple jobs, so it stays local).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS, DIV_PILL_COLORS, DIV_BORDER_COLORS, CLAIM_STATUS_COLORS } from './techConstants';
import { DivisionIcon } from '@/components/DivisionIcons';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import MergeModal from '@/components/MergeModal';
import PullToRefresh from '@/components/PullToRefresh';
import Hero from '@/components/tech/Hero';
import ActionBar from '@/components/tech/ActionBar';
import NowNextTile, { pickNowNext } from '@/components/tech/NowNextTile';
import PhotosGroup from '@/components/tech/PhotosGroup';
import Lightbox from '@/components/tech/Lightbox';
import DetailRow from '@/components/tech/DetailRow';
import RoomCard from '@/components/tech/RoomCard';
import AddRoomSheet from '@/components/tech/AddRoomSheet';
import { formatTime, relativeDate, currentLocaleTag } from '@/lib/techDateUtils';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { savePhotoBlob } from '@/lib/offlineDb';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';

// ─── SECTION: Helpers ──────────────
function formatLossDate(dateStr) {
  if (!dateStr) return '';
  // T12:00:00 keeps a date-only string on its calendar day in Denver; the
  // locale tag follows the active UI language.
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(currentLocaleTag(), { month: 'short', day: 'numeric', year: 'numeric' });
}

function nextApptForJob(jobId, appointments) {
  if (!jobId || !appointments?.length) return null;
  const today = new Date().toISOString().split('T')[0];
  return appointments
    .filter(a => a.job_id === jobId && a.date >= today && !['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''))[0] || null;
}

// ───────────────────────────────────────────────────────────────
// JobTile — one large tile per job under the claim. Claim-specific;
// the job detail page doesn't render multiple jobs, so this stays local.
// ───────────────────────────────────────────────────────────────
function JobTile({ job, taskSummary, nextAppt, onOpen }) {
  const { t } = useTranslation(['claimDetail', 'tech']);
  const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
  const divPill = DIV_PILL_COLORS[job.division] || DIV_PILL_COLORS.water;
  const rawDivLabel = (job.division || '').charAt(0).toUpperCase() + (job.division || '').slice(1);
  const divLabel = job.division ? t('tech:division.' + job.division, { defaultValue: rawDivLabel }) : '';
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <DivisionIcon type={job.division} size={22} />
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

      {total > 0 ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('tasks')}</span>
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
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('noTasksYet')}</div>
      )}

      {nextAppt && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('nextLabel')} <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
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
  // ─── SECTION: State & hooks ──────────────
  const { t } = useTranslation(['claimDetail', 'tech']);
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();
  const { enqueue } = useOfflineQueue();
  const offlineQueueEnabled = isFeatureEnabled('offline:queue');

  const [detail, setDetail] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [taskSummaries, setTaskSummaries] = useState({});
  const [docs, setDocs] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [demoSheets, setDemoSheets] = useState([]);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { jobId, index }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const roomsEnabled = isFeatureEnabled('page:tech_rooms');

  // Add Photo / Add Note state
  const [jobPicker, setJobPicker] = useState(null); // { action: 'photo'|'note' }
  const [uploading, setUploading] = useState(false);
  const [noteJobId, setNoteJobId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const fileRef = useRef(null);
  const pendingPhotoJobIdRef = useRef(null);

  // Admin kebab state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Page entry animation is now the shared View Transitions mechanism (motion-standard §2),
  // not a per-page entering flag — this effect only owns the status-bar tint.
  useEffect(() => {
    statusBarLight();
    return () => statusBarDark();
  }, []);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [data, appts, roomList, sheets] = await Promise.all([
        db.rpc('get_claim_detail', { p_claim_id: claimId }),
        db.rpc('get_claim_appointments', { p_claim_id: claimId }).catch(() => []),
        roomsEnabled
          ? db.rpc('get_claim_rooms', { p_claim_id: claimId }).catch(() => [])
          : Promise.resolve([]),
        db.rpc('get_claim_demo_sheets', { p_claim_id: claimId }).catch(() => []),
      ]);
      if (!data?.claim) {
        setLoadError(t('notFound'));
        return;
      }
      setDetail(data);
      setAppointments(appts || []);
      setRooms(roomList || []);
      setDemoSheets(sheets || []);

      const jobIds = (data.jobs || []).map(j => j.id);
      if (jobIds.length > 0) {
        const idList = jobIds.map(id => `"${id}"`).join(',');
        const [summaryEntries, docList] = await Promise.all([
          Promise.all(jobIds.map(id =>
            db.rpc('get_job_task_summary', { p_job_id: id })
              .then(s => [id, s])
              .catch(() => [id, null])
          )),
          db.select('job_documents', `job_id=in.(${idList})&order=created_at.desc`).catch(() => []),
        ]);
        setTaskSummaries(Object.fromEntries(summaryEntries));
        setDocs(docList || []);
      }
    } catch (e) {
      setLoadError(e.message || t('toastLoadFailed'));
      toast(t('toastLoadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [db, claimId, roomsEnabled, t]);

  const handleCreateRoom = useCallback(async (name) => {
    const created = await db.rpc('create_room_for_claim', {
      p_claim_id: claimId,
      p_name: name,
      p_created_by: employee?.id || null,
      p_client_id: crypto?.randomUUID?.() || null,
    });
    const r = await db.rpc('get_claim_rooms', { p_claim_id: claimId });
    setRooms(r || []);
    return created;
  }, [db, claimId, employee?.id]);

  // Cover photo per room — docs is already newest-first.
  const coverByRoom = useMemo(() => {
    const m = {};
    for (const d of docs) {
      if (d.category === 'photo' && d.room_id && !m[d.room_id]) {
        m[d.room_id] = d.file_path;
      }
    }
    return m;
  }, [docs]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Event handlers ──────────────
  const uploadPhotoForJob = useCallback(async (file, jobId) => {
    if (!file || !jobId) return;
    if (file.size > 10 * 1024 * 1024) { toast(t('tech:toast.photoTooLarge'), 'error'); return; }
    if (!file.type.startsWith('image/')) { toast(t('tech:toast.onlyImages'), 'error'); return; }

    // ── Offline-queue path (gated) ────────────────────────────────────────
    if (offlineQueueEnabled) {
      try {
        const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
        await savePhotoBlob(clientId, {
          blob: file,
          mimeType: file.type,
          name: file.name,
          jobId,
          appointmentId: null,
          uploadedBy: employee?.id || null,
          roomId: null,
          description: null,
        });
        await enqueue({
          type: 'photo.upload',
          clientId,
          payload: {
            clientId,
            jobId,
            appointmentId: null,
            roomId: null,
            description: null,
            name: file.name,
          },
        });
        impact('light');
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          toast(t('tech:toast.photoQueued'), 'success');
        } else {
          toast(t('tech:toast.photoUploading'));
        }
      } catch (err) {
        toast(t('tech:toast.photoQueueFailed', { message: err?.message || 'unknown' }), 'error');
      }
      return;
    }

    // ── Inline path (default) ────────────────────────────────────────────
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
      toast(t('tech:toast.photoUploaded'));
      load();
    } catch (err) {
      toast(t('tech:toast.photoUploadFailed', { message: err.message }), 'error');
    } finally {
      setUploading(false);
    }
  }, [db, employee?.id, load, offlineQueueEnabled, enqueue, t]);

  // Reload when a queued photo for one of this claim's jobs finishes syncing.
  useEffect(() => {
    if (!offlineQueueEnabled) return;
    const runner = getSyncRunner();
    if (!runner) return;
    const jobIds = new Set((detail?.jobs || []).map(j => j.id));
    return runner.on('sync:item-done', ({ item }) => {
      if (item?.type !== 'photo.upload') return;
      if (!jobIds.has(item?.payload?.jobId)) return;
      load();
    });
  }, [offlineQueueEnabled, detail?.jobs, load]);

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const jobId = pendingPhotoJobIdRef.current;
    pendingPhotoJobIdRef.current = null;
    if (file && jobId) uploadPhotoForJob(file, jobId);
  };

  const captureForJob = async (jobId) => {
    if (uploading) return;
    if (isNativeCamera()) {
      try {
        const file = await takeNativePhoto();
        if (file) await uploadPhotoForJob(file, jobId);
      } catch (err) {
        if (!isUserCancelled(err)) toast(t('tech:toast.cameraError', { message: err.message }), 'error');
      }
    } else {
      pendingPhotoJobIdRef.current = jobId;
      fileRef.current?.click();
    }
  };

  const startAddPhoto = () => {
    const jobs = detail?.jobs || [];
    if (jobs.length === 0) { toast(t('noJobs'), 'error'); return; }
    if (jobs.length === 1) captureForJob(jobs[0].id);
    else setJobPicker({ action: 'photo' });
  };

  const startAddNote = () => {
    const jobs = detail?.jobs || [];
    if (jobs.length === 0) { toast(t('noJobs'), 'error'); return; }
    setNoteText('');
    if (jobs.length === 1) setNoteJobId(jobs[0].id);
    else setJobPicker({ action: 'note' });
  };

  const onJobPicked = (jobId) => {
    const action = jobPicker?.action;
    setJobPicker(null);
    if (action === 'photo') captureForJob(jobId);
    else if (action === 'note') { setNoteText(''); setNoteJobId(jobId); }
  };

  const handleSoftDelete = async () => {
    if (!detail?.claim) return;
    setDeleting(true);
    try {
      await db.update('claims', `id=eq.${claimId}`, {
        status: 'deleted',
        updated_by: employee?.id || null,
      });
      toast(t('toastClaimArchived', { claimNumber: detail.claim.claim_number }));
      navigate('/tech/claims', { replace: true });
    } catch (err) {
      toast(t('toastDeleteFailed', { message: err.message }), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const saveNote = async () => {
    if (!noteJobId || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await db.rpc('insert_job_document', {
        p_job_id: noteJobId,
        p_name: 'Field note',
        p_file_path: '',
        p_mime_type: 'text/plain',
        p_category: 'note',
        p_uploaded_by: employee?.id || null,
        p_description: noteText.trim(),
        p_appointment_id: null,
      });
      toast(t('tech:toast.noteSaved'));
      setNoteText('');
      setNoteJobId(null);
      load();
    } catch (err) {
      toast(t('tech:toast.noteSaveFailed', { message: err.message }), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  // ─── SECTION: Render ──────────────
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
            {loadError || t('notFound')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
            {t('notFoundSub')}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/tech/claims')}>{t('backToClaims')}</button>
            <button className="btn btn-primary" onClick={load}>{t('tech:btn.retry')}</button>
          </div>
        </div>
      </div>
    );
  }

  const { claim, jobs = [], contact, adjuster } = detail;
  const division = jobs[0]?.division || 'water';
  const insuredName = contact?.name || jobs[0]?.insured_name || t('tech:misc.unknown');
  const phone = contact?.phone || jobs[0]?.client_phone || null;
  const address = [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ');
  const isAdmin = employee?.role === 'admin' || employee?.role === 'manager';
  const nowNext = pickNowNext(appointments, employee?.id);

  const docsByJob = {};
  for (const d of docs) {
    if (!docsByJob[d.job_id]) docsByJob[d.job_id] = { photos: [], notes: [] };
    if (d.category === 'photo') docsByJob[d.job_id].photos.push(d);
    else if (d.category === 'note') docsByJob[d.job_id].notes.push(d);
  }
  const totalPhotos = docs.filter(d => d.category === 'photo').length;
  const totalNotes = docs.filter(d => d.category === 'note').length;
  const hasAnyPhotoOrNote = totalPhotos + totalNotes > 0;

  const lightboxPhotos = lightbox ? (docsByJob[lightbox.jobId]?.photos || []) : [];

  // Build hero meta row pieces
  const metaPieces = [];
  if (claim.date_of_loss) metaPieces.push(t('lossPrefix', { date: formatLossDate(claim.date_of_loss) }));
  if (claim.loss_type) metaPieces.push(claim.loss_type.charAt(0).toUpperCase() + claim.loss_type.slice(1));
  if (claim.insurance_claim_number) metaPieces.push(t('insPrefix', { num: claim.insurance_claim_number }));
  if (jobs.length > 0) metaPieces.push(t('jobsMetaCount', { count: jobs.length }));

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <Hero
        division={division}
        eyebrow={t('eyebrow')}
        topLabel={claim.claim_number}
        title={insuredName}
        address={address}
        statusText={t('tech:claimStatus.' + (claim.status || 'open'), { defaultValue: claim.status || 'open' })}
        statusColors={CLAIM_STATUS_COLORS[claim.status] || CLAIM_STATUS_COLORS.open}
        meta={metaPieces}
        onBack={() => navigate('/tech/claims')}
        backLabel={t('backToClaims')}
        showMenu={isAdmin}
        onMenu={() => setMenuOpen(true)}
      />
      <ActionBar phone={phone} address={address} />

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
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
            {jobs.length === 1 ? t('jobOne') : t('jobsCount', { count: jobs.length })}
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

      {/* ── Rooms grid (feature-gated) ─────────────────────────────── */}
      {roomsEnabled && (
        <div style={{ padding: '22px var(--space-4) 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {rooms.length === 0 ? t('roomsHeader') : t('roomsCount', { count: rooms.length })}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={() => setAddRoomOpen(true)}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: 0,
                borderRadius: 14,
                border: '2px dashed var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}
              aria-label={t('addRoomAria')}
            >
              <div
                style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'var(--accent-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t('addRoom')}</div>
            </button>

            {rooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                coverFilePath={coverByRoom[room.id]}
                divisionGradient={DIV_GRADIENTS[jobs[0]?.division] || DIV_GRADIENTS.water}
                onClick={() => navigate(`/tech/claims/${claimId}/rooms/${room.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: '22px var(--space-4) 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 4,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {hasAnyPhotoOrNote ? t('photosNotesCount', { count: totalPhotos + totalNotes }) : t('photosNotes')}
          </div>
          {totalPhotos > 0 && (
            <button
              onClick={() => navigate(`/tech/claims/${claimId}/photos`)}
              style={{
                background: 'none', border: 'none', padding: '4px 0',
                color: 'var(--accent)', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {t('tech:btn.seeAll')}
            </button>
          )}
        </div>
        {hasAnyPhotoOrNote ? (
          jobs.map(job => {
            const g = docsByJob[job.id];
            if (!g || (g.photos.length === 0 && g.notes.length === 0)) return null;
            return (
              <PhotosGroup
                key={job.id}
                job={job}
                photos={g.photos}
                notes={g.notes}
                isSingleJob={jobs.length === 1}
                db={db}
                onOpenAlbum={(jobId, index) => setLightbox({ jobId, index })}
                onSeeAllForJob={(jobId) => navigate(`/tech/claims/${claimId}/photos`, { state: { focusJobId: jobId } })}
              />
            );
          })
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '6px 0 4px' }}>
            {t('noPhotosNotes')}
          </div>
        )}

        {noteJobId && (
          <div style={{
            marginTop: 12, padding: 12,
            border: '1px solid var(--border-color)', borderRadius: 12,
            background: 'var(--bg-primary)',
          }}>
            {jobs.length > 1 && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                <Trans
                  t={t}
                  i18nKey="noteForPrefix"
                  values={{ jobNumber: jobs.find(j => j.id === noteJobId)?.job_number }}
                  components={{ b: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }} /> }}
                />
              </div>
            )}
            <textarea
              className="input textarea"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder={t('tech:btn.notePlaceholder')}
              rows={3}
              autoFocus
              style={{ width: '100%', fontSize: 15, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setNoteJobId(null); setNoteText(''); }}
                style={{
                  padding: '10px 18px', minHeight: 44, borderRadius: 10,
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                }}
              >
                {t('tech:btn.cancel')}
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
                {savingNote ? t('tech:btn.saving') : t('tech:btn.saveNote')}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            onClick={startAddPhoto}
            disabled={uploading || jobs.length === 0}
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
            {uploading ? t('tech:btn.uploading') : t('tech:btn.addPhoto')}
          </button>
          <button
            onClick={startAddNote}
            disabled={jobs.length === 0 || !!noteJobId}
            style={{
              flex: 1, minHeight: 48, borderRadius: 12,
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              WebkitTapHighlightColor: 'transparent',
              opacity: (jobs.length === 0 || noteJobId) ? 0.5 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            {t('tech:btn.addNote')}
          </button>
        </div>
      </div>

      </PullToRefresh>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {jobPicker && (
        <div
          onClick={() => setJobPicker(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', width: '100%',
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
              maxHeight: '70vh', overflowY: 'auto',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{
              width: 36, height: 4, background: 'var(--border-color)',
              borderRadius: 2, margin: '0 auto 12px',
            }} />
            <div style={{
              fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
              marginBottom: 10, textAlign: 'center',
            }}>
              {jobPicker.action === 'photo' ? t('pickPhotoJob') : t('pickNoteJob')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobs.map(job => {
                const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
                return (
                  <button
                    key={job.id}
                    onClick={() => onJobPicked(job.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '14px 14px', minHeight: 60,
                      borderRadius: 12, textAlign: 'left',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-light)',
                      borderLeft: `4px solid ${divColor}`,
                      cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <DivisionIcon type={job.division} size={22} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {job.job_number}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                        {job.division ? t('tech:division.' + job.division, { defaultValue: job.division }) : ''} · {(job.phase || '').replace(/_/g, ' ')}
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setJobPicker(null)}
              style={{
                marginTop: 14, width: '100%', minHeight: 44, borderRadius: 10,
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              }}
            >
              {t('tech:btn.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Demo Sheets ───────────────────────────────────────────────── */}
      <div style={{ padding: '18px var(--space-4) 0' }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          marginBottom: 8,
        }}>
          {demoSheets.length > 0 ? t('scopeSheetsCount', { count: demoSheets.length }) : t('scopeSheets')}
        </div>
        {demoSheets.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '6px 0 4px' }}>
            {t('noScopeSheets')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {demoSheets.map(s => {
              const isSubmitted = s.status === 'submitted';
              const dateStr = s.form_date
                ? new Date(s.form_date + 'T12:00:00').toLocaleDateString(currentLocaleTag(), { month: 'short', day: 'numeric', year: 'numeric' })
                : new Date(s.updated_at).toLocaleDateString(currentLocaleTag(), { month: 'short', day: 'numeric', year: 'numeric' });
              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/tech/tools/demo-sheet?id=${s.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', minHeight: 56, padding: '12px 14px',
                    borderRadius: 12, background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    textAlign: 'left',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: isSubmitted ? '#f0fdf4' : 'var(--accent-light)',
                    color: isSubmitted ? '#16a34a' : 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, flexShrink: 0,
                  }}>
                    📋
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {t('sheetRoomCount', { count: s.room_count })}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: isSubmitted ? '#f0fdf4' : '#fffbeb',
                        color:      isSubmitted ? '#16a34a' : '#d97706',
                        border: `1px solid ${isSubmitted ? '#bbf7d0' : '#fde68a'}`,
                      }}>
                        {isSubmitted ? t('submitted') : t('draft')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {dateStr}
                      {s.technician_name ? ` · ${s.technician_name}` : ''}
                      {s.job_number ? ` · ${s.job_number}` : ''}
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </div>

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
          <span>{t('detailsToggle')}</span>
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
            <DetailRow label={t('detail.carrier')} value={claim.insurance_carrier || t('outOfPocket')} />
            <DetailRow label={t('detail.policyNum')} value={claim.policy_number} />
            <DetailRow label={t('detail.insClaimNum')} value={claim.insurance_claim_number} mono />
            <DetailRow label={t('detail.dateOfLoss')} value={formatLossDate(claim.date_of_loss)} />
            <DetailRow label={t('detail.lossType')} value={claim.loss_type} capitalize />
            {claim.notes && <DetailRow label={t('detail.notes')} value={claim.notes} multiline />}

            {contact && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  marginTop: 14, marginBottom: 6,
                }}>
                  {t('detail.insured')}
                </div>
                <DetailRow label={t('detail.name')} value={contact.name} />
                <DetailRow label={t('detail.phone')} value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : null} />
                <DetailRow label={t('detail.email')} value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} />
              </>
            )}

            {adjuster && (
              <>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  marginTop: 14, marginBottom: 6,
                }}>
                  {t('detail.adjuster')}
                </div>
                <DetailRow label={t('detail.name')} value={adjuster.name} />
                <DetailRow label={t('detail.company')} value={adjuster.company} />
                <DetailRow label={t('detail.cell')} value={adjuster.phone} href={adjuster.phone ? `tel:${adjuster.phone}` : null} />
                <DetailRow label={t('detail.email')} value={adjuster.email} href={adjuster.email ? `mailto:${adjuster.email}` : null} />
              </>
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox(prev => prev ? { ...prev, index: i } : null)}
          db={db}
        />
      )}

      <AddRoomSheet
        open={addRoomOpen}
        onClose={() => setAddRoomOpen(false)}
        onCreate={handleCreateRoom}
        existingNames={rooms.map(r => r.name)}
      />

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
              {t('mergeClaim')}
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
              {t('deleteClaim')}
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
              {t('tech:btn.cancel')}
            </button>
          </div>
        </div>
      )}

      {showMerge && (
        <MergeModal
          type="claim"
          keepRecord={claim}
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
            <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>{t('deleteTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              <Trans
                t={t}
                i18nKey="deleteArchiveNote"
                values={{ claimNumber: claim.claim_number }}
                components={{ b: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }} /> }}
              />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              <Trans
                t={t}
                i18nKey="deleteTypeConfirm"
                components={{ b: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }} /> }}
              />
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
                {t('tech:btn.cancel')}
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
                {deleting ? t('tech:btn.deleting') : t('deleteTitle')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
