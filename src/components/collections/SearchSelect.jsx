/**
 * ════════════════════════════════════════════════
 * FILE: SearchSelect.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A dropdown you can type into to filter — used in the invoice/estimate builder to
 *   pick a QuickBooks "Item" or "Class" for a line without scrolling a giant list.
 *   Click it, type a few letters, pick the match. Clicking outside or pressing Escape
 *   closes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational input)
 *   Rendered by:  src/pages/InvoiceEditor.jsx, src/pages/EstimateEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom (createPortal)
 *   Internal:  ./collTokens (C palette)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Controlled: pass `value` (selected id) + `onChange(item|null)`; `options` is
 *     [{id, name}]. onChange(null) clears the selection.
 *   - The menu is PORTALED to <body> with position:fixed, anchored to the trigger via
 *     getBoundingClientRect (recomputed on scroll/resize). This is what makes it render
 *     correctly: an in-flow absolute menu was clipped by the line-items table's
 *     `overflow-x:auto` (InvoiceEditor.jsx) and by the card's rounded `overflow:hidden`.
 *     It flips ABOVE the trigger when there's more room up, and clamps to the viewport,
 *     so it shows fully near the top or bottom of the screen. Same technique as
 *     CarrierSelect / AddressAutocomplete.
 *   - Outside-click closes it, but must check BOTH the wrapper AND the portaled panel
 *     (the panel lives outside the wrapper's DOM subtree). Escape also closes.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C } from './collTokens';

export default function SearchSelect({ value, onChange, options = [], placeholder = 'Select…', disabled = false, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState(null); // measured {top|bottom, left, width, maxHeight}; null until open
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => o.id === value) || null;

  // ─── SECTION: Positioning (portaled, fixed to viewport) ──────────────
  // Anchor the menu to the trigger, flip up when there's more room above it, and keep it
  // on-screen horizontally. Fixed + portal escapes the line-items table's overflow clip.
  const recompute = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const menuW = Math.max(r.width, 220);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8));
    const below = window.innerHeight - r.bottom - gap;
    const above = r.top - gap;
    const openUp = below < 200 && above > below;
    const maxHeight = Math.max(140, Math.min(320, openUp ? above : below));
    setPos(openUp
      ? { left, width: menuW, bottom: window.innerHeight - r.top + gap, maxHeight }
      : { left, width: menuW, top: r.bottom + gap, maxHeight });
  }, []);

  // ─── SECTION: Open/close + listeners ──────────────
  useEffect(() => {
    if (!open) return undefined;
    // Position is measured in toggle() before open flips true (and re-measured on the
    // scroll/resize listeners below), so we don't setState synchronously in this effect.
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', recompute, true); // capture: also catches scroll in any ancestor
    window.addEventListener('resize', recompute);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
      clearTimeout(t);
    };
  }, [open, recompute]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.name.toLowerCase().includes(s)) : options;
  }, [q, options]);

  const pick = (item) => { onChange(item); setOpen(false); setQ(''); setHi(-1); };
  const toggle = () => { if (disabled) return; if (!open) recompute(); setOpen((o) => !o); };

  const opt = (active) => ({
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13,
    border: 'none', background: active ? C.rowHover : 'transparent', color: C.ink,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'normal',
  });

  // ─── SECTION: Render ──────────────
  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'block', minWidth: 0 }}>
      <button
        type="button" disabled={disabled} aria-label={ariaLabel}
        onClick={toggle}
        style={{
          width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px', fontSize: 13, borderRadius: 7, cursor: disabled ? 'default' : 'pointer',
          border: `1px solid ${open ? C.faint : C.inputBorder}`, background: disabled ? C.track : '#fff',
          color: selected ? C.ink : C.faint, fontFamily: 'inherit', minWidth: 0,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : (disabled ? '—' : placeholder)}
        </span>
        <span style={{ color: C.faint2, flex: 'none', fontSize: 10 }} aria-hidden="true">▾</span>
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          style={{
            position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width,
            zIndex: 9999, maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
            background: '#fff', border: `1px solid ${C.cardBorder}`, borderRadius: 10,
            boxShadow: '0 8px 28px rgba(16,24,40,.12)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: `1px solid ${C.hairline}`, flex: 'none' }}>
            <input
              ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHi(-1); }} placeholder="Search…"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: `1px solid ${C.inputBorder}`, borderRadius: 6, background: C.inputBg, color: C.ink, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {selected && (
              <button type="button" onClick={() => pick(null)} style={{ ...opt(false), color: C.muted }}>Clear selection</button>
            )}
            {filtered.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12.5, color: C.faint }}>No matches</div>}
            {filtered.map((o, i) => (
              <button
                key={o.id} type="button" onClick={() => pick(o)} onMouseEnter={() => setHi(i)}
                style={opt(i === hi || o.id === value)}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
