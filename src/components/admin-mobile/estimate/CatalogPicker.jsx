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
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { impact, selection } from '@/lib/nativeHaptics';

export default function CatalogPicker({ label, value, valueName, options = [], disabled, onChange, classPrefix = 'am-estb-picker' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);
  const popupId = `${useId()}-popup`;
  const popupOpen = open && !disabled;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const restoreTriggerFocus = () => triggerRef.current?.focus();
  const close = () => {
    setOpen(false);
    setQuery('');
    restoreTriggerFocus();
  };
  const pick = (opt) => {
    // A picker can become disabled while its popup is still mounted (for
    // example, while the parent saves). Never let a stale option click change
    // form state after that transition.
    if (disabled) return;
    selection();
    onChange(opt);
    close();
  };

  useEffect(() => {
    if (!disabled || !open) return undefined;
    // The disabled render hides the popup immediately. Clear its local open
    // state in a microtask as well, so a later re-enable cannot revive it.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setOpen(false);
      setQuery('');
    });
    return () => { active = false; };
  }, [disabled, open]);

  const display = valueName || (value ? String(value) : '');

  return (
    <div className={classPrefix}>
      <div className={`${classPrefix}-label`}>{label}</div>
      <button
        ref={triggerRef}
        type="button"
        className={`${classPrefix}-btn${display ? '' : ` ${classPrefix}-btn--empty`}`}
        aria-label={`${label}: ${display || (disabled ? 'unavailable' : `Choose ${label.toLowerCase()}`)}`}
        aria-expanded={popupOpen}
        aria-controls={popupId}
        onClick={() => {
          if (disabled) return;
          impact('light');
          if (popupOpen) {
            close();
            return;
          }
          setQuery('');
          setOpen(true);
        }}
        disabled={disabled}
      >
        <span className={`${classPrefix}-value`}>{display || (disabled ? '—' : `Choose ${label.toLowerCase()}…`)}</span>
        <span className={`${classPrefix}-caret`} aria-hidden="true">{popupOpen ? '▴' : '▾'}</span>
      </button>

      {popupOpen && (
        <div
          id={popupId}
          className={`${classPrefix}-drop`}
          onKeyDown={(event) => { if (event.key === 'Escape' && !disabled) close(); }}
        >
          <input
            className={`${classPrefix}-search`}
            aria-label={`Search ${label}`}
            value={query}
            onChange={(e) => { if (!disabled) setQuery(e.target.value); }}
            placeholder={`Search ${label.toLowerCase()}…`}
            autoFocus
          />
          <div className={`${classPrefix}-list`}>
            {display && (
              <button type="button" className={`${classPrefix}-opt ${classPrefix}-opt--clear`} onClick={() => pick(null)} disabled={disabled}>
                Clear {label.toLowerCase()}
              </button>
            )}
            {filtered.length === 0 && <div className={`${classPrefix}-empty`}>No matches.</div>}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`${classPrefix}-opt${String(value) === o.id ? ` ${classPrefix}-opt--on` : ''}`}
                onClick={() => pick(o)}
                disabled={disabled}
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
