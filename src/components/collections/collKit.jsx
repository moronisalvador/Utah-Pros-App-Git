/**
 * ════════════════════════════════════════════════
 * FILE: collKit.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The reusable visual building blocks for the "My Money / Collections" page —
 *   the white card, the KPI tile, the black-pill toggles (segmented controls),
 *   the search box, the buttons, the status pills, the little division color
 *   square, progress bars, and the pop-down Filters and Columns menus. Every tab
 *   (A/R, Invoices, Estimates, Payments) is assembled from these so the page looks
 *   like one product. Colors + formatters come from collTokens.js next door.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational kit)
 *   Rendered by:  src/pages/Collections.jsx + src/components/collections/*
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collTokens (palette + formatters)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This file exports ONLY components (helpers live in collTokens.js) so React
 *     Fast Refresh stays happy.
 *   - Interactive states (hover/active/focus) are in the `.coll-*` CSS in
 *     index.css; this file styles structure inline + via those classes.
 *   - PopoverButton owns its own open state and closes on outside-click / Escape;
 *     pass the panel body as children (or a (close) => … render function).
 * ════════════════════════════════════════════════
 */

import { useEffect, useRef, useState } from 'react';
import { C, STATUS, divColor } from './collTokens';

// ─── SECTION: Card + KPIs ──────────────
export function CollCard({ children, pad = 18, style, className = '' }) {
  return <section className={`coll-card ${className}`} style={{ padding: pad, ...style }}>{children}</section>;
}

export function KpiGrid({ cols = 4, children }) {
  // Column count via a modifier class (not inline) so the responsive media query
  // in index.css can collapse it to 2-up / 1-up on narrow screens.
  return <div className={`coll-kpi-grid coll-kpi-${cols}`}>{children}</div>;
}

// One KPI tile: uppercase label → big value → context line (any node). Pass
// onClick to make it a clickable quick-filter; `active` draws the selected ring.
export function Kpi({ label, value, valueColor = C.ink, children, onClick, active = false }) {
  const clickable = typeof onClick === 'function';
  const interactive = clickable
    ? { role: 'button', tabIndex: 0, onClick, 'aria-pressed': active,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } }
    : {};
  return (
    <section
      className={`coll-card coll-kpi${clickable ? ' coll-kpi-click' : ''}${active ? ' coll-kpi-active' : ''}`}
      {...interactive}
    >
      <div className="coll-kpi-label">{label}</div>
      <div className="coll-kpi-main">
        <div className="coll-kpi-value" style={{ color: valueColor }}>{value}</div>
        {children != null && <div className="coll-kpi-ctx">{children}</div>}
      </div>
    </section>
  );
}

