/**
 * ════════════════════════════════════════════════
 * FILE: PageHeader.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The standard title row at the top of a page — a big title, an optional
 *   subtitle line (usually a count like "12 of 340 jobs"), and an optional area
 *   on the right for action buttons. Using one component here means every page's
 *   header lines up and reads the same way.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  the top of most list/detail pages (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  styles in src/index.css (.ui-page-header); mirrors the .page-title/.page-subtitle idiom
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - `actions` renders on the right (buttons, a create menu). The title is an <h1>
 *     (the page's heading) styled via .ui-page-header-title.
 * ════════════════════════════════════════════════
 */

export default function PageHeader({ title, subtitle, actions, className = '', children }) {
  return (
    <div className={`ui-page-header${className ? ' ' + className : ''}`}>
      <div className="ui-page-header-titles">
        <h1 className="ui-page-header-title">{title}</h1>
        {subtitle != null && <div className="ui-page-header-sub">{subtitle}</div>}
        {children}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </div>
  );
}
