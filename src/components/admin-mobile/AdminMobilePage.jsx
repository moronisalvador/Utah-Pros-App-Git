/**
 * ════════════════════════════════════════════════
 * FILE: AdminMobilePage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The common outer frame every admin screen inside the field-tech app sits in.
 *   It draws the screen title (with an optional back arrow and an optional action
 *   button on the right) and then shows whatever the screen puts inside it. Using
 *   one shared frame keeps all the admin screens looking the same.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a layout wrapper component)
 *   Rendered by:  the admin-mobile stub pages (AdminDash, AdminCollections, …)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (Link for the back arrow)
 *   Internal:  ./icons (IconChevronLeft)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Styling is the shared .am-* vocabulary (published in index.css §SHARED).
 *   - `back` may be a route string (renders a Link) or a function (renders a
 *     button that calls it, e.g. navigate(-1)).
 * ════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom';
import { IconChevronLeft } from './icons';

export default function AdminMobilePage({ title, subtitle, back, action, children }) {
  return (
    <div className="am-page">
      <div className="am-page-header">
        <div className="am-page-header-lead">
          {back != null && (
            typeof back === 'function' ? (
              <button type="button" className="am-back-btn" onClick={back} aria-label="Back">
                <IconChevronLeft width={22} height={22} />
              </button>
            ) : (
              <Link to={back} className="am-back-btn" aria-label="Back">
                <IconChevronLeft width={22} height={22} />
              </Link>
            )
          )}
          <div className="am-page-heading">
            <div className="am-page-title">{title}</div>
            {subtitle && <div className="am-page-subtitle">{subtitle}</div>}
          </div>
        </div>
        {action && <div className="am-page-action">{action}</div>}
      </div>
      <div className="am-page-body">
        {children}
      </div>
    </div>
  );
}
