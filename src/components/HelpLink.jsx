/**
 * ════════════════════════════════════════════════
 * FILE: HelpLink.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small "?" you can drop next to a title or toolbar that takes the user
 *   straight to the matching part of the in-app Help guides. It opens the guide
 *   in a NEW TAB on purpose, so if someone is in the middle of filling out a
 *   form or a popup, clicking it never throws away what they were doing.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a reusable bit of UI, not a page)
 *   Rendered by:  any feature screen that wants a contextual help link —
 *                  CreateJobModal, InvoiceEditor, Collections, ClaimsList, …
 *
 * DEPENDS ON:
 *   Packages:  react (JSX only)
 *   Internal:  @/lib/navItems (reuses the shared IconHelp "?" SVG)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - `anchor` is the /help hash WITHOUT the leading # — "guide[/section]", e.g.
 *     "how-it-works/creating-a-job" or just "invoicing". Help.jsx parses that.
 *   - It's a plain <a target="_blank"> (no router) so the new tab is native and
 *     it behaves identically from a modal, a page header, or a table row.
 *   - onClick stopPropagation is load-bearing: several hosts close-on-click
 *     (e.g. CreateJobModal's backdrop) or have row handlers. We never
 *     preventDefault — the link must still navigate.
 *   - Conditional display (by role/flag) is the caller's job; this stays dumb.
 * ════════════════════════════════════════════════
 */
import { IconHelp } from '@/lib/navItems';

export default function HelpLink({ anchor, label, size = 'sm', variant = 'icon', title, style }) {
  const px = size === 'md' ? 16 : 14;
  const tip = title || 'Open the help guide';
  const isIcon = variant === 'icon';

  return (
    <a
      href={`/help#${anchor}`}
      target="_blank"
      rel="noopener noreferrer"
      title={tip}
      aria-label={tip}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: label ? 5 : 0,
        flexShrink: 0, textDecoration: 'none', color: 'var(--text-tertiary)',
        transition: 'color .15s, background .15s',
        ...(isIcon
          ? { width: 26, height: 26, justifyContent: 'center', borderRadius: 'var(--radius-md)' }
          : { fontSize: 13, fontWeight: 600 }),
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--accent)';
        if (isIcon) e.currentTarget.style.background = 'var(--accent-light)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-tertiary)';
        if (isIcon) e.currentTarget.style.background = 'transparent';
      }}
    >
      <IconHelp style={{ width: px, height: px }} />
      {label && <span>{label}</span>}
    </a>
  );
}
