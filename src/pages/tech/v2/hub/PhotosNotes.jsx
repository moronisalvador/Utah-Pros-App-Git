/**
 * ════════════════════════════════════════════════
 * FILE: PhotosNotes.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The photos-and-notes zone at the bottom of the Job Hub. It shows the job's
 *   photos grouped by day (the visit you're looking at first, then the rest of
 *   the job), tops out at a dozen thumbnails with a "See all" link to the full
 *   album, and lists the job's written notes. Tapping a photo opens the
 *   full-screen viewer with an "Add note / room" button; there's also a plain
 *   "Add note" box for jotting a quick note. Capturing new photos happens on the
 *   docked camera button, not here — this zone is for looking back and annotating.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z4 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/hub/HubBelowFold.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/components/tech/Lightbox,
 *              @/components/tech/PhotoNoteSheet, @/lib/techQuery (techKeys),
 *              @/lib/techDateUtils (fileUrl), @/lib/toast,
 *              @/lib/syncRunnerSingleton, ./hubHelpers (buildDocsQuery)
 *   Data:      reads  → job_documents (job-wide, via buildDocsQuery)
 *              writes → job_documents (insert_job_document note; description
 *                        update + move_photo_to_room via PhotoNoteSheet)
 *
 * NOTES / GOTCHAS:
 *   - Docs cache under the ['tech','hub',jobId] prefix so any photo/doc mutation
 *     (or a synced offline photo) repaints them via invalidateTech.
 *   - A sync:item-done listener (photo.upload, keyed to this job) refreshes the
 *     gallery the moment a queued photo finishes uploading — parity with the dock.
 *   - The Lightbox is a frozen shared component with no action slot, so the
 *     "Add note / room" button is rendered as a sibling overlay above it.
 *   - Inline notes tag the SELECTED visit (appointmentId) so they group with it.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import Lightbox from '@/components/tech/Lightbox';
import PhotoNoteSheet from '@/components/tech/PhotoNoteSheet';
import { techKeys } from '@/lib/techQuery';
import { fileUrl } from '@/lib/techDateUtils';
import { toast } from '@/lib/toast';
import { getSyncRunner } from '@/lib/syncRunnerSingleton';
import { buildDocsQuery } from './hubHelpers.js';

const PHOTO_CAP = 12;

// ─── SECTION: Helpers ──────────────
// Group a pre-sorted photo list by calendar day → [{ key, date, items }] (newest first).
function groupByDay(photos) {
  const groups = new Map();
  photos.forEach((p) => {
    const d = new Date(p.created_at);
    if (Number.isNaN(d.getTime())) { d.setTime(0); }
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups.has(key)) groups.set(key, { key, date: d, items: [] });
    groups.get(key).items.push(p);
  });
  return [...groups.values()];
}

function dayLabel(date, t, lang) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = today.getTime() - d.getTime();
  if (diff === 0) return t('photos.today');
  if (diff === 86400000) return t('photos.yesterday');
  if (diff > 0 && diff < 7 * 86400000) return d.toLocaleDateString(lang, { weekday: 'long' });
  return d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relLabel(isoStr, t) {
  if (!isoStr) return '';
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.minutesAgo', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('time.hoursAgo', { n: hrs });
  const days = Math.floor(hrs / 24);
  if (days === 1) return t('time.yesterday');
  return t('time.daysAgo', { n: days });
}

/**
 * @param {{ jobId: string, appointmentId?: string|null, rooms: Array|null,
 *           onCreateRoom: Function, onMutation?: (kind:string)=>void }} props
 */
