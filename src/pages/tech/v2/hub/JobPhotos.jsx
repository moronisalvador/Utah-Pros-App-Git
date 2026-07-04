/**
 * ════════════════════════════════════════════════
 * FILE: JobPhotos.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The job-wide photos and notes area at the bottom of the Job Hub. It shows
 *   every photo on the job grouped by day (Today, Yesterday, weekday, date),
 *   opens a full-screen viewer when a thumbnail is tapped, lists the job's
 *   notes, and gives the tech two big buttons: snap a photo (uploads right away,
 *   never blocks) and jot a note.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/tech/Lightbox, @/lib/toast
 *   Data:      none (docs arrive as props; capture/note handlers are passed in
 *              so the page owns the offline-vs-direct fork)
 *
 * NOTES / GOTCHAS:
 *   - Photos are job-wide (this IS one job): the whole job's photos show here,
 *     not just the selected visit's. The page's docs query is job-scoped.
 *   - "Snap-first": onAddPhoto uploads immediately; the note textarea is the
 *     optional describe-later step, never a blocking prompt.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import Lightbox from '@/components/tech/Lightbox';

// ─── SECTION: Helpers ──────────────
function groupPhotosByDate(photos) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = {};
  photos.forEach((p) => {
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
      if (d.getTime() === today.getTime()) label = 'Today';
      else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
      else if (today.getTime() - d.getTime() < 7 * 86400000) label = d.toLocaleDateString('en-US', { weekday: 'long' });
      else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return { label, items: g.items };
    });
}

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

export default function JobPhotos({ docs, db, uploading, onAddPhoto, onSaveNote }) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const photos = docs.filter((d) => d.category === 'photo');
  const notes = docs.filter((d) => d.category === 'note');

  const doSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await onSaveNote(noteText.trim());
      setNoteText('');
      setNoteOpen(false);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="tv2-hub-section">
      <div className="tech-section-header-sticky" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Photos & Notes{photos.length + notes.length > 0 ? ` (${photos.length + notes.length})` : ''}</span>
      </div>

      {photos.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>No photos yet</div>
      ) : (
        groupPhotosByDate(photos).map((group) => (
          <div key={group.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>{group.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {group.items.map((p) => {
                const idx = photos.findIndex((x) => x.id === p.id);
                return (
                  <div key={p.id}>
                    <div
                      onClick={() => setLightboxIndex(idx)}
                      style={{ aspectRatio: '1', borderRadius: 12, background: 'var(--bg-tertiary)', overflow: 'hidden', border: '1px solid var(--border-light)', cursor: 'pointer' }}
                    >
                      <img
                        src={`${db.baseUrl}/storage/v1/object/public/${p.file_path}`}
                        alt={p.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    {p.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.3 }}>{p.description}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Notes */}
      {notes.length > 0 && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: 14, color: 'var(--text-primary)' }}>
              <div>{n.description || n.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{relativeTime(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      {noteOpen && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-primary)' }}>
          <textarea
            className="input textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="What do you want to note?"
            rows={3}
            autoFocus
            style={{ width: '100%', fontSize: 16, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { setNoteOpen(false); setNoteText(''); }} disabled={savingNote}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={doSaveNote} disabled={!noteText.trim() || savingNote}>
              {savingNote ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={onAddPhoto}
          disabled={uploading}
          style={{
            flex: 1, minHeight: 'var(--tech-min-tap, 48px)', borderRadius: 12,
            background: 'var(--accent)', color: '#fff', border: 'none',
            cursor: uploading ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent', opacity: uploading ? 0.7 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          {uploading ? 'Uploading…' : 'Add Photo'}
        </button>
        <button
          type="button"
          onClick={() => { setNoteOpen(true); setNoteText(''); }}
          disabled={noteOpen}
          style={{
            flex: 1, minHeight: 'var(--tech-min-tap, 48px)', borderRadius: 12,
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            border: '1px solid var(--border-color)', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent', opacity: noteOpen ? 0.5 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Add Note
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
    </div>
  );
}
