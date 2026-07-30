/**
 * ════════════════════════════════════════════════
 * FILE: HubDock.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The fixed bar of big buttons pinned to the bottom of the Job Hub, in the
 *   thumb zone: a giant Photo button (snaps and saves instantly, then offers an
 *   optional note), Call, Navigate, and Message (greyed out when there's no phone
 *   or address), and a "⋯" for Documents and Edit visit. It slides out of the way
 *   whenever the tech is typing, so the on-screen keyboard never covers it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z3 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/tech/PhotoNoteSheet,
 *              @/lib/toast, @/lib/nativeCamera, @/lib/nativeHaptics,
 *              @/lib/techDateUtils (openMap)
 *   Data:      reads  → none (rooms arrive as a prop)
 *              writes → job-files storage bucket + job_documents (insert_job_document
 *                        / caption update / move_photo_to_room) — online only
 *
 * NOTES / GOTCHAS:
 *   - Snap-first preserved verbatim (tech-mobile-ux law): a successful upload
 *     shows a 4s "Photo saved · Add note" toast that opens PhotoNoteSheet.
 *   - Photo upload is online-only because its two-step server contract is not
 *     idempotent; offline attempts fail before persisting any local command.
 *   - Photos always tag the SELECTED visit (appointmentId) even when the tech is
 *     clocked into a different job — explicit attribution, never silent.
 *   - The bar hides on focusin of any text input (iOS keyboard hazard).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import PhotoNoteSheet from '@/components/tech/PhotoNoteSheet';
import { toast } from '@/lib/toast';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
import { openMap } from '@/lib/techDateUtils';
// Message opens the in-app thread (see the dock button below). The offline-queue
// imports that used to sit here went with the PR's removal of the offline photo
// fork — uploadPhotoFile is online-only now and guards on navigator.onLine.
import { openJobThread } from '@/lib/openInAppThread';

/**
 * @param {{ jobId: string, appointmentId: string|null, phone?: string|null,
 *           address?: string|null, rooms: Array|null, onCreateRoom: Function,
 *           onMutation?: (kind:string)=>void }} props
 */
