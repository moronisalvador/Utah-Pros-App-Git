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
 *   Data:      reads  → get_claims_list; claims (visible-match address enrichment)
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
import { IconButton, SkeletonBlock } from '@/components/ui';
import { impact } from '@/lib/nativeHaptics';
import { prefersReducedMotion } from '@/lib/reducedMotion';

const POPUP_EXIT_FALLBACK_MS = 180;
const CLAIM_DETAIL_DEBOUNCE_MS = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatClaimAddress(claim) {
  const stateZip = [claim?.loss_state, claim?.loss_zip].filter(Boolean).join(' ');
  return [claim?.loss_address, claim?.loss_city, stateZip].filter(Boolean).join(', ');
}

function formatLossDate(value) {
  if (!value) return '';
  const raw = String(value);
  const date = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
  const [claimDetails, setClaimDetails] = useState({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailLoadError, setDetailLoadError] = useState('');
  const [detailLoadAttempt, setDetailLoadAttempt] = useState(0);

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

  const baseFiltered = useMemo(() => {
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
  const visibleClaimIdsKey = open ? baseFiltered
    .map((claim) => claim.id)
    .filter((id) => UUID.test(id))
    .join(',') : '';

  // The shared list RPC intentionally omits street and ZIP. Enrich only the
  // visible six matches through the already-authorized claims read instead of
  // widening or replacing that shared RPC contract.
  useEffect(() => {
    let cancelled = false;
    const ids = visibleClaimIdsKey ? visibleClaimIdsKey.split(',') : [];
    if (!ids.length) {
      setDetailsLoading(false);
      setDetailLoadError('');
      return undefined;
    }
    setDetailsLoading(true);
    setDetailLoadError('');
    const timer = window.setTimeout(async () => {
      try {
        const rows = await db.select(
          'claims',
          `id=in.(${ids.join(',')})&select=id,loss_address,loss_city,loss_state,loss_zip,date_of_loss`,
        );
        if (cancelled) return;
        const nextDetails = Object.fromEntries((rows || []).map((claim) => [claim.id, claim]));
        setClaimDetails((current) => ({ ...current, ...nextDetails }));
        setDetailLoadError('');
      } catch (error) {
        if (!cancelled) setDetailLoadError(error?.message || 'Full claim addresses are unavailable.');
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    }, CLAIM_DETAIL_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [db, detailLoadAttempt, visibleClaimIdsKey]);

  // Keep the popup mounted long enough for its accelerated exit. Animation-end
  // normally removes it; this bounds interrupted/backgrounded WebViews.
  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(() => setClosing(false), POPUP_EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  // ─── SECTION: Helpers ──────────────
  const filtered = useMemo(() => {
    return baseFiltered.map((claim) => ({ ...claim, ...(claimDetails[claim.id] || {}) }));
  }, [baseFiltered, claimDetails]);
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
  const retryClaimDetails = () => {
    if (tech) impact('light');
    setDetailLoadError('');
    setDetailLoadAttempt((attempt) => attempt + 1);
  };

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
        {renderDropdown && <>
          {detailsLoading && <div className="claim-picker__details-loading" role="status" aria-label="Loading full claim details">
            <SkeletonBlock width="58%" height="var(--space-2)" />
            <SkeletonBlock width="82%" height="var(--space-2)" />
          </div>}
          {detailLoadError && <div className="claim-picker__details-error" role="alert"><span>Full claim addresses are unavailable.</span><button type="button" className="btn btn-secondary btn-sm claim-picker__retry" onClick={retryClaimDetails}>Retry</button></div>}
          <div id={listboxId} role="listbox" aria-label={`${label} matches`}>
          {filtered.map((claim, index) => <button key={claim.id} id={optionId(index)} className="claim-picker__option" type="button" role="option" aria-selected={safeActiveIndex === index}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectClaim(claim)}>
            <span className="claim-picker__option-name">{claim.insured_name || '(no name)'}</span>
            <span className="claim-picker__option-meta">
              <span className="claim-picker__option-number">{claim.claim_number || 'Claim number not recorded'}</span>
              <span className="claim-picker__option-loss-date">{formatLossDate(claim.date_of_loss) ? `Loss ${formatLossDate(claim.date_of_loss)}` : 'Date of loss not recorded'}</span>
            </span>
            <span className="claim-picker__option-address">{formatClaimAddress(claim) || 'Address not recorded'}</span>
          </button>)}
          </div>
        </>}
      </div>}
    </div>
  );
}
