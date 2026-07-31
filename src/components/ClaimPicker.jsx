/**
 * ════════════════════════════════════════════════
 * FILE: ClaimPicker.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets someone search for and link an existing claim while they prepare an out-of-pocket quote.
 *   They can keep typing a new customer name when there is no matching claim, and search errors are clear.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared calculator control)
 *   Rendered by:  OOP pricing calculators
 *
 * DEPENDS ON:
 *   Packages:  React
 *   Internal:  ClaimPicker.css, AuthContext, IconButton, nativeHaptics, reducedMotion
 *   Data:      reads  → get_claims_list
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Tech callers opt into 48px controls through `tech`; the main surface keeps its own tokenized sizing.
 *   - Claim-load failures render a retry state and never masquerade as an empty search result.
 * ════════════════════════════════════════════════
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './ClaimPicker.css';
import { useAuth } from '@/contexts/AuthContext';
import { IconButton } from '@/components/ui';
import { impact } from '@/lib/nativeHaptics';
import { prefersReducedMotion } from '@/lib/reducedMotion';

const POPUP_EXIT_FALLBACK_MS = 180;

export default function ClaimPicker({ label, value, onChangeText, onSelectClaim, linkedClaim, onUnlink, placeholder = 'Type homeowner name or search claims…', compact = false, tech = false }) {
  const { db } = useAuth();
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [allClaims, setAllClaims] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  // ─── SECTION: Data fetching ──────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await db.rpc('get_claims_list', {});
        if (!cancelled) { setAllClaims(rows || []); setLoaded(true); setLoadError(''); }
      } catch (error) {
        if (!cancelled) { setAllClaims([]); setLoaded(false); setLoadError(error?.message || 'Claims search is unavailable.'); }
      }
    })();
    return () => { cancelled = true; };
  }, [db, loadAttempt]);

  // Keep the popup mounted long enough for its accelerated exit. Animation-end
  // normally removes it; this bounds interrupted/backgrounded WebViews.
  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setClosing(false), POPUP_EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  // ─── SECTION: Helpers ──────────────
  const filtered = useMemo(() => {
    if (!value || value.length < 1) return [];
    const q = value.toLowerCase();
    const selectedId = linkedClaim?.id;
    return allClaims.filter((claim) => claim.id !== selectedId && (
      (claim.insured_name || '').toLowerCase().includes(q)
      || (claim.claim_number || '').toLowerCase().includes(q)
      || (claim.loss_city || '').toLowerCase().includes(q)
      || (claim.loss_address || '').toLowerCase().includes(q)
    )).slice(0, 6);
  }, [value, allClaims, linkedClaim]);
  const safeActiveIndex = activeIndex >= filtered.length ? -1 : activeIndex;

  const hasDropdown = Boolean(value && filtered.length > 0);
  const hasLoadError = Boolean(value && loadError && !linkedClaim);
  const hasNoMatch = Boolean(value && loaded && !loadError && filtered.length === 0 && !linkedClaim);
  const showDropdown = open && hasDropdown;
  const showLoadError = open && hasLoadError;
  const showNoMatch = open && hasNoMatch;
  const popupOpen = showDropdown || showLoadError || showNoMatch;
  const popupPresent = popupOpen || closing;
  const renderDropdown = showDropdown || (closing && hasDropdown);
  const renderLoadError = showLoadError || (closing && hasLoadError);
  const renderNoMatch = showNoMatch || (closing && hasNoMatch);
  const popupId = `${listboxId}-popup`;
  const optionId = (index) => `${listboxId}-option-${index}`;
  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
    setClosing(popupOpen && !prefersReducedMotion());
  };
  const openPopup = () => { setClosing(false); setOpen(true); };
  const selectClaim = (claim) => { if (tech) impact('light'); onSelectClaim(claim); close(); };
  const retry = () => { if (tech) impact('light'); setLoaded(false); setLoadError(''); setLoadAttempt((attempt) => attempt + 1); };

  // ─── SECTION: Event handlers ──────────────
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') { close(); return; }
    if (!filtered.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); openPopup();
      setActiveIndex((index) => (event.key === 'ArrowDown' ? (index < filtered.length - 1 ? index + 1 : 0) : (index > 0 ? index - 1 : filtered.length - 1)));
      return;
    }
    if (safeActiveIndex >= 0) { event.preventDefault(); selectClaim(filtered[safeActiveIndex]); }
  };
  const handleBlur = (event) => {
    // Keep the menu while keyboard focus moves between the input, results, and retry control.
    if (!rootRef.current?.contains(event.relatedTarget)) close();
  };

  // ─── SECTION: Render ──────────────
  return (
    <div ref={rootRef} className={`claim-picker${compact ? ' claim-picker--compact' : ''}${tech ? ' claim-picker--tech' : ''}`} onBlur={handleBlur}>
      <div className="claim-picker__label-row">
        <label className="claim-picker__label" htmlFor={inputId}>{label}</label>
        {linkedClaim && <div className="claim-picker__linked">
          <span className="claim-picker__linked-number">{linkedClaim.claim_number || 'Linked'}</span>
          <IconButton label="Unlink claim" size={tech ? 'lg' : undefined} className="claim-picker__unlink" onClick={onUnlink}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </IconButton>
        </div>}
      </div>
      <input id={inputId} className="claim-picker__input" type="text" value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChangeText(nextValue);
          if (nextValue) openPopup(); else close();
          setActiveIndex(-1);
        }} onFocus={openPopup} onKeyDown={handleKeyDown}
        placeholder={placeholder} autoComplete="off" autoCorrect="off" autoCapitalize="words" role="combobox" aria-autocomplete="list"
        aria-expanded={popupOpen} aria-controls={popupOpen ? popupId : undefined} aria-activedescendant={safeActiveIndex >= 0 && showDropdown ? optionId(safeActiveIndex) : undefined} />
      {popupPresent && <div
        id={popupId}
        className="claim-picker__menu"
        data-state={popupOpen ? 'open' : 'closing'}
        aria-hidden={!popupOpen}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !popupOpen) setClosing(false);
        }}
      >
        {renderLoadError && <div className="claim-picker__error" role="alert"><span>Claims search is unavailable.</span><button type="button" className="btn btn-secondary btn-sm claim-picker__retry" onClick={retry}>Retry</button></div>}
        {renderNoMatch && <div className="claim-picker__empty">No matching claims. Keep typing for a new customer.</div>}
        {renderDropdown && <div id={listboxId} role="listbox" aria-label={`${label} matches`}>
          {filtered.map((claim, index) => <button key={claim.id} id={optionId(index)} className="claim-picker__option" type="button" role="option" aria-selected={safeActiveIndex === index}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectClaim(claim)}>
            <span className="claim-picker__option-name">{claim.insured_name || '(no name)'}</span>
            <span className="claim-picker__option-meta">{claim.claim_number && <span className="claim-picker__option-number">{claim.claim_number}</span>}{(claim.loss_address || claim.loss_city) && <span>{claim.loss_address || ''}{claim.loss_address && claim.loss_city ? ', ' : ''}{claim.loss_city || ''}</span>}</span>
          </button>)}
        </div>}
      </div>}
    </div>
  );
}