/**
 * ════════════════════════════════════════════════
 * FILE: TechV2Page.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A plain page frame for v2 tech screens: a title heading and a padded content
 *   area, with an optional line of actions on the right. It gives the dashboard
 *   and schedule a consistent starting shape so they don't each reinvent the
 *   header spacing and typography.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared scaffold)
 *   Rendered by:  v2 dashboard + schedule pages (as their body content)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  index.css (--tech-* tokens)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - This is the BODY scaffold. The fixed/sticky header that must not move on
 *     pull-to-refresh belongs in TechPane's `header` slot, not here.
 * ════════════════════════════════════════════════
 */
import React from 'react';

/**
 * @param {{ title?: string, subtitle?: string, actions?: React.ReactNode, children: React.ReactNode }} props
 */
export default function TechV2Page({ title, subtitle, actions, children }) {
  return (
    <div className="tv2-page">
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 16px 8px' }}>
          <div>
            {title && <h1 style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h1>}
            {subtitle && <p style={{ fontSize: 'var(--tech-text-label)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>{subtitle}</p>}
          </div>
          {actions && <div style={{ flex: '0 0 auto' }}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
