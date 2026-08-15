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
 *   Packages:  react, react-i18next
 *   Internal:  @/contexts/AuthContext, @/hooks/usePhotoUpload,
 *              @/components/tech/PhotoNoteSheet, @/lib/toast,
 *              @/lib/nativeCamera, @/lib/nativeHaptics
 *   Data:      reads  → rooms (get_job_rooms — refresh after room assign/create)
 *              writes → job-files storage bucket + job_documents (via the shared
 *                        usePhotoUpload hook / caption update / move_photo_to_room)
 *                        — online only
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
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import PhotoNoteSheet from '@/components/tech/PhotoNoteSheet';
import { toast } from '@/lib/toast';
import { isNativeCamera, openNativeCameraExperience, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';
// openMap / openJobThread went with the Navigate and Message buttons — the hero
// address row and the action bar own those now. The offline-queue imports that
// used to sit here went with the removal of the offline photo fork:
// uploadPhotoFile is online-only and guards on navigator.onLine.

/**
 * @param {{ jobId: string, appointmentId: string|null, rooms: Array|null,
 *           onCreateRoom: Function, onMutation?: (kind:string)=>void }} props
 */
export default function HubDock({ jobId, appointmentId, rooms, onCreateRoom, onMutation }) {
  const { t } = useTranslation(['hub', 'tech']);
  const { db, isFeatureEnabled } = useAuth();
  const { uploadPhoto: uploadPhotoShared } = usePhotoUpload();
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');

  const [uploading, setUploading] = useState(false);
  const [hidden, setHidden] = useState(false);       // keyboard-open → hide bar
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
      // Shared usePhotoUpload hook: compression before Storage + one upload
      // helper (perf-budget.md §2) — same path as the album surfaces.
      const doc = await uploadPhotoShared(file, { jobId, appointmentId: appointmentId || null });
      impact('light');
      onMutation?.('photo');
      setPhotoToast({ id: doc?.id, filePath: doc?.file_path });
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
      // Camera opens instantly (no chooser). Each shutter tap uploads
      // IMMEDIATELY via onCapturedFile while the camera stays open (shoot &
      // save instantly); strip/album selections resolve as files after close.
      try {
        const files = await openNativeCameraExperience({
          allowMultiple: true,
          onCapturedFile: uploadPhotoFile,
        });
        for (const f of files) await uploadPhotoFile(f);
      } catch (err) {
        if (!isUserCancelled(err)) toast(t('tech:toast.cameraError', { message: err.message }), 'error');
      }
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

      {/* Snap-first toast — sits just above the dock.
          A11Y-02 (loading-error-states.md §4): the OUTER div is the live region
          and stays mounted even when empty (TechAppointment precedent) — a live
          region announces only what is inserted INTO an already-present node.
          Keep the conditional INSIDE it. */}
      <div role="status" aria-live="polite">
      {photoToast && (
        <div className="tv2-hub-phototoast" onClick={(e) => e.stopPropagation()}>
          <span>{t('tech:toast.photoSaved')}</span>
          <button type="button" className="tv2-hub-phototoast__note" onClick={openNote}>{t('dock.addNote')}</button>
        </div>
      )}
      </div>

      <nav className={`tv2-hub-dock${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden}>
        <button type="button" className="tv2-hub-dock__photo" onClick={triggerPhoto} disabled={uploading}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          <span aria-live="polite" aria-atomic="true">{uploading ? t('dock.uploading') : t('dock.photo')}</span>
        </button>

        {/* Call / Navigate / Message / More were removed from the dock 2026-08-08.
            Every one of them now lives above the fold: Message, Docs, Notes and
            More are the action bar, and Navigate is the hero's address row. With
            the action bar carrying its own "More", the screen briefly had TWO of
            them — which is the duplication this wave exists to end.

            Photo STAYS, alone, because this is still the only camera on the Job
            Hub: PhotosNotes offers add-note only and says so ("camera lives in
            the dock"). The spec retires this bar once capture moves inside rooms
            and daily logs — deleting it before then would delete photo capture. */}
      </nav>

      {/* The overflow menu went with the buttons above: its only entries were
          Documents and Edit visit, which are now the action bar's Docs button and
          the pencil on the clock card's status line. */}

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
