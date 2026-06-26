/**
 * ════════════════════════════════════════════════
 * FILE: SearchSelect.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A dropdown you can type into to filter — used in the invoice builder to pick a
 *   QuickBooks "Item" or "Class" for a line without scrolling a giant list. Click it,
 *   type a few letters, pick the match. Clicking outside or pressing Escape closes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational input)
 *   Rendered by:  src/pages/InvoiceEditor.jsx (any builder needing a searchable pick)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collTokens (C palette)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Controlled: pass `value` (selected id) + `onChange(item|null)`; `options` is
 *     [{id, name}]. onChange(null) clears the selection.
 *   - Closes on outside-click / Escape (same pattern as collKit's PopoverButton).
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from './collTokens';

export default function SearchSelect({ value, onChange, options = [], placeholder = 'Select…', disabled = false, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(-1);
  const ref = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => o.id === value) || null;

  // ─── SECTION: Event handlers ──────────────
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.name.toLowerCase().includes(s)) : options;
  }, [q, options]);

  const pick = (item) => { onChange(item); setOpen(false); setQ(''); setHi(-1); };

  const opt = (active) => ({
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13,
    border: 'none', background: active ? C.rowHover : 'transparent', color: C.ink,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'normal',
  });

  // ─── SECTION: Render ──────────────
  return (
    <span ref={ref} style={{ position: 'relative', display: 'block', minWidth: 0 }}>
      <button
        type="button" disabled={disabled} aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
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

      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, minWidth: 220,
            background: '#fff', border: `1px solid ${C.cardBorder}`, borderRadius: 10,
            boxShadow: '0 8px 28px rgba(16,24,40,.12)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: `1px solid ${C.hairline}` }}>
            <input
              ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHi(-1); }} placeholder="Search…"
              style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: `1px solid ${C.inputBorder}`, borderRadius: 6, background: C.inputBg, color: C.ink, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
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
        </div>
      )}
    </span>
  );
}
