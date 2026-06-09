import { useState, useEffect, useRef, useMemo } from 'react';
import RoomChip from './RoomChip';
import MaterialIcon, { MATERIAL_LABELS } from './MaterialIcon';
import { ROOM_TEMPLATES } from '@/pages/tech/techConstants';
import { calcGPP, calcDewPoint } from '@/lib/psychrometric';

/**
 * ReadingEntrySheet — multi-step bottom sheet for logging a moisture reading.
 *
 * Steps:
 *   1. Room       — pick existing chip or create new.   Skipped if defaultRoomId.
 *   2. Material   — 2-col tile grid of material types.
 *   3. Readings   — MC % (required), RH %, Temp °F with live GPP/Dew point.
 *   4. Details    — affected toggle, location text, equipment dropdown, notes.
 *
 * Parent handles the actual RPC (insert_reading or offline queue). This
 * component only collects data and calls onSave with the payload.
 *
 * Props:
 *   open           — boolean
 *   onClose        — () => void
 *   onSave         — async (payload) => void
 *   jobId          — string
 *   rooms          — [{id, name, photo_count?}] | null  (null = loading)
 *   defaultRoomId? — string   (when set, step 1 is skipped)
 *   onCreateRoom   — async (name) => { id, name }
 *   equipmentList  — [{id, label}]  for the optional equipment dropdown
 */