// ─── SECTION: Controls (segmented, search, buttons) ──────────────
// One segmented control for the section tabs, the period switch, and the status
// filters. Black-fill active treatment; size tunes padding/font inline.
export function SegControl({ options, value, onChange, size = 'md', ariaLabel }) {
  const pad = size === 'lg' ? '7px 14px' : size === 'sm' ? '5px 11px' : '6px 13px';
  const fs = size === 'lg' ? 12.5 : size === 'sm' ? 12 : 12.5;
  const radius = size === 'lg' ? 7 : 6;
  return (
    <div className="coll-seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const active = val === value;
        return (
          <button key={val} type="button" role="tab" aria-selected={active}
            className={`coll-seg-btn${active ? ' active' : ''}`}
            style={{ padding: pad, fontSize: fs, borderRadius: radius }}
            onClick={() => onChange(val)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, style }) {
  return (
    <div className="coll-search" style={style}>
      <span className="coll-search-ico" aria-hidden="true">⌕</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function GhostButton({ children, onClick, leftIcon, style, title }) {
  return (
    <button type="button" className="coll-ghost" onClick={onClick} style={style} title={title}>
      {leftIcon}{children}
    </button>
  );
}

export function PrimaryButton({ children, onClick, style }) {
  return <button type="button" className="coll-primary" onClick={onClick} style={style}>{children}</button>;
}

// ─── SECTION: Badges, squares, bars, pills ──────────────
export function Pill({ children, color, bg, border, style }) {
  return (
    <span className="coll-pill" style={{ color, background: bg, border: border ? `1px solid ${border}` : undefined, ...style }}>
      {children}
    </span>
  );
}

// Status badge for invoice rows — maps a status word to the right semantic colors.
const BADGE = {
  paid:    { label: 'PAID',    ...STATUS.success },
  partial: { label: 'PARTIAL', ...STATUS.warning },
  overdue: { label: 'OVERDUE', ...STATUS.danger },
  draft:   { label: 'DRAFT',   ...STATUS.neutral },
  sent:    { label: 'SENT',    ...STATUS.info },
  open:    { label: 'OPEN',    ...STATUS.info },
};
export function StatusBadge({ kind }) {
  const s = BADGE[kind] || BADGE.draft;
  return <Pill color={s.text} bg={s.tint} border={s.border} style={{ letterSpacing: '.04em' }}>{s.label}</Pill>;
}

export function DivisionSquare({ division, size = 9 }) {
  return <span style={{ width: size, height: size, borderRadius: 3, background: divColor(division), flex: 'none', display: 'inline-block' }} />;
}

export function ProgressBar({ pct = 0, color = STATUS.success.solid, track = C.track, height = 4, radius = 999 }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ width: '100%', height, background: track, borderRadius: radius, overflow: 'hidden' }}>
      <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: radius }} />
    </div>
  );
}

export function EmptyState({ icon = '📄', title, sub }) {
  return (
    <div className="coll-empty">
      <span className="coll-empty-ico" aria-hidden="true">{icon}</span>
      <div className="coll-empty-title">{title}</div>
      {sub && <div className="coll-empty-sub">{sub}</div>}
    </div>
  );
}

// ─── SECTION: Inline SVG icons (no icon library, per the design system) ──────────────
export function FunnelIcon({ size = 14, color = C.faint }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="17" x2="14" y2="17" />
    </svg>
  );
}
export function ColumnsIcon({ size = 14, color = C.faint }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="6" height="16" rx="1" /><rect x="11" y="4" width="6" height="16" rx="1" opacity="0.5" />
    </svg>
  );
}
export function MapPin({ size = 11, color = C.faint2 }) {
  return (
    <svg width={size * 0.82} height={size} viewBox="0 0 12 14" fill="none" stroke={color} strokeWidth="1.3" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M6 13c3-3.2 4.5-5.6 4.5-7.7A4.5 4.5 0 0 0 6 1a4.5 4.5 0 0 0-4.5 4.3C1.5 7.4 3 9.8 6 13Z" />
      <circle cx="6" cy="5.3" r="1.5" />
    </svg>
  );
}

// ─── SECTION: Pop-down menus — Filters + Columns ──────────────
// A right-anchored popover that closes on outside-click / Escape. `label`+`icon`
// render the trigger (styled like a ghost button); `children` is the panel body
// (or a (close) => … render function).
export function PopoverButton({ label, icon, count = 0, width = 280, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span className="coll-pop-wrap" ref={ref}>
      <button type="button" className={`coll-ghost${open ? ' coll-ghost-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        {icon}{label}
        {count > 0 && <span className="coll-count-badge">{count}</span>}
      </button>
      {open && (
        <div className="coll-popover" style={{ width }} role="dialog">
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </span>
  );
}

// A labeled group inside a filter panel.
export function FilterGroup({ label, children }) {
  return (
    <div className="coll-filter-group">
      <div className="coll-filter-label">{label}</div>
      {children}
    </div>
  );
}

// A small toggle chip used inside the Filters panel (e.g. divisions, sync state).
export function ToggleChip({ active, onClick, children, swatch }) {
  return (
    <button type="button" className={`coll-chip${active ? ' active' : ''}`} onClick={onClick}>
      {swatch && <span style={{ width: 9, height: 9, borderRadius: 3, background: swatch, flex: 'none' }} />}
      {children}
    </button>
  );
}
