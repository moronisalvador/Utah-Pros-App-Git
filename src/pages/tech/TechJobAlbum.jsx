import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS } from './techConstants';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import Lightbox from '@/components/tech/Lightbox';
import { fileUrl, photoDateTime } from '@/lib/techDateUtils';

export default function TechJobAlbum() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [job, setJob] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rows, docList] = await Promise.all([
        db.select('jobs', `id=eq.${jobId}&select=*`),
        db.select('job_documents', `job_id=eq.${jobId}&category=eq.photo&order=created_at.desc`).catch(() => []),
      ]);
      const j = rows?.[0];
      if (!j) {
        setLoadError('Job not found');
        return;
      }
      setJob(j);
      setPhotos(docList || []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load album');
      toast('Failed to load album', 'error');
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
            <button className="btn btn-secondary" onClick={() => navigate(`/tech/jobs/${jobId}`)}>Back</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const division = job.division || 'water';
  const tint = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const insuredName = job.insured_name || 'Unknown';

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
          onClick={() => navigate(`/tech/jobs/${jobId}`)}
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
        bottom: 'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))',
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
          {uploading ? 'Uploading…' : 'Add Photo'}
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
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}
