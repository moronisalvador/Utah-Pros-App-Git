/**
 * ════════════════════════════════════════════════
 * FILE: ActionMenu.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Manage ▾" dropdown in the top bar of the invoice & estimate builders —
 *   a little menu that tucks away the less-common actions (like "Revert to draft"
 *   or "Delete") so the main toolbar stays clean, the same way QuickBooks does it.
 *   Dangerous actions ask for a second click to confirm before they run.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational control)
 *   Rendered by:  src/pages/InvoiceEditor.jsx · src/pages/EstimateEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collTokens (C palette + STATUS colors)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - `items` is [{ key, label, onSelect, confirm?, confirmLabel?, danger?, show? }].
 *     `show:false` hides an item; if nothing is left to show, the whole menu renders
 *     nothing. `confirm:true` makes it a two-click action (first click arms it).
 *   - Owns its own open + confirm state; closes (and disarms) on outside-click /
 *     Escape (same pattern as collKit's PopoverButton + SearchSelect).
 * ════════════════════════════════════════════════
 */
import { useEffect, useRef, useState } from 'react';
import { C, STATUS } from './collTokens';

export default function ActionMenu({ label = 'Manage', items = [] }) {
  const visible = items.filter((it) => it.show !== false);
  const [open, setOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState(null);
  const [hoverKey, setHoverKey] = useState(null);
  const ref = useRef(null);

  // ─── SECTION: Event handlers ──────────────
  useEffect(() => {
    if (!open) return undefined;
    const reset = () => { setOpen(false); setConfirmKey(null); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) reset(); };
    const onKey = (e) => { if (e.key === 'Escape') reset(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!visible.length) return null;

  const choose = (it) => {
    if (it.confirm && confirmKey !== it.key) { setConfirmKey(it.key); return; }
    setOpen(false); setConfirmKey(null);
    it.onSelect?.();
  };

  // ─── SECTION: Render ──────────────
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button" className={`coll-ghost${open ? ' coll-ghost-open' : ''}`}
        onClick={() => { setOpen((o) => !o); setConfirmKey(null); }} aria-haspopup="menu" aria-expanded={open}
      >
        {label} <span aria-hidden="true" style={{ fontSize: 10, color: C.faint2, marginLeft: 1 }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: 200,
            background: '#fff', border: `1px solid ${C.cardBorder}`, borderRadius: 10,
            boxShadow: '0 8px 28px rgba(16,24,40,.12)', overflow: 'hidden', padding: 4,
          }}
        >
          {visible.map((it) => {
            const armed = it.confirm && confirmKey === it.key;
            const hovered = hoverKey === it.key;
            const danger = it.danger || armed;
            return (
              <button
                key={it.key} type="button" role="menuitem"
                onClick={() => choose(it)}
                onMouseEnter={() => setHoverKey(it.key)} onMouseLeave={() => setHoverKey(null)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13,
                  fontWeight: 600, border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  background: armed ? STATUS.danger.tint : hovered ? C.rowHover : 'transparent',
                  color: danger ? STATUS.danger.text : C.ink,
                }}
              >
                {armed ? (it.confirmLabel || `Confirm — ${it.label}`) : it.label}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
