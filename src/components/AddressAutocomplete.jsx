import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { loadPlaces, parseAddressComponents, hasPlacesKey } from '@/lib/googleMaps';

/**
 * AddressAutocomplete — street-input with Google Places suggestions dropdown.
 * Parent owns city/state/zip inputs. When user picks a suggestion, onSelect
 * fires with parsed { address, city, state, zip } so parent can fill siblings.
 * Falls back to a plain input when API key missing or script fails to load.
 */
function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Street address',
  required = false,
  style,
  className = 'input',
  touchTarget = false,
  autoFocus = false,
  dropdownZIndex = 9999,
}) {
  const [enabled, setEnabled] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0, above: false });
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const tokenRef = useRef(null);
  const placesRef = useRef(null);
  const debounceRef = useRef(null);
  const lastPickedRef = useRef('');
  const reqSeq = useRef(0);

  useEffect(() => {
    if (!hasPlacesKey()) return;
    let cancelled = false;
    loadPlaces().then((p) => {
      if (cancelled || !p) return;
      placesRef.current = p;
      tokenRef.current = new p.AutocompleteSessionToken();
      setEnabled(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const inInput = inputRef.current && inputRef.current.contains(e.target);
      const inDrop = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inInput && !inDrop) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const positionDropdown = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const estHeight = 240;
    const above = spaceBelow < 180 && r.top > estHeight;
    setDropPos({
      top: above ? r.top - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      above,
    });
  }, []);

  const fetchSuggestions = useCallback(async (input) => {
    const p = placesRef.current;
    if (!p || !input || input.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (!tokenRef.current) tokenRef.current = new p.AutocompleteSessionToken();
    const seq = ++reqSeq.current;
    try {
      const { suggestions: results } = await p.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: tokenRef.current,
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
        includedRegionCodes: ['us'],
      });
      if (seq !== reqSeq.current) return;
      const list = (results || [])
        .map((s) => s.placePrediction)
        .filter(Boolean)
        .map((pp) => ({
          placeId: pp.placeId,
          mainText: pp.mainText?.text || '',
          secondaryText: pp.secondaryText?.text || '',
          _pp: pp,
        }));
      setSuggestions(list);
      setActiveIdx(-1);
      if (list.length > 0) {
        positionDropdown();
        setOpen(true);
      } else {
        setOpen(false);
      }
    } catch {
      setSuggestions([]);
      setOpen(false);
    }
  }, [positionDropdown]);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange?.(v);
    if (!enabled) return;
    if (v === lastPickedRef.current) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 150);
  };

  const handleFocus = () => {
    if (enabled && suggestions.length > 0) {
      positionDropdown();
      setOpen(true);
    }
  };

  const pickSuggestion = async (sugg) => {
    const p = placesRef.current;
    if (!p || !sugg) return;
    setOpen(false);
    try {
      const place = sugg._pp.toPlace();
      await place.fetchFields({
        fields: ['addressComponents', 'formattedAddress'],
        sessionToken: tokenRef.current,
      });
      const parts = parseAddressComponents(place.addressComponents);
      lastPickedRef.current = parts.address;
      onSelect?.(parts);
      tokenRef.current = new p.AutocompleteSessionToken();
    } catch (err) {
      console.warn('[AddressAutocomplete] fetchFields failed:', err?.message || err);
    }
  };

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const rowStyle = touchTarget ? { minHeight: 48, padding: '12px var(--space-3)' } : undefined;

  const transformStyle = dropPos.above ? { transform: 'translateY(-100%)' } : undefined;

  return (
    <div className="lookup-select-wrap" style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className={className}
        type="text"
        value={value || ''}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        style={style}
      />
      {open && suggestions.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          className="lookup-select-dropdown"
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: dropdownZIndex,
            ...transformStyle,
          }}
        >
          {suggestions.map((s, i) => (
            <button
              key={s.placeId}
              type="button"
              className={`lookup-select-item${i === activeIdx ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
              style={rowStyle}
            >
              <span className="lookup-select-name">{s.mainText}</span>
              {s.secondaryText && <span className="lookup-select-tag" style={{ background: 'transparent', color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{s.secondaryText}</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default memo(AddressAutocomplete);
