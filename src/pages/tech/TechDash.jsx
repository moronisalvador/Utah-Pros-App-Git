import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import TimeTracker, { formatTimeStr } from '@/components/tech/TimeTracker';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';

const haptic = (ms = 50) => { if ('vibrate' in navigator) navigator.vibrate(ms); };

/* ── Create FAB ── */

function CreateFAB() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          onTouchMove={e => e.preventDefault()}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
            zIndex: 90, WebkitTapHighlightColor: 'transparent', touchAction: 'none',
          }}
        />
      )}

      {/* FAB + menu */}
      <div style={{
        position: 'fixed',
        bottom: 'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)) + 16px)',
        right: 16, zIndex: 91, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10,
      }}>
        {/* Option pills — shown when open */}
        {open && (
          <>
            <button
              onClick={() => { setOpen(false); navigate('/tech/new-job'); }}
              style={{
                height: 48, padding: '0 20px', borderRadius: 24,
                background: 'var(--accent)', color: '#fff', border: 'none',
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(37,99,235,0.35)',
                display: 'flex', alignItems: 'center', gap: 8,
                WebkitTapHighlightColor: 'transparent',
                animation: 'techFabIn 0.15s ease-out',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              New Job
            </button>
            <button
              onClick={() => { setOpen(false); navigate('/tech/new-customer'); }}
              style={{
                height: 48, padding: '0 20px', borderRadius: 24,
                background: '#16a34a', color: '#fff', border: 'none',
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(22,163,74,0.35)',
                display: 'flex', alignItems: 'center', gap: 8,
                WebkitTapHighlightColor: 'transparent',
                animation: 'techFabIn 0.1s ease-out',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              New Customer
            </button>
          </>
        )}

        {/* Main FAB button */}
        <button
          onClick={() => setOpen(prev => !prev)}
          style={{
            width: 56, height: 56, borderRadius: 28,
            background: 'var(--accent)', color: '#fff', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.35)',
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}

/* ── Active Appointment Card ── */

function ActiveCard({ appt, employee, db, onReload }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [confirmOmw, setConfirmOmw] = useState(false);
  const [acting, setActing] = useState(false);
  const [photoToast, setPhotoToast] = useState(null); // { id, filePath }
  const [photoNoteSheet, setPhotoNoteSheet] = useState(null); // { id, filePath }
  const [photoNoteText, setPhotoNoteText] = useState('');
  const [savingPhotoNote, setSavingPhotoNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const confirmTimer = useRef(null);
  const photoToastTimer = useRef(null);
  const fileRef = useRef(null);

  const job = appt.jobs;
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
  const clientName = job?.insured_name;

  const loadTasks = useCallback(async () => {
    if (tasksLoaded) return;
    try {
      const result = await db.rpc('get_appointment_tasks', { p_appointment_id: appt.id });
      setTasks(result || []);
    } catch { /* ignore */ }
    setTasksLoaded(true);
  }, [db, appt.id, tasksLoaded]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      if (photoToastTimer.current) clearTimeout(photoToastTimer.current);
    };
  }, []);

  const openMap = (e) => {
    e.stopPropagation();
    if (!address) return;
    const encoded = encodeURIComponent(address);
    const url = /iPhone|iPad/.test(navigator.userAgent)
      ? `maps://?q=${encoded}`
      : `https://maps.google.com/?q=${encoded}`;
    window.open(url);
  };

  const uploadPhotoFile = async (file) => {
    if (!file || !job) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is too large (max 10 MB)', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed', 'error'); return; }
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
        p_appointment_id: appt.id,
      });
      if (onReload) onReload();
      // Show inline toast with "Add note" option
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

  // Web path: triggered by hidden <input type=file capture>
  const handlePhotoCaptured = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await uploadPhotoFile(file);
  };

  // Unified photo button: native camera on iOS, file picker on web
  const openPhotoCapture = async () => {
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
    } catch (err) {
      toast('Failed to save note: ' + err.message, 'error');
    }
    setSavingPhotoNote(false);
    setPhotoNoteSheet(null);
    setPhotoNoteText('');
  };

  const doOmw = async () => {
    if (!confirmOmw) {
      setConfirmOmw(true);
      confirmTimer.current = setTimeout(() => setConfirmOmw(false), 3000);
      return;
    }
    setConfirmOmw(false);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    haptic(50);
    setActing(true);
    try {
      await db.rpc('clock_appointment_action', {
        p_appointment_id: appt.id,
        p_employee_id: employee.id,
        p_action: 'omw',
      });
      if (onReload) onReload();
    } catch (e) {
      toast('Action failed: ' + e.message, 'error');
    }
    setActing(false);
  };

  const goToDetail = () => navigate(`/tech/appointment/${appt.id}`);

  const doneCount = tasks.filter(t => t.is_completed).length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const isScheduled = appt.status === 'scheduled' || appt.status === 'confirmed';
  const isActive = ['en_route', 'in_progress', 'paused'].includes(appt.status);

  return (
    <div className="tech-appt-card" data-status={appt.status} onClick={goToDetail}>
      {/* Client name — most important identifier */}
      {clientName && (
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
          {clientName}
        </div>
      )}

      {/* Appointment title */}
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {appt.title || job?.division || 'Appointment'}
      </div>

      {/* Address */}
      {address && (
        <button className="tech-appt-address" onClick={openMap}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {address}
        </button>
      )}

      {/* Task progress bar (non-interactive) */}
      {tasksLoaded && totalCount > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Tasks {doneCount}/{totalCount}
          </div>
          <div className="tech-task-progress-bar">
            <div className="tech-task-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* TimeTracker for active states (en_route/in_progress/paused) */}
      {isActive && (
        <div onClick={e => e.stopPropagation()}>
          <TimeTracker appt={appt} employee={employee} db={db} onUpdate={onReload} />
        </div>
      )}

      {/* Quick actions row */}
      {isScheduled && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }} onClick={e => e.stopPropagation()}>
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={fileRef} onChange={handlePhotoCaptured} />

          {/* Photo */}
          <button
            onClick={openPhotoCapture}
            disabled={uploading}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              height: 48, borderRadius: 'var(--tech-radius-button)', fontSize: 13, fontWeight: 600,
              background: uploading ? 'var(--accent-light)' : 'var(--bg-tertiary)',
              color: uploading ? 'var(--accent)' : 'var(--text-secondary)',
              border: `1px solid ${uploading ? 'var(--accent)' : 'var(--border-light)'}`,
              cursor: uploading ? 'wait' : 'pointer',
              fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
              opacity: uploading ? 0.8 : 1,
            }}
          >
            {uploading ? '⏳ Uploading...' : '📸 Photo'}
          </button>

          {/* Notes — navigates to appointment detail */}
          <button
            onClick={() => navigate(`/tech/appointment/${appt.id}`)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              height: 48, borderRadius: 'var(--tech-radius-button)', fontSize: 13, fontWeight: 600,
              background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-light)', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
            }}
          >
            📝 Notes
          </button>

          {/* Clock In (two-click confirm) */}
          <button
            onClick={doOmw}
            onBlur={() => { setConfirmOmw(false); if (confirmTimer.current) clearTimeout(confirmTimer.current); }}
            disabled={acting}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              height: 48, borderRadius: 'var(--tech-radius-button)', fontSize: 13, fontWeight: 700,
              background: confirmOmw ? '#fef2f2' : '#b45309',
              color: confirmOmw ? '#dc2626' : '#fff',
              border: confirmOmw ? '1px solid #fecaca' : '1px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
              opacity: acting ? 0.6 : 1,
            }}
          >
            {confirmOmw ? 'Confirm?' : '▶ Clock In'}
          </button>
        </div>
      )}

      {/* Fixed photo saved toast — above bottom nav */}
      {photoToast && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
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
          }}
        >
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

      {/* Photo note bottom sheet */}
      {photoNoteSheet && (
        <div
          onClick={e => { e.stopPropagation(); setPhotoNoteSheet(null); setPhotoNoteText(''); }}
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
              {/* Small thumbnail */}
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
              {/* Input */}
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
    </div>
  );
}