export default function ReadingEntrySheet({
  open,
  onClose,
  onSave,
  jobId,
  rooms,
  defaultRoomId,
  onCreateRoom,
  equipmentList = [],
}) {
  // ── Step + internal state ────────────────────────────────────────────────
  const firstStep = defaultRoomId ? 2 : 1;
  const [step, setStep] = useState(firstStep);

  const [roomId, setRoomId] = useState(defaultRoomId || null);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);

  const [material, setMaterial] = useState('');

  const [mc, setMc] = useState('');
  const [rh, setRh] = useState('');
  const [tempF, setTempF] = useState('');

  const [isAffected, setIsAffected] = useState(true);
  const [location, setLocation] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);

  // Reset when sheet opens
  useEffect(() => {
    if (open) {
      setStep(defaultRoomId ? 2 : 1);
      setRoomId(defaultRoomId || null);
      setShowNewRoom(false);
      setNewRoomName('');
      setCreatingRoom(false);
      setMaterial('');
      setMc('');
      setRh('');
      setTempF('');
      setIsAffected(true);
      setLocation('');
      setEquipmentId('');
      setNotes('');
      setSaving(false);
    }
  }, [open, defaultRoomId]);

  // Auto-focus MC % when entering step 3
  const mcInputRef = useRef(null);
  useEffect(() => {
    if (open && step === 3) {
      // Tiny defer so the transition doesn't fight focus
      const t = setTimeout(() => mcInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, step]);

  // ── Derived values ───────────────────────────────────────────────────────
  const rhNum   = rh === '' ? NaN : parseFloat(rh);
  const tempNum = tempF === '' ? NaN : parseFloat(tempF);
  const mcNum   = mc === '' ? NaN : parseFloat(mc);

  const gpp = useMemo(() => {
    if (!Number.isFinite(rhNum) || !Number.isFinite(tempNum)) return null;
    const v = calcGPP(tempNum, rhNum);
    return Number.isFinite(v) ? v : null;
  }, [rhNum, tempNum]);

  const dewPoint = useMemo(() => {
    if (!Number.isFinite(rhNum) || !Number.isFinite(tempNum)) return null;
    const v = calcDewPoint(tempNum, rhNum);
    return Number.isFinite(v) ? v : null;
  }, [rhNum, tempNum]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fireToast = (message, type = 'success') => {
    window.dispatchEvent(
      new CustomEvent('upr:toast', { detail: { message, type } })
    );
  };

  const totalSteps = 4;

  const canAdvance = () => {
    if (step === 1) return !!roomId;
    if (step === 2) return !!material;
    if (step === 3) return Number.isFinite(mcNum);
    return true;
  };

  const handleBack = () => {
    if (step === firstStep) {
      onClose?.();
      return;
    }
    setStep((s) => Math.max(firstStep, s - 1));
  };

  const handleNext = () => {
    if (!canAdvance()) return;
    setStep((s) => Math.min(totalSteps, s + 1));
  };

  const handlePickRoom = (id) => {
    setRoomId(id);
    // Auto-advance
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
        setShowNewRoom(false);
        setNewRoomName('');
        setStep(2);
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

  const handlePickMaterial = (key) => {
    setMaterial(key);
    setStep(3);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!Number.isFinite(mcNum)) {
      fireToast('Enter a moisture content (MC %)', 'error');
      return;
    }
    if (!roomId) {
      fireToast('Pick a room first', 'error');
      return;
    }
    if (!material) {
      fireToast('Pick a material', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        jobId,
        roomId,
        material,
        location: location.trim() || null,
        mc: mcNum,
        rh: Number.isFinite(rhNum) ? rhNum : null,
        temp_f: Number.isFinite(tempNum) ? tempNum : null,
        gpp: gpp ?? null,
        dew_point: dewPoint ?? null,
        is_affected: !!isAffected,
        equipment_id: equipmentId || null,
        notes: notes.trim() || null,
      };
      await onSave?.(payload);
      fireToast('Reading saved', 'success');
      onClose?.();
    } catch (err) {
      fireToast('Failed to save reading: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  // Materials in display order (keys come straight from MATERIAL_LABELS).
  const materialKeys = Object.keys(MATERIAL_LABELS);

  // ── Render ───────────────────────────────────────────────────────────────
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
        aria-label="Add moisture reading"
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          maxHeight: '88dvh',
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
            {stepTitle(step)}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {Array.from({ length: totalSteps }).map((_, i) => {
              const active = i + 1 === step;
              const done   = i + 1 < step;
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

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 10px' }}>
          {/* STEP 1 — ROOM */}
          {step === 1 && (
            <StepRoom
              rooms={rooms}
              roomId={roomId}
              onPickRoom={handlePickRoom}
              showNewRoom={showNewRoom}
              setShowNewRoom={setShowNewRoom}
              newRoomName={newRoomName}
              setNewRoomName={setNewRoomName}
              onCreateRoom={handleCreateRoom}
              creatingRoom={creatingRoom}
            />
          )}

          {/* STEP 2 — MATERIAL */}
          {step === 2 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                marginBottom: 4,
              }}
            >
              {materialKeys.map((key) => {
                const active = material === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePickMaterial(key)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 8,
                      minHeight: 72,
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
                    <MaterialIcon type={key} size={22} />
                    <span>{MATERIAL_LABELS[key]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* STEP 3 — READINGS */}
          {step === 3 && (
            <StepReadings
              mc={mc} setMc={setMc}
              rh={rh} setRh={setRh}
              tempF={tempF} setTempF={setTempF}
              mcInputRef={mcInputRef}
              gpp={gpp}
              dewPoint={dewPoint}
            />
          )}

          {/* STEP 4 — DETAILS */}
          {step === 4 && (
            <StepDetails
              isAffected={isAffected}
              setIsAffected={setIsAffected}
              location={location}
              setLocation={setLocation}
              equipmentId={equipmentId}
              setEquipmentId={setEquipmentId}
              equipmentList={equipmentList}
              notes={notes}
              setNotes={setNotes}
            />
          )}
        </div>

        {/* Footer — Back + Next/Save */}
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
            onClick={handleBack}
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
            {step === firstStep ? 'Cancel' : 'Back'}
          </button>

          {step < totalSteps && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleNext}
              disabled={!canAdvance()}
              style={{ flex: 1, minHeight: 48, fontWeight: 700 }}
            >
              Next
            </button>
          )}
          {step === totalSteps && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !Number.isFinite(mcNum)}
              style={{ flex: 1, minHeight: 48, fontWeight: 700 }}
            >
              {saving ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Saving...
                </span>
              ) : (
                'Save reading'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Internal helpers ───────────────────────────────────────────────────── */

function stepTitle(step) {
  switch (step) {
    case 1: return 'Pick a room';
    case 2: return 'Pick a material';
    case 3: return 'Enter readings';
    case 4: return 'Details';
    default: return '';
  }
}

/* ── STEP 1: Room picker ────────────────────────────────────────────────── */
function StepRoom({
  rooms,
  roomId,
  onPickRoom,
  showNewRoom,
  setShowNewRoom,
  newRoomName,
  setNewRoomName,
  onCreateRoom,
  creatingRoom,
}) {
  if (showNewRoom) {
    return (
      <>
        <SectionLabel>Pick a common room</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}
        >
          {ROOM_TEMPLATES.map((name) => (
            <button
              key={name}
              type="button"
              disabled={creatingRoom}
              onClick={() => onCreateRoom(name)}
              style={templateButtonStyle(creatingRoom)}
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
          style={{ fontSize: 16, width: '100%', marginBottom: 12 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newRoomName.trim()) {
              e.preventDefault();
              onCreateRoom(newRoomName);
            }
          }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onCreateRoom(newRoomName)}
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
            style={ghostButtonStyle}
          >
            Back
          </button>
        </div>
      </>
    );
  }

  return (
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
          No rooms yet. Create one to log this reading.
        </div>
      )}

      {rooms && rooms.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            padding: '4px 0 12px',
            marginBottom: 4,
          }}
        >
          {rooms.map((r) => (
            <RoomChip
              key={r.id}
              room={r}
              selected={r.id === roomId}
              onClick={() => onPickRoom(r.id)}
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
  );
}

/* ── STEP 3: Numeric readings + live GPP/Dew point ──────────────────────── */
function StepReadings({ mc, setMc, rh, setRh, tempF, setTempF, mcInputRef, gpp, dewPoint }) {
  return (
    <>
      <LabeledNumberInput
        label="MC %"
        sublabel="required"
        value={mc}
        onChange={setMc}
        placeholder="14.2"
        inputRef={mcInputRef}
        accent
      />

      <LabeledNumberInput
        label="RH %"
        sublabel="optional"
        value={rh}
        onChange={setRh}
        placeholder="58"
      />

      <LabeledNumberInput
        label="Temp °F"
        sublabel="optional"
        value={tempF}
        onChange={setTempF}
        placeholder="72"
      />

      {/* Live psych readout */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 4,
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)',
          fontSize: 13,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}
          >
            GPP
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {gpp == null ? '—' : gpp.toFixed(1)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}
          >
            Dew point
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {dewPoint == null ? '—' : `${dewPoint.toFixed(1)}°F`}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '10px 12px',
          background: 'var(--accent-light)',
          border: '1px solid #bfdbfe',
          borderRadius: 'var(--radius-md)',
          color: 'var(--accent)',
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        MC % is the material moisture content (e.g., 14.2 on drywall).
      </div>
    </>
  );
}

/* ── STEP 4: Details ────────────────────────────────────────────────────── */
function StepDetails({
  isAffected, setIsAffected,
  location, setLocation,
  equipmentId, setEquipmentId,
  equipmentList,
  notes, setNotes,
}) {
  return (
    <>
      {/* Affected toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)',
          marginBottom: 12,
          minHeight: 48,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Affected area
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Mark if this material shows damage/elevated moisture.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isAffected}
          onClick={() => setIsAffected((v) => !v)}
          style={{
            position: 'relative',
            width: 52,
            height: 32,
            minWidth: 52,
            minHeight: 32,
            borderRadius: 999,
            background: isAffected ? 'var(--accent)' : 'var(--bg-tertiary)',
            border: `1px solid ${isAffected ? 'var(--accent)' : 'var(--border-color)'}`,
            cursor: 'pointer',
            padding: 0,
            transition: 'all 0.15s ease-out',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: isAffected ? 23 : 3,
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              transition: 'left 0.15s ease-out',
            }}
          />
        </button>
      </div>

      {/* Location */}
      <SectionLabel>Location (optional)</SectionLabel>
      <input
        className="input"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder='e.g. "South wall 18in from floor"'
        style={{ fontSize: 16, width: '100%', marginBottom: 12 }}
      />

      {/* Equipment dropdown */}
      <SectionLabel>Linked equipment (optional)</SectionLabel>
      <select
        className="input"
        value={equipmentId}
        onChange={(e) => setEquipmentId(e.target.value)}
        style={{
          fontSize: 16,
          width: '100%',
          marginBottom: 12,
          minHeight: 48,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <option value="">None</option>
        {equipmentList.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>

      {/* Notes */}
      <SectionLabel>Notes (optional)</SectionLabel>
      <textarea
        className="input textarea"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything the next tech should know"
        rows={3}
        style={{
          fontSize: 16,
          width: '100%',
          minHeight: 72,
          fontFamily: 'var(--font-sans)',
        }}
      />
    </>
  );
}

/* ── Small leaf helpers ─────────────────────────────────────────────────── */

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

function LabeledNumberInput({ label, sublabel, value, onChange, placeholder, inputRef, accent }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: accent ? 'var(--accent)' : 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
        {sublabel && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {sublabel}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        className="input"
        type="text"
        inputMode="decimal"
        pattern="[0-9.]*"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          // Allow empty, digits, single decimal
          if (v === '' || /^\d*\.?\d*$/.test(v)) onChange(v);
        }}
        placeholder={placeholder}
        style={{
          fontSize: 22,
          width: '100%',
          minHeight: 56,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          padding: '0 16px',
        }}
      />
    </div>
  );
}

function templateButtonStyle(disabled) {
  return {
    minHeight: 48,
    padding: '0 12px',
    borderRadius: 'var(--tech-radius-button, 14px)',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-light)',
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'wait' : 'pointer',
    fontFamily: 'var(--font-sans)',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    opacity: disabled ? 0.6 : 1,
  };
}

const ghostButtonStyle = {
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
};
