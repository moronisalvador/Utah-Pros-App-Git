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
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import IconButton from '@/components/ui/IconButton';
import { impact } from '@/lib/nativeHaptics';
import { IconChevronLeft } from './icons';

function BackControl({ back }) {
  if (back == null) return null;
  return typeof back === 'function' ? (
    <IconButton size="lg" className="am-back-btn" onClick={back} label="Back">
      <IconChevronLeft width={22} height={22} aria-hidden="true" />
    </IconButton>
  ) : (
    <Link to={back} className="am-back-btn" aria-label="Back" onClick={() => impact('light')}>
      <IconChevronLeft width={22} height={22} aria-hidden="true" />
    </Link>
  );
}

export default function AdminMobilePage({
  title,
  subtitle,
  back,
  action,
  children,
  bodyClassName = '',
}) {
  const { key: routeKey } = useLocation();
  const headingRef = useRef(null);
  const focusedRouteKeyRef = useRef(null);

  // A destination page announces itself after navigation. Route keys, rather
  // than render count, keep ordinary data/state updates from stealing focus.
  useEffect(() => {
    if (focusedRouteKeyRef.current === routeKey) return;
    focusedRouteKeyRef.current = routeKey;
    headingRef.current?.focus({ preventScroll: true });
  }, [routeKey]);

  return (
    <div className="am-page">
      <div className="am-page-header">
        <div className="am-page-header-lead">
          <BackControl back={back} />
          <div className="am-page-heading">
            <h1 ref={headingRef} tabIndex={-1} className="am-page-title">{title}</h1>
            {subtitle && <div className="am-page-subtitle">{subtitle}</div>}
          </div>
        </div>
        {action && <div className="am-page-action">{action}</div>}
      </div>
      <div className={`am-page-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
        {children}
      </div>
    </div>
  );
}
