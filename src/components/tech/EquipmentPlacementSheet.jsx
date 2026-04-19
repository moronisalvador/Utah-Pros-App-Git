import { useState, useEffect } from 'react';
import RoomChip from './RoomChip';
import { ROOM_TEMPLATES } from '@/pages/tech/techConstants';

/**
 * EquipmentPlacementSheet — 2-step bottom sheet for placing a piece of
 * drying equipment in a room.
 *
 * Steps:
 *   1. Type    — 2-col icon + label grid of equipment types.
 *   2. Details — room picker (RoomChip), optional nickname, optional serial.
 *
 * Parent handles the place_equipment RPC call (directly or via offline
 * queue). This component just collects data and calls onSave.
 *
 * Props:
 *   open           — boolean
 *   onClose        — () => void
 *   onSave         — async (payload) => void
 *   jobId          — string
 *   rooms          — [{id, name}] | null  (null = loading)
 *   defaultRoomId? — string (prefills but doesn't skip, since step 1 is type)
 *   onCreateRoom   — async (name) => { id, name }
 */

export const EQUIPMENT_LABELS = {
  dehu_lgr:          'LGR Dehumidifier',
  dehu_conventional: 'Conventional Dehu',
  dehu_desiccant:    'Desiccant Dehu',
  air_mover:         'Air Mover (Centrifugal)',
  air_mover_axial:   'Air Mover (Axial)',
  afd:               'AFD / Scrubber',
  hepa:              'HEPA',
  heater:            'Heater',
  other:             'Other',
};

