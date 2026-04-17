import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS, DIV_BORDER_COLORS, DIV_PILL_COLORS } from './techConstants';
import { DIV_EMOJI } from '@/lib/claimUtils';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';

function fileUrl(db, filePath) {
  if (!filePath) return null;
  return `${db.baseUrl}/storage/v1/object/public/${filePath}`;
}

// Insurance + timeline-friendly: always show actual date + time. Two lines
// (date then time) so the caption reads cleanly even on narrow columns.
function photoDateTime(isoStr) {
  if (!isoStr) return { date: '', time: '' };
  const d = new Date(isoStr);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return { date, time };
}

// Local copy of Lightbox — promote to components/tech/ once TechJobDetail
// becomes the 3rd caller.
function Lightbox({ photos, index, onClose, onIndex, db }) {
  if (!photos || photos.length === 0 || index == null) return null;
  const current = photos[index];
  if (!current) return null;
  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onClose(); }}
        aria-label="Close album"
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
          fontSize: 22, lineHeight: 1, cursor: 'pointer',
          minWidth: 44, minHeight: 44, borderRadius: 'var(--radius-full)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      <div style={{
        position: 'absolute', top: 16, left: 16,
        color: '#fff', fontSize: 13, fontWeight: 600,
        background: 'rgba(0,0,0,0.35)', padding: '6px 12px', borderRadius: 'var(--radius-full)',
      }}>
        {index + 1} / {photos.length}
      </div>

      <img
        src={fileUrl(db, current.file_path)}
        alt={current.name || 'Photo'}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain',
          touchAction: 'pinch-zoom',
        }}
      />

      {canPrev && (
        <button
          onClick={e => { e.stopPropagation(); onIndex(index - 1); }}
          aria-label="Previous photo"
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {canNext && (
        <button
          onClick={e => { e.stopPropagation(); onIndex(index + 1); }}
          aria-label="Next photo"
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {current.description && (
        <div style={{
          position: 'absolute', bottom: 20, left: 20, right: 20,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          padding: '10px 14px', borderRadius: 'var(--radius-md)',
          fontSize: 13, lineHeight: 1.4, textAlign: 'center',
        }}>
          {current.description}
        </div>
      )}
    </div>
  );
}

export default function TechClaimAlbum() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { db, employee } = useAuth();

  // Optional: open the page with a specific job's photos emphasized
  const focusJobId = location.state?.focusJobId || null;

  const [detail, setDetail] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { jobId, index }

  // Add Photo state (same shape as TechClaimDetail)
  const [jobPicker, setJobPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const pendingPhotoJobIdRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await db.rpc('get_claim_detail', { p_claim_id: claimId });
      if (!data?.claim) {
        setLoadError('Claim not found');
        return;
      }
      setDetail(data);
      const jobIds = (data.jobs || []).map(j => j.id);
      if (jobIds.length > 0) {
        const idList = jobIds.map(id => `"${id}"`).join(',');
        const docList = await db.select(
          'job_documents',
          `job_id=in.(${idList})&category=eq.photo&order=created_at.desc`,
        ).catch(() => []);
        setDocs(docList || []);
      }
    } catch (e) {
      setLoadError(e.message || 'Failed to load album');
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
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusJobId, loading]);

  const uploadPhotoForJob = useCallback(async (file, jobId) => {
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
  }, [db, employee?.id, load]);

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
        if (!isUserCancelled(err)) toast('Camera error: ' + err.message, 'error');
      }
    } else {
      pendingPhotoJobIdRef.current = jobId;
      fileRef.current?.click();
    }
  };

  const startAddPhoto = () => {
    const jobs = detail?.jobs || [];
    if (jobs.length === 0) { toast('No jobs on this claim', 'error'); return; }
    if (jobs.length === 1) captureForJob(jobs[0].id);
    else setJobPicker(true);
  };

  // Group docs by job (all already filtered to photos + newest first)
  const jobs = detail?.jobs || [];
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
            const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
            const emoji = DIV_EMOJI[job.division] || DIV_EMOJI.general;
            return (
              <div key={job.id} id={`album-group-${job.id}`} style={{ marginBottom: 22 }}>
                {jobs.length > 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    paddingBottom: 6, marginBottom: 10,
                    borderBottom: `2px solid ${divColor}`,
                  }}>
                    <span style={{ fontSize: 16 }}>{emoji}</span>
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
                          src={fileUrl(db, p.file_path)}
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

      {/* Pinned Add Photo */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))',
        padding: '10px var(--space-4)',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, var(--bg-primary) 40%)',
        pointerEvents: 'none',
      }}>
        <button
          onClick={startAddPhoto}
          disabled={uploading || jobs.length === 0}
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
          {uploading ? 'Uploading…' : 'Add Photo'}
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

      {/* Hidden file input for web */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Multi-job picker sheet */}
      {jobPicker && (
        <div
          onClick={() => setJobPicker(false)}
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
              Add photo to which job?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobs.map(job => {
                const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
                const divPill = DIV_PILL_COLORS[job.division] || DIV_PILL_COLORS.water;
                const emoji = DIV_EMOJI[job.division] || DIV_EMOJI.general;
                return (
                  <button
                    key={job.id}
                    onClick={() => { setJobPicker(false); captureForJob(job.id); }}
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
                    <span style={{ fontSize: 20 }}>{emoji}</span>
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
