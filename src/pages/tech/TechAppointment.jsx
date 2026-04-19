import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import TimeTracker, { formatTimeStr } from '@/components/tech/TimeTracker';
import PhotoNoteSheet from '@/components/tech/PhotoNoteSheet';
import ReadingEntrySheet from '@/components/tech/ReadingEntrySheet';
import EquipmentPlacementSheet from '@/components/tech/EquipmentPlacementSheet';
import MaterialIcon, { MATERIAL_LABELS } from '@/components/tech/MaterialIcon';
import { EQUIPMENT_LABELS } from '@/components/tech/EquipmentPlacementSheet';
import GenerateReportButton from '@/components/tech/GenerateReportButton';
import { APPT_STATUS_COLORS as STATUS_COLORS, DIV_GRADIENTS, DIV_PILL_COLORS } from './techConstants';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { savePhotoBlob } from '@/lib/offlineDb';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';

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
  const { employee, db, isFeatureEnabled } = useAuth();
  const { enqueue } = useOfflineQueue();
  const offlineQueueEnabled = isFeatureEnabled('offline:queue');
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
  const [photoNoteSheet, setPhotoNoteSheet] = useState(null); // { id, filePath, description? }
  const [rooms, setRooms] = useState(null);
  const [uploading, setUploading] = useState(false);
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');
  // ── Hydro (Phase 2) state ──────────────────────────────────────────────
  const moistureEnabled = isFeatureEnabled('page:tech_moisture');
  const equipmentEnabled = isFeatureEnabled('page:tech_equipment');
  const [readings, setReadings] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [readingSheetOpen, setReadingSheetOpen] = useState(false);
  const [equipmentSheetOpen, setEquipmentSheetOpen] = useState(false);
  const [confirmRemoveEquipId, setConfirmRemoveEquipId] = useState(null);
  const photoToastTimer = useRef(null);
  const fileRef = useRef(null);
  const togglingRef = useRef(new Set());

  useEffect(() => {
    requestAnimationFrame(() => setEntering(true));
    // Division-colored hero = light text on dark gradient
    statusBarLight();
    return () => statusBarDark();
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

  const uploadPhotoFile = async (file) => {
    if (!file || !appt?.jobs) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is too large (max 10 MB)', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed', 'error'); return; }
    const job = appt.jobs;

    // ── Offline-queue path (gated by offline:queue flag) ─────────────────
    // Store the blob in IDB + enqueue. The sync runner drains immediately
    // when online; otherwise it waits for the next connectivity event.
    // A sync:item-done listener below reloads the gallery on success.
    if (offlineQueueEnabled) {
      try {
        const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
        await savePhotoBlob(clientId, {
          blob: file,
          mimeType: file.type,
          name: file.name,
          jobId: job.id,
          appointmentId: id,
          uploadedBy: employee?.id || null,
          roomId: null,
          description: null,
        });
        await enqueue({
          type: 'photo.upload',
          clientId,
          payload: {
            clientId,
            jobId: job.id,
            appointmentId: id,
            roomId: null,
            description: null,
            name: file.name,
          },
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

    // ── Inline path (default) ────────────────────────────────────────────
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
      impact('light');
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

  // Reload gallery when a queued photo for this appointment finishes syncing.
  // Only active when offline:queue is on — otherwise load() runs inline.
  useEffect(() => {
    if (!offlineQueueEnabled) return;
    const runner = getSyncRunner();
    if (!runner) return;
    return runner.on('sync:item-done', ({ item }) => {
      if (item?.type !== 'photo.upload') return;
      if (item?.payload?.appointmentId !== id) return;
      load();
    });
  }, [offlineQueueEnabled, id, load]);

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
    setPhotoNoteSheet({ id: photoToast.id, filePath: photoToast.filePath, description: '' });
    setPhotoToast(null);
  };

  // ── Rooms (Phase 1) ───────────────────────────────────────────────────────
  const jobIdForRooms = appt?.jobs?.id || appt?.job_id;

  useEffect(() => {
    if (!roomsEnabled || !jobIdForRooms) { setRooms(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await db.rpc('get_job_rooms', { p_job_id: jobIdForRooms });
        if (!cancelled) setRooms(r || []);
      } catch {
        if (!cancelled) setRooms([]);
      }
    })();
    return () => { cancelled = true; };
  }, [roomsEnabled, jobIdForRooms, db]);

  const handleSavePhotoNote = async (text) => {
    if (!photoNoteSheet?.id) return;
    await db.update('job_documents', `id=eq.${photoNoteSheet.id}`, { description: text });
    load();
  };

  const handleAssignPhotoRoom = async (roomId) => {
    if (!photoNoteSheet?.id) return;
    await db.rpc('move_photo_to_room', {
      p_document_id: photoNoteSheet.id,
      p_room_id: roomId,
    });
    if (jobIdForRooms) {
      const r = await db.rpc('get_job_rooms', { p_job_id: jobIdForRooms });
      setRooms(r || []);
    }
    load();
  };

  const handleCreateRoom = async (name) => {
    if (!jobIdForRooms) throw new Error('Appointment not loaded');
    const created = await db.rpc('create_room', {
      p_job_id: jobIdForRooms,
      p_name: name,
      p_created_by: employee?.id,
      p_client_id: crypto?.randomUUID?.() || null,
    });
    const r = await db.rpc('get_job_rooms', { p_job_id: jobIdForRooms });
    setRooms(r || []);
    return created;
  };

  const currentPhotoRoomId = photoNoteSheet?.id
    ? docs.find(d => d.id === photoNoteSheet.id)?.room_id || null
    : null;

  // ── Hydro: load readings + equipment, and save handlers ─────────────────
  const loadHydro = useCallback(async () => {
    if (!jobIdForRooms) return;
    try {
      const [r, e] = await Promise.all([
        moistureEnabled ? db.rpc('get_job_readings', { p_job_id: jobIdForRooms }) : Promise.resolve([]),
        equipmentEnabled ? db.rpc('get_job_equipment', { p_job_id: jobIdForRooms, p_include_removed: false }) : Promise.resolve([]),
      ]);
      setReadings(r || []);
      setEquipment(e || []);
    } catch {
      // silent — the sections will just show empty state
    }
  }, [db, jobIdForRooms, moistureEnabled, equipmentEnabled]);

  useEffect(() => { loadHydro(); }, [loadHydro]);

  // Refresh when a queued reading or equipment change for THIS job syncs.
  useEffect(() => {
    if (!offlineQueueEnabled) return;
    if (!jobIdForRooms) return;
    const runner = getSyncRunner();
    if (!runner) return;
    return runner.on('sync:item-done', ({ item }) => {
      const t = item?.type;
      if (t !== 'reading.insert' && t !== 'equipment.place' && t !== 'equipment.remove') return;
      if (item?.payload?.jobId && item.payload.jobId !== jobIdForRooms) return;
      loadHydro();
    });
  }, [offlineQueueEnabled, jobIdForRooms, loadHydro]);

  const handleSaveReading = async (payload) => {
    if (!jobIdForRooms) throw new Error('Appointment not loaded');
    const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
    const queuePayload = {
      clientId,
      jobId: jobIdForRooms,
      roomId: payload.roomId || null,
      material: payload.material,
      location: payload.location || null,
      mc: payload.mc ?? null,
      rh: payload.rh ?? null,
      tempF: payload.temp_f ?? null,
      gpp: payload.gpp ?? null,
      dewPoint: payload.dew_point ?? null,
      isAffected: !!payload.is_affected,
      equipmentId: payload.equipment_id || null,
      notes: payload.notes || null,
      takenBy: employee?.id || null,
      takenAt: new Date().toISOString(),
    };
    if (offlineQueueEnabled) {
      await enqueue({ type: 'reading.insert', clientId, payload: queuePayload });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast('Reading queued — will upload when online', 'success');
      } else {
        toast('Reading saved');
      }
    } else {
      await db.rpc('insert_reading', {
        p_job_id:       queuePayload.jobId,
        p_room_id:      queuePayload.roomId,
        p_material:     queuePayload.material,
        p_location:     queuePayload.location,
        p_mc:           queuePayload.mc,
        p_rh:           queuePayload.rh,
        p_temp_f:       queuePayload.tempF,
        p_gpp:          queuePayload.gpp,
        p_dew_point:    queuePayload.dewPoint,
        p_is_affected:  queuePayload.isAffected,
        p_equipment_id: queuePayload.equipmentId,
        p_taken_by:     queuePayload.takenBy,
        p_notes:        queuePayload.notes,
        p_client_id:    clientId,
      });
      toast('Reading saved');
      loadHydro();
    }
  };

  const handlePlaceEquipment = async (payload) => {
    if (!jobIdForRooms) throw new Error('Appointment not loaded');
    const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
    const queuePayload = {
      clientId,
      jobId: jobIdForRooms,
      roomId: payload.roomId || null,
      equipmentType: payload.equipment_type,
      nickname: payload.nickname || null,
      serialNumber: payload.serial_number || null,
      placedBy: employee?.id || null,
    };
    if (offlineQueueEnabled) {
      await enqueue({ type: 'equipment.place', clientId, payload: queuePayload });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast('Placement queued — will upload when online', 'success');
      } else {
        toast('Equipment placed');
      }
    } else {
      await db.rpc('place_equipment', {
        p_job_id:         queuePayload.jobId,
        p_room_id:        queuePayload.roomId,
        p_equipment_type: queuePayload.equipmentType,
        p_nickname:       queuePayload.nickname,
        p_serial:         queuePayload.serialNumber,
        p_placed_by:      queuePayload.placedBy,
        p_client_id:      clientId,
        p_notes:          null,
      });
      toast('Equipment placed');
      loadHydro();
    }
  };

  const handleRemoveEquipment = async (equipmentId) => {
    if (confirmRemoveEquipId !== equipmentId) {
      setConfirmRemoveEquipId(equipmentId);
      setTimeout(() => setConfirmRemoveEquipId(null), 3000);
      return;
    }
    setConfirmRemoveEquipId(null);
    try {
      if (offlineQueueEnabled) {
        await enqueue({
          type: 'equipment.remove',
          clientId: (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`,
          payload: { equipmentId, removedBy: employee?.id || null, jobId: jobIdForRooms },
        });
        toast('Equipment marked for removal');
      } else {
        await db.rpc('remove_equipment', { p_equipment_id: equipmentId, p_removed_by: employee?.id || null });
        toast('Equipment removed');
        loadHydro();
      }
    } catch (err) {
      toast('Remove failed: ' + (err?.message || 'unknown'), 'error');
    }
  };

  // Latest reading per (room, material) — used for compact section rows.
  const latestReadings = (() => {
    const seen = new Set();
    const out = [];
    for (const r of readings) {
      const key = `${r.room_id || 'none'}:${r.material}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  })();
  const stalledCount = latestReadings.filter(r => r.is_stalled).length;

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
              minWidth: 48, minHeight: 48,
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
          {job && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate(`/tech/jobs/${job.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', minHeight: 36, borderRadius: 'var(--radius-full)',
                  background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>
                View job
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
              {job.claim_id && (
                <button
                  onClick={() => navigate(`/tech/claims/${job.claim_id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', minHeight: 36, borderRadius: 'var(--radius-full)',
                    background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>
                  View claim
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              )}
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

        {/* Message — TODO: switch to in-app SMS when available */}
        {job?.client_phone ? (
          <a
            href={`sms:${job.client_phone}`}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, textDecoration: 'none',
              padding: '6px 0', minWidth: 64, minHeight: 56,
              fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)',
              touchAction: 'manipulation',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span style={{ fontSize: 10, fontWeight: 600 }}>Message</span>
          </a>
        ) : (
          <button
            disabled
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, background: 'none', border: 'none', cursor: 'not-allowed',
              padding: '6px 0', minWidth: 64, minHeight: 56, opacity: 0.45,
              fontFamily: 'var(--font-sans)', color: 'var(--text-tertiary)',
              touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span style={{ fontSize: 10, fontWeight: 600 }}>Message</span>
          </button>
        )}

        {/* Photo */}
        <button
          onClick={openPhotoCapture}
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

        {/* Edit */}
        <button
          onClick={() => navigate(`/tech/appointment/${id}/edit`)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 4, background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 0', minWidth: 64, minHeight: 56,
            fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)',
            touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span style={{ fontSize: 10, fontWeight: 600 }}>Edit</span>
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
            <span>Tasks {totalCount > 0 && <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', color: 'var(--text-secondary)' }}>{doneCount}/{totalCount}</span>}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/tech/appointment/${id}/edit?section=tasks`)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Tasks
            </button>
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

        {/* ── Moisture Readings (Phase 2, feature-gated) ───────────────── */}
        {moistureEnabled && (
          <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
            <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                Moisture
                {readings.length > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', letterSpacing: 'normal', textTransform: 'none' }}>
                    {readings.length} reading{readings.length === 1 ? '' : 's'}
                  </span>
                )}
                {stalledCount > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 'var(--radius-full)',
                    background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                    letterSpacing: 'normal', textTransform: 'none',
                  }}>
                    {stalledCount} stalled
                  </span>
                )}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setReadingSheetOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Reading
              </button>
            </div>

            {readings.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
                No readings yet. Log MC, RH, and temp to start a drying log.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {readings.slice(0, 12).map(r => {
                  // Color-code MC: green ≤ goal, amber within 2, red above
                  const mc = r.mc_pct;
                  const goal = r.drying_goal_pct;
                  let mcColor = 'var(--text-primary)';
                  if (mc != null && goal != null) {
                    if (mc <= goal) mcColor = '#16a34a';
                    else if (mc - goal <= 2) mcColor = '#d97706';
                    else mcColor = '#dc2626';
                  }
                  return (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      minHeight: 48, padding: '8px 10px',
                      borderRadius: 10, background: 'var(--bg-primary)',
                      border: '1px solid var(--border-light)',
                    }}>
                      <MaterialIcon type={r.material} size={22} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {MATERIAL_LABELS[r.material] || r.material}
                          {!r.is_affected && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 6 }}>(unaffected)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {r.room_name || 'Untagged'}
                          {r.location_description ? ` · ${r.location_description}` : ''}
                          {` · ${relativeTime(r.taken_at)}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 72 }}>
                        {mc != null ? (
                          <div style={{ fontSize: 16, fontWeight: 700, color: mcColor, fontFamily: 'var(--font-mono)' }}>
                            {mc}%
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</div>
                        )}
                        {goal != null && (
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                            goal {goal}%
                          </div>
                        )}
                      </div>
                      {r.is_stalled && (
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          padding: '2px 6px', borderRadius: 'var(--radius-full)',
                          background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                        }}>
                          STALLED
                        </span>
                      )}
                    </div>
                  );
                })}
                {readings.length > 12 && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingTop: 4 }}>
                    +{readings.length - 12} older reading{readings.length - 12 === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Equipment Placements (Phase 2, feature-gated) ──────────── */}
        {equipmentEnabled && (
          <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
            <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                Equipment
                {equipment.length > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)', letterSpacing: 'normal', textTransform: 'none', marginLeft: 6 }}>
                    {equipment.length} on-site
                  </span>
                )}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEquipmentSheetOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Place
              </button>
            </div>

            {equipment.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>
                No equipment on-site. Place dehus, air movers, or AFDs to start tracking days on-site.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {equipment.map(e => {
                  const isConfirming = confirmRemoveEquipId === e.id;
                  return (
                    <div key={e.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      minHeight: 48, padding: '8px 10px',
                      borderRadius: 10, background: 'var(--bg-primary)',
                      border: '1px solid var(--border-light)',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'var(--bg-tertiary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
                      }}>
                        {(EQUIPMENT_LABELS[e.equipment_type] || 'EQ').slice(0, 3).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {e.nickname || EQUIPMENT_LABELS[e.equipment_type] || e.equipment_type}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {e.room_name || 'Untagged'}
                          {` · Day ${(e.days_onsite || 0) + 1}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveEquipment(e.id)}
                        onBlur={() => setConfirmRemoveEquipId(null)}
                        style={{
                          minHeight: 36, minWidth: 48,
                          padding: '6px 10px',
                          fontSize: 12, fontWeight: 700,
                          border: `1px solid ${isConfirming ? '#fecaca' : 'var(--border-light)'}`,
                          borderRadius: 8,
                          background: isConfirming ? '#fef2f2' : 'var(--bg-tertiary)',
                          color: isConfirming ? '#dc2626' : 'var(--text-tertiary)',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        {isConfirming ? 'Confirm' : 'Remove'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Phase 2 sheets — mounted unconditionally so flipping the feature
            flag on doesn't require a remount. Sheets self-gate on `open`. */}
        <ReadingEntrySheet
          open={readingSheetOpen}
          onClose={() => setReadingSheetOpen(false)}
          onSave={async (payload) => {
            await handleSaveReading(payload);
            setReadingSheetOpen(false);
          }}
          jobId={jobIdForRooms}
          rooms={rooms}
          onCreateRoom={handleCreateRoom}
          equipmentList={equipment.map(e => ({
            id: e.id,
            label: e.nickname || EQUIPMENT_LABELS[e.equipment_type] || e.equipment_type,
          }))}
        />
        <EquipmentPlacementSheet
          open={equipmentSheetOpen}
          onClose={() => setEquipmentSheetOpen(false)}
          onSave={async (payload) => {
            await handlePlaceEquipment(payload);
            setEquipmentSheetOpen(false);
          }}
          jobId={jobIdForRooms}
          rooms={rooms}
          onCreateRoom={handleCreateRoom}
        />

        {/* Photo gallery — 2 columns */}
        <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--border-light)' }}>
          <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Photos</span>
            <button className="btn btn-secondary btn-sm" onClick={openPhotoCapture} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                minWidth: 48, minHeight: 48,
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

        {/* Photo note + room-tag sheet — shared with TechDash */}
        <PhotoNoteSheet
          photo={photoNoteSheet}
          rooms={rooms}
          roomsEnabled={roomsEnabled}
          currentRoomId={currentPhotoRoomId}
          onSaveNote={handleSavePhotoNote}
          onAssignRoom={handleAssignPhotoRoom}
          onCreateRoom={handleCreateRoom}
          onClose={() => setPhotoNoteSheet(null)}
        />

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

        {/* ── Water Loss Report (Phase 3, feature-gated) ───────────────── */}
        {jobIdForRooms && (
          <GenerateReportButton jobId={jobIdForRooms} jobNumber={appt.jobs?.job_number} />
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