export default function HubDock({ jobId, appointmentId, phone, address, rooms, onCreateRoom, onMutation }) {
  const { t } = useTranslation(['hub', 'tech']);
  const { employee, db, isFeatureEnabled } = useAuth();
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');
  const navigate = useNavigate();

  const [uploading, setUploading] = useState(false);
  const [hidden, setHidden] = useState(false);       // keyboard-open → hide bar
  const [menuOpen, setMenuOpen] = useState(false);
  // MSG-05: Message resolves the job's contact on tap; block a second tap
  // from firing a second lookup while the first is still in flight.
  const [openingThread, setOpeningThread] = useState(false);
  const [photoToast, setPhotoToast] = useState(null); // { id, filePath }
  const [photoNoteSheet, setPhotoNoteSheet] = useState(null);
  const [localRooms, setLocalRooms] = useState(rooms);
  const fileRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => { setLocalRooms(rooms); }, [rooms]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Hide the docked bar while any text input has focus (keyboard would cover it).
  useEffect(() => {
    const isField = (el) => el && (el.matches?.('input, textarea, select, [contenteditable="true"]'));
    const onIn = (e) => { if (isField(e.target)) setHidden(true); };
    const onOut = () => { setHidden(false); };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut); };
  }, []);

  const uploadPhotoFile = async (file) => {
    if (!file || !jobId) return;
    if (file.size > 10 * 1024 * 1024) { toast(t('tech:toast.photoTooLarge'), 'error'); return; }
    if (!file.type.startsWith('image/')) { toast(t('tech:toast.onlyImages'), 'error'); return; }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast(
        'Photo uploads require an internet connection. Reconnect and try again.',
        'error',
      );
      return;
    }

    setUploading(true);
    try {
      const ts = Date.now();
      const path = `${jobId}/${ts}-${file.name}`;
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${db.apiKey}`, 'Content-Type': file.type }, body: file,
      });
      if (!res.ok) throw new Error('Upload failed');
      const doc = await db.rpc('insert_job_document', {
        p_job_id: jobId, p_name: file.name, p_file_path: `job-files/${path}`,
        p_mime_type: file.type, p_category: 'photo', p_uploaded_by: employee?.id || null,
        p_appointment_id: appointmentId || null,
      });
      impact('light');
      onMutation?.('photo');
      setPhotoToast({ id: doc?.id, filePath: `job-files/${path}` });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setPhotoToast(null), 4000);
    } catch (err) {
      toast(t('tech:toast.photoUploadFailed', { message: err.message }), 'error');
    } finally {
      setUploading(false);
    }
  };

  const onCaptured = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await uploadPhotoFile(f); };

  const triggerPhoto = async () => {
    if (uploading) return;
    if (isNativeCamera()) {
      try { const f = await takeNativePhoto(); if (f) await uploadPhotoFile(f); }
      catch (err) { if (!isUserCancelled(err)) toast(t('tech:toast.cameraError', { message: err.message }), 'error'); }
    } else { fileRef.current?.click(); }
  };

  const openNote = () => {
    if (!photoToast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setPhotoNoteSheet({ id: photoToast.id, filePath: photoToast.filePath, description: '' });
    setPhotoToast(null);
  };

  const saveNote = async (text) => {
    if (!photoNoteSheet?.id) return;
    await db.update('job_documents', `id=eq.${photoNoteSheet.id}`, { description: text });
    onMutation?.('doc');
  };
  const assignRoom = async (roomId) => {
    if (!photoNoteSheet?.id) return;
    await db.rpc('move_photo_to_room', { p_document_id: photoNoteSheet.id, p_room_id: roomId });
    if (jobId) setLocalRooms(await db.rpc('get_job_rooms', { p_job_id: jobId }) || []);
  };
  const createRoom = async (name) => {
    const created = await onCreateRoom?.(name);
    if (jobId) setLocalRooms(await db.rpc('get_job_rooms', { p_job_id: jobId }) || []);
    return created;
  };

  return (
    <>
      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={fileRef} onChange={onCaptured} />

      {/* Snap-first toast — sits just above the dock. */}
      {photoToast && (
        <div className="tv2-hub-phototoast" onClick={(e) => e.stopPropagation()}>
          <span>{t('tech:toast.photoSaved')}</span>
          <button type="button" className="tv2-hub-phototoast__note" onClick={openNote}>{t('dock.addNote')}</button>
        </div>
      )}

      <nav className={`tv2-hub-dock${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden}>
        <button type="button" className="tv2-hub-dock__photo" onClick={triggerPhoto} disabled={uploading}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          <span>{uploading ? t('dock.uploading') : t('dock.photo')}</span>
        </button>

        <a className={`tv2-hub-dock__btn${phone ? '' : ' is-disabled'}`} href={phone ? `tel:${phone}` : undefined} aria-disabled={!phone}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
          <span>{t('tech:actionBar.call')}</span>
        </a>

        <button type="button" className={`tv2-hub-dock__btn${address ? '' : ' is-disabled'}`} onClick={address ? () => openMap(address) : undefined} disabled={!address}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
          <span>{t('tech:actionBar.navigate')}</span>
        </button>

        {/* Opens the thread INSIDE UPR. A native sms: link here would send from the
            tech's personal number, so it would never reach the customer's UPR
            thread. The Job Hub flag is off today, so this was latent — it would
            have surfaced the moment the flag opened.
            MSG-05: resolve the job's contact on tap and open that thread directly;
            the picker stays the fallback when the job has no single clear customer. */}
        <button
          type="button"
          className={`tv2-hub-dock__btn${phone ? '' : ' is-disabled'}`}
          onClick={phone ? async () => {
            setOpeningThread(true);
            try { await openJobThread(navigate, jobId, db); }
            finally { setOpeningThread(false); }
          } : undefined}
          disabled={!phone || openingThread}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <span>{t('tech:actionBar.message')}</span>
        </button>

        <button type="button" className="tv2-hub-dock__btn" onClick={() => setMenuOpen((v) => !v)} aria-label={t('dock.more')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          <span>{t('dock.more')}</span>
        </button>
      </nav>

      {/* Overflow menu */}
      {menuOpen && (
        <div className="tv2-hub-dockmenu-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="tv2-hub-dockmenu" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => { setMenuOpen(false); navigate(`/tech/jobs/${jobId}/documents`); }}>
              {t('tech:actionBar.documents')}
            </button>
            {appointmentId && (
              <button type="button" onClick={() => { setMenuOpen(false); navigate(`/tech/appointment/${appointmentId}/edit`); }}>
                {t('dock.editVisit')}
              </button>
            )}
          </div>
        </div>
      )}

      <PhotoNoteSheet
        photo={photoNoteSheet}
        rooms={localRooms}
        roomsEnabled={roomsEnabled}
        currentRoomId={null}
        onSaveNote={saveNote}
        onAssignRoom={assignRoom}
        onCreateRoom={createRoom}
        onClose={() => setPhotoNoteSheet(null)}
      />
    </>
  );
}
