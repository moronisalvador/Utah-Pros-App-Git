/**
 * ════════════════════════════════════════════════
 * FILE: Card.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The reusable "card" frame that every box on the Overview dashboard sits in
 *   — the white rounded panel with a title at the top, an optional little
 *   drag-handle in the corner, and a thin divider line above a footer. Also a
 *   couple of tiny shared pieces: the green/red "up/down %" pill and the footer
 *   "View all →" link. Keeping these in one place means all the cards look
 *   identical and we only fix the shell once.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational primitives)
 *   Rendered by:  src/components/overview/Widgets.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./tokens (C palette)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The ⠿ drag handle is decorative for now (Phase 1 is a static grid).
 *     Drag/resize/reorder + per-user persistence is Phase 3 — the handle is
 *     already here so wiring it up later is purely behavioral.
 *   - `title` accepts a node (not just a string) so cards can embed things like
 *     the live "LIVE" badge in the Employee status header.
 * ════════════════════════════════════════════════
 */

import { C } from './tokens';

// ─── SECTION: Shared primitives ──────────────

export function DragHandle({ show = true }) {
  if (!show) return null;
  return (
    <span className="ovw-handle" title="Drag to rearrange (coming soon)" aria-hidden="true">⠿</span>
  );
}

export function DeltaPill({ dir, pct }) {
  const up = dir === 'up';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 11.5, fontWeight: 700,
        color: up ? '#15803d' : '#c0322c',
        background: up ? '#e9f7ef' : '#fdecea',
        padding: '3px 7px', borderRadius: 999,
      }}
    >
      {up ? '▲' : '▼'} {pct}%
    </span>
  );
}

// Footer link styled as a button (no real navigation in Phase 1).
export function FootLink({ children, onClick }) {
  return (
    <button type="button" className="ovw-link" onClick={onClick}>{children}</button>
  );
}

// The hairline footer row — pass exactly two children (left node, right node).
export function CardFooter({ children }) {
  return <div className="ovw-foot">{children}</div>;
}

// Small muted left-hand summary span used in most footers.
export function FootSummary({ children, color = C.body, weight = 600, size = 12 }) {
  return <span style={{ fontSize: size, color, fontWeight: weight }}>{children}</span>;
}

// ─── SECTION: Card shell ──────────────

export function Card({
  spanClass,
  title,
  suffix,
  dotColor,
  right,
  showHandle = true,
  wide = false,
  gap,
  headGap,
  children,
}) {
  return (
    <section
      className={`ovw-card${wide ? ' ovw-card-wide' : ''} ${spanClass}`}
      style={gap != null ? { gap } : undefined}
    >
      <div className="ovw-card-head" style={headGap != null ? { marginBottom: headGap } : undefined}>
        <div className="ovw-card-title">
          {dotColor && (
            <span style={{ width: 8, height: 8, borderRadius: 3, background: dotColor, flex: 'none' }} />
          )}
          {title}
          {suffix && <span className="ovw-suffix">{suffix}</span>}
        </div>
        <div className="ovw-head-right">
          {right}
          <DragHandle show={showHandle} />
        </div>
      </div>
      {children}
    </section>
  );
}
