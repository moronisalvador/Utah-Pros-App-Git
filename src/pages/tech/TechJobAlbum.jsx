/**
 * ════════════════════════════════════════════════
 * FILE: TechJobAlbum.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A photo gallery for a single job, seen by a field technician. It shows all
 *   of that job's photos in a grid, newest first, with the date and time under
 *   each one. Tapping a photo opens it full-screen for zooming. An "Add Photo"
 *   button lets the tech snap and upload a new picture right from the page.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/jobs/:jobId/photos
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, ./techConstants, @/lib/toast,
 *              @/lib/nativeCamera, @/lib/nativeHaptics,
 *              @/components/tech/Lightbox, @/lib/techDateUtils,
 *              @/lib/backNav, @/components/tech/v2/nav (jobHref)
 *   Data:      All access goes through the db client from useAuth.
 *              reads  → jobs (direct db.select); job_documents
 *                        (direct db.select, photos only)
 *              writes → job_documents (insert_job_document)
 *                        + job-files storage bucket (direct REST upload)
 *
 * NOTES / GOTCHAS:
 *   - This is the single-job version of TechClaimAlbum (no job grouping, no
 *     job-picker sheet) — the photo upload + lightbox logic mirrors it.
 *   - Photos are fetched by job_id only; appointment_id is always passed as
 *     null on upload here.
 *   - Uploads cap at 10 MB and must be image/* (per file); the native camera
 *     path is used on device, a hidden file input on web.
 *   - Add Photo supports selecting several album photos in one pass: native
 *     shows AddPhotoSourceSheet (Take photo / Choose from album multi-select),
 *     web's hidden input carries `multiple`. Files upload sequentially with a
 *     per-file failure summary ("3 of 5 photos uploaded").
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS } from './techConstants';
import { toast } from '@/lib/toast';
import { isNativeCamera, captureNativePhoto, pickNativePhotos, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import AddPhotoSourceSheet from '@/components/tech/AddPhotoSourceSheet';
import Lightbox from '@/components/tech/Lightbox';
import { fileUrl, photoDateTime } from '@/lib/techDateUtils';
import { goBackOr } from '@/lib/backNav';
import { jobHref } from '@/components/tech/v2/nav';

export default function TechJobAlbum() {
  const kbInset = useNativeKeyboardInset();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [job, setJob] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } during a multi-photo batch
  const [sourceSheet, setSourceSheet] = useState(false);
  const fileRef = useRef(null);

  // ─── SECTION: Data fetching ──────────────
  // LES-01 (loading-error-states.md §1): the photo read used to carry an inline
  // `.catch(() => [])`. `db.select` THROWS on any non-OK response, so that
  // swallow rendered "No photos yet. Tap Add Photo to capture the first one."
  // over a real outage — and on the post-upload reload it WIPED a grid the tech
  // was looking at. It now rejects into the outer catch.
  //
  // `silent` = don't re-gate the page (page-lifecycle.md §1: the loading gate is
  // cold-start only). `quiet` = don't surface the failure; the upload already
  // reported its own outcome, so the grid stays put and the error goes to the
  // console only. Precedent for the silence gate: src/pages/crm/CrmCallLog.jsx.
  const load = useCallback(async ({ silent = false, quiet = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const [rows, docList] = await Promise.all([
        db.select('jobs', `id=eq.${jobId}&select=*`),
        db.select('job_documents', `job_id=eq.${jobId}&category=eq.photo&order=created_at.desc`),
      ]);
      const j = rows?.[0];
      if (!j) {
        setLoadError('Job not found');
        return;
      }
      setJob(j);
      setPhotos(docList || []);
    } catch (e) {
      // Raw failures stay in the console for diagnosis and never reach the screen:
      // a tech in a flooded basement must not be shown PostgREST JSON.
      console.error('TechJobAlbum load failed:', e?.message || e);
      if (quiet) return;
      setLoadError('Failed to load album');
      toast('Failed to load album', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobId]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Event handlers ──────────────
  // Uploads ONE file. Throws on any failure — including the per-file size and
  // type guards — so the batch loop below can count it and keep going.
  const uploadOne = useCallback(async (file) => {
    if (file.size > 10 * 1024 * 1024) throw Object.assign(new Error('Photo is too large (max 10 MB)'), { isGuard: true });
    if (!file.type.startsWith('image/')) throw Object.assign(new Error('Only image files are allowed'), { isGuard: true });
    // Checked per file, not only at batch start: connectivity can drop
    // mid-batch, and a fast refusal beats a hanging storage fetch.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw Object.assign(new Error('Photo uploads require an internet connection. Reconnect and try again.'), { isGuard: true });
    }
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
  }, [db, employee?.id, jobId]);

  // Sequential batch: one file at a time so a mid-batch failure never loses
  // the photos before it, with a per-file failure summary at the end.
  const uploadPhotos = useCallback(async (files) => {
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
          await uploadOne(files[i]);
          done++;
        } catch (err) {
          console.error(`TechJobAlbum upload failed (${files[i]?.name}):`, err?.message || err);
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
      // LES-01: silent + quiet — refresh the grid without collapsing the page
      // into a spinner, and without stacking a second toast on the summary if
      // the refresh itself fails. The already-rendered grid stays.
      if (done > 0) load({ silent: true, quiet: true });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, [jobId, uploadOne, load]);

  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) uploadPhotos(files);
  };

  // Native shows our own Take photo / Choose from album sheet: the OS
  // multi-select album picker (pickNativePhotos) cannot also offer the
  // camera, so the choice has to be ours. Web keeps the input's own picker.
  const triggerAddPhoto = () => {
    if (uploading) return;
    if (isNativeCamera()) setSourceSheet(true);
    else fileRef.current?.click();
  };

  const takePhotoNative = async () => {
    setSourceSheet(false);
    try {
      const file = await captureNativePhoto();
      if (file) await uploadPhotos([file]);
    } catch (err) {
      if (!isUserCancelled(err)) toast('Camera error: ' + err.message, 'error');
    }
  };

  const choosePhotosNative = async () => {
    setSourceSheet(false);
    try {
      const files = await pickNativePhotos();
      if (files.length) await uploadPhotos(files);
    } catch (err) {
      if (!isUserCancelled(err)) toast('Could not open the photo album: ' + err.message, 'error');
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
            {loadError || 'Album not available'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => goBackOr(navigate, jobHref(jobId))}>Back</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const division = job.division || 'water';
  const tint = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const insuredName = job.insured_name || 'Unknown';

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
          onClick={() => goBackOr(navigate, jobHref(jobId))}
          aria-label="Back to job"
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
            {job.job_number} · {insuredName}
          </div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '4px 10px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
        }}>
          {photos.length}
        </span>
      </div>

      <div style={{ height: 4, background: tint }} />

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '12px var(--space-4) calc(132px + env(safe-area-inset-bottom, 0px))',
      }}>
        {photos.length === 0 ? (
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {photos.map((p, i) => {
              const { date, time } = photoDateTime(p.created_at);
              return (
                <button
                  key={p.id}
                  onClick={() => setLightboxIndex(i)}
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
                      src={fileUrl(db, p.file_path)}
                      alt={p.name || 'Photo'}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                      {date}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', lineHeight: 1.2, marginTop: 1 }}>
                      {time}
                    </div>
                  </div>
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
              );
            })}
          </div>
        )}
      </div>

      {/* Pinned Add Photo */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: kbInset > 0 ? `${kbInset}px` : 'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))',
        padding: '10px var(--space-4)',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, var(--bg-primary) 40%)',
        pointerEvents: 'none',
      }}>
        <button
          onClick={triggerAddPhoto}
          disabled={uploading}
          style={{
            pointerEvents: 'auto', width: '100%', minHeight: 52,
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
          {uploading
            ? (progress ? `Uploading ${progress.done} of ${progress.total}…` : 'Uploading…')
            : 'Add Photo'}
        </button>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={(i) => setLightboxIndex(i)}
          db={db}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <AddPhotoSourceSheet
        open={sourceSheet}
        onClose={() => setSourceSheet(false)}
        onTakePhoto={takePhotoNative}
        onChooseFromAlbum={choosePhotosNative}
      />
    </div>
  );
}