export default function PhotosNotes({ jobId, appointmentId, rooms, onCreateRoom, onMutation }) {
  const { t, i18n } = useTranslation('hub');
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');

  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [sheetPhoto, setSheetPhoto] = useState(null);
  const [localRooms, setLocalRooms] = useState(rooms);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => { setLocalRooms(rooms); }, [rooms]);

  // ── Docs (job-wide, cache-first under the hub prefix) ──
  const docsQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'docs', jobId],
    queryFn: () => db.select('job_documents', buildDocsQuery({ jobId })),
    enabled: !!jobId,
  });
  const docs = Array.isArray(docsQuery.data) ? docsQuery.data : [];

  // Reload the gallery when a queued photo for THIS job finishes syncing.
  useEffect(() => {
    const runner = getSyncRunner();
    if (!runner) return undefined;
    return runner.on('sync:item-done', ({ item }) => {
      if (item?.type !== 'photo.upload') return;
      if (item?.payload?.jobId && item.payload.jobId !== jobId) return;
      onMutation?.('photo');
    });
  }, [jobId, onMutation]);

  // Photos: selected-visit first, then the rest, each newest-first (spec order).
  const photos = docs
    .filter((d) => d.category === 'photo' && d.file_path)
    .sort((a, b) => {
      const aSel = appointmentId && a.appointment_id === appointmentId ? 0 : 1;
      const bSel = appointmentId && b.appointment_id === appointmentId ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  const notes = docs
    .filter((d) => d.category === 'note')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const shown = photos.slice(0, PHOTO_CAP);
  const overflow = photos.length - shown.length;
  const groups = groupByDay(shown);

  const openSheetForCurrent = useCallback(() => {
    const p = photos[lightboxIndex];
    if (!p) return;
    setSheetPhoto({ id: p.id, filePath: p.file_path, description: p.description || '', roomId: p.room_id || null });
    setLightboxIndex(null); // close the viewer so the sheet (same z-index) sits cleanly on top
  }, [photos, lightboxIndex]);

  const saveSheetNote = async (text) => {
    if (!sheetPhoto?.id) return;
    await db.update('job_documents', `id=eq.${sheetPhoto.id}`, { description: text });
    onMutation?.('doc');
  };
  const assignRoom = async (roomId) => {
    if (!sheetPhoto?.id) return;
    await db.rpc('move_photo_to_room', { p_document_id: sheetPhoto.id, p_room_id: roomId });
    if (jobId) setLocalRooms(await db.rpc('get_job_rooms', { p_job_id: jobId }) || []);
    onMutation?.('room');
  };
  const createRoom = async (name) => {
    const created = await onCreateRoom?.(name);
    if (jobId) setLocalRooms(await db.rpc('get_job_rooms', { p_job_id: jobId }) || []);
    return created;
  };

  const saveInlineNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setSavingNote(true);
    try {
      await db.rpc('insert_job_document', {
        p_job_id: jobId, p_name: 'Field note', p_file_path: '', p_mime_type: 'text/plain',
        p_category: 'note', p_uploaded_by: employee?.id || null,
        p_description: text, p_appointment_id: appointmentId || null,
      });
      onMutation?.('doc');
      setNoteText('');
      setNoteOpen(false);
      toast(t('toast.noteSaved'));
    } catch (err) {
      toast(t('toast.noteSaveFailed', { message: err?.message || '' }), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const total = photos.length + notes.length;

  return (
    <section className="tv2-hub-section">
      <div className="tv2-hub-section__head">
        <span className="tv2-hub-section__title">
          {t('below.photos')}
          {total > 0 && <span className="tv2-hub-section__count">{total}</span>}
        </span>
        {(overflow > 0 || total > 0) && (
          <button type="button" className="tv2-hub-linkbtn" onClick={() => navigate(`/tech/jobs/${jobId}/photos`)}>
            {t('photos.seeAll')}
          </button>
        )}
      </div>

      {/* Gallery grouped by day. */}
      {photos.length === 0 ? (
        <div className="tv2-hub-empty">{t('photos.noPhotos')}</div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="tv2-hub-photogroup">
            <div className="tv2-hub-photogroup__label">{dayLabel(g.date, t, i18n.language)}</div>
            <div className="tv2-hub-photogrid">
              {g.items.map((p) => {
                const idx = photos.findIndex((x) => x.id === p.id);
                return (
                  <button type="button" key={p.id} className="tv2-hub-thumb" onClick={() => setLightboxIndex(idx)}>
                    <img src={fileUrl(db, p.file_path)} alt={p.description || p.name || ''} loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0.2'; }} />
                    {p.description && <span className="tv2-hub-thumb__cap">{p.description}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
      {overflow > 0 && (
        <button type="button" className="tv2-hub-photomore" onClick={() => navigate(`/tech/jobs/${jobId}/photos`)}>
          {t('photos.moreCount', { count: overflow })}
        </button>
      )}

      {/* Notes. */}
      {notes.length > 0 && (
        <div className="tv2-hub-notelist">
          {notes.map((n) => (
            <div key={n.id} className="tv2-hub-noteitem">
              <div className="tv2-hub-noteitem__text">{n.description || n.name}</div>
              <div className="tv2-hub-noteitem__meta">{relLabel(n.created_at, t)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Inline add-note (the plain describe-later path; camera lives in the dock). */}
      {noteOpen ? (
        <div className="tv2-hub-noteform">
          <textarea
            className="tv2-hub-noteform__input"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t('photos.notePlaceholder')}
            rows={3}
            autoFocus
          />
          <div className="tv2-hub-noteform__actions">
            <button type="button" className="tv2-hub-addrow__cancel" onClick={() => { setNoteOpen(false); setNoteText(''); }} disabled={savingNote}>
              {t('common.cancel')}
            </button>
            <button type="button" className="tv2-hub-addrow__save" onClick={saveInlineNote} disabled={!noteText.trim() || savingNote}>
              {savingNote ? t('photos.saving') : t('photos.saveNote')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="tv2-hub-addbtn" onClick={() => { setNoteOpen(true); setNoteText(''); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          {t('photos.addNote')}
        </button>
      )}

      {/* Full-screen viewer + its "Add note / room" action (Lightbox has no slot). */}
      {lightboxIndex !== null && (
        <>
          <Lightbox photos={photos} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onIndex={(i) => setLightboxIndex(i)} db={db} />
          <button type="button" className="tv2-hub-lightbox-action" onClick={openSheetForCurrent}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            {roomsEnabled ? t('photos.addNoteRoom') : t('photos.addNote')}
          </button>
        </>
      )}

      <PhotoNoteSheet
        photo={sheetPhoto}
        rooms={localRooms}
        roomsEnabled={roomsEnabled}
        currentRoomId={sheetPhoto?.roomId || null}
        onSaveNote={saveSheetNote}
        onAssignRoom={assignRoom}
        onCreateRoom={createRoom}
        onClose={() => setSheetPhoto(null)}
      />
    </section>
  );
}