/* ── Future Appointment Row (timeline style) ── */

function FutureRow({ appt, showCrew }) {
  const navigate = useNavigate();
  const job = appt.jobs;
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
  const timeStr = appt.time_start ? formatTimeStr(appt.time_start) : '';
  const crewNames = showCrew && appt.appointment_crew?.length > 0
    ? appt.appointment_crew.map(c => c.employees?.display_name || c.employees?.full_name || '?').join(', ')
    : null;

  return (
    <div className="tech-future-row" onClick={() => navigate(`/tech/appointment/${appt.id}`)}>
      <div className="tech-future-time-col">
        <div className="tech-future-time">{timeStr}</div>
      </div>
      <div className="tech-future-line" />
      <div className="tech-future-content">
        <div className="tech-future-title">{job?.insured_name || appt.title || 'Appointment'}</div>
        <div className="tech-future-address">
          {[appt.title, job?.job_number ? `#${job.job_number}` : null].filter(Boolean).join(' · ')}
        </div>
        {address && <div className="tech-future-address">{address}</div>}
        {crewNames && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{crewNames}</div>}
      </div>
    </div>
  );
}

/* ── Upcoming Section (reusable) ── */

function UpcomingSection({ upcoming }) {
  if (!upcoming || upcoming.length === 0) return null;

  const grouped = {};
  upcoming.forEach(a => {
    const d = a.date;
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(a);
  });
  const sorted = Object.keys(grouped).sort();

  const formatDate = (ds) => {
    const d = new Date(ds + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 12, paddingLeft: 4,
      }}>
        Coming Up
      </div>
      {sorted.map(ds => (
        <div key={ds}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
            padding: '8px 4px 4px',
          }}>
            {formatDate(ds)}
          </div>
          {grouped[ds].map(appt => (
            <FutureRow key={appt.id} appt={appt} showCrew />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Skeleton Loading ── */

function DashSkeleton() {
  return (
    <div className="tech-page">
      {/* Greeting skeleton */}
      <div style={{ marginBottom: 16 }}>
        <div className="tech-skeleton-line short" style={{ height: 10, width: '30%' }} />
        <div className="tech-skeleton-line" style={{ height: 28, width: '55%', marginBottom: 6 }} />
        <div className="tech-skeleton-line" style={{ height: 14, width: '40%' }} />
      </div>
      {/* Card skeleton */}
      <div className="tech-skeleton-card">
        <div className="tech-skeleton-line" style={{ height: 18, width: '45%' }} />
        <div className="tech-skeleton-line medium" />
        <div className="tech-skeleton-line long" />
        <div className="tech-skeleton-line" style={{ height: 4, width: '60%' }} />
        <div style={{ height: 8 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="tech-skeleton-line" style={{ flex: 1, height: 40 }} />
          <div className="tech-skeleton-line" style={{ flex: 1, height: 40 }} />
          <div className="tech-skeleton-line" style={{ flex: 1, height: 40 }} />
        </div>
      </div>
      <div className="tech-skeleton-card">
        <div className="tech-skeleton-line medium" style={{ height: 18 }} />
        <div className="tech-skeleton-line long" />
      </div>
    </div>
  );
}

/* ── TechDash Page ── */

export default function TechDash() {
  const { employee, db, logout } = useAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const logoutTimer = useRef(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.rpc('get_my_appointments_today', { p_employee_id: employee.id });
      setAppointments(result || []);
    } catch (e) {
      toast('Failed to load appointments', 'error');
    }
    setLoading(false);
  }, [db, employee.id]);

  // Fetch upcoming 7 days — always, for all crew
  const loadUpcoming = useCallback(async () => {
    try {
      const tomorrow = new Date(Date.now() + 86400000);
      const end = new Date(Date.now() + 7 * 86400000);
      const result = await db.rpc('get_appointments_range', {
        p_start_date: tomorrow.toISOString().split('T')[0],
        p_end_date: end.toISOString().split('T')[0],
      });
      setUpcoming(result || []);
    } catch { /* ignore */ }
  }, [db]);

  useEffect(() => { load(); loadUpcoming(); }, [load, loadUpcoming]);

  useEffect(() => {
    return () => { if (logoutTimer.current) clearTimeout(logoutTimer.current); };
  }, []);

  const isAdmin = employee?.role === 'admin';

  const handleLogoutTap = () => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      logoutTimer.current = setTimeout(() => setConfirmLogout(false), 3000);
      return;
    }
    setConfirmLogout(false);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    logout();
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const firstName = (employee.display_name || employee.full_name || '').split(' ')[0];

  if (loading) return <DashSkeleton />;

  const activeStatuses = ['scheduled', 'en_route', 'in_progress', 'paused', 'confirmed'];
  const active = appointments.filter(a => activeStatuses.includes(a.status));
  const completed = appointments.filter(a => a.status === 'completed');
  const future = appointments.filter(a => !activeStatuses.includes(a.status) && a.status !== 'completed');

  // Shared menu button + dropdown
  const menuButton = (
    <div style={{ position: 'absolute', top: 'var(--space-3)', right: 'var(--space-4)', zIndex: 20 }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setShowMenu(false); }}>
      <button
        onClick={() => setShowMenu(v => !v)}
        style={{
          width: 40, height: 40, borderRadius: 'var(--tech-radius-button)',
          background: showMenu ? 'var(--accent-light)' : 'var(--bg-tertiary)',
          color: showMenu ? 'var(--accent)' : 'var(--text-secondary)',
          border: `1px solid ${showMenu ? 'var(--accent)' : 'var(--border-light)'}`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'manipulation',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {showMenu && (
        <div style={{
          position: 'absolute', right: 0, top: 46, background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--tech-radius-card)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 180, overflow: 'hidden',
          animation: 'techFabIn 0.12s ease-out',
        }}>
          {isAdmin && (
            <button onClick={() => { setShowMenu(false); navigate('/'); }} onMouseDown={e => e.preventDefault()}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 16px',
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', textAlign: 'left' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Admin View
            </button>
          )}
          <button onClick={() => { setShowMenu(false); navigate('/tech/feedback'); }} onMouseDown={e => e.preventDefault()}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 16px',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', textAlign: 'left',
              borderTop: '1px solid var(--border-light)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Send Feedback
          </button>
          <button onClick={() => { setShowMenu(false); handleLogoutTap(); }} onMouseDown={e => e.preventDefault()}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 16px',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              color: confirmLogout ? '#dc2626' : 'var(--text-primary)', fontFamily: 'var(--font-sans)', textAlign: 'left',
              borderTop: '1px solid var(--border-light)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={confirmLogout ? '#dc2626' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            {confirmLogout ? 'Tap again to Sign Out' : 'Sign Out'}
          </button>
        </div>
      )}
    </div>
  );

  if (appointments.length === 0) {
    return (
      <div className="tech-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="tech-dash-greeting-sticky" style={{ position: 'relative' }}>
          {menuButton}
          <div className="tech-dash-date">{dateStr}</div>
          <div className="tech-dash-name">Hey {firstName} 👋</div>
          <div className="tech-dash-summary">0 appointments today</div>
        </div>

        {upcoming.length > 0 ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-4)' }}>
            <UpcomingSection upcoming={upcoming} />
          </div>
        ) : (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-state-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <polyline points="9 16 11 18 15 14" strokeWidth="2"/>
              </svg>
            </div>
            <div className="empty-state-text">No appointments today</div>
            <div className="empty-state-sub">
              <Link to="/tech/schedule" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                Check your upcoming schedule →
              </Link>
            </div>
          </div>
        )}

        {/* ── FAB: Create New (empty state) ── */}
        <CreateFAB />
      </div>
    );
  }

  return (
    <div className="tech-page" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0 }}>
      {/* Greeting — fixed, never moves on pull-to-refresh */}
      <div className="tech-dash-greeting-sticky" style={{ position: 'relative' }}>
        {menuButton}
        <div className="tech-dash-date">{dateStr}</div>
        <div className="tech-dash-name">Hey {firstName} 👋</div>
        <div className="tech-dash-summary">
          {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} today
        </div>
      </div>

      {/* Only this part refreshes */}
      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
        <div style={{ padding: 'var(--space-4)' }}>
          {/* Active appointment cards */}
          {active.map(appt => (
            <ActiveCard key={appt.id} appt={appt} employee={employee} db={db} onReload={load} />
          ))}

          {/* Future appointments — timeline style */}
          {future.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                marginBottom: 8, paddingLeft: 4,
              }}>
                Upcoming
              </div>
              {future.map(appt => (
                <FutureRow key={appt.id} appt={appt} />
              ))}
            </div>
          )}

          {/* Completed — compact */}
          {completed.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                marginBottom: 8, paddingLeft: 4,
              }}>
                Completed
              </div>
              {completed.map(appt => {
                const timeStr = appt.time_start ? formatTimeStr(appt.time_start) : '';
                return (
                  <div
                    key={appt.id}
                    className="tech-appt-card"
                    data-status="completed"
                    onClick={() => navigate(`/tech/appointment/${appt.id}`)}
                    style={{ opacity: 0.65, padding: '12px 16px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>{timeStr}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {appt.title || 'Appointment'}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Coming Up — all crew, next 7 days */}
          <UpcomingSection upcoming={upcoming} />
        </div>
      </PullToRefresh>

      {/* ── FAB: Create New ── */}
      <CreateFAB />
    </div>
  );
}
