import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const OOP = '__oop__';

/**
 * CarrierSelect — searchable combobox for insurance carriers
 *
 * Desktop: inline dropdown under the input
 * Mobile (≤768px): full-screen bottom sheet with sticky search + scrollable list
 *
 * Props:
 *   value     string  — carrier name | OOP sentinel | '' (unselected)
 *   onChange  fn      — called with new value string
 *   carriers  array   — [{ id, name }] from get_insurance_carriers RPC
 *   onAdd     fn      — async (name) => void — persists a new carrier
 *   required  bool    — red border when empty
 *   height    number  — input height in px (default 34)
 */
export const OOP_VALUE = OOP;

export default function CarrierSelect({ value, onChange, carriers = [], onAdd, required = false, height = 34 }) {
  const [query,  setQuery]  = useState('');
  const [open,   setOpen]   = useState(false);
  const [adding, setAdding] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  const wrapRef   = useRef(null);
  const inputRef  = useRef(null);
  const panelRef  = useRef(null);

  const displayText = value === OOP ? '💵 Out of pocket / No insurance' : value || '';

  const filtered = query.trim()
    ? carriers.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : carriers;
  const exactMatch = carriers.some(c => c.name.toLowerCase() === query.trim().toLowerCase());
  const canAdd = query.trim().length > 1 && !exactMatch && query.trim() !== OOP;

  // Live breakpoint tracking (orientation change, resize)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onMQ = e => setIsMobile(e.matches);
    mq.addEventListener('change', onMQ);
    return () => mq.removeEventListener('change', onMQ);
  }, []);

  // Position the desktop dropdown under the trigger; recompute on scroll/resize
  const recomputePos = useCallback(() => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);
  useEffect(() => {
    if (!open || isMobile) return;
    recomputePos();
    window.addEventListener('scroll', recomputePos, true);
    window.addEventListener('resize', recomputePos);
    return () => {
      window.removeEventListener('scroll', recomputePos, true);
      window.removeEventListener('resize', recomputePos);
    };
  }, [open, isMobile, recomputePos]);

  // Body scroll lock while the mobile sheet is open
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, isMobile]);

  // Outside-click close — checks both wrapper and panel (panel is portaled)
  useEffect(() => {
    if (!open || isMobile) return;
    const h = e => {
      const inWrap  = wrapRef.current?.contains(e.target);
      const inPanel = panelRef.current?.contains(e.target);
      if (!inWrap && !inPanel) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, isMobile]);

  // Auto-focus search input when opening
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), isMobile ? 200 : 0);
    return () => clearTimeout(t);
  }, [open, isMobile]);

  const openDropdown = () => { setQuery(''); setOpen(true); };
  const close = () => { setOpen(false); setQuery(''); };
  const select = (val) => { onChange(val); close(); };

  const handleAdd = async () => {
    const name = query.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await onAdd(name);
      onChange(name);
      close();
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && canAdd) { e.preventDefault(); handleAdd(); }
  };

  const isEmpty     = !value;
  const borderColor = isEmpty && required ? '#fca5a5' : 'var(--border-color)';

  // ── Trigger ────────────────────────────────────────────────────────────────
  const trigger = (
    <button
      type="button"
      onClick={openDropdown}
      style={{
        width: '100%', height, display: 'flex', alignItems: 'center',
        padding: '0 10px', background: 'var(--bg-primary)',
        border: `1px solid ${borderColor}`, borderRadius: 'var(--radius-md)',
        cursor: 'pointer', fontFamily: 'var(--font-sans)',
        fontSize: 13, textAlign: 'left', gap: 6,
        color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value ? displayText : 'Search carriers...'}
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  );

  // ── List body (shared by desktop & mobile panels) ──────────────────────────
  const listBody = (
    <>
      <DropItem
        label="💵 Out of pocket / No insurance"
        active={value === OOP}
        onClick={() => select(OOP)}
        style={{ borderBottom: '1px solid var(--border-light)' }}
      />
      {filtered.length === 0 && !canAdd && (
        <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
          No carriers found
        </div>
      )}
      {filtered.map(c => (
        <DropItem key={c.id} label={c.name} active={value === c.name} onClick={() => select(c.name)} />
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: isMobile ? '14px 16px' : '9px 12px', border: 'none',
            borderTop: '1px solid var(--border-light)',
            background: '#f0fdf4', cursor: adding ? 'wait' : 'pointer',
            fontFamily: 'var(--font-sans)', textAlign: 'left',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span style={{ fontSize: isMobile ? 15 : 13, color: '#16a34a', fontWeight: 600 }}>
            {adding ? 'Adding…' : `Add "${query.trim()}" as new carrier`}
          </span>
        </button>
      )}
    </>
  );

  // ── Desktop dropdown (portal) ──────────────────────────────────────────────
  const desktopPanel = open && !isMobile && typeof document !== 'undefined' && createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width,
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        zIndex: 9999, maxHeight: 320, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Inline search input inside dropdown */}
      <div style={{ position: 'relative', padding: 8, borderBottom: '1px solid var(--border-light)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef} className="input" value={query}
          onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="Type to search..."
          style={{ paddingLeft: 32, height, fontSize: 13, width: '100%' }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        {listBody}
      </div>
    </div>,
    document.body
  );

  // ── Mobile bottom sheet (portal) ───────────────────────────────────────────
  const mobilePanel = open && isMobile && typeof document !== 'undefined' && createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex', alignItems: 'flex-end',
      }}
      onClick={close}
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: '85dvh',
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
      >
        {/* Grabber */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-color)' }} />
        </div>

        {/* Header + close */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 16px 12px', borderBottom: '1px solid var(--border-light)',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            Insurance Carrier
          </div>
          <button type="button" onClick={close} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 8, margin: -8,
            color: 'var(--text-secondary)', fontSize: 15, fontWeight: 600,
          }}>Cancel</button>
        </div>

        {/* Sticky search */}
        <div style={{ padding: 12, position: 'relative', borderBottom: '1px solid var(--border-light)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search carriers…"
            inputMode="search"
            autoCapitalize="words"
            autoCorrect="off"
            style={{
              width: '100%', height: 44, paddingLeft: 38, paddingRight: 12,
              fontSize: 16, fontFamily: 'var(--font-sans)',
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', outline: 'none',
            }}
          />
        </div>

        {/* Scrollable list — overscroll-behavior prevents page scroll chaining */}
        <div style={{
          flex: 1, overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
        }}>
          {listBody}
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <div ref={wrapRef} style={{ position: 'relative' }}>{trigger}</div>
      {desktopPanel}
      {mobilePanel}
    </>
  );
}

function DropItem({ label, active, onClick, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', border: 'none',
        background: active ? 'var(--bg-secondary)' : 'transparent',
        cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
        fontSize: 15, color: 'var(--text-primary)',
        minHeight: 48,
        ...style,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {active && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </button>
  );
}
