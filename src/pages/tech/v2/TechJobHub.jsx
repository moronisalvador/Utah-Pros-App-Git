/**
 * ════════════════════════════════════════════════
 * FILE: TechJobHub.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The merged field-tech surface for a job — the "Job Hub." It replaces the two
 *   old separate screens (one for a job, one for a single appointment) with one
 *   page. Up top is the job's identity banner and Call/Navigate/Message/Documents
 *   bar, plus a red warning if there's no signed Work Authorization. Below that a
 *   tech picks which visit they're looking at, and the page re-scopes to that
 *   visit: its timer, crew, tasks, moisture readings, and equipment. The bottom
 *   is job-wide: the claim breadcrumb, collapsible job details, and every photo
 *   and note on the job. Admins get a merge/delete menu.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/job/:jobId?appt=<id>  (behind page:tech_job_hub)
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/components/PullToRefresh,
 *              @/components/tech/Hero, @/components/tech/ActionBar,
 *              @/components/tech/GenerateReportButton, @/lib/techQuery,
 *              @/lib/toast, @/lib/nativeAppearance, @/lib/nativeCamera,
 *              @/lib/nativeHaptics, @/hooks/useOfflineQueue, @/lib/offlineDb,
 *              @/lib/syncRunnerSingleton, @/pages/tech/techConstants,
 *              ./hub/* (WorkAuthBanner, ClaimBreadcrumb, JobDetailsPanel,
 *              VisitPicker, VisitContext, JobPhotos, AdminJobMenu, hubHelpers)
 *   Data:      reads  → get_job_hub (job + claim + work_auth + visits),
 *                        get_job_contacts, job_documents (job-wide),
 *                        get_appointment_detail (selected visit), get_job_rooms
 *              writes → job_documents (insert_job_document — photos/notes) +
 *                        job-files storage bucket; child components own the rest
 *
 * NOTES / GOTCHAS:
 *   - ONE statusBar effect pair lives here (light on mount, dark on unmount) —
 *     the merged children never touch the status bar (the two legacy pages each
 *     had their own; the merge keeps exactly one).
 *   - The visit picker syncs the URL's ?appt=; a stale/absent id falls back to
 *     today's/next via selectVisitId.
 *   - Photo capture honors the offline fork: a capture in a visit context routes
 *     through the offline queue (tagged to that appointment); a job-level capture
 *     (no visit selected) uploads directly. Notes always insert directly.
 *   - Mutations invalidate the shared tech query caches (dash/schedule panes)
 *     through invalidateTech so those persistent screens stay fresh.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import Hero from '@/components/tech/Hero';
import ActionBar from '@/components/tech/ActionBar';
import GenerateReportButton from '@/components/tech/GenerateReportButton';
import { DIV_PILL_COLORS } from '@/pages/tech/techConstants';
import { invalidateTech } from '@/lib/techQuery';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { savePhotoBlob } from '@/lib/offlineDb';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';
import WorkAuthBanner from './hub/WorkAuthBanner.jsx';
import ClaimBreadcrumb from './hub/ClaimBreadcrumb.jsx';
import JobDetailsPanel from './hub/JobDetailsPanel.jsx';
import VisitPicker from './hub/VisitPicker.jsx';
import VisitContext from './hub/VisitContext.jsx';
import JobPhotos from './hub/JobPhotos.jsx';
import AdminJobMenu from './hub/AdminJobMenu.jsx';
import { selectVisitId, buildDocsQuery } from './hub/hubHelpers.js';

// ─── SECTION: Helpers ──────────────
function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const todayISO = () => new Date().toISOString().split('T')[0];

export default function TechJobHub() {
  // ─── SECTION: State & hooks ──────────────
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { employee, db, isFeatureEnabled } = useAuth();
  const queryClient = useQueryClient();
  const { enqueue } = useOfflineQueue();
  const offlineQueueEnabled = isFeatureEnabled('offline:queue');
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');

  const [hub, setHub] = useState(null);        // { job, claim, work_auth_signed, appointments }
  const [contact, setContact] = useState(null);
  const [docs, setDocs] = useState([]);
  const [rooms, setRooms] = useState(null);
  const [visit, setVisit] = useState(null);    // get_appointment_detail of the selected appt
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [entering, setEntering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileRef = useRef(null);

  // Division-colored hero = light text → force a light status bar (ONE pair).
  useEffect(() => {
    requestAnimationFrame(() => setEntering(true));
    statusBarLight();
    return () => statusBarDark();
  }, []);

  // ─── SECTION: Data fetching ──────────────
  const appointments = hub?.appointments || [];
  const apptParam = searchParams.get('appt');
  const selectedId = selectVisitId(appointments, apptParam, employee?.id, todayISO());

  const loadFrame = useCallback(async () => {
    setLoadError(null);
    try {
      const [h, contacts] = await Promise.all([
        db.rpc('get_job_hub', { p_job_id: jobId }),
        db.rpc('get_job_contacts', { p_job_id: jobId }).catch(() => []),
      ]);
      if (!h || !h.job) { setLoadError('Job not found'); setLoading(false); return; }
      setHub(h);
      const list = Array.isArray(contacts) ? contacts : [];
      setContact(list.find((c) => c.is_primary) || list[0] || null);
      const docList = await db.select('job_documents', buildDocsQuery({ jobId })).catch(() => []);
      setDocs(docList || []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load job');
      toast('Failed to load job', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobId]);

  useEffect(() => { loadFrame(); }, [loadFrame]);

  // Rooms (job-scoped) — shared by the reading sheet (per-visit) + gated by flag.
  useEffect(() => {
    if (!roomsEnabled || !jobId) { setRooms(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const r = await db.rpc('get_job_rooms', { p_job_id: jobId });
        if (!cancelled) setRooms(r || []);
      } catch { if (!cancelled) setRooms([]); }
    })();
    return () => { cancelled = true; };
  }, [roomsEnabled, jobId, db]);

  // Load the selected visit's full detail (crew, private-gating) when it changes.
  const loadVisit = useCallback(async () => {
    if (!selectedId) { setVisit(null); return; }
    try {
      const detail = await db.rpc('get_appointment_detail', { p_appointment_id: selectedId });
      setVisit(detail || null);
    } catch { setVisit(null); }
  }, [db, selectedId]);

  useEffect(() => { loadVisit(); }, [loadVisit]);

  // Keep the URL's ?appt= in sync with the resolved selection (stale/absent →
  // default). replace: no new history entry per auto-correction.
  useEffect(() => {
    if (selectedId && apptParam !== selectedId) {
      const next = new URLSearchParams(searchParams);
      next.set('appt', selectedId);
      setSearchParams(next, { replace: true });
    }
  }, [selectedId, apptParam, searchParams, setSearchParams]);

  const reloadDocs = useCallback(async () => {
    const docList = await db.select('job_documents', buildDocsQuery({ jobId })).catch(() => []);
    setDocs(docList || []);
  }, [db, jobId]);

  // ─── SECTION: Event handlers ──────────────
  const selectVisit = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('appt', id);
    setSearchParams(next, { replace: true });
  };

  // A visit-level mutation (clock, task) — refresh the frame + selected visit and
  // invalidate the shared caches so the dash/schedule panes stay fresh.
  const onVisitMutation = useCallback((kind) => {
    invalidateTech(queryClient, kind);
    loadFrame();
    loadVisit();
  }, [queryClient, loadFrame, loadVisit]);

  const uploadPhotoFile = async (file) => {
    if (!file || !jobId) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is too large (max 10 MB)', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed', 'error'); return; }

    // Offline fork: a capture in a visit context (a visit is selected) keeps the
    // offline queue and tags the appointment; a job-level capture (no visit)
    // uploads directly. Do not extend the queue to job-level (owner decision).
    if (offlineQueueEnabled && selectedId) {
      try {
        const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
        await savePhotoBlob(clientId, {
          blob: file, mimeType: file.type, name: file.name,
          jobId, appointmentId: selectedId, uploadedBy: employee?.id || null,
          roomId: null, description: null,
        });
        await enqueue({
          type: 'photo.upload', clientId,
          payload: { clientId, jobId, appointmentId: selectedId, roomId: null, description: null, name: file.name },
        });
        impact('light');
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          toast('Photo queued — will upload when online', 'success');
        }
      } catch (err) {
        toast('Failed to queue photo: ' + (err?.message || 'unknown'), 'error');
      }
      return;
    }

    // Direct path (job-level, or offline queue off).
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
        p_job_id: jobId, p_name: file.name, p_file_path: `job-files/${path}`,
        p_mime_type: file.type, p_category: 'photo', p_uploaded_by: employee?.id || null,
        p_appointment_id: selectedId || null,
      });
      impact('light');
      toast('Photo uploaded');
      await reloadDocs();
      invalidateTech(queryClient, 'photo');
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoCaptured = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await uploadPhotoFile(file);
  };

  const triggerAddPhoto = async () => {
    if (uploading) return;
    if (isNativeCamera()) {
      try {
        const file = await takeNativePhoto();
        if (file) await uploadPhotoFile(file);
      } catch (err) {
        if (!isUserCancelled(err)) toast('Camera error: ' + err.message, 'error');
      }
    } else {
      fileRef.current?.click();
    }
  };

  // Reload the gallery when a queued photo for THIS job finishes syncing.
  useEffect(() => {
    if (!offlineQueueEnabled || !jobId) return undefined;
    const runner = getSyncRunner();
    if (!runner) return undefined;
    return runner.on('sync:item-done', ({ item }) => {
      if (item?.type !== 'photo.upload') return;
      if (item?.payload?.jobId && item.payload.jobId !== jobId) return;
      reloadDocs();
      invalidateTech(queryClient, 'photo');
    });
  }, [offlineQueueEnabled, jobId, reloadDocs, queryClient]);

  const saveNote = async (text) => {
    try {
      await db.rpc('insert_job_document', {
        p_job_id: jobId, p_name: 'Field note', p_file_path: '', p_mime_type: 'text/plain',
        p_category: 'note', p_uploaded_by: employee?.id || null,
        p_description: text, p_appointment_id: selectedId || null,
      });
      toast('Note saved');
      await reloadDocs();
    } catch (err) {
      toast('Failed to save note: ' + err.message, 'error');
    }
  };

  const handleCreateRoom = useCallback(async (name) => {
    if (!jobId) throw new Error('Job not loaded');
    const created = await db.rpc('create_room', {
      p_job_id: jobId, p_name: name, p_created_by: employee?.id,
      p_client_id: crypto?.randomUUID?.() || null,
    });
    const r = await db.rpc('get_job_rooms', { p_job_id: jobId });
    setRooms(r || []);
    return created;
  }, [db, jobId, employee?.id]);

  // ─── SECTION: Render ──────────────
  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (!hub || !hub.job) {
    return (
      <div className="tech-page">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{loadError || 'Job not found'}</div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>This job may have been removed or is unavailable.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
            <button className="btn btn-primary" onClick={loadFrame}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const job = hub.job;
  const claim = hub.claim;
  const division = job.division || 'water';
  const title = contact?.name || job.insured_name || 'Unknown';
  const phone = contact?.phone || job.client_phone || null;
  const address = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const phaseLabel = titleCase(job.phase || 'New');
  const divPill = DIV_PILL_COLORS[division] || DIV_PILL_COLORS.water;
  const isAdmin = employee?.role === 'admin' || employee?.role === 'manager';

  const metaPieces = [];
  if (job.date_of_loss) metaPieces.push(`Loss: ${formatLossDate(job.date_of_loss)}`);
  if (job.division) metaPieces.push(titleCase(job.division));
  if (job.status && job.status !== 'active') metaPieces.push(`Status: ${titleCase(job.status)}`);

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
      <ActionBar
        phone={phone}
        address={address}
        onDocuments={() => navigate(`/tech/jobs/${jobId}/documents`)}
      />

      <WorkAuthBanner hub={hub} jobId={jobId} />

      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={fileRef} onChange={handlePhotoCaptured} />

      <PullToRefresh onRefresh={loadFrame} style={{ flex: 1 }}>
        <ClaimBreadcrumb claim={claim} division={division} />

        <JobDetailsPanel job={job} contact={contact} address={address} phaseLabel={phaseLabel} isAdmin={isAdmin} />

        <VisitPicker appointments={appointments} selectedId={selectedId} onSelect={selectVisit} jobId={jobId} />

        {selectedId && (
          <VisitContext
            appt={visit}
            job={job}
            address={address}
            rooms={rooms}
            onCreateRoom={handleCreateRoom}
            onClock={onVisitMutation}
          />
        )}

        <JobPhotos
          docs={docs}
          db={db}
          uploading={uploading}
          onAddPhoto={triggerAddPhoto}
          onSaveNote={saveNote}
        />

        <GenerateReportButton jobId={jobId} jobNumber={job.job_number} />

        <div style={{ height: 20 }} />
      </PullToRefresh>

      <AdminJobMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        job={job}
        claim={claim}
        onMerged={loadFrame}
      />
    </div>
  );
}
