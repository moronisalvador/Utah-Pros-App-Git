/**
 * ════════════════════════════════════════════════
 * FILE: GlobalSearch.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The search box in the desktop top bar. As you type (after 2 letters), it
 *   looks across customers, claims, jobs, invoices and payments and shows the
 *   matches grouped in a dropdown. Clicking a result jumps straight to that
 *   record's page.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (desktop top bar, ≥1280px only)
 *   Rendered by:  src/components/TopNav.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (db), @/components/Icons (IconSearch)
 *   Data:      reads → contacts, claims, jobs, invoices, payments
 *                      (via the global_search RPC) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - 300ms debounce + 2-char minimum (same idiom as CreateJobModal's typeahead).
 *   - Payments have no detail page → a payment result opens its invoice editor
 *     (falls back to its job). The "estimates" bucket is reserved/empty until an
 *     estimates module exists, so it never renders.
 *   - Calls through a db ref so it survives auth-token refresh.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';

// Render order + how each result type routes. Payments have no own page, so they
// open the linked invoice (or job). Estimates are intentionally absent (no module).
const GROUPS = [
  { key: 'customers', label: 'Customers', route: it => `/customers/${it.id}` },
  { key: 'claims',    label: 'Claims',    route: it => `/claims/${it.id}` },
  { key: 'jobs',      label: 'Jobs',      route: it => `/jobs/${it.id}` },
  { key: 'invoices',  label: 'Invoices',  route: it => `/invoices/${it.id}` },
  { key: 'payments',  label: 'Payments',  route: it => (it.invoice_id ? `/invoices/${it.invoice_id}` : (it.job_id ? `/jobs/${it.job_id}` : null)) },
];

export default function GlobalSearch() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const dbRef = useRef(db);
  dbRef.current = db;

  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  const runSearch = useCallback(async (t) => {
    if (t.trim().length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await dbRef.current.rpc('global_search', { p_term: t.trim(), p_limit: 6 });
      setResults(r || {});
    } catch { setResults({}); }
    finally { setLoading(false); }
  }, []);

  const onChange = (e) => {
    const v = e.target.value;
    setTerm(v);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(v), 300);
  };

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  const go = (path) => {
    if (!path) return;
    setOpen(false);
    setTerm('');
    setResults(null);
    navigate(path);
  };

  const hasAny = results && GROUPS.some(g => (results[g.key] || []).length > 0);
  const showDrop = open && term.trim().length >= 2;

  return (
    <div className="topnav-search" ref={ref}>
      <IconSearch className="topnav-search-icon" />
      <input
        className="topnav-search-input"
        type="text"
        placeholder="Search…"
        value={term}
        onChange={onChange}
        onFocus={() => setOpen(true)}
        aria-label="Search customers, claims, jobs, invoices, payments"
      />
      {showDrop && (
        <div className="topnav-search-results" role="listbox">
          {loading && <div className="topnav-search-loading">Searching…</div>}
          {!loading && !hasAny && <div className="topnav-search-empty">No matches for “{term.trim()}”.</div>}
          {!loading && hasAny && GROUPS.map(g => {
            const items = results[g.key] || [];
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="topnav-search-group-label">{g.label}</div>
                {items.map(it => (
                  <button
                    key={`${g.key}-${it.id}`}
                    className="topnav-search-item"
                    role="option"
                    onClick={() => go(g.route(it))}
                  >
                    <span className="topnav-search-item-title">{it.title}</span>
                    {it.subtitle && <span className="topnav-search-item-sub">{it.subtitle}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
