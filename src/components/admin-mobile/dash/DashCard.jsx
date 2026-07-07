/**
 * ════════════════════════════════════════════════
 * FILE: DashCard.jsx  (admin-mobile Dashboard — card shell + small pieces)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The common frame every card on the mobile admin dashboard sits in. It draws the
 *   card's title (and an optional little suffix or an up/down change pill), then
 *   shows the card's contents — or a soft shimmer while the numbers load, or a
 *   "Couldn't load · Retry" if the fetch failed. It also provides the small shared
 *   bits cards reuse: the change pill, a tappable footer link, and an empty-state
 *   line. Using one frame keeps every card looking the same.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational card shell)
 *   Rendered by:  the admin-mobile dashboard card components
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (Link for the footer deep-link)
 *   Internal:  ../icons (IconChevronRight)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Styling is the §DASH `.am-dash-*` vocabulary in index.css.
 *   - The card owns its loading/error chrome; a card's body renders only once its
 *     data is present, so a card never has to guard for null data itself.
 *   - The footer link uses Foundation's frozen href helper (never a hardcoded
 *     "/tech/admin/…" path).
 * ════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom';
import { IconChevronRight } from '../icons';

export function DashCard({ title, suffix, right, live = false, loading, error, onRetry, footer, children }) {
  return (
    <section className="am-dash-card">
      <header className="am-dash-card-head">
        <div className="am-dash-card-titles">
          <span className="am-dash-card-title">{title}</span>
          {live && <span className="am-dash-live"><span className="am-dash-live-dot" aria-hidden="true" />LIVE</span>}
          {suffix && <span className="am-dash-card-suffix">{suffix}</span>}
        </div>
        {right && !loading && !error && <div className="am-dash-card-right">{right}</div>}
      </header>

      {loading ? (
        <div className="am-dash-skeleton" aria-hidden="true">
          <span className="am-dash-shimmer" />
          <span className="am-dash-shimmer am-dash-shimmer--sm" />
        </div>
      ) : error ? (
        <div className="am-dash-error">
          <span>Couldn't load</span>
          <button type="button" className="am-dash-retry" onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <div className="am-dash-card-body">{children}</div>
      )}

      {footer && !loading && !error && <div className="am-dash-card-foot">{footer}</div>}
    </section>
  );
}

// Up/down change pill (mirror of the desktop DeltaPill).
export function DeltaPill({ dir, pct }) {
  if (dir == null || pct == null) return null;
  return (
    <span className={`am-dash-delta am-dash-delta--${dir}`}>
      {dir === 'up' ? '▲' : '▼'} {pct}%
    </span>
  );
}

// A tappable footer link — always built from the frozen href helper by the caller.
export function DashFootLink({ to, children }) {
  return (
    <Link to={to} className="am-dash-footlink">
      {children}
      <IconChevronRight width={15} height={15} />
    </Link>
  );
}

export function DashEmpty({ children }) {
  return <div className="am-dash-empty">{children}</div>;
}
