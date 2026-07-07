/**
 * ════════════════════════════════════════════════
 * FILE: CatalogPicker.jsx  (Admin Mobile — QBO item/class picker, P4b)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A phone-friendly picker for choosing a QuickBooks Item or Class on an
 *   estimate line. Tap the field and a search box with a scrollable list opens
 *   right there on the card (no popup), so you don't lose your place. Type to
 *   narrow the list, tap to choose, or tap "Clear" to remove the choice. Built
 *   for gloved hands: every row is a big touch target.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a form control)
 *   Rendered by:  src/components/admin-mobile/estimate/LineItemCard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      reads → none · writes → none (options + value passed in as props)
 *
 * NOTES / GOTCHAS:
 *   - Inline expandable, not a modal — per the tech-mobile UX rules (no modals
 *     for field actions; the tech keeps context of which line they're editing).
 *   - Options are { id, name } (already normalized by parseQboCatalog). onChange
 *     fires with the option or null (Clear).
 * ════════════════════════════════════════════════
 */
import { useMemo, useState } from 'react';

export default function CatalogPicker({ label, value, valueName, options = [], disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const pick = (opt) => {
    onChange(opt);
    setOpen(false);
    setQuery('');
  };

  const display = valueName || (value ? String(value) : '');

  return (
    <div className="am-estb-picker">
      <div className="am-estb-picker-label">{label}</div>
      <button
        type="button"
        className={`am-estb-picker-btn${display ? '' : ' am-estb-picker-btn--empty'}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className="am-estb-picker-value">{display || (disabled ? '—' : `Choose ${label.toLowerCase()}…`)}</span>
        <span className="am-estb-picker-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="am-estb-picker-drop">
          <input
            className="am-estb-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            autoFocus
          />
          <div className="am-estb-picker-list">
            {display && (
              <button type="button" className="am-estb-picker-opt am-estb-picker-opt--clear" onClick={() => pick(null)}>
                Clear {label.toLowerCase()}
              </button>
            )}
            {filtered.length === 0 && <div className="am-estb-picker-empty">No matches.</div>}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`am-estb-picker-opt${String(value) === o.id ? ' am-estb-picker-opt--on' : ''}`}
                onClick={() => pick(o)}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
