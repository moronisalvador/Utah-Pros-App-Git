/**
 * ════════════════════════════════════════════════
 * FILE: GlobalSearch.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The search box in the middle of the desktop top bar. As you type it will
 *   look across customers, claims, jobs, invoices and payments and show matching
 *   results in a dropdown; picking one jumps to that record.
 *
 *   NOTE: this is the shell (the box + open/close behavior). The live, typed
 *   search that calls the database is wired in a later step (the global_search
 *   RPC). Until then the box is visible but reports that search is coming.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (desktop top bar, ≥1280px only)
 *   Rendered by:  src/components/TopNav.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/Icons (IconSearch)
 *   Data:      reads → (planned) global_search RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Placeholder pending the global_search RPC migration; intentionally inert.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { IconSearch } from '@/components/Icons';

export default function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!focused) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setFocused(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [focused]);

  return (
    <div className="topnav-search" ref={ref}>
      <IconSearch className="topnav-search-icon" />
      <input
        className="topnav-search-input"
        type="text"
        placeholder="Search…"
        value={term}
        onChange={e => setTerm(e.target.value)}
        onFocus={() => setFocused(true)}
        aria-label="Search"
      />
      {focused && term.trim().length >= 2 && (
        <div className="topnav-search-results" role="listbox">
          <div className="topnav-search-empty">Search is being set up — coming soon.</div>
        </div>
      )}
    </div>
  );
}
