/**
 * ════════════════════════════════════════════════
 * FILE: NewMenu.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The black "New" button at the top-right of the desktop bar. Clicking it
 *   drops down a little menu to start something new — a Claim (which opens the
 *   job creator), an Estimate, a Customer, or an Invoice. It doesn't do the work
 *   itself; it just tells the app shell which "create" pop-up to open.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (lives in the desktop top bar, ≥1280px only)
 *   Rendered by:  src/components/TopNav.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/navItems (IconPlus), @/contexts/AuthContext (isFeatureEnabled)
 *   Data:      reads → feature flags (gates New Estimate) · writes → none (delegates via onAction)
 *
 * NOTES / GOTCHAS:
 *   - "New Claim" → onAction('job'): a claim is created as part of the job
 *     creator (CreateJobModal). New Customer → 'customer', New Invoice →
 *     'invoice'. Layout.handleCreateAction maps these to the right modal.
 *   - "New Estimate" → onAction('estimate'): opens NewEstimateModal via
 *     Layout.handleCreateAction. Gated on the page:estimates feature flag, so it
 *     only appears when Estimates is enabled — in lockstep with its nav links.
 *   - Closes on outside-click and Escape (same pattern as the legacy CreateMenu).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconPlus } from '@/lib/navItems';

const OPTIONS = [
  { key: 'job',      label: 'New Claim',    desc: 'Start a claim & job', emoji: '\u{1F4C4}' },
  { key: 'estimate', label: 'New Estimate', desc: 'Build an estimate',   emoji: '\u{1F4D0}', flag: 'page:estimates' },
  { key: 'customer', label: 'New Customer', desc: 'Add a contact',       emoji: '\u{1F464}' },
  { key: 'invoice',  label: 'New Invoice',  desc: 'Create an invoice',   emoji: '\u{1F9FE}' },
];

function IconChevron(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function NewMenu({ onAction }) {
  const { isFeatureEnabled } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Hide flag-gated options (New Estimate) until the feature is enabled, so the
  // menu stays in lockstep with the Estimates nav links + routes.
  const options = OPTIONS.filter(o => !o.flag || isFeatureEnabled(o.flag));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const select = (key) => { setOpen(false); onAction?.(key); };

  return (
    <div className="topnav-new" ref={ref}>
      <button className={`topnav-new-btn${open ? ' active' : ''}`} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <IconPlus style={{ width: 15, height: 15 }} />
        New
        <IconChevron style={{ width: 13, height: 13, opacity: 0.8 }} />
      </button>
      {open && (
        <div className="topnav-menu topnav-menu--new" role="menu">
          {options.map(o => (
            <button key={o.key} className="topnav-menu-item" role="menuitem" onClick={() => select(o.key)}>
              <span className="topnav-menu-emoji">{o.emoji}</span>
              <span className="topnav-menu-text">
                <span className="topnav-menu-label">{o.label}</span>
                <span className="topnav-menu-desc">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
