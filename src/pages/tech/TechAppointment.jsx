import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import TimeTracker, { formatTimeStr } from '@/components/tech/TimeTracker';
import { APPT_STATUS_COLORS as STATUS_COLORS, DIV_GRADIENTS, DIV_PILL_COLORS } from './techConstants';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function TechAppointment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { employee, db } = useAuth();
  const [appt, setAppt] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [entering, setEntering] = useState(false);
  const [photoToast, setPhotoToast] = useState(null); // { id, filePath }
  const [photoNoteSheet, setPhotoNoteSheet] = useState(null); // { id, filePath }
  const [photoNoteText, setPhotoNoteText] = useState('');
  const [savingPhotoNote, setSavingPhotoNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoToastTimer = useRef(null);
  const fileRef = useRef(null);
  const togglingRef = useRef(new Set());

  useEffect(() => {
    requestAnimationFrame(() => setEntering(true));
  }, []);

  const load = useCallback(async () => {
    try {
      const [detail, taskList] = await Promise.all([
        db.rpc('get_appointment_detail', { p_appointment_id: id }),
        db.rpc('get_appointment_tasks', { p_appointment_id: id }),
      ]);
      setAppt(detail);
      setTasks(taskList || []);
      // Fetch docs by appointment_id OR job_id (catches older docs without appointment_id)
      const jobId = detail?.jobs?.id || detail?.job_id;
      const docList = jobId
        ? await db.select('job_documents', `or=(appointment_id.eq.${id},job_id.eq.${jobId})&select=*&order=created_at.desc`).catch(() => [])
        : await db.select('job_documents', `appointment_id=eq.${id}&select=*&order=created_at.desc`).catch(() => []);
      setDocs(docList || []);
    } catch (e) {
      toast('Failed to load appointment', 'error');
    }
    setLoading(false);
  }, [db, id]);

  useEffect(() => { load(); }, [load]);

  const toggleTask = async (task) => {
    if (togglingRef.current.has(task.id)) return;
    togglingRef.current.add(task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.id, p_employee_id: employee.id });
    } catch (e) {
      toast('Failed to toggle task', 'error');
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    } finally {
      togglingRef.current.delete(task.id);
    }
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (photoToastTimer.current) clearTimeout(photoToastTimer.current); };
  }, []);

  const handlePhotoCaptured = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !appt?.jobs) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is too large (max 10 MB)', 'error'); e.target.value = ''; return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed', 'error'); e.target.value = ''; return; }
    const job = appt.jobs;
    e.target.value = '';
    setUploading(true);
    try {
      const ts = Date.now();
      const path = `${job.id}/${ts}-${file.name}`;
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${db.apiKey}`, 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Upload failed');
      const doc = await db.rpc('insert_job_document', {
        p_job_id: job.id,
        p_name: file.name,
        p_file_path: `job-files/${path}`,
        p_mime_type: file.type,
        p_category: 'photo',
        p_uploaded_by: employee.id,
        p_appointment_id: id,
      });
      load();
      const docId = doc?.id;
      setPhotoToast({ id: docId, filePath: `job-files/${path}` });
      if (photoToastTimer.current) clearTimeout(photoToastTimer.current);
      photoToastTimer.current = setTimeout(() => setPhotoToast(null), 4000);
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const openPhotoNoteSheet = () => {
    if (!photoToast) return;
    if (photoToastTimer.current) clearTimeout(photoToastTimer.current);
    setPhotoNoteSheet({ id: photoToast.id, filePath: photoToast.filePath });
    setPhotoNoteText('');
    setPhotoToast(null);
  };

  const savePhotoNote = async () => {
    if (!photoNoteSheet?.id || !photoNoteText.trim()) return;
    setSavingPhotoNote(true);
    try {
      await db.update('job_documents', `id=eq.${photoNoteSheet.id}`, { description: photoNoteText.trim() });
      toast('Note added');
      load();
    } catch (err) {
      toast('Failed to save note: ' + err.message, 'error');
    }
    setSavingPhotoNote(false);
    setPhotoNoteSheet(null);
    setPhotoNoteText('');
  };

  const saveNote = async () => {
    if (!noteText.trim() || !appt?.jobs) return;
    setSavingNote(true);
    try {
      await db.rpc('insert_job_document', {
        p_job_id: appt.jobs.id,
        p_name: 'Field note',
        p_file_path: '',
        p_mime_type: 'text/plain',
        p_category: 'note',
        p_uploaded_by: employee.id,
        p_description: noteText.trim(),
        p_appointment_id: id,
      });
      toast('Note saved');
      setNoteText('');
      setNoteOpen(false);
      load();
    } catch (err) {
      toast('Failed to save note: ' + err.message, 'error');
    }
    setSavingNote(false);
  };

  const openMap = (address) => {
    if (!address) return;
    const encoded = encodeURIComponent(address);
    const url = /iPhone|iPad/.test(navigator.userAgent)
      ? `maps://?q=${encoded}`
      : `https://maps.google.com/?q=${encoded}`;
    window.open(url);
  };

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (!appt) {
    return (
      <div className="tech-page">
        <div className="empty-state" style={{ marginTop: 60 }}>
          <div className="empty-state-text">Appointment not found</div>
        </div>
      </div>
    );
  }

  const job = appt.jobs;
  const crew = appt.appointment_crew || [];
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
  const sc = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;
  const doneCount = tasks.filter(t => t.is_completed).length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  const photos = docs.filter(d => d.category === 'photo');
  const notes = docs.filter(d => d.category === 'note');
  const division = job?.division || 'water';
  const heroGradient = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const divPill = DIV_PILL_COLORS[division] || DIV_PILL_COLORS.water;
  const divPillColor = divPill?.color || '#1e40af';

  return (
    <div className={`tech-page${entering ? ' tech-page-enter' : ''}`} style={{ padding: 0 }}>
      {/* ── Division-colored hero header ── */}
      <div style={{
        background: heroGradient,
        padding: '0 0 0 0',
      }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px var(--space-4)',
        }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'none', border: 'none', color: '#fff',
              cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: '#fff', color: divPillColor,
          }}>
            {(appt.status || 'scheduled').replace(/_/g, ' ')}
          </span>
        </div>

        {/* Hero content */}
        <div style={{ padding: '4px var(--space-5) 20px' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>
            {appt.title || 'Appointment'}
          </div>
          {job && (
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>
              {job.job_number}{job.insured_name ? ` · ${job.insured_name}` : ''}
            </div>
          )}
          {address && (
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
              {address}
            </div>
          )}
        </div>
      </div>

      {/* ── Action bar ── */}
      <div style={{
        display: 'flex', background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-light)',
        padding: '8px 0',
      }}>
        {/* Navigate */}
        {address && (
          <button
            onClick={() => openMap(address)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 0', minWidth: 64, minHeight: 56,
              fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)',
              touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
            <span style={{ fontSize: 10, fontWeight: 600 }}>Navigate</span>
          </button>
        )}

        {/* Call */}
        {job?.client_phone && (
          <a
            href={`tel:${job.client_phone}`}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, textDecoration: 'none',
              padding: '6px 0', minWidth: 64, minHeight: 56,
              fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)',
              touchAction: 'manipulation',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span style={{ fontSize: 10, fontWeight: 600 }}>Call</span>
          </a>
        )}

        {/* Message */}
        <button
          onClick={() => navigate('/tech/conversations')}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 4, background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 0', minWidth: 64, minHeight: 56,
            fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)',
            touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Message</span>
        </button>

        {/* Photo */}
        <button
          onClick={() => !uploading && fileRef.current?.click()}
          disabled={uploading}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 4, background: 'none', border: 'none',
            cursor: uploading ? 'wait' : 'pointer',
            padding: '6px 0', minWidth: 64, minHeight: 56,
            fontFamily: 'var(--font-sans)',
            color: uploading ? 'var(--accent)' : 'var(--text-secondary)',
            touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span style={{ fontSize: 10, fontWeight: 600 }}>{uploading ? 'Uploading...' : 'Photo'}</span>
        </button>
      </div>

      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={fileRef} onChange={handlePhotoCaptured} />

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
        {/* Time Tracker */}
        <div style={{ padding: '0 var(--space-4)' }}>
          <TimeTracker appt={appt} employee={employee} db={db} onUpdate={load} />
        </div>

        {/* Crew section */}
        {crew.length > 0 && (
          <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
            <div className="tech-section-header-sticky">Crew</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {crew.map(c => {
                const emp = c.employees;
                const initials = (emp?.display_name || emp?.full_name || '?')
                  .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                const isLead = c.role === 'lead' || c.role === 'crew_lead';
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 'var(--radius-full)',
                      background: 'var(--accent-light)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, flexShrink: 0,
                    }}>
                      {initials}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
                      {emp?.display_name || emp?.full_name || 'Unknown'}
                    </span>
                    {isLead && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 6px',
                        borderRadius: 'var(--radius-full)',
                        background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a',
                      }}>
                        Lead
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tasks section */}
        <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
          <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Tasks</span>
            {totalCount > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400, letterSpacing: 'normal', textTransform: 'none' }}>{doneCount}/{totalCount}</span>
            )}
          </div>

          {/* Progress bar */}
          {totalCount > 0 && (
            <div className="tech-task-progress-bar" style={{ marginBottom: 8 }}>
              <div className="tech-task-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          {totalCount === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No tasks assigned</div>
          ) : (
            tasks.map(task => (
              <div key={task.id} className="tech-task-row" onClick={() => toggleTask(task)}
                style={{ minHeight: 'var(--tech-row-height)' }}>
                <div className={`tech-task-check${task.is_completed ? ' done' : ''}`}>
                  {task.is_completed && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </div>
                <span className={`tech-task-name${task.is_completed ? ' done' : ''}`}>{task.title}</span>
              </div>
            ))
          )}
        </div>

        {/* Photo gallery — 2 columns */}
        <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
          <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Photos</span>
            <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Add Photo
            </button>
          </div>
          {photos.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No photos yet</div>
          ) : (
            groupPhotosByDate(photos).map(group => (
              <div key={group.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  {group.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {group.items.map(p => (
                    <div key={p.id}>
                      <div
                        onClick={() => setLightboxPhoto(p)}
                        style={{
                          aspectRatio: '1', borderRadius: 12,
                          background: 'var(--bg-tertiary)', overflow: 'hidden',
                          border: '1px solid var(--border-light)', cursor: 'pointer',
                        }}
                      >
                        <img
                          src={`${db.baseUrl}/storage/v1/object/public/${p.file_path}`}
                          alt={p.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      </div>
                      {p.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.3 }}>
                          {p.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Lightbox with pinch-to-zoom */}
        {lightboxPhoto && (
          <div
            onClick={() => setLightboxPhoto(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 'var(--space-4)',
            }}
          >
            <button
              onClick={() => setLightboxPhoto(null)}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'none', border: 'none', color: '#fff',
                fontSize: 28, lineHeight: 1, cursor: 'pointer', padding: 8,
                zIndex: 1001,
              }}
            >
              ✕
            </button>
            <img
              src={`${db.baseUrl}/storage/v1/object/public/${lightboxPhoto.file_path}`}
              alt={lightboxPhoto.name}
              onClick={e => e.stopPropagation()}
              style={{
                maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain',
                borderRadius: 'var(--radius-md)',
                touchAction: 'pinch-zoom',
              }}
            />
          </div>
        )}

        {/* Photo note sheet — drops from top to avoid keyboard overlap */}
        {photoNoteSheet && (
          <div
            onClick={() => { setPhotoNoteSheet(null); setPhotoNoteText(''); }}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                background: 'var(--bg-primary)',
                borderRadius: '0 0 16px 16px',
                padding: 'calc(env(safe-area-inset-top, 12px) + 8px) 16px 16px',
                animation: 'tech-fade-in 0.15s ease-out',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 10, overflow: 'hidden',
                  background: 'var(--bg-tertiary)', flexShrink: 0,
                }}>
                  <img
                    src={`${db.baseUrl}/storage/v1/object/public/${photoNoteSheet.filePath}`}
                    alt="Photo"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                </div>
                <input
                  className="input"
                  value={photoNoteText}
                  onChange={e => setPhotoNoteText(e.target.value)}
                  placeholder="What's in this photo?"
                  autoFocus
                  style={{ fontSize: 16, flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={savePhotoNote}
                  disabled={savingPhotoNote || !photoNoteText.trim()}
                  style={{ flex: 1 }}
                >
                  {savingPhotoNote ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => { setPhotoNoteSheet(null); setPhotoNoteText(''); }}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Notes section */}
        <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
          <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Notes</span>
            {!noteOpen && (
              <button className="btn btn-secondary btn-sm" onClick={() => setNoteOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Note
              </button>
            )}
          </div>

          {noteOpen && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                className="input textarea"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Type a note..."
                rows={3}
                style={{ fontSize: 16, marginBottom: 8, width: '100%', minHeight: 100 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={saveNote} disabled={savingNote || !noteText.trim()}>
                  {savingNote ? 'Saving...' : 'Save'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setNoteOpen(false); setNoteText(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {notes.length === 0 && !noteOpen && (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No notes yet</div>
          )}
          {notes.map(n => (
            <div key={n.id} style={{
              padding: '10px 12px', marginBottom: 6,
              background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
              fontSize: 14, color: 'var(--text-primary)',
            }}>
              <div>{n.description || n.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                {relativeTime(n.created_at)}
              </div>
            </div>
          ))}
        </div>

        {/* Appointment notes */}
        {appt.notes && (
          <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Appointment Notes
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{appt.notes}</div>
          </div>
        )}

        <div style={{ height: 20 }} />
      </PullToRefresh>

      {/* Fixed photo saved toast — above bottom nav */}
      {photoToast && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(var(--tech-nav-height, 64px) + max(12px, env(safe-area-inset-bottom, 12px)) + 12px)',
          left: 16, right: 16,
          zIndex: 100,
          padding: '10px 14px',
          background: '#f0fdf4', border: '1px solid #bbf7d0',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          animation: 'tech-fade-in 0.15s ease-out',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#16a34a' }}>Photo saved ✓</span>
          <button
            onClick={openPhotoNoteSheet}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, color: 'var(--accent)',
              fontFamily: 'var(--font-sans)', padding: '4px 0',
              touchAction: 'manipulation',
            }}
          >
            Add note
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */

function groupPhotosByDate(photos) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = {};
  photos.forEach(p => {
    const d = new Date(p.created_at);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().split('T')[0];
    if (!groups[key]) groups[key] = { date: d, items: [] };
    groups[key].items.push(p);
  });

  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, g]) => {
      const d = g.date;
      let label;
      if (d.getTime() === today.getTime()) {
        label = 'Today';
      } else if (d.getTime() === yesterday.getTime()) {
        label = 'Yesterday';
      } else if (today.getTime() - d.getTime() < 7 * 86400000) {
        label = d.toLocaleDateString('en-US', { weekday: 'long' });
      } else {
        label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return { label, items: g.items };
    });
}
