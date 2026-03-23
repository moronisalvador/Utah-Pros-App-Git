import { useState, useEffect, useRef } from 'react';

const OOP = '__oop__';

/**
 * CarrierSelect — searchable combobox for insurance carriers
 *
 * Props:
 *   value        string  — carrier name | OOP sentinel | '' (unselected)
 *   onChange     fn      — called with new value string
 *   carriers     array   — [{ id, name }] from get_insurance_carriers RPC
 *   onAdd        fn      — async (name: string) => void  — called to persist a new carrier to DB
 *   required     bool    — shows red border + hint when empty
 *   height       number  — input height in px (default 34)
 */
export const OOP_VALUE = OOP;

export default function CarrierSelect({ value, onChange, carriers = [], onAdd, required = false, height = 34 }) {
  const [query,    setQuery]    = useState('');
  const [open,     setOpen]     = useState(false);
  const [adding,   setAdding]   = useState(false);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);

  // Display text shown in the input
  const displayText = value === OOP
    ? '💵 Out of pocket / No insurance'
    : value || '';

  // Filtered carrier list based on query
  const filtered = query.trim()
    ? carriers.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : carriers;

  // Whether the typed query exactly matches an existing carrier (case-insensitive)
  const exactMatch = carriers.some(c => c.name.toLowerCase() === query.trim().toLowerCase());
  const canAdd     = query.trim().length > 1 && !exactMatch && query.trim() !== OOP;

  // Close on outside click
  useEffect(() => {
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const openDropdown = () => {
    setQuery('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const select = (val) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const handleAdd = async () => {
    const name = query.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await onAdd(name);
      onChange(name);
      setOpen(false);
      setQuery('');
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    if (e.key === 'Enter' && canAdd) { e.preventDefault(); handleAdd(); }
  };

  const isEmpty    = !value;
  const borderColor = isEmpty && required ? '#fca5a5' : 'var(--border-color)';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Trigger / display input */}
      {!open ? (
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
      ) : (
        /* Search input — shown while open */
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className="input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to search..."
            style={{ paddingLeft: 32, height, fontSize: 13, width: '100%', borderColor }}
          />
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
          zIndex: 50, maxHeight: 260, overflowY: 'auto',
        }}>
          {/* OOP — always at top */}
          <DropItem
            label="💵 Out of pocket / No insurance"
            active={value === OOP}
            onClick={() => select(OOP)}
            style={{ borderBottom: '1px solid var(--border-light)' }}
          />

          {/* Filtered carriers */}
          {filtered.length === 0 && !canAdd && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>
              No carriers found
            </div>
          )}
          {filtered.map(c => (
            <DropItem key={c.id} label={c.name} active={value === c.name} onClick={() => select(c.name)} />
          ))}

          {/* Add new carrier option */}
          {canAdd && (
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 12px', border: 'none', borderTop: '1px solid var(--border-light)',
                background: '#f0fdf4', cursor: adding ? 'wait' : 'pointer',
                fontFamily: 'var(--font-sans)', textAlign: 'left',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                {adding ? 'Adding…' : `Add "${query.trim()}" as new carrier`}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DropItem({ label, active, onClick, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 12px', border: 'none',
        background: active ? 'var(--bg-secondary)' : 'transparent',
        cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
        fontSize: 13, color: 'var(--text-primary)',
        ...style,
      }}
    >
      <span>{label}</span>
      {active && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </button>
  );
}
