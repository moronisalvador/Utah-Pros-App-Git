import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS, DIV_BORDER_COLORS } from './techConstants';
import { DivisionIcon } from '@/components/DivisionIcons';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import Lightbox from '@/components/tech/Lightbox';
import { photoDateTime } from '@/lib/techDateUtils';

/**
 * TechRoomDetail — view photos + notes tagged to a single room, spanning
 * every job on the claim. Rooms are claim-scoped so a "Kitchen" tile shows
 * the full water + mold + recon story in one place.
 *
 * Route: /tech/claims/:claimId/rooms/:roomId
 */
export default function TechRoomDetail() {
  const { claimId, roomId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [claim, setClaim] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [room, setRoom] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [tab, setTab] = useState('photos'); // 'photos' | 'notes'

  // Add-photo state
  const [jobPicker, setJobPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const pendingJobRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [detail, roomList] = await Promise.all([
        db.rpc('get_claim_detail', { p_claim_id: claimId }),
        db.rpc('get_claim_rooms', { p_claim_id: claimId }).catch(() => []),
      ]);
      if (!detail?.claim) {
        setLoadError('Claim not found');
        return;
      }
      const foundRoom = (roomList || []).find(r => r.id === roomId);
      if (!foundRoom) {
        setLoadError('Room not found');
        return;
      }
      setClaim(detail.claim);
      setJobs(detail.jobs || []);
      setRoom(foundRoom);

      const docList = await db
        .select('job_documents', `room_id=eq.${roomId}&order=created_at.desc`)
        .catch(() => []);
      setDocs(docList || []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load room');
      toast('Failed to load room', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, claimId, roomId]);

  useEffect(() => { load(); }, [load]);

  const photos = useMemo(() => docs.filter(d => d.category === 'photo'), [docs]);
  const notes = useMemo(() => docs.filter(d => d.category === 'note'), [docs]);

  // Group photos by date for the section headers (Today / Yesterday / date)
  const photosByDate = useMemo(() => {
    const groups = [];
    const keyFor = (isoStr) => {
      if (!isoStr) return 'unknown';
      return new Date(isoStr).toISOString().slice(0, 10);
    };
    let current = null;
    for (const p of photos) {
      const k = keyFor(p.created_at);
      if (!current || current.key !== k) {
        current = { key: k, label: photoDateTime(p.created_at)?.dateLabel || k, items: [] };
        groups.push(current);
      }
      current.items.push(p);
    }
    return groups;
  }, [photos]);

  const uploadPhotoForJob = useCallback(async (file, jobId) => {
    if (!file || !jobId || !room) return;
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
        p_room_id: room.id,
      });
      impact('light');
      toast('Photo uploaded');
      load();
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  }, [db, employee?.id, room, load]);

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const jobId = pendingJobRef.current;
    pendingJobRef.current = null;
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
      pendingJobRef.current = jobId;
      fileRef.current?.click();
    }
  };

  const startAddPhoto = () => {
    if (jobs.length === 0) { toast('No jobs on this claim', 'error'); return; }
    if (jobs.length === 1) captureForJob(jobs[0].id);
    else setJobPicker(true);
  };

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (loadError || !room) {
    return (
      <div className="tech-page">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {loadError || 'Room not found'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-secondary"
              onClick={() => navigate(`/tech/claims/${claimId}`)}
            >
              Back to claim
            </button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const division = jobs[0]?.division || 'water';
  const tint = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;

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
          <div style={{
            fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {room.name}
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {claim?.claim_number} · Room
          </div>
        </div>
      </div>

      {/* Division-tinted thin band */}
      <div style={{ height: 4, background: tint }} />

      {/* Tabs (Photos | Notes) */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-light)',
          background: 'var(--bg-primary)',
          position: 'sticky',
          top: 65,
          zIndex: 9,
        }}
      >
        <TabButton
          active={tab === 'photos'}
          onClick={() => setTab('photos')}
          badge={photos.length}
        >
          Photos
        </TabButton>
        <TabButton
          active={tab === 'notes'}
          onClick={() => setTab('notes')}
          badge={notes.length}
        >
          Notes
        </TabButton>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '12px var(--space-4) calc(132px + env(safe-area-inset-bottom, 0px))',
      }}>
        {tab === 'photos' && (
          photos.length === 0 ? (
            <EmptyState
              icon="📷"
              title="No photos in this room yet"
              hint="Tap Add Photo, or snap one from any appointment and tag it to this room."
            />
          ) : (
            photosByDate.map(group => (
              <div key={group.key} style={{ marginBottom: 22 }}>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
                  margin: '4px 0 10px',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {group.label}
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
                }}>
                  {group.items.map((p) => {
                    const absIndex = photos.findIndex(x => x.id === p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => setLightboxIndex(absIndex)}
                        style={{
                          padding: 0, border: 'none', background: 'none',
                          cursor: 'pointer', fontFamily: 'var(--font-sans)',
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
                            src={`${db.baseUrl}/storage/v1/object/public/${p.file_path}`}
                            alt={p.name || 'Photo'}
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )
        )}

        {tab === 'notes' && (
          notes.length === 0 ? (
            <EmptyState
              icon="📝"
              title="No notes in this room yet"
              hint="Notes on photos for this room will show up here."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => {
                const job = jobs.find(j => j.id === n.job_id);
                const divColor = DIV_BORDER_COLORS[job?.division] || '#6b7280';
                return (
                  <div
                    key={n.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-light)',
                      borderLeft: `4px solid ${divColor}`,
                    }}
                  >
                    <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                      {n.description || '(empty note)'}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)',
                    }}>
                      {job && <DivisionIcon type={job.division} size={12} />}
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{job?.job_number || '—'}</span>
                      <span>·</span>
                      <span>{photoDateTime(n.created_at)?.dateLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {tab === 'photos' && (
        <div
          style={{
            position: 'fixed',
            left: 0, right: 0,
            bottom: `calc(var(--tech-nav-height, 64px) + max(12px, env(safe-area-inset-bottom, 12px)))`,
            padding: '10px var(--space-4) 12px',
            background: 'linear-gradient(to top, var(--bg-primary) 60%, rgba(255,255,255,0))',
            display: 'flex', justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <button
            onClick={startAddPhoto}
            disabled={uploading || jobs.length === 0}
            style={{
              pointerEvents: 'auto',
              width: '100%', maxWidth: 420,
              minHeight: 52, borderRadius: 14,
              background: 'var(--accent)', color: '#fff', border: 'none',
              cursor: uploading ? 'wait' : 'pointer',
              fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 4px 14px rgba(37,99,235,0.35)',
              opacity: uploading ? 0.7 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            {uploading ? 'Uploading…' : 'Add Photo'}
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {jobPicker && (
        <JobPicker
          jobs={jobs}
          onPick={(jobId) => { setJobPicker(false); captureForJob(jobId); }}
          onClose={() => setJobPicker(false)}
          title={`Add photo for ${room.name} — which job?`}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
          db={db}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, badge, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 48,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        padding: '10px 8px',
        marginBottom: -1,
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span>{children}</span>
      {badge > 0 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: 'var(--radius-full)',
            background: active ? 'var(--accent-light)' : 'var(--bg-tertiary)',
            color: active ? 'var(--accent)' : 'var(--text-tertiary)',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div style={{
      textAlign: 'center', padding: '64px 16px',
      color: 'var(--text-tertiary)', fontSize: 14,
    }}>
      <div style={{ fontSize: 44, opacity: 0.4, marginBottom: 10 }}>{icon}</div>
      <div style={{
        fontSize: 15, fontWeight: 600, color: 'var(--text-primary)',
        marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 320, margin: '0 auto' }}>
        {hint}
      </div>
    </div>
  );
}

function JobPicker({ jobs, onPick, onClose, title }) {
  return (
    <div
      onClick={onClose}
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
          {title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {jobs.map(job => {
            const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
            return (
              <button
                key={job.id}
                onClick={() => onPick(job.id)}
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
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
  );
}
