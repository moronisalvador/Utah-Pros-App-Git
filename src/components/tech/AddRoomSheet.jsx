/**
 * ════════════════════════════════════════════════
 * FILE: AddRoomSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A slide-up panel for adding a new room to a claim. The tech either taps one
 *   of the common room names (Kitchen, Bathroom, etc.) or types a custom name,
 *   and the room is created. Rooms are shared across every job on the claim.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bottom sheet)
 *   Rendered by:  src/pages/tech/TechClaimDetail.jsx (create room from the grid)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/pages/tech/techConstants (ROOM_TEMPLATES list), @/lib/toast
 *   Data:      reads  → none
 *              writes → none directly — the parent's onCreate callback performs
 *                        the create_room / create_room_for_claim RPC (writes
 *                        rooms)
 *
 * NOTES / GOTCHAS:
 *   - Common room names already on the claim are filtered out of the template
 *     grid (case-insensitive) via the existingNames prop.
 *   - Props: open, onClose, onCreate(name) => { id, name }, existingNames[].
 *   - Toasts via @/lib/toast (ok/err) — never alert()/confirm().
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { ok, err } from '@/lib/toast';
import { useDialogLifecycle } from '@/lib/useDialogLifecycle';
import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset';
import { ROOM_TEMPLATES } from '@/pages/tech/techConstants';

export default function AddRoomSheet({ open, onClose, onCreate, existingNames = [] }) {
  const kbInset = useNativeKeyboardInset();
  // MODAL-01: focus trap, focus return, Escape, aria-modal — the same
  // contract Modal.jsx provides, without restructuring this sheet's markup.
  const panelRef = useRef(null);
  const dialogProps = useDialogLifecycle({ open, onClose, panelRef });
  // ─── SECTION: State & hooks ──────────────
  const [creating, setCreating] = useState(false);
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    if (open) {
      setCustomName('');
      setCreating(false);
    }
  }, [open]);

  if (!open) return null;

  const existingSet = new Set((existingNames || []).map(n => n?.toLowerCase().trim()));
  const availableTemplates = ROOM_TEMPLATES.filter(
    (t) => !existingSet.has(t.toLowerCase().trim())
  );

  // ─── SECTION: Event handlers ──────────────
  const handleCreate = async (nameRaw) => {
    const name = (nameRaw || '').trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await onCreate?.(name);
      ok(`Room "${name}" added`);
      onClose?.();
    } catch (e) {
      err('Failed to create room: ' + (e?.message || 'unknown error'));
    } finally {
      setCreating(false);
    }
  };

  // ─── SECTION: Render ──────────────
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
        // KB-03: lift the whole sheet clear of the on-screen keyboard.
        // 0 on web, where the hook attaches nothing (PWA unchanged).
        paddingBottom: kbInset || undefined,
        justifyContent: 'center',
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        ref={panelRef}
        {...dialogProps}
        aria-label="Add a room"
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          // KB-03: '100%' of the OVERLAY's content box, which is already
          // 100dvh - kbInset because the overlay reserves the keyboard with
          // paddingBottom (index.css sets border-box globally). Subtracting
          // kbInset from the dvh cap here as well double-counted the keyboard:
          // on a 17 Pro Max that only wasted space, but on an iPhone 17 and
          // smaller it pushed this sheet's primary button below the fold.
          maxHeight: kbInset > 0 ? '100%' : '80dvh',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: kbInset > 0 ? 12 : 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        {/* Grabber */}
        <div style={{ padding: '10px 16px 4px', position: 'relative' }}>
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: 'var(--border-color)',
              margin: '0 auto',
            }}
          />
        </div>

        <div style={{ padding: '4px 16px 10px' }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 4,
            }}
          >
            Add a room
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            Rooms are shared across every job on this claim.
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 4px' }}>
          {availableTemplates.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  margin: '8px 0',
                }}
              >
                Common rooms
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                {availableTemplates.map((name) => (
                  <button
                    key={name}
                    type="button"
                    disabled={creating}
                    onClick={() => handleCreate(name)}
                    style={{
                      minHeight: 48,
                      padding: '0 12px',
                      borderRadius: 'var(--tech-radius-button, 14px)',
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-light)',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: creating ? 'wait' : 'pointer',
                      fontFamily: 'var(--font-sans)',
                      touchAction: 'manipulation',
                      WebkitTapHighlightColor: 'transparent',
                      opacity: creating ? 0.6 : 1,
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}

          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 6,
            }}
          >
            Or type a custom name
          </div>
          <input
            className="input"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            placeholder="e.g. Upstairs Hallway"
            autoFocus={availableTemplates.length === 0}
            disabled={creating}
            style={{
              fontSize: 16,
              width: '100%',
              marginBottom: 12,
              boxSizing: 'border-box',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && customName.trim()) {
                e.preventDefault();
                handleCreate(customName);
              }
            }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleCreate(customName)}
              disabled={creating || !customName.trim()}
              style={{ flex: 1, minHeight: 48, fontWeight: 700 }}
            >
              {creating ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Creating...
                </span>
              ) : (
                'Create room'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: 14,
                fontWeight: 600,
                cursor: creating ? 'wait' : 'pointer',
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
        </div>
      </div>
    </div>
  );
}
