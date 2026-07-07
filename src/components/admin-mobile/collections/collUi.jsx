/**
 * ════════════════════════════════════════════════
 * FILE: collUi.jsx  (admin-mobile Collections — small shared UI bits)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little reusable pieces the four Collections tabs all share: a status word
 *   pill (Paid / Overdue / Draft …), a search box, and an "empty" message when a
 *   list has nothing to show. Keeping them here means every tab looks and behaves
 *   the same.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational helpers)
 *   Rendered by:  the admin-mobile Collections tab components
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  ./collFormat (statusLabel, estimateStatusLabel)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Styling is the §COLLECTIONS `.am-coll-*` vocabulary in index.css. Color
 *     comes from status-tinted classes, so a status reads from three feet away.
 * ════════════════════════════════════════════════
 */
import { statusLabel, estimateStatusLabel } from './collFormat';

// A colored status word. `kind` is an invoice status (paid|overdue|draft|partial|sent)
// or, when `estimate` is set, an estimate status (converted|error|sent|draft).
export function StatusChip({ kind, estimate = false }) {
  if (!kind) return null;
  const label = estimate ? estimateStatusLabel(kind) : statusLabel(kind);
  return <span className={`am-coll-chip am-coll-chip--${kind}`}>{label}</span>;
}

export function CollSearch({ value, onChange, placeholder }) {
  return (
    <div className="am-coll-search">
      <input
        type="search"
        inputMode="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder || 'Search'}
      />
    </div>
  );
}

export function CollEmpty({ title, sub }) {
  return (
    <div className="am-coll-empty">
      <div className="am-coll-empty-title">{title}</div>
      {sub && <div className="am-coll-empty-sub">{sub}</div>}
    </div>
  );
}

export function CollFoot({ children }) {
  return <div className="am-coll-foot">{children}</div>;
}
