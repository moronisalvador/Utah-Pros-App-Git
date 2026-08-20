/**
 * ════════════════════════════════════════════════
 * FILE: TechClaimAlbum.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A photo gallery for one insurance claim, seen by a field technician. It
 *   pulls every photo across all the jobs on that claim and lays them out in a
 *   grid, grouped by job. Tapping a photo opens it full-screen so it can be
 *   zoomed. An "Add Photo" button lets the tech snap a new picture — if the
 *   claim has several jobs, a small sheet pops up first to ask which job the
 *   photo belongs to.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/claims/:claimId/photos
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, ./techConstants,
 *              @/components/DivisionIcons, @/lib/toast, @/lib/nativeCamera,
 *              @/lib/nativeHaptics, @/components/tech/Lightbox,
 *              @/lib/techDateUtils
 *   Data:      All access goes through the db client from useAuth.
 *              reads  → claims, contacts, jobs (get_claim_detail);
 *                        job_documents (direct db.select, photos only)
 *              writes → job_documents (insert_job_document)
 *                        + job-files storage bucket (direct REST upload)
 *
 * NOTES / GOTCHAS:
 *   - Photos are fetched by job_id (not appointment_id) for every job on the
 *     claim, then grouped in-memory; the job headers only show when there's
 *     more than one job.
 *   - Opening with router state { focusJobId } scrolls that job's group into
 *     view on mount.
 *   - Uploads cap at 10 MB and must be image/* (per file); the native camera
 *     path is used on device, a hidden file input on web.
 *   - Add Photo opens the CAMERA instantly once the job is known — no source
 *     chooser (owner ruling 2026-08-14). Native gets the full-screen camera
 *     experience (recents strip + album icon inside it, multi-select); the
 *     adjacent album icon-button jumps straight to the OS multi-select
 *     picker. Web: camera-first capture input + a `multiple` album input.
 *     On multi-job claims the job-picker sheet still asks WHICH JOB first —
 *     that's attribution, not a source chooser. Files upload sequentially
 *     with a per-file failure summary.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDialogLifecycle } from '@/lib/useDialogLifecycle';
import { useSheetClosing } from '@/lib/useSheetClosing';
import { useAuth } from '@/contexts/AuthContext';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import { DIV_GRADIENTS, DIV_BORDER_COLORS, DIV_PILL_COLORS } from './techConstants';
import { DivisionIcon } from '@/components/DivisionIcons';
import { toast } from '@/lib/toast';
import { isNativeCamera, openNativeCameraExperience, pickNativePhotos, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import Lightbox from '@/components/tech/Lightbox';
import { photoDateTime } from '@/lib/techDateUtils';
import { useSignedUrls } from '@/hooks/useSignedUrls';
import { scrollBehavior } from '@/lib/reducedMotion';

export default function TechClaimAlbum() {
  const kbInset = useNativeKeyboardInset();
  const { claimId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { db } = useAuth();
  const { uploadPhoto: uploadPhotoShared } = usePhotoUpload();

  // Optional: open the page with a specific job's photos emphasized
  const focusJobId = location.state?.focusJobId || null;

  // ─── SECTION: State & hooks ──────────────
  const [detail, setDetail] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { jobId, index }

  // Add Photo state (same shape as TechClaimDetail)
  const [jobPicker, setJobPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } during a multi-photo batch
  const fileRef = useRef(null);   // web camera-first input (capture="environment")
  const albumRef = useRef(null);  // web album input (`multiple`)
  const pendingPhotoJobIdRef = useRef(null);
  // Which flow follows the job picker on a multi-job claim: 'camera' | 'album'.
  const pendingSourceRef = useRef('camera');

  // MODAL-01 for the inline job-picker sheet: focus trap, focus return,
  // Escape, aria-modal — plus the exit-animation half (motion-standard §3:
  // every enter has an exit; unmount on animationend, never instantly).
  const jobPickerPanelRef = useRef(null);
  const closeJobPicker = useCallback(() => setJobPicker(false), []);
  const jobPickerDialogProps = useDialogLifecycle({
    open: jobPicker, onClose: closeJobPicker, panelRef: jobPickerPanelRef,
  });
  const {
    present: jobPickerPresent,
    overlayClassName: jobPickerOverlayClass,
    panelClassName: jobPickerPanelClass,
    onAnimationEnd: jobPickerAnimationEnd,
  } = useSheetClosing(jobPicker);

  // ─── SECTION: Data fetching ──────────────
  // LES-01 (loading-error-states.md §1): the photo read used to carry an inline
  // `.catch(() => [])`. `db.select` THROWS on any non-OK response, so that
  // swallow rendered an empty album over a real outage — and on the post-upload
  // reload it wiped a grid the tech was looking at. It now rejects into the
  // outer catch. `silent`/`quiet` per page-lifecycle.md §1: the loading gate is
  // cold-start only, and the upload already reported its own outcome.
  const load = useCallback(async ({ silent = false, quiet = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const data = await db.rpc('get_claim_detail', { p_claim_id: claimId });
      if (!data?.claim) {
        setLoadError('Claim not found');
        return;
      }
      const jobIds = (data.jobs || []).map(j => j.id);
      let docList = [];
      if (jobIds.length > 0) {
        const idList = jobIds.map(id => `"${id}"`).join(',');
        docList = await db.select(
          'job_documents',
          `job_id=in.(${idList})&category=eq.photo&order=created_at.desc`,
        );
      }
      // Committed after both reads resolve, so a failed photo read on a cold
      // load lands on the error screen rather than an empty-looking album.
      setDetail(data);
      setDocs(docList || []);
    } catch (e) {
      // Raw failures stay in the console for diagnosis and never reach the screen:
      // a tech in a flooded basement must not be shown PostgREST JSON.
      console.error('TechClaimAlbum load failed:', e?.message || e);
      if (quiet) return;
      setLoadError('Failed to load album');
      toast('Failed to load album', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, claimId]);

  useEffect(() => { load(); }, [load]);

  // Scroll to focused job group on mount
  useEffect(() => {
    if (!focusJobId || loading) return;
    const el = document.getElementById(`album-group-${focusJobId}`);
    if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, [focusJobId, loading]);

  // ─── SECTION: Event handlers ──────────────
  // Uploads ONE file. Throws on any failure — including the per-file size and
  // type guards — so the batch loop below can count it and keep going. The
  // shared usePhotoUpload hook owns compression + Storage + insert_job_document
  // (perf-budget.md §2: photos compress before storage, one upload helper).
  const uploadOne = useCallback(async (file, jobId) => {
    if (file.size > 10 * 1024 * 1024) throw Object.assign(new Error('Photo is too large (max 10 MB)'), { isGuard: true });
    if (!file.type.startsWith('image/')) throw Object.assign(new Error('Only image files are allowed'), { isGuard: true });
    // Checked per file, not only at batch start: connectivity can drop
    // mid-batch, and a fast refusal beats a hanging storage fetch.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw Object.assign(new Error('Photo uploads require an internet connection. Reconnect and try again.'), { isGuard: true });
    }
    await uploadPhotoShared(file, { jobId });
  }, [uploadPhotoShared]);

  // Sequential batch: one file at a time so a mid-batch failure never loses
  // the photos before it, with a per-file failure summary at the end.
  const uploadPhotosForJob = useCallback(async (files, jobId) => {
    if (!files?.length || !jobId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast(
        'Photo uploads require an internet connection. Reconnect and try again.',
        'error',
      );
      return;
    }
    setUploading(true);
    const failures = [];
    let done = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        if (files.length > 1) setProgress({ done: i + 1, total: files.length });
        try {
          await uploadOne(files[i], jobId);
          done++;
        } catch (err) {
          console.error(`TechClaimAlbum upload failed (${files[i]?.name}):`, err?.message || err);
          failures.push(err);
        }
      }
      if (failures.length === 0) {
        impact('light');
        toast(files.length === 1 ? 'Photo uploaded' : `${files.length} photos uploaded`);
      } else if (done > 0) {
        toast(`${done} of ${files.length} photos uploaded — ${failures.length} failed`, 'error');
      } else if (files.length === 1) {
        // Single-file failure keeps the pre-batch wording: the guard messages
        // as-is, anything else behind the "Photo upload failed:" prefix.
        toast(failures[0].isGuard ? failures[0].message : 'Photo upload failed: ' + failures[0].message, 'error');
      } else {
        toast('Photo uploads failed: ' + failures[0].message, 'error');
      }
      // LES-01: silent + quiet — refresh without collapsing the page into a
      // spinner, and without a second toast on top of the summary if the
      // refresh fails. The already-rendered grid stays.
      if (done > 0) load({ silent: true, quiet: true });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, [uploadOne, load]);

  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const jobId = pendingPhotoJobIdRef.current;
    pendingPhotoJobIdRef.current = null;
    if (files.length && jobId) uploadPhotosForJob(files, jobId);
  };

  // The camera IS the screen (owner ruling 2026-08-14): once the job is
  // known, 'camera' opens the full-screen camera instantly (recents strip +
  // album icon live inside it) and 'album' jumps straight to the OS
  // multi-select picker. No source chooser in between. Each shutter tap
  // uploads IMMEDIATELY via onCapturedFile while the camera stays open
  // (shoot & save instantly); strip/album selections batch after close.
  const addPhotosForJob = async (jobId, source = 'camera') => {
    if (uploading || !jobId) return;
    if (isNativeCamera()) {
      try {
        const files = source === 'album'
          ? await pickNativePhotos()
          : await openNativeCameraExperience({
              allowMultiple: true,
              onCapturedFile: (file) => uploadPhotosForJob([file], jobId),
            });
        if (files.length) await uploadPhotosForJob(files, jobId);
      } catch (err) {
        if (!isUserCancelled(err)) {
          toast(
            source === 'album'
              ? 'Could not open the photo album: ' + err.message
              : 'Camera error: ' + err.message,
            'error',
          );
        }
      }
    } else {
      pendingPhotoJobIdRef.current = jobId;
      (source === 'album' ? albumRef : fileRef).current?.click();
    }
  };

  // The multi-job picker asks WHICH JOB the photos belong to (attribution,
  // not a source chooser) — it carries the tapped flow through the pick.
  const startAddPhoto = (source = 'camera') => {
    const jobs = detail?.jobs || [];
    if (jobs.length === 0) { toast('No jobs on this claim', 'error'); return; }
    pendingSourceRef.current = source;
    if (jobs.length === 1) addPhotosForJob(jobs[0].id, source);
    else setJobPicker(true);
  };

  // ─── SECTION: Helpers ──────────────
  // Group docs by job (all already filtered to photos + newest first)
  const jobs = detail?.jobs || [];
  // Signed at the component level over the whole doc list: the per-job
  // `photos` below lives inside a .map() callback, where a hook cannot go.
  const photoPaths = useMemo(() => docs.map((d) => d.file_path), [docs]);
  const { urls: photoUrls } = useSignedUrls(photoPaths);

  const photosByJob = useMemo(() => {
    const g = {};
    for (const d of docs) {
      if (!g[d.job_id]) g[d.job_id] = [];
      g[d.job_id].push(d);
    }
    return g;
  }, [docs]);

  const totalPhotos = docs.length;
  const division = jobs[0]?.division || 'water';
  const tint = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;

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
            {loadError || 'Album not available'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate(`/tech/claims/${claimId}`)}>Back</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const { claim, contact } = detail;
  const insuredName = contact?.name || jobs[0]?.insured_name || 'Unknown';

  // ─── SECTION: Render ──────────────
  return (
    <div className="tech-page tech-page-enter" style={{ padding: 0 }}>
      {/* Slim top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px var(--space-4)',
        borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(`/tech/claims/${claimId}`)}
          aria-label="Back to claim"
          style={{
            background: 'none', border: 'none', color: 'var(--text-primary)',
            cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
            minWidth: 48, minHeight: 44, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            Photos
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {claim.claim_number} · {insuredName}
          </div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '4px 10px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
        }}>
          {totalPhotos}
        </span>
      </div>

      {/* Division-tinted thin band */}
      <div style={{ height: 4, background: tint }} />

      {/* Content — scrollable. Bottom padding clears the pinned Add Photo
          button (~72px tall block) plus breathing room for the 2-line
          timestamp caption of the last photo. */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '12px var(--space-4) calc(132px + env(safe-area-inset-bottom, 0px))',
      }}>
        {totalPhotos === 0 ? (
          <div style={{
            textAlign: 'center', padding: '64px 16px',
            color: 'var(--text-tertiary)', fontSize: 14,
          }}>
            <div style={{ fontSize: 44, opacity: 0.4, marginBottom: 10 }}>📷</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              No photos yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              Tap "Add Photo" to capture the first one.
            </div>
          </div>
        ) : (
          jobs.map(job => {
            const photos = photosByJob[job.id] || [];
            if (photos.length === 0) return null;
            const divColor = DIV_BORDER_COLORS[job.division] || 'var(--neutral)';
            return (
              <div key={job.id} id={`album-group-${job.id}`} style={{ marginBottom: 22 }}>
                {jobs.length > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    paddingBottom: 6, marginBottom: 10,
                    borderBottom: `2px solid ${divColor}`,
                  }}>
                    <DivisionIcon type={job.division} size={18} />
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {job.job_number}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                      · {job.division}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                      {photos.length} photo{photos.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
                }}>
                  {photos.map((p, i) => (
                    <button
                      key={p.id}
                      onClick={() => setLightbox({ jobId: job.id, index: i })}
                      style={{
                        padding: 0, border: 'none', background: 'none',
                        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <div style={{
                        width: '100%', aspectRatio: '1',
                        borderRadius: 14, overflow: 'hidden',
                        border: '1px solid var(--border-light)',
                        background: 'var(--bg-tertiary)',
                        boxShadow: 'var(--tech-shadow-card, 0 1px 3px rgba(0,0,0,0.06))',
                      }}>
                        <img
                          src={photoUrls.get(p.file_path)}
                          alt={p.name || 'Photo'}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      </div>
                      {(() => {
                        const { date, time } = photoDateTime(p.created_at);
                        return (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                              {date}
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', lineHeight: 1.2, marginTop: 1 }}>
                              {time}
                            </div>
                          </div>
                        );
                      })()}
                      {p.description && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-secondary)',
                          marginTop: 2, lineHeight: 1.3,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}>
                          {p.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pinned Add Photo (camera-first) + album icon */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: kbInset > 0 ? `${kbInset}px` : 'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))',
        padding: '10px var(--space-4)',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, var(--bg-primary) 40%)',
        pointerEvents: 'none',
        display: 'flex', gap: 8,
      }}>
        <button
          onClick={() => startAddPhoto('camera')}
          disabled={uploading || jobs.length === 0}
          style={{
            pointerEvents: 'auto', flex: 1, minHeight: 52,
            borderRadius: 14, background: 'var(--accent)', color: '#fff',
            border: 'none', cursor: uploading ? 'wait' : 'pointer',
            fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
            boxShadow: '0 6px 20px rgba(37, 99, 235, 0.35)',
            opacity: uploading ? 0.7 : 1,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span aria-live="polite" aria-atomic="true">
            {uploading
              ? (progress ? `Uploading ${progress.done} of ${progress.total}…` : 'Uploading…')
              : 'Add Photo'}
          </span>
        </button>
        <button
          onClick={() => startAddPhoto('album')}
          disabled={uploading || jobs.length === 0}
          aria-label="Choose from album"
          style={{
            pointerEvents: 'auto', width: 52, minHeight: 52, flexShrink: 0,
            borderRadius: 14, background: 'var(--bg-primary)',
            color: 'var(--accent)', border: '1px solid var(--border-light)',
            cursor: uploading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
            boxShadow: 'var(--tech-shadow-card, 0 1px 3px rgba(0,0,0,0.06))',
            opacity: uploading ? 0.7 : 1,
          }}
        >
          <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          photos={photosByJob[lightbox.jobId] || []}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox(prev => prev ? { ...prev, index: i } : null)}
          db={db}
        />
      )}

      {/* Web inputs: camera-first primary, multi-select album behind the icon */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <input
        ref={albumRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Multi-job picker sheet */}
      {jobPickerPresent && (
        <div
          onClick={closeJobPicker}
          className={jobPickerOverlayClass}
          onAnimationEnd={jobPickerAnimationEnd}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            ref={jobPickerPanelRef}
            {...jobPickerDialogProps}
            aria-label="Add photo to which job?"
            className={jobPickerPanelClass}
            style={{
              background: 'var(--bg-primary)', width: '100%',
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
              maxHeight: '70dvh', overflowY: 'auto',
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
              Add photo to which job?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobs.map(job => {
                const divColor = DIV_BORDER_COLORS[job.division] || 'var(--neutral)';
                const divPill = DIV_PILL_COLORS[job.division] || DIV_PILL_COLORS.water;
                return (
                  <button
                    key={job.id}
                    onClick={() => { setJobPicker(false); addPhotosForJob(job.id, pendingSourceRef.current); }}
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
                        {job.division} · {(job.phase || '').replace(/_/g, ' ')}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: divPill.bg, color: divPill.color,
                    }}>
                      {(photosByJob[job.id] || []).length}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setJobPicker(false)}
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
    </div>
  );
}
