/**
 * ════════════════════════════════════════════════
 * FILE: PhotoCaptureButton.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Photo" button a tech taps from the dashboard hero to snap a jobsite
 *   photo. It uploads the moment the photo is taken — the tech is never blocked
 *   by a required note or form (snap-first). Right after saving, a small green
 *   "Photo saved" toast offers an optional "Add note" link, which opens a sheet
 *   to add a caption and (if the rooms feature is on) tag the photo to a room.
 *   This is the exact field-photo flow from the v1 dashboard, packaged as one
 *   reusable button for the v2 hero.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (button used inside the v2 dashboard hero)
 *   Rendered by:  src/pages/tech/v2/dash/NowNextHero.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/components/tech/PhotoNoteSheet,
 *              @/lib/toast, @/lib/nativeCamera, @/lib/nativeHaptics,
 *              @/hooks/useOfflineQueue, @/lib/offlineDb, @/lib/syncRunnerSingleton
 *   Data:      reads  → rooms (get_job_rooms)
 *              writes → job-files storage bucket (direct REST upload),
 *                        job_documents (insert_job_document + a direct caption
 *                        update), rooms (move_photo_to_room / create_room)
 *
 * NOTES / GOTCHAS:
 *   - Two upload paths, identical to v1: an offline-queue path (gated by the
 *     'offline:queue' flag — stores the blob in IndexedDB and enqueues a sync
 *     job) and the default inline path (uploads to Storage, then records via
 *     insert_job_document). Snap-first: neither blocks the camera flow.
 *   - onUploaded() is the caller's cache-invalidation hook (photo mutation) — it
 *     replaces v1's onReload full refetch.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import PhotoNoteSheet from '@/components/tech/PhotoNoteSheet';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { savePhotoBlob } from '@/lib/offlineDb';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';

/**
 * @param {{ job: object, appointmentId: string, employee: object, db: object,
 *           onUploaded?: () => void }} props
 */
export default function PhotoCaptureButton({ job, appointmentId, employee, db, onUploaded }) {
  const { t } = useTranslation(['dash', 'tech']);
  const { isFeatureEnabled } = useAuth();
  const { enqueue } = useOfflineQueue();
  const offlineQueueEnabled = isFeatureEnabled('offline:queue');
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');
  const [uploading, setUploading] = useState(false);
  const [photoToast, setPhotoToast] = useState(null); // { id, filePath }
  const [photoNoteSheet, setPhotoNoteSheet] = useState(null); // { id, filePath, description? }
  const [rooms, setRooms] = useState(null);
  const fileRef = useRef(null);
  const photoToastTimer = useRef(null);

  useEffect(() => () => { if (photoToastTimer.current) clearTimeout(photoToastTimer.current); }, []);

  // Load rooms for this job when the rooms flag is on (for photo → room tagging).
  useEffect(() => {
    if (!roomsEnabled || !job?.id) { setRooms(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const r = await db.rpc('get_job_rooms', { p_job_id: job.id });
        if (!cancelled) setRooms(r || []);
      } catch {
        if (!cancelled) setRooms([]);
      }
    })();
    return () => { cancelled = true; };
  }, [roomsEnabled, job?.id, db]);

  const uploadPhotoFile = async (file) => {
    if (!file || !job) return;
    if (file.size > 10 * 1024 * 1024) { toast(t('tech:toast.photoTooLarge'), 'error'); return; }
    if (!file.type.startsWith('image/')) { toast(t('tech:toast.onlyImages'), 'error'); return; }

    // ── Offline-queue path (gated) ────────────────────────────────────────
    if (offlineQueueEnabled) {
      try {
        const clientId = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random()}`;
        await savePhotoBlob(clientId, {
          blob: file, mimeType: file.type, name: file.name,
          jobId: job.id, appointmentId, uploadedBy: employee?.id || null,
          roomId: null, description: null,
        });
        await enqueue({
          type: 'photo.upload',
          clientId,
          payload: { clientId, jobId: job.id, appointmentId, roomId: null, description: null, name: file.name },
        });
        impact('light');
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          toast(t('tech:toast.photoQueued'), 'success');
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
        p_appointment_id: appointmentId,
      });
      if (onUploaded) onUploaded();
      impact('light');
      setPhotoToast({ id: doc?.id, filePath: `job-files/${path}` });
      if (photoToastTimer.current) clearTimeout(photoToastTimer.current);
      photoToastTimer.current = setTimeout(() => setPhotoToast(null), 4000);
    } catch (err) {
      toast(t('tech:toast.photoUploadFailed', { message: err.message }), 'error');
    } finally {
      setUploading(false);
    }
  };

  // Reload the dashboard when a queued photo for this appointment finishes.
  useEffect(() => {
    if (!offlineQueueEnabled) return undefined;
    const runner = getSyncRunner();
    if (!runner) return undefined;
    return runner.on('sync:item-done', ({ item }) => {
      if (item?.type !== 'photo.upload') return;
      if (item?.payload?.appointmentId !== appointmentId) return;
      if (onUploaded) onUploaded();
    });
  }, [offlineQueueEnabled, appointmentId, onUploaded]);

  const handlePhotoCaptured = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await uploadPhotoFile(file);
  };

  const openPhotoCapture = async () => {
    if (uploading) return;
    if (isNativeCamera()) {
      try {
        const file = await takeNativePhoto();
        if (file) await uploadPhotoFile(file);
      } catch (err) {
        if (!isUserCancelled(err)) toast(t('tech:toast.cameraError', { message: err.message }), 'error');
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

  const handleSavePhotoNote = async (text) => {
    if (!photoNoteSheet?.id) return;
    await db.update('job_documents', `id=eq.${photoNoteSheet.id}`, { description: text });
  };

  const handleAssignPhotoRoom = async (roomId) => {
    if (!photoNoteSheet?.id) return;
    await db.rpc('move_photo_to_room', { p_document_id: photoNoteSheet.id, p_room_id: roomId });
    if (job?.id) setRooms(await db.rpc('get_job_rooms', { p_job_id: job.id }) || []);
  };

  const handleCreateRoom = async (name) => {
    if (!job?.id) throw new Error('Job not loaded');
    const created = await db.rpc('create_room', {
      p_job_id: job.id, p_name: name,
      p_created_by: employee?.id, p_client_id: crypto?.randomUUID?.() || null,
    });
    setRooms(await db.rpc('get_job_rooms', { p_job_id: job.id }) || []);
    return created;
  };

  return (
    <>
      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={fileRef} onChange={handlePhotoCaptured} />
      <button
        type="button"
        className="tv2-dash-secondary-btn"
        onClick={openPhotoCapture}
        disabled={uploading}
        data-busy={uploading ? 'true' : undefined}
      >
        {uploading ? t('uploadingBtn') : t('photoBtn')}
      </button>

      {/* Fixed photo-saved toast — above the bottom nav */}
      {photoToast && (
        <div className="tv2-dash-photo-toast" onClick={(e) => e.stopPropagation()}>
          <span className="tv2-dash-photo-toast__label">{t('tech:toast.photoSaved')}</span>
          <button type="button" className="tv2-dash-photo-toast__note" onClick={openPhotoNoteSheet}>
            {t('addNoteLink')}
          </button>
        </div>
      )}

      <PhotoNoteSheet
        photo={photoNoteSheet}
        rooms={rooms}
        roomsEnabled={roomsEnabled}
        currentRoomId={null}
        onSaveNote={handleSavePhotoNote}
        onAssignRoom={handleAssignPhotoRoom}
        onCreateRoom={handleCreateRoom}
        onClose={() => setPhotoNoteSheet(null)}
      />
    </>
  );
}
