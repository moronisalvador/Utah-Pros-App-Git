/**
 * ════════════════════════════════════════════════
 * FILE: skeletons.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gray placeholder blocks that shimmer while a v2 screen is loading for the
 *   very first time (a true cold start with nothing cached). Once there's cached
 *   content, screens show that instead and never fall back to these — the rule is
 *   "content is never replaced by a spinner."
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  v2 dashboard + schedule on cold start
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  index.css (.tv2-skel)
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import React from 'react';

/** A single shimmer block. */
export function SkeletonBlock({ height = 16, width = '100%', radius, style }) {
  return <div className="tv2-skel" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** A skeleton standing in for an ApptListRow. */
export function SkeletonRow() {
  return (
    <div className="tv2-appt-row" style={{ boxShadow: 'none' }}>
      <SkeletonBlock width={4} height={40} radius={2} />
      <div style={{ flex: 1 }}>
        <SkeletonBlock width="60%" height={14} />
        <SkeletonBlock width="40%" height={11} style={{ marginTop: 8 }} />
      </div>
      <SkeletonBlock width={64} height={20} radius={999} />
    </div>
  );
}

/** A list of skeleton rows for a cold-start feed. */
export function SkeletonList({ rows = 5 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}