export default function EquipmentPlacementSheet({
  open,
  onClose,
  onSave,
  jobId,
  rooms,
  defaultRoomId,
  onCreateRoom,
}) {
  const [step, setStep] = useState(1);
  const [equipmentType, setEquipmentType] = useState('');
  const [roomId, setRoomId] = useState(defaultRoomId || null);
  const [nickname, setNickname] = useState('');
  const [serial, setSerial] = useState('');
  const [saving, setSaving] = useState(false);

  // New-room sub-state
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setStep(1);
      setEquipmentType('');
      setRoomId(defaultRoomId || null);
      setNickname('');
      setSerial('');
      setSaving(false);
      setShowNewRoom(false);
      setNewRoomName('');
      setCreatingRoom(false);
    }
  }, [open, defaultRoomId]);

  const fireToast = (message, type = 'success') => {
    window.dispatchEvent(
      new CustomEvent('upr:toast', { detail: { message, type } })
    );
  };

  const handlePickType = (key) => {
    setEquipmentType(key);
    setStep(2);
  };

  const handleCreateRoom = async (nameRaw) => {
    const name = (nameRaw || '').trim();
    if (!name || creatingRoom) return;
    setCreatingRoom(true);
    try {
      const created = await onCreateRoom?.(name);
      if (created?.id) {
        setRoomId(created.id);
        fireToast('Room created', 'success');
      }
      setShowNewRoom(false);
      setNewRoomName('');
    } catch (err) {
      fireToast('Failed to create room: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!equipmentType) {
      fireToast('Pick an equipment type', 'error');
      return;
    }
    if (!roomId) {
      fireToast('Pick a room first', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave?.({
        jobId,
        roomId,
        equipment_type: equipmentType,
        nickname: nickname.trim() || null,
        serial_number: serial.trim() || null,
      });
      fireToast('Equipment placed', 'success');
      onClose?.();
    } catch (err) {
      fireToast('Failed to place equipment: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const typeKeys = Object.keys(EQUIPMENT_LABELS);
  const canSave = !!equipmentType && !!roomId;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Place equipment"
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          maxHeight: '85dvh',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        {/* Grabber + close */}
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

        {/* Title + step dots */}
        <div style={{ padding: '2px 16px 10px' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {step === 1 ? 'Pick equipment type' : 'Where is it going?'}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[1, 2].map((i) => {
              const active = i === step;
              const done = i < step;
              return (
                <span
                  key={i}
                  style={{
                    width: active ? 20 : 8,
                    height: 8,
                    borderRadius: 999,
                    background: active
                      ? 'var(--accent)'
                      : done
                        ? 'var(--accent-light)'
                        : 'var(--bg-tertiary)',
                    transition: 'all 0.15s ease-out',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 10px' }}>
          {step === 1 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
              }}
            >
              {typeKeys.map((key) => {
                const active = equipmentType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePickType(key)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 8,
                      minHeight: 80,
                      padding: '12px 14px',
                      borderRadius: 'var(--tech-radius-button, 14px)',
                      background: active ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                      color: active ? 'var(--accent)' : 'var(--text-primary)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border-light)'}`,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      textAlign: 'left',
                      touchAction: 'manipulation',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <EquipmentIcon type={key} size={24} />
                    <span style={{ lineHeight: 1.25 }}>{EQUIPMENT_LABELS[key]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <>
              {/* Room picker */}
              <SectionLabel>Room</SectionLabel>

              {!showNewRoom && (
                <>
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
                      No rooms yet. Create one to place this equipment.
                    </div>
                  )}

                  {rooms && rooms.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                        padding: '4px 0 12px',
                      }}
                    >
                      {rooms.map((r) => (
                        <RoomChip
                          key={r.id}
                          room={r}
                          selected={r.id === roomId}
                          onClick={() => setRoomId(r.id)}
                        />
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowNewRoom(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      minHeight: 48,
                      padding: '0 16px',
                      marginBottom: 16,
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

              {showNewRoom && (
                <div
                  style={{
                    padding: '12px',
                    marginBottom: 16,
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-light)',
                  }}
                >
                  <SectionLabel>Pick a common room</SectionLabel>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    {ROOM_TEMPLATES.map((name) => (
                      <button
                        key={name}
                        type="button"
                        disabled={creatingRoom}
                        onClick={() => handleCreateRoom(name)}
                        style={{
                          minHeight: 48,
                          padding: '0 12px',
                          borderRadius: 'var(--tech-radius-button, 14px)',
                          background: 'var(--bg-primary)',
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

                  <SectionLabel>Or type a custom name</SectionLabel>
                  <input
                    className="input"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="e.g. Upstairs Hallway"
                    style={{ fontSize: 16, width: '100%', marginBottom: 10 }}
                    onKeyDown={(e) => {
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
                      onClick={() => {
                        setShowNewRoom(false);
                        setNewRoomName('');
                      }}
                      disabled={creatingRoom}
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
                      Back
                    </button>
                  </div>
                </div>
              )}

              {/* Nickname */}
              <SectionLabel>Nickname (optional)</SectionLabel>
              <input
                className="input"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder='e.g. "LGR #3"'
                style={{ fontSize: 16, width: '100%', marginBottom: 12 }}
              />

              {/* Serial */}
              <SectionLabel>Serial number (optional)</SectionLabel>
              <input
                className="input"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="e.g. DRI-2045-88"
                style={{ fontSize: 16, width: '100%' }}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 16px 0',
            borderTop: '1px solid var(--border-light)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (step === 1) onClose?.();
              else setStep(1);
            }}
            disabled={saving}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer',
              padding: '0 16px',
              minHeight: 48,
              fontFamily: 'var(--font-sans)',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step === 2 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!canSave || saving}
              style={{ flex: 1, minHeight: 48, fontWeight: 700 }}
            >
              {saving ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Placing...
                </span>
              ) : (
                'Place now'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Equipment icons ────────────────────────────────────────────────────── */
/**
 * Inline SVGs matching the DivisionIcon style — stroke-based at 1.8–2 weight,
 * no fills except where color-soft accents help readability at small sizes.
 */
function EquipmentIcon({ type, size = 24, style }) {
  const s = {
    width: size,
    height: size,
    display: 'block',
    flexShrink: 0,
    ...style,
  };

  switch (type) {
    // LGR Dehu — upright box with horizontal grille, droplet inside
    case 'dehu_lgr':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="11" x2="17" y2="11" />
          <path d="M12 14c1.5 2 2 3 2 4a2 2 0 0 1 -4 0c0 -1 .5 -2 2 -4z" fill="currentColor" fillOpacity="0.3" />
        </svg>
      );

    // Conventional Dehu — upright box with horizontal grille only
    case 'dehu_conventional':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <line x1="7" y1="8"  x2="17" y2="8"  />
          <line x1="7" y1="11" x2="17" y2="11" />
          <line x1="7" y1="14" x2="17" y2="14" />
          <line x1="7" y1="17" x2="17" y2="17" />
        </svg>
      );

    // Desiccant Dehu — taller box with silica-gel dots
    case 'dehu_desiccant':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <circle cx="9"  cy="9"  r="1.1" fill="currentColor" />
          <circle cx="14" cy="10" r="1.1" fill="currentColor" />
          <circle cx="11" cy="13" r="1.1" fill="currentColor" />
          <circle cx="15" cy="15" r="1.1" fill="currentColor" />
          <circle cx="9"  cy="16" r="1.1" fill="currentColor" />
        </svg>
      );

    // Centrifugal Air Mover — round drum shape with center hub
    case 'air_mover':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 18c0 -7 4 -12 8 -12s8 5 8 12z" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="12" cy="15" r="2.5" fill="currentColor" fillOpacity="0.3" />
        </svg>
      );

    // Axial Air Mover — circle with 4 fan blades
    case 'air_mover_axial':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 12c0 -4 2 -5 4 -5 0 2 -1 4 -4 5z" fill="currentColor" fillOpacity="0.3" />
          <path d="M12 12c4 0 5 2 5 4 -2 0 -4 -1 -5 -4z" fill="currentColor" fillOpacity="0.3" />
          <path d="M12 12c0 4 -2 5 -4 5 0 -2 1 -4 4 -5z" fill="currentColor" fillOpacity="0.3" />
          <path d="M12 12c-4 0 -5 -2 -5 -4 2 0 4 1 5 4z" fill="currentColor" fillOpacity="0.3" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        </svg>
      );

    // AFD / Scrubber — cylinder with filter strata
    case 'afd':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="6" ry="2" />
          <path d="M6 5v14a6 2 0 0 0 12 0V5" />
          <line x1="6"  y1="10" x2="18" y2="10" />
          <line x1="6"  y1="14" x2="18" y2="14" />
        </svg>
      );

    // HEPA — shield/filter symbol
    case 'hepa':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l8 3v5c0 5 -3.5 8.5 -8 10 -4.5 -1.5 -8 -5 -8 -10V6z" fill="currentColor" fillOpacity="0.15" />
          <path d="M9 12l2 2 4 -4" />
        </svg>
      );

    // Heater — sun/flame radiating lines
    case 'heater':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.25" />
          <line x1="12" y1="2"  x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="4.5"  y1="4.5"  x2="6.5"  y2="6.5"  />
          <line x1="17.5" y1="17.5" x2="19.5" y2="19.5" />
          <line x1="2"  y1="12" x2="5"  y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <line x1="4.5"  y1="19.5" x2="6.5"  y2="17.5" />
          <line x1="17.5" y1="6.5"  x2="19.5" y2="4.5"  />
        </svg>
      );

    // Other — plug / socket
    case 'other':
    default:
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3v5" />
          <path d="M15 3v5" />
          <path d="M6 8h12v4a6 6 0 0 1 -12 0z" fill="currentColor" fillOpacity="0.2" />
          <path d="M12 18v4" />
        </svg>
      );
  }
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 6,
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}
