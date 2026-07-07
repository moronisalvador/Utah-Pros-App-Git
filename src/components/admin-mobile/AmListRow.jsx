/**
 * ════════════════════════════════════════════════
 * FILE: AmListRow.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One tappable row in an admin list — an invoice, an estimate, a lead. It shows
 *   a title, an optional line of smaller detail under it, an optional amount or
 *   status chip on the right, and a chevron hinting you can tap through. If given
 *   a link it becomes tappable; otherwise it's a plain row.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a shared presentational row)
 *   Rendered by:  the admin-mobile list screens (collections, leads, …)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (Link)
 *   Internal:  ./icons (IconChevronRight)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Pass `to` (a route string, build it with the href helpers) to make the row
 *     a link; pass `onClick` for a button-style row; pass neither for a static
 *     row. The chevron only shows when the row is navigable.
 *   - Minimum height uses the shared .am-row rule (>=48px touch target).
 * ════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom';
import { IconChevronRight } from './icons';

export default function AmListRow({ title, detail, trailing, to, onClick }) {
  const navigable = to != null || typeof onClick === 'function';
  const inner = (
    <>
      <div className="am-row-main">
        <div className="am-row-title">{title}</div>
        {detail != null && <div className="am-row-detail">{detail}</div>}
      </div>
      {trailing != null && <div className="am-row-trailing">{trailing}</div>}
      {navigable && <IconChevronRight width={18} height={18} className="am-row-chevron" />}
    </>
  );

  if (to != null) {
    return <Link to={to} className="am-row">{inner}</Link>;
  }
  if (typeof onClick === 'function') {
    return <button type="button" className="am-row am-row--button" onClick={onClick}>{inner}</button>;
  }
  return <div className="am-row">{inner}</div>;
}
