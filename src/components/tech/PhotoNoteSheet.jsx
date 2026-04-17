import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ROOM_TEMPLATES } from '@/pages/tech/techConstants';
import RoomChip from './RoomChip';

/**
 * PhotoNoteSheet — shared bottom-sheet for adding a note and/or assigning a
 * photo to a room. Extracted from the duplicated inline sheets in
 * TechAppointment.jsx and TechDash.jsx.
 *
 * Props:
 *   photo            — { id, filePath, description? } | null   (null = closed)
 *   rooms            — [{ id, name, photo_count? }] | null     (null while loading)
 *   roomsEnabled     — boolean (page:tech_rooms feature flag)
 *   currentRoomId    — string | null   (currently assigned room)
 *   onSaveNote       — async (text) => void
 *   onAssignRoom     — async (roomId) => void
 *   onCreateRoom     — async (name)   => { id, name }
 *   onClose          — () => void
 */
export default function PhotoNoteSheet({
  photo,
  rooms,
  roomsEnabled = false,
  currentRoomId = null,
  onSaveNote,
  onAssignRoom,
  onCreateRoom,
  onClose,
}) {
  const { db } = useAuth();

  // Internal state
  const [tab, setTab] = useState('note');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [assigningId, setAssigningId] = useState(null); // room id currently being assigned
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Reset local state each time a new photo is opened.
  useEffect(() => {
    if (photo) {
      setTab('note');
      setNoteText(photo.description || '');
      setShowNewRoom(false);
      setNewRoomName('');
      setAssigningId(null);
      setSavingNote(false);
      setCreatingRoom(false);
    }
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumbUrl = useMemo(() => {
    if (!photo?.filePath || !db?.baseUrl) return null;
    return `${db.baseUrl}/storage/v1/object/public/${photo.filePath}`;
  }, [photo?.filePath, db?.baseUrl]);

  if (!photo) return null;

  const initialDescription = photo.description || '';
  const noteDirty = noteText.trim() !== initialDescription.trim();

  const fireToast = (message, type = 'success') => {
    window.dispatchEvent(
      new CustomEvent('upr:toast', { detail: { message, type } })
    );
  };

  const handleSaveNote = async () => {
    if (!noteDirty || savingNote) return;
    setSavingNote(true);
    try {
      await onSaveNote?.(noteText.trim());
      fireToast(initialDescription ? 'Note updated' : 'Note added', 'success');
      onClose?.();
    } catch (err) {
      fireToast('Failed to save note: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handleAssignRoom = async (roomId) => {
    if (assigningId) return;
    setAssigningId(roomId);
    try {
      await onAssignRoom?.(roomId);
      fireToast('Photo tagged to room', 'success');
      onClose?.();
    } catch (err) {
      fireToast('Failed to assign room: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setAssigningId(null);
    }
  };

  const handleCreateRoom = async (nameRaw) => {
    const name = (nameRaw || '').trim();
    if (!name || creatingRoom) return;
    setCreatingRoom(true);
    try {
      const created = await onCreateRoom?.(name);
      if (created?.id) {
        fireToast('Room created', 'success');
        // Auto-assign freshly-created room
        await onAssignRoom?.(created.id);
        onClose?.();
      } else {
        fireToast('Room created', 'success');
        setShowNewRoom(false);
        setNewRoomName('');
      }
    } catch (err) {
      fireToast('Failed to create room: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setCreatingRoom(false);
    }
  };

  const currentRoomName = (() => {
    if (!rooms || !currentRoomId) return null;
    const r = rooms.find(x => x.id === currentRoomId);
    return r?.name || null;
  })();

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Photo note and room"
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          maxHeight: '70dvh',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        {/* Header: grabber + close */}
        <div style={{ position: 'relative', padding: '10px 16px 4px' }}>
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: 'var(--border-color)',
              margin: '0 auto 4px',
            }}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 4,
              right: 8,
              width: 40,
              height: 40,
              minWidth: 40,
              minHeight: 40,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              padding: 0,
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ✕
          </button>
        </div>

        {/* Thumbnail row */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '4px 16px 8px',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--bg-tertiary)',
              flexShrink: 0,
              border: '1px solid var(--border-light)',
            }}
          >
            {thumbUrl && (
              <img
                src={thumbUrl}
                alt="Photo"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                marginBottom: 2,
              }}
            >
              Photo
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {initialDescription || 'No description yet'}
            </div>
          </div>
        </div>

        {/* Tabs (only when rooms enabled) */}
        {roomsEnabled && (
          <div
            style={{
              display: 'flex',
              padding: '0 16px',
              borderBottom: '1px solid var(--border-light)',
              gap: 4,
            }}
          >
            <TabButton active={tab === 'note'} onClick={() => setTab('note')}>Note</TabButton>
            <TabButton active={tab === 'room'} onClick={() => setTab('room')}>Room</TabButton>
          </div>
        )}

        {/* Content area — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 4px' }}>
          {/* NOTE TAB */}
          {(!roomsEnabled || tab === 'note') && (
            <>
              <textarea
                className="input textarea"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="What's in this photo?"
                autoFocus
                rows={4}
                style={{
                  fontSize: 16,
                  width: '100%',
                  minHeight: 96,
                  marginBottom: 12,
                  fontFamily: 'var(--font-sans)',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveNote}
                  disabled={savingNote || !noteDirty}
                  style={{ flex: 1, minHeight: 48, fontWeight: 700 }}
                >
                  {savingNote ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} />
                      Saving...
                    </span>
                  ) : (
                    'Save note'
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '0 12px',
                    minHeight: 48,
                    fontFamily: 'var(--font-sans)',
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* ROOM TAB */}
          {roomsEnabled && tab === 'room' && (
            <>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  marginBottom: 8,
                }}
              >
                Currently:{' '}
                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                  {currentRoomName || 'Untagged'}
                </span>
              </div>

              {!showNewRoom && (
                <>
                  {/* Existing rooms — loading */}
                  {rooms === null && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 0',
                        fontSize: 13,
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      <span className="spinner" style={{ width: 14, height: 14 }} />
                      Loading rooms...
                    </div>
                  )}

                  {/* Existing rooms — empty */}
                  {rooms && rooms.length === 0 && (
                    <div
                      style={{
                        padding: '12px 14px',
                        marginBottom: 12,
                        background: 'var(--bg-secondary)',
                        border: '1px dashed var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      No rooms yet. Create one to start organizing photos by area.
                    </div>
                  )}

                  {/* Existing rooms — list */}
                  {rooms && rooms.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        overflowX: 'auto',
                        padding: '4px 0 12px',
                        marginBottom: 4,
                        WebkitOverflowScrolling: 'touch',
                      }}
                    >
                      {rooms.map(r => (
                        <RoomChip
                          key={r.id}
                          room={r}
                          selected={r.id === currentRoomId}
                          onClick={() => handleAssignRoom(r.id)}
                          style={{
                            opacity: assigningId && assigningId !== r.id ? 0.5 : 1,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* + New room button */}
                  <button
                    type="button"
                    onClick={() => setShowNewRoom(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      minHeight: 48,
                      padding: '0 16px',
                      marginTop: 4,
                      borderRadius: 'var(--tech-radius-button, 14px)',
                      background: 'var(--bg-tertiary)',
                      color: 'var(--accent)',
                      border: '1px solid var(--border-light)',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      touchAction: 'manipulation',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    New room
                  </button>
                </>
              )}

              {/* New room inline view */}
              {showNewRoom && (
                <>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Pick a common room
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    {ROOM_TEMPLATES.map(name => (
                      <button
                        key={name}
                        type="button"
                        disabled={creatingRoom}
                        onClick={() => handleCreateRoom(name)}
                        style={{
                          minHeight: 48,
                          padding: '0 12px',
                          borderRadius: 'var(--tech-radius-button, 14px)',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-light)',
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: creatingRoom ? 'wait' : 'pointer',
                          fontFamily: 'var(--font-sans)',
                          touchAction: 'manipulation',
                          WebkitTapHighlightColor: 'transparent',
                          opacity: creatingRoom ? 0.6 : 1,
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Or type a custom name
                  </div>
                  <input
                    className="input"
                    value={newRoomName}
                    onChange={e => setNewRoomName(e.target.value)}
                    placeholder="e.g. Upstairs Hallway"
                    style={{ fontSize: 16, width: '100%', marginBottom: 12 }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newRoomName.trim()) {
                        e.preventDefault();
                        handleCreateRoom(newRoomName);
                      }
                    }}
                  />

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleCreateRoom(newRoomName)}
                      disabled={creatingRoom || !newRoomName.trim()}
                      style={{ flex: 1, minHeight: 48, fontWeight: 700 }}
                    >
                      {creatingRoom ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span className="spinner" style={{ width: 14, height: 14 }} />
                          Creating...
                        </span>
                      ) : (
                        'Create'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowNewRoom(false); setNewRoomName(''); }}
                      disabled={creatingRoom}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: creatingRoom ? 'wait' : 'pointer',
                        padding: '0 12px',
                        minHeight: 48,
                        fontFamily: 'var(--font-sans)',
                        touchAction: 'manipulation',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Small internal tab button ─────────────────────────────────────────── */
function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 48,
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        padding: '10px 4px',
        marginBottom: -1,
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </button>
  );
}
